/**
 * Push notifications via the Expo Push API (works for Android/iOS builds of the skyERPOS app).
 * Tokens are registered by the mobile app through POST /api/account/devices.
 * All functions are fire-and-forget safe: they never throw to the caller.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { userDevices, users } from '@/lib/db/schema'
import { hasPermission, type Permission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'
import { fetchWithTimeout } from '@/lib/utils/fetch-timeout'

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

export interface PushTicketResult {
  token: string
  status: 'ok' | 'error'
  error?: string
}

/**
 * Send one message to many tokens (chunked by 100, as the Expo API requires) and report the
 * Expo ticket per token. Tokens Expo says are no longer registered are removed from user_devices.
 * Non-Expo tokens are reported as errors and never sent.
 */
export async function sendPushDetailed(tokens: string[], message: PushMessage): Promise<PushTicketResult[]> {
  const unique = Array.from(new Set(tokens))
  const results: PushTicketResult[] = unique.filter((t) => !isExpoToken(t)).map((token) => ({ token, status: 'error' as const, error: 'Not an Expo push token' }))
  const valid = unique.filter(isExpoToken)
  const invalid: string[] = []
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100)
    try {
      const res = await fetchWithTimeout(process.env.EXPO_PUSH_URL || EXPO_PUSH_URL, {
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
      const json = (await res.json().catch(() => ({}))) as { data?: { status: string; message?: string; details?: { error?: string } }[] }
      chunk.forEach((token, idx) => {
        const ticket = json.data?.[idx]
        if (ticket?.status === 'ok') {
          results.push({ token, status: 'ok' })
        } else {
          const error = ticket?.details?.error || ticket?.message || (res.ok ? 'No ticket returned' : `HTTP ${res.status}`)
          if (ticket?.details?.error === 'DeviceNotRegistered') invalid.push(token)
          results.push({ token, status: 'error', error })
        }
      })
    } catch (error) {
      logError('notifications/push', error, { stage: 'expo-send' })
      for (const token of chunk) results.push({ token, status: 'error', error: error instanceof Error ? error.message : 'Send failed' })
    }
  }
  if (invalid.length) {
    await db.delete(userDevices).where(inArray(userDevices.pushToken, invalid)).catch(() => undefined)
  }
  return results
}

/** Send one message to many tokens (chunked by 100, as the Expo API requires). */
export async function sendPush(tokens: string[], message: PushMessage): Promise<{ sent: number; invalid: string[] }> {
  const results = await sendPushDetailed(tokens, message)
  return {
    sent: results.filter((r) => r.status === 'ok').length,
    invalid: results.filter((r) => r.error === 'DeviceNotRegistered').map((r) => r.token),
  }
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
