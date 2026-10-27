import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { recurringInvoiceRuns, recurringInvoices } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateParams } from '@/lib/validation/helpers'
import { requireQuota } from '@/lib/db/storage-quota'
import { logError } from '@/lib/ai/error-logger'
import { postDraftRun } from '@/lib/recurring-invoices/generate'

const paramsSchema = z.object({ id: z.string().uuid(), runId: z.string().uuid() })

// POST /api/recurring-invoices/[id]/runs/[runId]/post — turn a draft run into the invoice
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError
    const p = validateParams(await params, paramsSchema)
    if (!p.success) return p.response
    const { id, runId } = p.data
    const tenantId = session.user.tenantId
    const check = await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, recurringInvoices, id, { includeUnassigned: true })
      if (denied) return denied
      const [run] = await db.select({ id: recurringInvoiceRuns.id }).from(recurringInvoiceRuns)
        .where(and(eq(recurringInvoiceRuns.id, runId), eq(recurringInvoiceRuns.recurringInvoiceId, id)))
      return run ? null : NextResponse.json({ error: 'Run not found' }, { status: 404 })
    })
    if (check) return check
    const outcome = await postDraftRun(tenantId, runId)
    if (outcome.kind === 'generated') return NextResponse.json(outcome)
    if (outcome.kind === 'not_draft') return NextResponse.json({ error: `This run is ${outcome.status}, not a draft`, ...outcome }, { status: 409 })
    if (outcome.kind === 'failed') return NextResponse.json({ ...outcome, error: outcome.error }, { status: 400 })
    return NextResponse.json(outcome)
  } catch (error) {
    logError('api/recurring-invoices/[id]/runs/[runId]/post', error)
    return NextResponse.json({ error: 'Failed to post the draft invoice' }, { status: 500 })
  }
}
