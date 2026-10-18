import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { sales, saleItems, items, categories } from '@/lib/db/schema'
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

    if (session.user.businessType !== 'restaurant' && session.user.businessType !== 'supermarket') {
      return NextResponse.json({ error: 'This report is only available for restaurant and supermarket businesses' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      // Sale items joined with items to get cost price, grouped by item
      const data = await db.select({
        itemId: saleItems.itemId,
        itemName: saleItems.itemName,
        categoryName: sql<string>`COALESCE(${categories.name}, 'Uncategorized')`,
        totalSold: sql<string>`COALESCE(SUM(CAST(${saleItems.quantity} AS numeric)), 0)`,
        revenue: sql<string>`COALESCE(SUM(CAST(${saleItems.total} AS numeric)), 0)`,
        costOfGoods: sql<string>`COALESCE(SUM(CAST(${saleItems.quantity} AS numeric) * CAST(${items.costPrice} AS numeric)), 0)`,
      })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .leftJoin(items, eq(saleItems.itemId, items.id))
        .leftJoin(categories, eq(items.categoryId, categories.id))
        .where(and(
          eq(saleItems.tenantId, session.user.tenantId),
          gte(sales.createdAt, new Date(fromDate)),
          lte(sales.createdAt, new Date(toDate + 'T23:59:59')),
          sql`${sales.status} != 'void'`,
          eq(sales.isReturn, false),
        ))
        .groupBy(saleItems.itemId, saleItems.itemName, categories.name)
        .orderBy(sql`SUM(CAST(${saleItems.total} AS numeric)) DESC`)

      let totalRevenue = 0
      let totalCost = 0

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const menuItems = data.map((row: any) => {
        const revenue = Number(row.revenue)
        const costOfGoods = Number(row.costOfGoods)
        const grossProfit = revenue - costOfGoods
        const foodCostPct = revenue > 0 ? (costOfGoods / revenue) * 100 : 0

        totalRevenue += revenue
        totalCost += costOfGoods

        return {
          itemId: row.itemId,
          itemName: row.itemName,
          categoryName: row.categoryName,
          totalSold: Math.round(Number(row.totalSold) * 1000) / 1000,
          revenue: Math.round(revenue * 100) / 100,
          costOfGoods: Math.round(costOfGoods * 100) / 100,
          foodCostPct: Math.round(foodCostPct * 100) / 100,
          grossProfit: Math.round(grossProfit * 100) / 100,
        }
      })

      const overallFoodCostPct = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0

      return NextResponse.json({
        summary: {
          overallFoodCostPct: Math.round(overallFoodCostPct * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          totalProfit: Math.round((totalRevenue - totalCost) * 100) / 100,
          itemCount: menuItems.length,
        },
        data: menuItems,
      })
    })
  } catch (error) {
    logError('api/reports/food-cost-analysis', error)
    return NextResponse.json({ error: 'Failed to generate food cost analysis report' }, { status: 500 })
  }
}
