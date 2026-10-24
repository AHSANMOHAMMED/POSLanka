import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { countRows, listVendorTables } from '@/lib/admin/vendor-data'

/**
 * GET /api/sys-control/vendors/[id]/data — the tables holding this vendor's data, grouped, with row
 * counts. Viewing needs vendors.impersonate (owner / support admins); changes need vendors.manage.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, p.data.id), columns: { id: true, name: true, businessId: true, slug: true } })
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const counts = await countRows(tenant.id)
    const tables = listVendorTables().map((t) => ({ ...t, rows: counts[t.name] ?? 0 }))
    return NextResponse.json({ vendor: tenant, tables })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/data GET', error)
    return NextResponse.json({ error: 'Failed to load the vendor’s data' }, { status: 500 })
  }
}
