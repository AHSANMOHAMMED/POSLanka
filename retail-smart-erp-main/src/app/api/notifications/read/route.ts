import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { inAppNotifications } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { markNotificationsReadSchema } from '@/lib/validation/schemas/notification-alerts'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'

// POST /api/notifications/read { ids?: uuid[], all?: true } — mark my notifications as read
export async function POST(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await validateBody(request, markNotificationsReadSchema)
  if (!parsed.success) return parsed.response
  const tenantId = session.user.tenantId
  const userId = session.user.id
  try {
    const result = await withTenant(tenantId, async (tdb) => {
      const conds = [eq(inAppNotifications.tenantId, tenantId), eq(inAppNotifications.userId, userId), isNull(inAppNotifications.readAt)]
      if (!parsed.data.all) conds.push(inArray(inAppNotifications.id, parsed.data.ids || []))
      const updated = await tdb.update(inAppNotifications).set({ readAt: new Date() })
        .where(and(...conds)).returning({ id: inAppNotifications.id })
      const [{ unread }] = await tdb.select({ unread: sql<number>`count(*)::int` }).from(inAppNotifications)
        .where(and(eq(inAppNotifications.tenantId, tenantId), eq(inAppNotifications.userId, userId), isNull(inAppNotifications.readAt)))
      return { updated: updated.length, unreadCount: unread }
    })
    // keep this user's other open tabs/devices in sync
    if (result.updated > 0) broadcastAccountChange(userId, 'inbox-notification', 'updated', 'read', { tenantId })
    return NextResponse.json(result)
  } catch (error) {
    logError('api/notifications/read', error)
    return NextResponse.json({ error: 'Failed to mark notifications as read' }, { status: 500 })
  }
}
