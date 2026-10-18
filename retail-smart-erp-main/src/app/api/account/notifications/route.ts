import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accountNotifications } from '@/lib/db/schema'
import { eq, desc, and, inArray, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { validateBody } from '@/lib/validation/helpers'
import { createNotificationSchema, updateNotificationsSchema } from '@/lib/validation/schemas/account'

// GET /api/account/notifications - Get user notifications
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const unreadOnly = searchParams.get('unread') === 'true'

    const accountId = session.user.accountId

    // Build query conditions
    const conditions = [eq(accountNotifications.accountId, accountId)]
    if (unreadOnly) {
      conditions.push(eq(accountNotifications.isRead, false))
    }

    // Fetch notifications
    const notifications = await db
      .select()
      .from(accountNotifications)
      .where(and(...conditions))
      .orderBy(desc(accountNotifications.createdAt))
      .limit(limit)

    // Get unread count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accountNotifications)
      .where(and(
        eq(accountNotifications.accountId, accountId),
        eq(accountNotifications.isRead, false)
      ))

    return NextResponse.json({
      notifications: notifications.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        link: n.link,
        isRead: n.isRead,
        readAt: n.readAt,
        metadata: n.metadata,
        createdAt: n.createdAt,
      })),
      unreadCount: countResult?.count ?? 0,
    })
  } catch (error) {
    logError('api/account/notifications', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}

// POST /api/account/notifications - Create a notification (internal use)
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, createNotificationSchema)
    if (!parsed.success) return parsed.response
    const { type, title, message, link, metadata } = parsed.data

    const [notification] = await db.insert(accountNotifications).values({
      accountId: session.user.accountId,
      type,
      title,
      message,
      link: link || null,
      metadata: metadata || {},
    }).returning()

    broadcastAccountChange(session.user.accountId, 'account-notification', 'created', notification.id)

    return NextResponse.json(notification)
  } catch (error) {
    logError('api/account/notifications', error)
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 })
  }
}

// PUT /api/account/notifications - Mark notifications as read
export async function PUT(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, updateNotificationsSchema)
    if (!parsed.success) return parsed.response
    const { notificationIds, markAllRead } = parsed.data

    const accountId = session.user.accountId
    const now = new Date()

    if (markAllRead) {
      // Mark all notifications as read
      await db.update(accountNotifications)
        .set({ isRead: true, readAt: now })
        .where(and(
          eq(accountNotifications.accountId, accountId),
          eq(accountNotifications.isRead, false)
        ))
      broadcastAccountChange(accountId, 'account-notification', 'updated', 'bulk')
    } else if (notificationIds && notificationIds.length > 0) {
      // Mark specific notifications as read
      await db.update(accountNotifications)
        .set({ isRead: true, readAt: now })
        .where(and(
          eq(accountNotifications.accountId, accountId),
          inArray(accountNotifications.id, notificationIds)
        ))
      broadcastAccountChange(accountId, 'account-notification', 'updated', notificationIds[0])
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/account/notifications', error)
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 })
  }
}

// DELETE /api/account/notifications - Delete notification(s)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const deleteAll = searchParams.get('all') === 'true'

    const accountId = session.user.accountId

    if (deleteAll) {
      // Delete all notifications for this account
      await db.delete(accountNotifications)
        .where(eq(accountNotifications.accountId, accountId))
      broadcastAccountChange(accountId, 'account-notification', 'deleted', 'all')
    } else if (id) {
      // Delete specific notification
      await db.delete(accountNotifications)
        .where(and(
          eq(accountNotifications.id, id),
          eq(accountNotifications.accountId, accountId)
        ))
      broadcastAccountChange(accountId, 'account-notification', 'deleted', id)
    } else {
      return NextResponse.json({ error: 'Either id or all=true is required' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/account/notifications', error)
    return NextResponse.json({ error: 'Failed to delete notification' }, { status: 500 })
  }
}
