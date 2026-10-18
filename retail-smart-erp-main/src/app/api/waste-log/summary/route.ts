import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { wasteLog } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      // Today
      const [today] = await db
        .select({
          count: sql<number>`count(*)::int`,
          cost: sql<string>`coalesce(sum(${wasteLog.costAmount}), 0)::text`,
        })
        .from(wasteLog)
        .where(sql`${wasteLog.recordedAt} >= current_date`)

      // This week (Monday start)
      const [week] = await db
        .select({
          count: sql<number>`count(*)::int`,
          cost: sql<string>`coalesce(sum(${wasteLog.costAmount}), 0)::text`,
        })
        .from(wasteLog)
        .where(sql`${wasteLog.recordedAt} >= date_trunc('week', current_date)`)

      // All time
      const [total] = await db
        .select({
          cost: sql<string>`coalesce(sum(${wasteLog.costAmount}), 0)::text`,
        })
        .from(wasteLog)

      return NextResponse.json({
        todayCount: today.count,
        todayCost: today.cost,
        weekCount: week.count,
        weekCost: week.cost,
        totalCost: total.cost,
      })
    })
  } catch (error) {
    logError('api/waste-log/summary', error)
    return NextResponse.json({ error: 'Failed to fetch waste log summary' }, { status: 500 })
  }
}
