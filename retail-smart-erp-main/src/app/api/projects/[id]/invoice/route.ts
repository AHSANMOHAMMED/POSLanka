import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { projectInvoiceSchema } from '@/lib/validation/schemas/projects'
import { requireQuota } from '@/lib/db/storage-quota'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { createProjectInvoice, loadBillingContext, previewFromContext } from '@/lib/projects/server'

type Ctx = { params: Promise<{ id: string }> }

async function guard(params: Ctx['params']) {
  const session = await authWithCompany()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const permError = requirePermission(session, 'manageSales')
  if (permError) return { error: permError }
  const moduleError = requireModule(session, 'selling')
  if (moduleError) return { error: moduleError }
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return { error: p.response }
  const denied = await withTenant(session.user.tenantId, (db) => assertRecordBranch(session, db, projects, p.data.id, { includeUnassigned: true }))
  if (denied) return { error: denied }
  return { session, id: p.data.id }
}

// GET /api/projects/[id]/invoice — what "Create invoice" would bill now
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const g = await guard(params)
    if ('error' in g) return g.error
    const { session, id } = g
    return await withTenant(session.user.tenantId, async (db) => {
      const ctx = await loadBillingContext(db, id)
      if (!ctx || !ctx.project.isActive) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      return NextResponse.json(previewFromContext(ctx))
    })
  } catch (error) {
    logError('api/projects/[id]/invoice GET', error)
    return NextResponse.json({ error: 'Failed to preview the invoice' }, { status: 500 })
  }
}

// POST /api/projects/[id]/invoice — invoice unbilled billable time (or the fixed price) through the
// back-office sale path (POST /api/sales, service lines, left on the customer's account)
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const g = await guard(params)
    if ('error' in g) return g.error
    const { session, id } = g
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError
    const acctError = await requireAccountingConfig(null, session.user.tenantId, 'sale')
    if (acctError) return acctError
    const parsed = await validateBody(request, projectInvoiceSchema)
    if (!parsed.success) return parsed.response
    const userId = await resolveUserIdRequired(session)
    const result = await createProjectInvoice(session, userId, id, parsed.data)
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    logAndBroadcast(session.user.tenantId, 'project', 'updated', id, { userId, description: `Invoiced ${result.invoiceNo} from project` })
    logAndBroadcast(session.user.tenantId, 'time-entry', 'updated', id)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    logError('api/projects/[id]/invoice POST', error)
    return NextResponse.json({ error: 'Failed to create the invoice' }, { status: 500 })
  }
}
