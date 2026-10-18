import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { activityLogs } from '@/lib/db/schema'
import { eq, and, desc, gte, lte, sql, inArray } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { activityLogsListSchema } from '@/lib/validation/schemas/users'

// X4: GET activity logs with pagination and filters
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewActivityLogs')
    if (permError) return permError

    const parsed = validateSearchParams(request, activityLogsListSchema)
    if (!parsed.success) return parsed.response
    const { page, limit: parsedLimit, pageSize, entityType, action, userId, startDate, endDate } = parsed.data
    const limit = parsedLimit ?? pageSize ?? 50
    const offset = (page - 1) * limit

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (RLS handles tenantId filtering)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = []

      if (entityType) {
        conditions.push(eq(activityLogs.entityType, entityType))
      }
      if (action) {
        if (action.includes(',')) {
          const actions = action.split(',').map(a => a.trim()) as (typeof activityLogs.action.enumValues[number])[]
          conditions.push(inArray(activityLogs.action, actions))
        } else {
          conditions.push(eq(activityLogs.action, action as typeof activityLogs.action.enumValues[number]))
        }
      }
      if (userId) {
        conditions.push(eq(activityLogs.userId, userId))
      }
      if (startDate) {
        conditions.push(gte(activityLogs.createdAt, new Date(startDate)))
      }
      if (endDate) {
        conditions.push(lte(activityLogs.createdAt, new Date(endDate + 'T23:59:59')))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count }] = await db.select({ count: sql<number>`count(*)` })
        .from(activityLogs)
        .where(whereClause)

      // Get paginated results
      const logs = await db.query.activityLogs.findMany({
        where: whereClause,
        with: {
          user: {
            columns: { id: true, fullName: true, email: true }
          }
        },
        orderBy: [desc(activityLogs.createdAt)],
        limit,
        offset,
      })

      return NextResponse.json({
        logs,
        pagination: {
          page,
          limit,
          total: Number(count),
          totalPages: Math.ceil(Number(count) / limit),
        },
      })
    })
  } catch (error) {
    logError('api/activity-logs', error)
    return NextResponse.json({ error: 'Failed to fetch activity logs' }, { status: 500 })
  }
}
