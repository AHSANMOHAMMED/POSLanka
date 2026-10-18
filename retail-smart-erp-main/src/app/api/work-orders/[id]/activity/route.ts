import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { activityLogs, users } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET /api/work-orders/[id]/activity - Get activity log for a work order
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const logs = await db
        .select({
          id: activityLogs.id,
          action: activityLogs.action,
          description: activityLogs.description,
          createdAt: activityLogs.createdAt,
          user: {
            fullName: users.fullName,
          },
        })
        .from(activityLogs)
        .leftJoin(users, eq(activityLogs.userId, users.id))
        .where(
          and(
            eq(activityLogs.entityType, 'work_order'),
            eq(activityLogs.entityId, id)
          )
        )
        .orderBy(desc(activityLogs.createdAt))
        .limit(50)

      return NextResponse.json(logs)
    })
  } catch (error) {
    logError('api/work-orders/[id]/activity', error)
    return NextResponse.json(
      { error: 'Failed to fetch activity log' },
      { status: 500 }
    )
  }
}
