import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { activityLogs, users } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { z } from 'zod'

const getActivitySchema = z.object({
  entityType: z.string().min(1).max(50), // e.g., 'purchase_order', 'work_order'
  entityId: z.string().uuid(),
})

// GET /api/document-activity?entityType=purchase_order&entityId=xxx
export async function GET(request: NextRequest) {
  try {
    const paramsParsed = validateSearchParams(request, getActivitySchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { entityType, entityId } = paramsParsed.data

    const result = await withAuthTenant(async (_session, db) => {
      const logs = await db
        .select({
          id: activityLogs.id,
          action: activityLogs.action,
          description: activityLogs.description,
          metadata: activityLogs.metadata,
          createdAt: activityLogs.createdAt,
          user: {
            fullName: users.fullName,
          },
        })
        .from(activityLogs)
        .leftJoin(users, eq(activityLogs.userId, users.id))
        .where(
          and(
            eq(activityLogs.entityType, entityType),
            eq(activityLogs.entityId, entityId)
          )
        )
        .orderBy(desc(activityLogs.createdAt))
        .limit(50)

      return { data: logs }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json(result.data)
  } catch (error) {
    logError('api/document-activity/GET', error)
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
  }
}
