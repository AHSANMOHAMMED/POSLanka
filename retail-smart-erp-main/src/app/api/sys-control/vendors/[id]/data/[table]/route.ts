import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateBody } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { DataError, auditCopy, insertRow, listRows } from '@/lib/admin/vendor-data'

const paramsSchema = z.object({ id: z.string().uuid(), table: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/) })
const insertSchema = z.object({ values: z.record(z.string(), z.unknown()) })

async function vendorExists(id: string) {
  return !!(await db.query.tenants.findFirst({ where: eq(tenants.id, id), columns: { id: true } }))
}

function dataError(err: unknown) {
  if (err instanceof DataError) return NextResponse.json({ error: err.message, field: err.field }, { status: err.status })
  return null
}

/**
 * GET /api/sys-control/vendors/[id]/data/[table]?q=&page=&pageSize=&sort=&dir=&column=&value=
 * Rows of one table for this vendor: search across text columns, sort, page, exact filter on a column.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; table: string }> }) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const p = paramsSchema.safeParse(await params)
    if (!p.success) return NextResponse.json({ error: 'Unknown table' }, { status: 404 })
    if (!(await vendorExists(p.data.id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const sp = request.nextUrl.searchParams
    const result = await listRows(p.data.id, p.data.table, {
      q: sp.get('q') || undefined,
      page: Number(sp.get('page')) || 1,
      pageSize: Number(sp.get('pageSize')) || 50,
      sort: sp.get('sort') || undefined,
      dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
      filterColumn: sp.get('column') || undefined,
      filterValue: sp.get('value') ?? undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    const r = dataError(error)
    if (r) return r
    logError('api/sys-control/vendors/[id]/data/[table] GET', error)
    return NextResponse.json({ error: 'Failed to load the rows' }, { status: 500 })
  }
}

/** POST — add a row to this vendor's table ({ values: { column: value } }). vendors.manage, audited. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; table: string }> }) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/data', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('vendors.manage')
    if (!session) return adminAuthError()
    const p = paramsSchema.safeParse(await params)
    if (!p.success) return NextResponse.json({ error: 'Unknown table' }, { status: 404 })
    if (!(await vendorExists(p.data.id))) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const body = await validateBody(request, insertSchema)
    if (!body.success) return body.response
    const row = await insertRow(p.data.id, p.data.table, body.data.values)
    await adminAudit.create(session.superAdminId, 'vendor_data', String(row.id ?? p.data.table), {
      op: 'data_insert', tenantId: p.data.id, table: p.data.table, after: auditCopy(row),
    })
    return NextResponse.json({ success: true, row }, { status: 201 })
  } catch (error) {
    const r = dataError(error)
    if (r) return r
    logError('api/sys-control/vendors/[id]/data/[table] POST', error)
    return NextResponse.json({ error: 'Failed to add the row' }, { status: 500 })
  }
}
