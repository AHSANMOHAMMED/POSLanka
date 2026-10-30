import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, logAdminAction, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateParams, validateSearchParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { CSV_BOM, csvRow, fileSlug } from '@/lib/admin/csv'
import { ITEM_CSV_HEADER, itemCsvCells, itemReportSchema, resolvePeriod, vendorItemReport } from '@/lib/admin/vendor-business'

/**
 * GET /api/sys-control/vendors/[id]/business/items?period=&fromDate=&toDate=&q=&sort=&dir=&page=&pageSize=
 * Item by item: stock, cost, sales and profit for the period. &format=csv downloads every matching
 * item (audited). vendors.impersonate.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = validateSearchParams(request, itemReportSchema)
    if (!parsed.success) return parsed.response
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, p.data.id), columns: { id: true, slug: true } })
    if (!tenant) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const period = await resolvePeriod(tenant.id, parsed.data)
    if (!period) return NextResponse.json({ error: 'Choose a start date on or before the end date' }, { status: 400 })
    const { q, sort, dir, page, pageSize } = parsed.data

    if (request.nextUrl.searchParams.get('format') !== 'csv') {
      const result = await withTenant(tenant.id, (tx) => vendorItemReport(tx, period, { q, sort, dir, page, pageSize }))
      return NextResponse.json({ ...result, page, pageSize })
    }

    const rateLimited = await withRateLimit('/api/sys-control/vendors/business/items', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const { rows } = await withTenant(tenant.id, (tx) => vendorItemReport(tx, period, { q, sort, dir }))
    await logAdminAction({
      accountId: session.superAdminId, action: 'view', resource: 'vendor_data_export', resourceId: tenant.id,
      details: { op: 'items_export', tenantId: tenant.id, fromDate: period.fromDate, toDate: period.toDate, rows: rows.length },
    })
    const lines = [csvRow(ITEM_CSV_HEADER), ...rows.map((r) => csvRow(itemCsvCells(r)))]
    return new NextResponse(`${CSV_BOM}${lines.join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileSlug(tenant.slug)}-items-${period.fromDate}-to-${period.toDate}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/business/items GET', error)
    return NextResponse.json({ error: 'Failed to load the item report' }, { status: 500 })
  }
}
