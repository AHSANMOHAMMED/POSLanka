import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateBody } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { DataError, auditCopy, deleteRow, getRow, updateRow } from '@/lib/admin/vendor-data'

const paramsSchema = z.object({
  id: z.string().uuid(),
  table: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  rowId: z.string().min(1).max(100),
})
const updateSchema = z.object({ values: z.record(z.string(), z.unknown()) })

/** Tables whose changes affect signed-in permissions */
const PERMISSION_TABLES = new Set(['users', 'custom_roles', 'role_permission_overrides', 'module_access', 'business_profile'])

async function vendorExists(id: string) {
  return !!(await db.query.tenants.findFirst({ where: eq(tenants.id, id), columns: { id: true } }))
}

function dataError(err: unknown) {
  if (err instanceof DataError) return NextResponse.json({ error: err.message, field: err.field }, { status: err.status })
  return null
}

type Ctx = { params: Promise<{ id: string; table: string; rowId: string }> }

/** GET — one row of this vendor's table. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const p = paramsSchema.safeParse(await params)
    if (!p.success) return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    if (!(await vendorExists(p.data.id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    return NextResponse.json({ row: await getRow(p.data.id, p.data.table, p.data.rowId) })
  } catch (error) {
    const r = dataError(error)
    if (r) return r
    logError('api/sys-control/vendors/[id]/data/[table]/[rowId] GET', error)
    return NextResponse.json({ error: 'Failed to load the row' }, { status: 500 })
  }
}

/** PATCH — change columns of one row ({ values }). vendors.manage, audited with before / after. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/data', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const p = paramsSchema.safeParse(await params)
    if (!p.success) return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    if (!(await vendorExists(p.data.id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const body = await validateBody(request, updateSchema)
    if (!body.success) return body.response
    const { before, after } = await updateRow(p.data.id, p.data.table, p.data.rowId, body.data.values)
    if (PERMISSION_TABLES.has(p.data.table)) invalidatePermissionCache(p.data.id)
    const changed = Object.keys(after).filter((k) => k !== 'updated_at' && JSON.stringify(after[k]) !== JSON.stringify(before[k]))
    await adminAudit.update(session.superAdminId, 'vendor_data', p.data.rowId, {
      op: 'data_update', tenantId: p.data.id, table: p.data.table, changed,
      before: auditCopy(Object.fromEntries(changed.map((k) => [k, before[k]]))),
      after: auditCopy(Object.fromEntries(changed.map((k) => [k, after[k]]))),
    })
    return NextResponse.json({ success: true, row: after, changed })
  } catch (error) {
    const r = dataError(error)
    if (r) return r
    logError('api/sys-control/vendors/[id]/data/[table]/[rowId] PATCH', error)
    return NextResponse.json({ error: 'Failed to save the row' }, { status: 500 })
  }
}

/** DELETE — remove one row (refused while other rows use it). vendors.manage, audited with the row. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/data', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const p = paramsSchema.safeParse(await params)
    if (!p.success) return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    if (!(await vendorExists(p.data.id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const before = await deleteRow(p.data.id, p.data.table, p.data.rowId)
    if (PERMISSION_TABLES.has(p.data.table)) invalidatePermissionCache(p.data.id)
    await adminAudit.delete(session.superAdminId, 'vendor_data', p.data.rowId, {
      op: 'data_delete', tenantId: p.data.id, table: p.data.table, before: auditCopy(before),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const r = dataError(error)
    if (r) return r
    logError('api/sys-control/vendors/[id]/data/[table]/[rowId] DELETE', error)
    return NextResponse.json({ error: 'Failed to delete the row' }, { status: 500 })
  }
}
