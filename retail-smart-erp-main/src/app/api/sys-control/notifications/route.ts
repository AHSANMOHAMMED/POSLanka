import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accountNotifications, accounts } from '@/lib/db/schema'
import { eq, desc, inArray } from 'drizzle-orm'
import { adminAudit, withRateLimit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { sysCreateNotificationSchema, sysDeleteNotificationsSchema } from '@/lib/validation/schemas/sys-control'

// GET /api/sys-control/notifications - Get sent notifications
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/notifications')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')

    // Get all notifications with account info
    const notifications = await db
      .select({
        id: accountNotifications.id,
        accountId: accountNotifications.accountId,
        type: accountNotifications.type,
        title: accountNotifications.title,
        message: accountNotifications.message,
        link: accountNotifications.link,
        isRead: accountNotifications.isRead,
        createdAt: accountNotifications.createdAt,
        accountName: accounts.fullName,
        accountEmail: accounts.email,
      })
      .from(accountNotifications)
      .leftJoin(accounts, eq(accountNotifications.accountId, accounts.id))
      .orderBy(desc(accountNotifications.createdAt))
      .limit(limit)
      .offset(offset)

    return NextResponse.json({ notifications })
  } catch (error) {
    logError('api/sys-control/notifications', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}

// POST /api/sys-control/notifications - Send notification to users
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/notifications')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, sysCreateNotificationSchema)
    if (!parsed.success) return parsed.response
    const { type, title, message, link, accountIds, sendToAll } = parsed.data

    let targetAccountIds: string[] = []

    if (sendToAll) {
      // Get all active accounts (non-super admins)
      const allAccounts = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.isSuperAdmin, false))
      targetAccountIds = allAccounts.map((a) => a.id)
    } else if (accountIds && Array.isArray(accountIds) && accountIds.length > 0) {
      targetAccountIds = accountIds
    } else {
      return NextResponse.json({ error: 'Either accountIds or sendToAll is required' }, { status: 400 })
    }

    if (targetAccountIds.length === 0) {
      return NextResponse.json({ error: 'No target accounts found' }, { status: 400 })
    }

    // Create notifications for all target accounts
    const notificationValues = targetAccountIds.map((accountId) => ({
      accountId,
      type,
      title,
      message,
      link: link || null,
      metadata: { sentBy: 'system_admin', sentAt: new Date().toISOString() },
    }))

    const inserted = await db.insert(accountNotifications).values(notificationValues).returning()

    // Audit log
    await adminAudit.create(session.superAdminId, 'notification', 'bulk', {
      count: inserted.length,
      type,
      title,
    })

    return NextResponse.json({
      success: true,
      count: inserted.length,
      message: `Notification sent to ${inserted.length} user${inserted.length > 1 ? 's' : ''}`,
    })
  } catch (error) {
    logError('api/sys-control/notifications', error)
    return NextResponse.json({ error: 'Failed to send notifications' }, { status: 500 })
  }
}

// DELETE /api/sys-control/notifications - Delete notifications
export async function DELETE(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/notifications')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, sysDeleteNotificationsSchema)
    if (!parsed.success) return parsed.response
    const { ids } = parsed.data

    // Delete the notifications
    await db.delete(accountNotifications).where(inArray(accountNotifications.id, ids))

    // Audit log
    await adminAudit.create(session.superAdminId, 'notification', 'delete', {
      count: ids.length,
    })

    return NextResponse.json({
      success: true,
      message: `Deleted ${ids.length} notification${ids.length > 1 ? 's' : ''}`,
    })
  } catch (error) {
    logError('api/sys-control/notifications', error)
    return NextResponse.json({ error: 'Failed to delete notifications' }, { status: 500 })
  }
}
