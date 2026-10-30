import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateParams, validateSearchParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { periodSchema, resolvePeriod, vendorBusinessSummary } from '@/lib/admin/vendor-business'

/**
 * GET /api/sys-control/vendors/[id]/business?period=today|7d|30d|month|year|all|custom&fromDate=&toDate=
 * Sales, profit, stock value, money owed, expenses and branches of one vendor for the period.
 * Same access as its stock and data: vendors.impersonate.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = validateSearchParams(request, periodSchema)
    if (!parsed.success) return parsed.response
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, p.data.id), columns: { id: true, currency: true } })
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const period = await resolvePeriod(tenant.id, parsed.data)
    if (!period) return NextResponse.json({ error: 'Choose a start date on or before the end date' }, { status: 400 })
    const summary = await withTenant(tenant.id, (tx) => vendorBusinessSummary(tx, period))
    return NextResponse.json({ ...summary, currency: tenant.currency })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/business GET', error)
    return NextResponse.json({ error: 'Failed to load the business report' }, { status: 500 })
  }
}
