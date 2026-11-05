import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { serviceJobPayments, serviceJobs } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { serviceJobPaymentSchema } from '@/lib/validation/schemas/service-jobs'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'
import {
  SERVICE_JOB_MONEY, addServiceJobHistory, postServiceJobAdvanceToGL, requireAnyPermission, serviceJobErrorResponse,
} from '@/lib/service-jobs/server'

// POST /api/service-jobs/[id]/payments — advance / part payment before delivery
// (Dr Cash/Bank, Cr Customer Advance; settled against the invoice when the job is converted).
// Up to the job total, or the estimate while no lines are priced yet.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, SERVICE_JOB_MONEY)
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, serviceJobPaymentSchema)
    if (!parsed.success) return parsed.response
    const { amount, paymentMethod, reference } = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, serviceJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied

      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(serviceJobs).where(eq(serviceJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
        if (job.saleId || job.status === 'delivered' || job.status === 'cancelled') {
          return { error: NextResponse.json({ error: `Payments cannot be taken on a ${job.status} job` }, { status: 400 }) }
        }
        const paidSoFar = parseCurrency(job.paidAmount)
        const ceiling = Math.max(parseCurrency(job.total), parseCurrency(job.estimateAmount || '0'))
        const room = roundCurrency(Math.max(0, ceiling - paidSoFar))
        const pay = roundCurrency(amount)
        if (room <= 0) return { error: NextResponse.json({ error: 'Nothing is due on this job (add the charges or an estimate first)' }, { status: 400 }) }
        if (pay > room + 0.01) {
          return { error: NextResponse.json({ error: `The payment is more than the amount due (${room.toFixed(2)})` }, { status: 400 }) }
        }
        const effective = roundCurrency(Math.min(pay, room))

        const [payment] = await tx.insert(serviceJobPayments).values({
          tenantId,
          serviceJobId: id,
          amount: String(effective),
          paymentMethod,
          reference: reference || null,
          receivedBy: userId,
          // the cash goes into this user's drawer (no open shift → recorded without one)
          posOpeningEntryId: await currentOpenShiftId(tx, userId),
        }).returning()
        await postServiceJobAdvanceToGL(tx, tenantId, {
          paymentId: payment.id, jobNo: job.jobNo, amount: effective, paymentMethod, customerId: job.customerId,
        })
        const paid = roundCurrency(paidSoFar + effective)
        const [updated] = await tx.update(serviceJobs).set({
          paidAmount: String(paid),
          balanceDue: String(roundCurrency(Math.max(0, parseCurrency(job.total) - paid))),
          updatedAt: new Date(),
        }).where(eq(serviceJobs.id, id)).returning()
        await addServiceJobHistory(tx, { tenantId, serviceJobId: id, note: `Advance ${effective.toFixed(2)} (${paymentMethod}) received`, changedBy: userId })
        return { data: { payment, job: { ...updated, passcode: undefined } } }
      })
      if ('error' in result) return result.error

      logAndBroadcast(tenantId, 'service-job', 'updated', id, {
        userId,
        entityName: result.data.job.jobNo,
        description: `Advance ${result.data.payment.amount} (${paymentMethod}) received for job "${result.data.job.jobNo}"`,
      })
      return NextResponse.json(result.data)
    })
  } catch (error) {
    const handled = serviceJobErrorResponse(error)
    if (handled) return handled
    logError('api/service-jobs/[id]/payments', error)
    return NextResponse.json({ error: 'Failed to record the payment' }, { status: 500 })
  }
}
