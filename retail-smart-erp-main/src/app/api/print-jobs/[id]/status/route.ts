import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { printJobPayments, printJobs } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { printJobStatusSchema } from '@/lib/validation/schemas/print-jobs'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { reversePrintJobAdvance } from '@/lib/print-jobs/server'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'
import { printJobErrorResponse } from '@/lib/print-jobs/errors'

const LABELS: Record<string, string> = {
  received: 'Received', designing: 'Designing', proof_sent: 'Proof sent', approved: 'Approved', printing: 'Printing',
  finishing: 'Finishing', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled',
}

// POST /api/print-jobs/[id]/status — move the job along the production pipeline, or cancel it.
// Any open status can go to any other open status (the floor skips and repeats steps); delivery
// happens through /invoice. Cancelling a job with advances refunds them (refundAdvances: true).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, printJobStatusSchema)
    if (!parsed.success) return parsed.response
    const { status, proofStatus, proofNote, cancellationReason, refundAdvances } = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, printJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied

      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Print job not found' }, { status: 404 }) }
        if (job.status === 'delivered' || job.status === 'cancelled' || job.saleId) {
          return { error: NextResponse.json({ error: `The job is already ${job.status}` }, { status: 400 }) }
        }
        const now = new Date()
        const set: Partial<typeof printJobs.$inferInsert> = { status, updatedAt: now }

        // Proof bookkeeping that goes with the move
        let nextProof = proofStatus
        if (!nextProof && status === 'proof_sent') nextProof = 'sent'
        if (!nextProof && status === 'approved' && job.proofStatus !== 'not_needed') nextProof = 'approved'
        if (nextProof && nextProof !== job.proofStatus) {
          set.proofStatus = nextProof
          if (nextProof === 'sent') set.proofSentAt = now
          if (nextProof === 'approved' || nextProof === 'changes_requested') set.proofRespondedAt = now
        }
        if (proofNote !== undefined) set.proofNote = proofNote || null

        if (status === 'cancelled') {
          const open = await tx.select().from(printJobPayments)
            .where(and(eq(printJobPayments.printJobId, id), isNull(printJobPayments.refundedAt)))
          if (open.length > 0 && !refundAdvances) {
            return { error: NextResponse.json({ error: 'This job has advances. Confirm the refund to cancel it.', code: 'ADVANCE_REFUND_REQUIRED' }, { status: 400 }) }
          }
          // 0187: the refund leaves the drawer of the user's open shift (if any)
          const refundShiftId = open.length > 0 ? await currentOpenShiftId(tx, userId) : null
          for (const pay of open) {
            await reversePrintJobAdvance(tx, tenantId, pay.id)
            await tx.update(printJobPayments).set({ refundedAt: now, refundPosOpeningEntryId: refundShiftId }).where(eq(printJobPayments.id, pay.id))
          }
          set.paidAmount = '0'
          set.balanceDue = job.total
          set.cancelledAt = now
          set.cancellationReason = cancellationReason || null
        }

        const [updated] = await tx.update(printJobs).set(set).where(eq(printJobs.id, id)).returning()
        return { data: updated, from: job.status }
      })
      if ('error' in result) return result.error

      logAndBroadcast(tenantId, 'print-job', 'updated', id, {
        userId,
        entityName: result.data.jobNo,
        activityAction: status === 'cancelled' ? 'cancel' : 'status_change',
        description: `Print job "${result.data.jobNo}": ${LABELS[result.from] || result.from} → ${LABELS[status] || status}`,
      })
      return NextResponse.json(result.data)
    })
  } catch (error) {
    const handled = printJobErrorResponse(error)
    if (handled) return handled
    logError('api/print-jobs/[id]/status', error)
    return NextResponse.json({ error: 'Failed to change the job status' }, { status: 500 })
  }
}
