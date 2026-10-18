import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { suppliers } from '@/lib/db/schema'
import { sql, and, eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET - Summary supplier performance for all suppliers
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('from')
    const toDate = searchParams.get('to')

    const result = await withTenant(session.user.tenantId, async (db) => {
      // Build date conditions for purchase orders (raw SQL aliases for subqueries)
      const poDateCondition = fromDate || toDate
        ? sql`AND ${and(
            ...[
              ...(fromDate ? [sql`po.created_at >= ${new Date(fromDate)}`] : []),
              ...(toDate ? [sql`po.created_at <= ${new Date(toDate + 'T23:59:59')}`] : []),
            ]
          )}`
        : sql``

      // Build date conditions for purchases (same date range)
      const purchaseDateCondition = fromDate || toDate
        ? sql`AND ${and(
            ...[
              ...(fromDate ? [sql`p.created_at >= ${new Date(fromDate)}`] : []),
              ...(toDate ? [sql`p.created_at <= ${new Date(toDate + 'T23:59:59')}`] : []),
            ]
          )}`
        : sql``

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any[] = await db.select({
        id: suppliers.id,
        name: suppliers.name,
        totalOrders: sql<number>`COALESCE((
          SELECT count(*) FROM purchase_orders po
          WHERE po.supplier_id = ${suppliers.id}
          AND po.tenant_id = ${suppliers.tenantId}
          AND po.status NOT IN ('cancelled', 'draft')
          ${poDateCondition}
        ), 0)`,
        totalOrderValue: sql<string>`COALESCE((
          SELECT SUM(po.total::numeric) FROM purchase_orders po
          WHERE po.supplier_id = ${suppliers.id}
          AND po.tenant_id = ${suppliers.tenantId}
          AND po.status NOT IN ('cancelled', 'draft')
          ${poDateCondition}
        ), 0)`,
        totalInvoices: sql<number>`COALESCE((
          SELECT count(*) FROM purchases p
          WHERE p.supplier_id = ${suppliers.id}
          AND p.tenant_id = ${suppliers.tenantId}
          AND p.status NOT IN ('cancelled', 'draft')
          AND p.is_return = false
          ${purchaseDateCondition}
        ), 0)`,
        totalPurchased: sql<string>`COALESCE((
          SELECT SUM(p.total::numeric) FROM purchases p
          WHERE p.supplier_id = ${suppliers.id}
          AND p.tenant_id = ${suppliers.tenantId}
          AND p.status NOT IN ('cancelled', 'draft')
          AND p.is_return = false
          ${purchaseDateCondition}
        ), 0)`,
        outstandingBalance: sql<string>`COALESCE((
          SELECT SUM((p.total::numeric - p.paid_amount::numeric)) FROM purchases p
          WHERE p.supplier_id = ${suppliers.id}
          AND p.tenant_id = ${suppliers.tenantId}
          AND p.status NOT IN ('cancelled', 'draft')
          AND p.is_return = false
        ), 0)`,
      })
        .from(suppliers)
        .where(eq(suppliers.tenantId, session.user.tenantId))

      // Filter to suppliers with activity
      const activeSuppliers = data.filter(s => Number(s.totalOrders) > 0 || Number(s.totalInvoices) > 0)

      // Sort by total order value descending
      activeSuppliers.sort((a, b) => parseFloat(b.totalOrderValue) - parseFloat(a.totalOrderValue))

      return activeSuppliers
    })

    return NextResponse.json(result)
  } catch (error) {
    logError('api/reports/supplier-performance', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}
