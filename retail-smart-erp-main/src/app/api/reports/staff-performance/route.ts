import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gte, lte, sql, inArray } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { sales, users, employeeProfiles } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/roles'
import { getBranchScope, canAccessBranch, branchDeniedResponse } from '@/lib/auth/branch-access'
import { tenantToday } from '@/lib/accounting/gl'
import { tenantDayRange } from '@/lib/reports/date-range'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    const tenantId = session.user.tenantId
    const { searchParams } = new URL(request.url)
    const today = await tenantToday(tenantId)
    const fromDate = searchParams.get('fromDate') || `${today.slice(0, 8)}01`
    const toDate = searchParams.get('toDate') || today
    const warehouseId = searchParams.get('warehouseId')

    const range = await tenantDayRange(tenantId, fromDate, toDate)

    return await withTenant(tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      if (warehouseId && !canAccessBranch(scope, warehouseId)) {
        return branchDeniedResponse(scope, db)
      }

      // Base conditions for completed, non-voided sales within date range
      const conditions = [
        eq(sales.tenantId, tenantId),
        eq(sales.status, 'completed'),
        gte(sales.createdAt, range.from),
        lte(sales.createdAt, range.to),
      ]

      if (warehouseId) {
        conditions.push(eq(sales.warehouseId, warehouseId))
      } else if (scope) {
        conditions.push(inArray(sales.warehouseId, scope))
      }

      // Aggregate sales by cashier / salesperson (createdBy)
      const rows = await db
        .select({
          staffId: sales.createdBy,
          salesCount: sql<number>`count(*)::int`,
          totalRevenue: sql<number>`coalesce(sum(${sales.total}), 0)::float`,
          totalDiscount: sql<number>`coalesce(sum(${sales.discountAmount}), 0)::float`,
        })
        .from(sales)
        .where(and(...conditions))
        .groupBy(sales.createdBy)
        .orderBy(desc(sql`sum(${sales.total})`))

      // Fetch user details & employee codes for the aggregated staff
      const staffIds = rows.map((r) => r.staffId).filter(Boolean) as string[]
      const userMap = new Map<string, { name: string; email: string; role: string; employeeCode: string | null }>()

      if (staffIds.length > 0) {
        const staffUsers = await db
          .select({
            id: users.id,
            name: users.fullName,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), inArray(users.id, staffIds)))

        const profiles = await db
          .select({
            userId: employeeProfiles.userId,
            employeeCode: employeeProfiles.employeeCode,
          })
          .from(employeeProfiles)
          .where(and(eq(employeeProfiles.tenantId, tenantId), inArray(employeeProfiles.userId, staffIds)))

        const codeMap = new Map(profiles.map((p) => [p.userId, p.employeeCode]))

        for (const u of staffUsers) {
          userMap.set(u.id, {
            name: u.name,
            email: u.email,
            role: u.role,
            employeeCode: codeMap.get(u.id) || null,
          })
        }
      }

      // Format report leaderboard
      const leaderboard = rows.map((r, index) => {
        const user = r.staffId ? userMap.get(r.staffId) : null
        const revenue = Number(r.totalRevenue) || 0
        const count = Number(r.salesCount) || 0
        // Star points: 1 point per 100 LKR of sales volume
        const starPoints = Math.round(revenue / 100)
        const aov = count > 0 ? Math.round((revenue / count) * 100) / 100 : 0

        return {
          rank: index + 1,
          staffId: r.staffId,
          staffName: user?.name || 'Unassigned Cashier',
          staffEmail: user?.email || '',
          staffRole: user?.role || 'cashier',
          employeeCode: user?.employeeCode || null,
          salesCount: count,
          totalRevenue: revenue,
          totalDiscount: Number(r.totalDiscount) || 0,
          averageOrderValue: aov,
          starPoints,
        }
      })

      return NextResponse.json({
        period: { fromDate, toDate, timezone: range.tz },
        leaderboard,
        totalSalesCount: leaderboard.reduce((sum, item) => sum + item.salesCount, 0),
        totalSalesRevenue: leaderboard.reduce((sum, item) => sum + item.totalRevenue, 0),
        totalStarPoints: leaderboard.reduce((sum, item) => sum + item.starPoints, 0),
      })
    })
  } catch (error) {
    logError('api/reports/staff-performance', error)
    return NextResponse.json({ error: 'Failed to load staff performance report' }, { status: 500 })
  }
}

