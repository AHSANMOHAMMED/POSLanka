import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { tenantDayRange } from '@/lib/reports/date-range'
import { logError } from '@/lib/ai/error-logger'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// GET /api/reports/promotions?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD — H5 promotion effectiveness:
// per promotion the redemptions (sales that got it), discount given and value of those sales, in
// the tenant's business days. Voided sales / redemptions are left out.
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate') || ''
    const toDate = searchParams.get('toDate') || ''
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
      return NextResponse.json({ error: 'fromDate and toDate (YYYY-MM-DD) are required' }, { status: 400 })
    }
    if (fromDate > toDate) return NextResponse.json({ error: 'fromDate must be before toDate' }, { status: 400 })
    const tenantId = session.user.tenantId
    const range = await tenantDayRange(tenantId, fromDate, toDate)

    return await withTenant(tenantId, async (db) => {
      const rows = (await db.execute(sql`
        SELECT p.id AS "promotionId", p.name, p.type, p.coupon_code AS "couponCode", p.is_active AS "isActive",
               count(r.id)::int AS redemptions,
               count(DISTINCT r.customer_id)::int AS customers,
               COALESCE(sum(r.amount), 0)::float AS "discountGiven",
               COALESCE(sum(s.total), 0)::float AS "salesValue"
        FROM promotion_redemptions r
        JOIN promotions p ON p.id = r.promotion_id
        JOIN sales s ON s.id = r.sale_id
        WHERE r.tenant_id = ${tenantId}::uuid AND r.voided_at IS NULL AND s.status <> 'void'
          AND r.created_at >= ${range.from.toISOString()}::timestamp AND r.created_at <= ${range.to.toISOString()}::timestamp
        GROUP BY p.id, p.name, p.type, p.coupon_code, p.is_active
        ORDER BY "discountGiven" DESC, p.name
      `)).rows as Array<{ promotionId: string; name: string; type: string; couponCode: string | null; isActive: boolean; redemptions: number; customers: number; discountGiven: number; salesValue: number }>
      const r2 = (n: number) => Math.round(n * 100) / 100
      const data = rows.map((r) => ({
        ...r,
        discountGiven: r2(r.discountGiven),
        salesValue: r2(r.salesValue),
        avgDiscount: r.redemptions ? r2(r.discountGiven / r.redemptions) : 0,
        discountPercentOfSales: r.salesValue + r.discountGiven > 0 ? r2((r.discountGiven / (r.salesValue + r.discountGiven)) * 100) : 0,
      }))
      return NextResponse.json({
        fromDate, toDate,
        totals: {
          redemptions: data.reduce((s, r) => s + r.redemptions, 0),
          discountGiven: r2(data.reduce((s, r) => s + r.discountGiven, 0)),
          salesValue: r2(data.reduce((s, r) => s + r.salesValue, 0)),
        },
        data,
      })
    })
  } catch (error) {
    logError('api/reports/promotions', error)
    return NextResponse.json({ error: 'Failed to fetch promotion report' }, { status: 500 })
  }
}
