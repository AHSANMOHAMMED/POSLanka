import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { sales } from '@/lib/db/schema'
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

    if (session.user.businessType !== 'restaurant') {
      return NextResponse.json({ error: 'This report is only available for restaurant businesses' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      // Sales grouped by hour of day
      const data = await db.select({
        hour: sql<number>`EXTRACT(HOUR FROM ${sales.createdAt})::int`,
        orderCount: sql<number>`COUNT(*)::int`,
        totalRevenue: sql<string>`COALESCE(SUM(CAST(${sales.total} AS numeric)), 0)`,
        avgOrderValue: sql<string>`CASE WHEN COUNT(*) > 0 THEN SUM(CAST(${sales.total} AS numeric)) / COUNT(*) ELSE 0 END`,
      })
        .from(sales)
        .where(and(
          eq(sales.tenantId, session.user.tenantId),
          gte(sales.createdAt, new Date(fromDate)),
          lte(sales.createdAt, new Date(toDate + 'T23:59:59')),
          sql`${sales.status} != 'void'`,
          eq(sales.isReturn, false),
        ))
        .groupBy(sql`EXTRACT(HOUR FROM ${sales.createdAt})`)
        .orderBy(sql`EXTRACT(HOUR FROM ${sales.createdAt})`)

      let totalOrders = 0
      let totalRevenue = 0
      let peakHour = 0
      let peakOrders = 0

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hours = data.map((row: any) => {
        const orderCount = row.orderCount
        const revenue = Number(row.totalRevenue)
        totalOrders += orderCount
        totalRevenue += revenue

        if (orderCount > peakOrders) {
          peakOrders = orderCount
          peakHour = row.hour
        }

        return {
          hour: row.hour,
          hourLabel: `${row.hour.toString().padStart(2, '0')}:00`,
          orderCount,
          totalRevenue: Math.round(revenue * 100) / 100,
          avgOrderValue: Math.round(Number(row.avgOrderValue) * 100) / 100,
        }
      })

      const hoursWithData = hours.length
      const avgHourlyRevenue = hoursWithData > 0 ? totalRevenue / hoursWithData : 0

      return NextResponse.json({
        summary: {
          peakHour: `${peakHour.toString().padStart(2, '0')}:00`,
          peakOrders,
          totalOrders,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          avgHourlyRevenue: Math.round(avgHourlyRevenue * 100) / 100,
        },
        data: hours,
      })
    })
  } catch (error) {
    logError('api/reports/peak-hours', error)
    return NextResponse.json({ error: 'Failed to generate peak hours report' }, { status: 500 })
  }
}
