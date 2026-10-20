/**
 * Push notifications via the Expo Push API (works for Android/iOS builds of the POSLanka app).
 * Tokens are registered by the mobile app through POST /api/account/devices.
 * All functions are fire-and-forget safe: they never throw to the caller.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { userDevices, users } from '@/lib/db/schema'
import { hasPermission, type Permission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export interface PushMessage {
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default' | null
  channelId?: string
  priority?: 'default' | 'normal' | 'high'
}

function isExpoToken(t: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(t)
}

/** Send one message to many tokens (chunked by 100, as the Expo API requires). */
export async function sendPush(tokens: string[], message: PushMessage): Promise<{ sent: number; invalid: string[] }> {
  const valid = Array.from(new Set(tokens.filter(isExpoToken)))
  const invalid: string[] = []
  let sent = 0
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100)
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          data: message.data || {},
          sound: message.sound === null ? undefined : 'default',
          channelId: message.channelId || 'default',
          priority: message.priority || 'high',
        }))),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] }
      json.data?.forEach((ticket, idx) => {
        if (ticket.status === 'ok') sent++
        else if (ticket.details?.error === 'DeviceNotRegistered') invalid.push(chunk[idx])
      })
    } catch (error) {
      logError('notifications/push', error, { stage: 'expo-send' })
    }
  }
  if (invalid.length) {
    await db.delete(userDevices).where(inArray(userDevices.pushToken, invalid)).catch(() => undefined)
  }
  return { sent, invalid }
}

/** Push to specific tenant users. */
export async function sendPushToUsers(tenantId: string, userIds: string[], message: PushMessage) {
  if (userIds.length === 0) return { sent: 0, invalid: [] }
  try {
    const rows = await db.select({ token: userDevices.pushToken })
      .from(userDevices)
      .where(and(eq(userDevices.tenantId, tenantId), inArray(userDevices.userId, userIds)))
    return sendPush(rows.map((r) => r.token), message)
  } catch (error) {
    logError('notifications/push', error, { stage: 'users' })
    return { sent: 0, invalid: [] }
  }
}

/** Push to every active tenant user whose role grants `permission` (e.g. approvers). */
export async function sendPushToPermission(tenantId: string, permission: Permission, message: PushMessage, excludeUserId?: string) {
  try {
    // users is tenant data under RLS: read it in the tenant's context (works for any login role)
    const tenantUsers = await withTenant(tenantId, (tdb) =>
      tdb.select({ id: users.id, role: users.role, customRoleId: users.customRoleId })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true))))
    const targets = tenantUsers
      .filter((u) => u.id !== excludeUserId && hasPermission(u.role, permission, tenantId, u.customRoleId))
      .map((u) => u.id)
    return sendPushToUsers(tenantId, targets, message)
  } catch (error) {
    logError('notifications/push', error, { stage: 'permission' })
    return { sent: 0, invalid: [] }
  }
}

/** Push to every super admin device. */
export async function sendPushToSuperAdmins(message: PushMessage) {
  try {
    const rows = await db.select({ token: userDevices.pushToken }).from(userDevices).where(isNotNull(userDevices.superAdminId))
    return sendPush(rows.map((r) => r.token), message)
  } catch (error) {
    logError('notifications/push', error, { stage: 'super-admins' })
    return { sent: 0, invalid: [] }
  }
}
