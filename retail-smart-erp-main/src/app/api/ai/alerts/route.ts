import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { aiAlerts } from '@/lib/db/schema'
import { desc, eq, and, sql, isNull } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { updateAlertSchema } from '@/lib/validation/schemas/ai'

export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '20'), 100)
  const type = searchParams.get('type')
  const unreadOnly = searchParams.get('unread') === 'true'
  const all = searchParams.get('all') === 'true'

  return await withTenant(session.user.tenantId, async (db) => {
    const conditions = []

    // Don't show dismissed alerts
    conditions.push(isNull(aiAlerts.dismissedAt))

    if (type) {
      conditions.push(eq(aiAlerts.type, type as 'anomaly' | 'insight' | 'error' | 'suggestion'))
    }

    if (unreadOnly) {
      conditions.push(isNull(aiAlerts.readAt))
    }

    const whereClause = and(...conditions)

    if (all) {
      const alerts = await db
        .select()
        .from(aiAlerts)
        .where(whereClause)
        .orderBy(desc(aiAlerts.createdAt))
        .limit(50)

      return NextResponse.json(alerts)
    }

    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiAlerts)
      .where(whereClause)

    const alerts = await db
      .select()
      .from(aiAlerts)
      .where(whereClause)
      .orderBy(desc(aiAlerts.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    // Also get unread count
    const [{ count: unreadCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiAlerts)
      .where(and(isNull(aiAlerts.dismissedAt), isNull(aiAlerts.readAt)))

    return NextResponse.json({
      data: alerts,
      unreadCount,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    })
  })
}

// Mark alerts as read/dismissed
export async function PUT(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await validateBody(request, updateAlertSchema)
  if (!parsed.success) return parsed.response
  const { id, ids, action } = parsed.data

  return await withTenant(session.user.tenantId, async (db) => {
    const targetIds = ids || (id ? [id] : [])

    for (const alertId of targetIds) {
      if (action === 'read') {
        await db.update(aiAlerts)
          .set({ readAt: new Date() })
          .where(eq(aiAlerts.id, alertId))
      } else if (action === 'dismiss') {
        await db.update(aiAlerts)
          .set({ dismissedAt: new Date() })
          .where(eq(aiAlerts.id, alertId))
      }
    }

    return NextResponse.json({ success: true })
  })
}
