import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { printJobPayments, printJobs } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { printJobPaymentSchema } from '@/lib/validation/schemas/print-jobs'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { postPrintJobAdvanceToGL } from '@/lib/print-jobs/server'
import { printJobErrorResponse } from '@/lib/print-jobs/errors'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'

// POST /api/print-jobs/[id]/payments — take an advance / part payment before delivery
// (Dr Cash/Bank, Cr Customer Advance; settled against the invoice on delivery)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, printJobPaymentSchema)
    if (!parsed.success) return parsed.response
    const { amount, paymentMethod, reference } = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, printJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied

      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Print job not found' }, { status: 404 }) }
        if (job.saleId || job.status === 'delivered' || job.status === 'cancelled') {
          return { error: NextResponse.json({ error: `Payments cannot be taken on a ${job.status} job` }, { status: 400 }) }
        }
        const balance = parseCurrency(job.balanceDue)
        const pay = roundCurrency(amount)
        if (pay > balance + 0.01) {
          return { error: NextResponse.json({ error: `The payment is more than the balance due (${balance.toFixed(2)})` }, { status: 400 }) }
        }
        const effective = roundCurrency(Math.min(pay, balance))
        if (effective <= 0) return { error: NextResponse.json({ error: 'Nothing is due on this job' }, { status: 400 }) }

        const [payment] = await tx.insert(printJobPayments).values({
          tenantId,
          printJobId: id,
          amount: String(effective),
          paymentMethod,
          reference: reference || null,
          receivedBy: userId,
          // 0187: the cash goes into this user's drawer (no open shift → recorded without one)
          posOpeningEntryId: await currentOpenShiftId(tx, userId),
        }).returning()
        await postPrintJobAdvanceToGL(tx, tenantId, {
          paymentId: payment.id, jobNo: job.jobNo, amount: effective, paymentMethod, customerId: job.customerId,
        })
        const paid = roundCurrency(parseCurrency(job.paidAmount) + effective)
        const [updated] = await tx.update(printJobs).set({
          paidAmount: String(paid),
          balanceDue: String(roundCurrency(Math.max(0, parseCurrency(job.total) - paid))),
          updatedAt: new Date(),
        }).where(eq(printJobs.id, id)).returning()
        return { data: { payment, job: updated } }
      })
      if ('error' in result) return result.error

      logAndBroadcast(tenantId, 'print-job', 'updated', id, {
        userId,
        entityName: result.data.job.jobNo,
        description: `Advance ${result.data.payment.amount} (${paymentMethod}) received for print job "${result.data.job.jobNo}"`,
      })
      return NextResponse.json(result.data)
    })
  } catch (error) {
    const handled = printJobErrorResponse(error)
    if (handled) return handled
    logError('api/print-jobs/[id]/payments', error)
    return NextResponse.json({ error: 'Failed to record the payment' }, { status: 500 })
  }
}
