import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { serviceJobPayments, serviceJobs } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { serviceJobStatusSchema } from '@/lib/validation/schemas/service-jobs'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { hasAnyPermission } from '@/lib/auth/field-access'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'
import { serviceJobStatusLabel } from '@/lib/service-jobs/constants'
import {
  SERVICE_JOB_MONEY, SERVICE_JOB_VIEW, addServiceJobHistory, requireAnyPermission, reverseServiceJobAdvance, serviceJobErrorResponse,
} from '@/lib/service-jobs/server'

// POST /api/service-jobs/[id]/status — move the job along received → diagnosing → awaiting
// approval → in progress → ready (any open status to any other: the bench skips and repeats
// steps), record the customer's answer to the estimate, or cancel. Delivery happens through
// /invoice. Cancelling a job with advances refunds them (refundAdvances: true, counter staff).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, SERVICE_JOB_VIEW)
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, serviceJobStatusSchema)
    if (!parsed.success) return parsed.response
    const { status, note, estimateStatus, cancellationReason, refundAdvances } = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, serviceJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied

      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(serviceJobs).where(eq(serviceJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
        if (job.status === 'delivered' || job.status === 'cancelled' || job.saleId) {
          return { error: NextResponse.json({ error: `The job is already ${job.status}` }, { status: 400 }) }
        }
        const now = new Date()
        const set: Partial<typeof serviceJobs.$inferInsert> = { status, updatedAt: now }

        // Estimate bookkeeping that goes with the move
        let nextEstimate = estimateStatus
        if (!nextEstimate && status === 'awaiting_approval' && job.estimateStatus === 'none' && job.estimateAmount) nextEstimate = 'pending'
        if (nextEstimate && nextEstimate !== job.estimateStatus) {
          set.estimateStatus = nextEstimate
          if (nextEstimate === 'approved' || nextEstimate === 'declined') set.estimateRespondedAt = now
        }

        if (status === 'cancelled') {
          const open = await tx.select().from(serviceJobPayments)
            .where(and(eq(serviceJobPayments.serviceJobId, id), isNull(serviceJobPayments.refundedAt)))
          if (open.length > 0 && !refundAdvances) {
            return { error: NextResponse.json({ error: 'This job has advances. Confirm the refund to cancel it.', code: 'ADVANCE_REFUND_REQUIRED' }, { status: 400 }) }
          }
          if (open.length > 0 && !hasAnyPermission(session, SERVICE_JOB_MONEY)) {
            return { error: NextResponse.json({ error: 'Only counter staff or managers can refund advances' }, { status: 403 }) }
          }
          // the refund leaves the drawer of the user's open shift (if any)
          const refundShiftId = open.length > 0 ? await currentOpenShiftId(tx, userId) : null
          for (const pay of open) {
            await reverseServiceJobAdvance(tx, tenantId, pay.id)
            await tx.update(serviceJobPayments).set({ refundedAt: now, refundPosOpeningEntryId: refundShiftId }).where(eq(serviceJobPayments.id, pay.id))
          }
          set.paidAmount = '0'
          set.balanceDue = job.total
          set.cancelledAt = now
          set.cancellationReason = cancellationReason || null
        }

        const [updated] = await tx.update(serviceJobs).set(set).where(eq(serviceJobs.id, id)).returning()
        const estimateNote = nextEstimate && nextEstimate !== job.estimateStatus && nextEstimate !== 'pending' ? `Estimate ${nextEstimate}` : null
        await addServiceJobHistory(tx, {
          // same status = a note only
          tenantId, serviceJobId: id, fromStatus: status === job.status ? null : job.status, toStatus: status === job.status ? null : status, changedBy: userId,
          note: [estimateNote, status === 'cancelled' ? cancellationReason : null, note].filter(Boolean).join(' · ') || null,
        })
        return { data: updated, from: job.status }
      })
      if ('error' in result) return result.error

      const kind = result.data.jobType
      logAndBroadcast(tenantId, 'service-job', 'updated', id, {
        userId,
        entityName: result.data.jobNo,
        activityAction: status === 'cancelled' ? 'cancel' : 'status_change',
        description: result.from === status
          ? `Note added to job "${result.data.jobNo}"`
          : `Job "${result.data.jobNo}": ${serviceJobStatusLabel(result.from, kind)} → ${serviceJobStatusLabel(status, kind)}`,
      })
      return NextResponse.json({ ...result.data, passcode: undefined })
    })
  } catch (error) {
    const handled = serviceJobErrorResponse(error)
    if (handled) return handled
    logError('api/service-jobs/[id]/status', error)
    return NextResponse.json({ error: 'Failed to change the job status' }, { status: 500 })
  }
}
