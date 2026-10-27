import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { recurringInvoices } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { requireQuota } from '@/lib/db/storage-quota'
import { logError } from '@/lib/ai/error-logger'
import { generateForProfile } from '@/lib/recurring-invoices/generate'
import { dateStringSchema } from '@/lib/validation/schemas/common'

const runNowSchema = z.object({ runDate: dateStringSchema.nullish() })

// POST /api/recurring-invoices/[id]/run — "Run now": raise the NEXT scheduled invoice now (as the
// signed-in user, through POST /api/sales). Idempotent per scheduled date: a double click returns
// the invoice already raised for that date ('duplicate') instead of a second one. Body (optional):
// { runDate } = the next run date shown to the user; when the schedule has already moved past it
// the invoice of that date is returned (no invoice for the following period).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const tenantId = session.user.tenantId
    const denied = await withTenant(tenantId, (db) => assertRecordBranch(session, db, recurringInvoices, id, { includeUnassigned: true }))
    if (denied) return denied

    const raw = await request.text().catch(() => '')
    let body: unknown = {}
    try { body = raw ? JSON.parse(raw) : {} } catch { return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 }) }
    const parsedBody = runNowSchema.safeParse(body)
    if (!parsedBody.success) return NextResponse.json({ error: 'Invalid run date' }, { status: 400 })

    const [outcome] = await generateForProfile(tenantId, id, {
      force: true, triggeredBy: 'manual', userId: session.user.id, expectedRunDate: parsedBody.data.runDate ?? null,
    })
    if (!outcome) return NextResponse.json({ error: 'Nothing to run' }, { status: 400 })
    switch (outcome.kind) {
      case 'generated':
      case 'draft':
      case 'duplicate':
        return NextResponse.json(outcome)
      case 'in_progress':
        return NextResponse.json({ ...outcome, error: 'This invoice is being created right now' }, { status: 409 })
      case 'failed':
        return NextResponse.json({ ...outcome, error: outcome.error }, { status: 400 })
      case 'not_due':
        return NextResponse.json({ ...outcome, error: 'The schedule has changed. Refresh and try again.', code: 'SCHEDULE_CHANGED' }, { status: 409 })
      case 'inactive':
        return NextResponse.json({ ...outcome, error: `This profile is ${outcome.status}` }, { status: outcome.status === 'missing' || outcome.status === 'deleted' ? 404 : 400 })
      default:
        return NextResponse.json(outcome)
    }
  } catch (error) {
    logError('api/recurring-invoices/[id]/run', error)
    return NextResponse.json({ error: 'Failed to run the recurring invoice' }, { status: 500 })
  }
}
