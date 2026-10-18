import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { sales } from '@/lib/db/schema'
import { sql, gte, and } from 'drizzle-orm'

export async function GET() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'viewReports')
  if (permError) return permError

  return await withTenant(session.user.tenantId, async (db) => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    async function periodStats(since: Date) {
      const [result] = await db.select({
        totalSales: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} = false AND ${sales.status} != 'void' THEN CAST(${sales.total} AS numeric) ELSE 0 END), 0)`,
        totalReturns: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} = true AND ${sales.status} != 'void' THEN ABS(CAST(${sales.total} AS numeric)) ELSE 0 END), 0)`,
        transactionCount: sql<number>`COUNT(CASE WHEN ${sales.isReturn} = false AND ${sales.status} != 'void' THEN 1 END)::int`,
        returnCount: sql<number>`COUNT(CASE WHEN ${sales.isReturn} = true AND ${sales.status} != 'void' THEN 1 END)::int`,
        pendingCount: sql<number>`COUNT(CASE WHEN ${sales.status} = 'pending' THEN 1 END)::int`,
      }).from(sales).where(gte(sales.createdAt, since))
      return result
    }

    // Payment method breakdown (today)
    const paymentBreakdown = await db.select({
      method: sales.paymentMethod,
      count: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(CAST(${sales.total} AS numeric)), 0)`,
    }).from(sales)
      .where(and(
        gte(sales.createdAt, todayStart),
        sql`${sales.isReturn} = false`,
        sql`${sales.status} != 'void'`,
      ))
      .groupBy(sales.paymentMethod)

    const today = await periodStats(todayStart)
    const week = await periodStats(weekStart)
    const month = await periodStats(monthStart)

    return NextResponse.json({
      today: {
        totalSales: Number(today.totalSales),
        totalReturns: Number(today.totalReturns),
        netSales: Number(today.totalSales) - Number(today.totalReturns),
        transactionCount: today.transactionCount,
        returnCount: today.returnCount,
        pendingCount: today.pendingCount,
      },
      week: {
        totalSales: Number(week.totalSales),
        netSales: Number(week.totalSales) - Number(week.totalReturns),
        transactionCount: week.transactionCount,
      },
      month: {
        totalSales: Number(month.totalSales),
        netSales: Number(month.totalSales) - Number(month.totalReturns),
        transactionCount: month.transactionCount,
      },
      paymentBreakdown,
    })
  })
}
