import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { sales, saleItems, items, workOrders, warehouseStock } from '@/lib/db/schema'
import { sql, eq, gte, and, desc } from 'drizzle-orm'
import { generateJSON, isAIEnabledForTenant } from '@/lib/ai/gemini'
import { SYSTEM_PROMPTS, formatMetricsForPrompt } from '@/lib/ai/prompts'

// Simple in-memory cache per tenant (1 hour TTL)
const insightsCache = new Map<string, { data: unknown; expires: number }>()

interface Insight {
  title: string
  description: string
  type: 'trend' | 'alert' | 'opportunity' | 'info'
  trend?: 'up' | 'down' | 'stable'
}

export async function GET() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = session.user.tenantId

  // Check cache
  const cached = insightsCache.get(tenantId)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  if (!isAIEnabledForTenant(session)) {
    return NextResponse.json({
      enabled: false,
      insights: [],
      message: 'AI features are not enabled for this company. An admin can enable AI in Settings.',
    })
  }

  return await withTenant(tenantId, async (db) => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekAgo = new Date(todayStart.getTime() - 7 * 86400000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

    // Fetch metrics in parallel
    const [
      todayResult,
      weekResult,
      monthResult,
      lastMonthResult,
      topItemsResult,
      lowStockResult,
      pendingOrdersResult,
    ] = await Promise.all([
      // Today's sales
      db.select({
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(sales).where(
        and(gte(sales.createdAt, todayStart), eq(sales.status, 'completed'))
      ),

      // This week's sales
      db.select({
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric), 0)::float`,
      }).from(sales).where(
        and(gte(sales.createdAt, weekAgo), eq(sales.status, 'completed'))
      ),

      // This month's sales
      db.select({
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric), 0)::float`,
      }).from(sales).where(
        and(gte(sales.createdAt, monthStart), eq(sales.status, 'completed'))
      ),

      // Last month's sales
      db.select({
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric), 0)::float`,
      }).from(sales).where(
        and(
          gte(sales.createdAt, lastMonthStart),
          sql`${sales.createdAt} <= ${lastMonthEnd}`,
          eq(sales.status, 'completed')
        )
      ),

      // Top items this month
      db.select({
        name: items.name,
        quantity: sql<number>`SUM(${saleItems.quantity}::numeric)::int`,
        revenue: sql<number>`SUM(${saleItems.total}::numeric)::float`,
      }).from(saleItems)
        .innerJoin(items, eq(saleItems.itemId, items.id))
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(gte(sales.createdAt, monthStart), eq(sales.status, 'completed')))
        .groupBy(items.name)
        .orderBy(desc(sql`SUM(${saleItems.total}::numeric)`))
        .limit(5),

      // Low stock items (from warehouse_stock)
      db.select({
        name: items.name,
        currentStock: sql<number>`${warehouseStock.currentStock}::int`,
        reorderLevel: sql<number>`COALESCE(${warehouseStock.minStock}, 5)::int`,
      }).from(warehouseStock)
        .innerJoin(items, eq(warehouseStock.itemId, items.id))
        .where(
          sql`${warehouseStock.currentStock}::numeric <= COALESCE(${warehouseStock.minStock}, 5) AND ${items.isActive} = true`
        )
        .limit(10),

      // Pending work orders (if applicable)
      db.select({
        count: sql<number>`count(*)::int`,
      }).from(workOrders).where(
        sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress')`
      ),
    ])

    const metrics = {
      businessType: session.user.businessType,
      todaySales: todayResult[0]?.total || 0,
      todayCount: todayResult[0]?.count || 0,
      weekSales: weekResult[0]?.total || 0,
      monthSales: monthResult[0]?.total || 0,
      lastMonthSales: lastMonthResult[0]?.total || 0,
      topItems: topItemsResult as Array<{ name: string; quantity: number; revenue: number }>,
      lowStockItems: lowStockResult as Array<{ name: string; currentStock: number; reorderLevel: number }>,
      pendingOrders: pendingOrdersResult[0]?.count || 0,
    }

    // Generate AI insights
    const metricsText = formatMetricsForPrompt(metrics)
    const aiInsights = await generateJSON<{ insights: Insight[] }>(
      `Analyze these business metrics and generate 3-5 actionable insights:\n\n${metricsText}`,
      {
        systemPrompt: SYSTEM_PROMPTS.businessInsights + '\n\nRespond with JSON: { "insights": [{ "title": "...", "description": "...", "type": "trend|alert|opportunity|info", "trend": "up|down|stable" }] }',
        maxTokens: 800,
        temperature: 0.5,
      }
    )

    const result = {
      enabled: true,
      insights: aiInsights?.insights || [],
      metrics: {
        todaySales: metrics.todaySales,
        todayCount: metrics.todayCount,
        weekSales: metrics.weekSales,
        monthSales: metrics.monthSales,
        lowStockCount: metrics.lowStockItems.length,
        pendingOrders: metrics.pendingOrders,
      },
      generatedAt: new Date().toISOString(),
    }

    // Cache for 1 hour
    insightsCache.set(tenantId, { data: result, expires: Date.now() + 3600000 })

    return NextResponse.json(result)
  })
}
