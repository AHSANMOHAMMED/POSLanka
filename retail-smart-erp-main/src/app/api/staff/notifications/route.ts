import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { hasPermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { deliverAlert, type NotifyPayload } from '@/lib/notifications/notify'
import { logError } from '@/lib/ai/error-logger'
import { notInRecycleBin } from '@/lib/recycle-bin'
import { consumeRateLimit, rateLimitedResponse } from '@/lib/auth/rate-limit'

const MAX_SELECTED = 50
const MAX_SELECTED_PER_SEND = 20

const sendSchema = z.object({
  title: z.string().trim().min(3, 'Enter a title of at least 3 characters').max(120),
  body: z.string().trim().min(3, 'Enter a message of at least 3 characters').max(2000),
  /** all = every active staff; managers = owners/managers; selected = userIds */
  audience: z.enum(['all', 'managers', 'selected']).default('selected'),
  userIds: z.array(z.string().uuid()).max(MAX_SELECTED).optional().default([]),
})

/**
 * GET /api/staff/notifications — active colleagues (for the compose picker).
 * POST /api/staff/notifications — send an in-app + Expo push to staff phones.
 *
 * Requires manageUsers (owners / managers). Cashiers cannot push-spam colleagues.
 */
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = session.user.tenantId
    const me = session.user.id
    const canManage = hasPermission(session.user.role, 'manageUsers', tenantId, session.user.customRoleId)
    if (!canManage) {
      return NextResponse.json({ error: 'Only managers can notify staff.' }, { status: 403 })
    }

    const staff = await withTenant(tenantId, async (tdb) => {
      return tdb
        .select({
          id: users.id,
          fullName: users.fullName,
          role: users.role,
        })
        .from(users)
        .where(and(
          eq(users.tenantId, tenantId),
          eq(users.isActive, true),
          ne(users.id, me),
          notInRecycleBin('user', users.id),
        ))
        .orderBy(asc(users.fullName))
        .limit(300)
    })

    return NextResponse.json({
      staff,
      canBroadcastAll: true,
      canNotify: true,
      maxSelected: MAX_SELECTED_PER_SEND,
    })
  } catch (error) {
    logError('api/staff/notifications GET', error)
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = await validateBody(request, sendSchema)
    if (!parsed.success) return parsed.response

    const { title, body, audience, userIds } = parsed.data
    const tenantId = session.user.tenantId
    const me = session.user.id
    const canManage = hasPermission(session.user.role, 'manageUsers', tenantId, session.user.customRoleId)

    if (!canManage) {
      return NextResponse.json({ error: 'Only managers can notify staff.' }, { status: 403 })
    }
    if (audience === 'selected' && userIds.length === 0) {
      return NextResponse.json({ error: 'Pick at least one colleague.' }, { status: 400 })
    }
    if (audience === 'selected' && userIds.length > MAX_SELECTED_PER_SEND) {
      return NextResponse.json({ error: `Pick at most ${MAX_SELECTED_PER_SEND} colleagues per send.` }, { status: 400 })
    }

    // 10 sends / hour / manager
    const hourly = await consumeRateLimit(`staff_notify:${tenantId}:${me}`, {
      maxAttempts: 10,
      windowMs: 60 * 60_000,
      category: 'staff_notify',
    })
    if (hourly.limited) {
      return rateLimitedResponse(hourly, 'You have sent too many staff messages this hour. Try again later.')
    }

    // 1 "all" broadcast / day
    if (audience === 'all') {
      const daily = await consumeRateLimit(`staff_notify_all:${tenantId}:${me}`, {
        maxAttempts: 1,
        windowMs: 24 * 60 * 60_000,
        category: 'staff_notify_all',
      })
      if (daily.limited) {
        return rateLimitedResponse(daily, 'You can send one company-wide staff message per day. Try again tomorrow.')
      }
    }

    // Per-recipient cooldown (selected): max 3 messages to the same person / hour
    if (audience === 'selected') {
      for (const uid of userIds.slice(0, MAX_SELECTED_PER_SEND)) {
        const per = await consumeRateLimit(`staff_notify_to:${tenantId}:${me}:${uid}`, {
          maxAttempts: 3,
          windowMs: 60 * 60_000,
          category: 'staff_notify_recipient',
        })
        if (per.limited) {
          return rateLimitedResponse(per, 'You have messaged one of these colleagues too often this hour.')
        }
      }
    }

    const senderName = session.user.name || session.user.email || 'Staff'
    const contentHash = createHash('sha256').update(`${title}\n${body}`).digest('hex').slice(0, 16)
    const payload: NotifyPayload = {
      title: title.slice(0, 255),
      body: `${body}\n\n— ${senderName}`.slice(0, 4000),
      excludeUserId: me,
      dedupeKey: `staff_msg:${me}:${contentHash}`,
      data: {
        screen: 'alerts',
        sentBy: me,
        sentByName: senderName,
      },
    }

    if (audience === 'all') {
      const rows = await withTenant(tenantId, async (tdb) => {
        return tdb
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.tenantId, tenantId),
            eq(users.isActive, true),
            ne(users.id, me),
            notInRecycleBin('user', users.id),
          ))
          .limit(500)
      })
      payload.userIds = rows.map((r) => r.id)
    } else if (audience === 'managers') {
      payload.permission = 'manageUsers'
    } else {
      const rows = await withTenant(tenantId, async (tdb) => {
        return tdb
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.tenantId, tenantId),
            eq(users.isActive, true),
            inArray(users.id, userIds.slice(0, MAX_SELECTED_PER_SEND)),
            ne(users.id, me),
            notInRecycleBin('user', users.id),
          ))
      })
      payload.userIds = rows.map((r) => r.id)
      if (!payload.userIds.length) {
        return NextResponse.json({ error: 'None of those colleagues are active in this company.' }, { status: 400 })
      }
    }

    if (audience === 'all' && !(payload.userIds?.length)) {
      return NextResponse.json({ error: 'No other staff members to notify.' }, { status: 400 })
    }

    const outcome = await deliverAlert(tenantId, 'staff_announcement', payload)

    if (outcome.skipped === 'deduped') {
      return NextResponse.json({ error: 'You just sent the same message. Wait a couple of minutes before sending it again.' }, { status: 429 })
    }
    if (outcome.skipped === 'no-recipients') {
      return NextResponse.json({ error: 'No recipients matched.' }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      recipients: outcome.recipients.length,
      inApp: outcome.inApp.length,
      pushTargets: outcome.pushed.length,
      pushSent: outcome.pushSent,
    })
  } catch (error) {
    logError('api/staff/notifications POST', error)
    return NextResponse.json({ error: 'Could not send the notification' }, { status: 500 })
  }
}
