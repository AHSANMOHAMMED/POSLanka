import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { workOrders, workOrderParts, items } from '@/lib/db/schema'
import { eq, and, sql, gte, lte } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    if (session.user.businessType !== 'auto_service' && session.user.businessType !== 'dealership') {
      return NextResponse.json({ error: 'This report is only available for service-capable businesses' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const data = await db.select({
        itemId: workOrderParts.itemId,
        itemName: items.name,
        sku: items.sku,
        totalQuantity: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS numeric)), 0)`,
        totalCost: sql<string>`COALESCE(SUM(CAST(${workOrderParts.total} AS numeric)), 0)`,
        workOrderCount: sql<number>`COUNT(DISTINCT ${workOrderParts.workOrderId})::int`,
      })
        .from(workOrderParts)
        .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
        .leftJoin(items, eq(workOrderParts.itemId, items.id))
        .where(and(
          eq(workOrderParts.tenantId, session.user.tenantId),
          gte(workOrders.createdAt, new Date(fromDate)),
          lte(workOrders.createdAt, new Date(toDate + 'T23:59:59')),
          sql`${workOrders.status} NOT IN ('draft', 'cancelled')`,
        ))
        .groupBy(workOrderParts.itemId, items.name, items.sku)
        .orderBy(sql`SUM(CAST(${workOrderParts.quantity} AS numeric)) DESC`)

      let totalPartsUsed = 0
      let totalCostSum = 0

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts = data.map((row: any) => {
        const qty = Number(row.totalQuantity)
        const cost = Number(row.totalCost)
        totalPartsUsed += qty
        totalCostSum += cost

        return {
          itemId: row.itemId,
          itemName: row.itemName || 'Unknown Part',
          sku: row.sku || '-',
          totalQuantity: Math.round(qty * 1000) / 1000,
          totalCost: Math.round(cost * 100) / 100,
          workOrderCount: row.workOrderCount,
        }
      })

      return NextResponse.json({
        summary: {
          totalPartsUsed: Math.round(totalPartsUsed * 1000) / 1000,
          totalCost: Math.round(totalCostSum * 100) / 100,
          uniqueParts: parts.length,
        },
        data: parts,
      })
    })
  } catch (error) {
    logError('api/reports/parts-usage', error)
    return NextResponse.json({ error: 'Failed to generate parts usage report' }, { status: 500 })
  }
}
