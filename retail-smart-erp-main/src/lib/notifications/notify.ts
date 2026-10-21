/**
 * Single entry point for vendor alerts (push + in-app inbox).
 *
 * CONTRACT (shared between workstreams — keep the signature stable):
 *   notify(tenantId, type, payload) never throws; it is fire-and-forget safe.
 *
 * Delivery:
 *   1. de-dupe: when `dedupeKey` is given and the type has a window (alert-types.ts), the same
 *      (tenant, key) is delivered at most once per window (atomic claim on alert_dedupe);
 *   2. recipients: active tenant users holding `permission` + `userIds` − `excludeUserId`
 *      (read under RLS, so another tenant's users can never be reached);
 *   3. per recipient preferences (defaults when none): muted / not-enabled types are skipped;
 *      everybody else gets an in-app inbox row;
 *   4. push (Expo) unless the user disabled push or is inside quiet hours;
 *   5. after commit, a per-user `inbox-notification` WebSocket event is sent to each in-app
 *      recipient so open web inboxes refresh immediately (best effort, never throws).
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { inAppNotifications, notificationPreferences, userDevices, users } from '@/lib/db/schema'
import { hasPermission, type Permission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { sendPush } from './push'
import { CRITICAL_ALERT_TYPES, DEDUPE_WINDOW_SECONDS, type AlertType } from './alert-types'
import { getTenantTimezone, inQuietHours, toPreferences, wantsType } from './alert-settings'

export type { AlertType } from './alert-types'

export interface NotifyPayload {
  title: string
  body: string
  /** Extra data for the mobile app (e.g. { screen: 'approvals', id }) */
  data?: Record<string, unknown>
  /** Same key within the de-dupe window is sent once (e.g. `low_stock:<warehouseId>:<itemId>`) */
  dedupeKey?: string
  /** Recipients: everyone holding this permission … */
  permission?: Permission
  /** … and/or these specific users */
  userIds?: string[]
  excludeUserId?: string
}

export interface NotifyOutcome {
  skipped?: 'deduped' | 'no-recipients'
  recipients: string[]
  inApp: string[]
  pushed: string[]
  pushSent: number
}

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

/**
 * Deliver an alert and report what happened (used by tests / cron summaries).
 * Throws on database errors — use notify() from application code.
 */
export async function deliverAlert(tenantId: string, type: AlertType, payload: NotifyPayload, now = new Date()): Promise<NotifyOutcome> {
  const outcome: NotifyOutcome = { recipients: [], inApp: [], pushed: [], pushSent: 0 }
  const windowSec = DEDUPE_WINDOW_SECONDS[type] ?? 0
  const tenantTz = await getTenantTimezone(tenantId)

  const plan = await withTenant(tenantId, async (tdb) => {
    // 1. atomic de-dupe claim
    if (payload.dedupeKey && windowSec > 0) {
      const key = payload.dedupeKey.slice(0, 200)
      const claimed = rows<{ ok: number }>(await tdb.execute(sql`
        INSERT INTO alert_dedupe (tenant_id, dedupe_key, last_sent_at)
        VALUES (${tenantId}, ${key}, now())
        ON CONFLICT (tenant_id, dedupe_key) DO UPDATE SET last_sent_at = now()
        WHERE alert_dedupe.last_sent_at < now() - make_interval(secs => ${windowSec})
        RETURNING 1 AS ok
      `))
      if (claimed.length === 0) return { skipped: 'deduped' as const }
    }

    // 2. recipients (RLS limits users to this tenant)
    const explicit = new Set((payload.userIds || []).filter(Boolean))
    if (!payload.permission && explicit.size === 0) return { skipped: 'no-recipients' as const }
    const candidates = await tdb.select({ id: users.id, role: users.role, customRoleId: users.customRoleId })
      .from(users)
      .where(and(
        eq(users.tenantId, tenantId),
        eq(users.isActive, true),
        payload.permission ? undefined : inArray(users.id, [...explicit]),
      ))
    const recipientIds = candidates
      .filter((u) => explicit.has(u.id) || (payload.permission && hasPermission(u.role, payload.permission, tenantId, u.customRoleId)))
      .map((u) => u.id)
      .filter((id) => id !== payload.excludeUserId)
    if (recipientIds.length === 0) return { skipped: 'no-recipients' as const }

    // 3. preferences
    const prefRows = await tdb.select().from(notificationPreferences)
      .where(and(eq(notificationPreferences.tenantId, tenantId), inArray(notificationPreferences.userId, recipientIds)))
    const prefByUser = new Map(prefRows.map((p) => [p.userId, toPreferences(p)]))
    const inApp: string[] = []
    const push: string[] = []
    for (const id of recipientIds) {
      const prefs = prefByUser.get(id) || toPreferences(null)
      if (!wantsType(prefs, type)) continue
      inApp.push(id)
      if (!prefs.pushEnabled) continue
      if (!CRITICAL_ALERT_TYPES.includes(type) && inQuietHours(prefs, now, prefs.timezone || tenantTz)) continue
      push.push(id)
    }

    const data = { type, ...(payload.data || {}) }
    const inserted = inApp.length > 0
      ? await tdb.insert(inAppNotifications).values(inApp.map((userId) => ({
        tenantId,
        userId,
        type,
        title: payload.title.slice(0, 255),
        body: payload.body || '',
        data,
      }))).returning({ id: inAppNotifications.id, userId: inAppNotifications.userId })
      : []
    const tokens = push.length > 0
      ? (await tdb.select({ token: userDevices.pushToken }).from(userDevices)
        .where(and(eq(userDevices.tenantId, tenantId), inArray(userDevices.userId, push)))).map((r) => r.token)
      : []
    return { recipientIds, inApp, push, tokens, data, inserted }
  })

  if ('skipped' in plan) return { ...outcome, skipped: plan.skipped }
  emitInboxEvents(tenantId, type, plan.inserted)
  outcome.recipients = plan.recipientIds
  outcome.inApp = plan.inApp
  outcome.pushed = plan.push
  if (plan.tokens.length > 0) {
    const res = await sendPush(plan.tokens, { title: payload.title, body: payload.body, data: plan.data })
    outcome.pushSent = res.sent
  }
  return outcome
}

/** Real-time nudge to each recipient's open sessions (user-scoped channel). Never throws. */
function emitInboxEvents(tenantId: string, type: AlertType, inserted: Array<{ id: string; userId: string }>) {
  for (const row of inserted) {
    try {
      broadcastAccountChange(row.userId, 'inbox-notification', 'created', row.id, { tenantId, alertType: type })
    } catch (error) {
      logError('notifications/notify:broadcast', error, { type })
    }
  }
}

export async function notify(tenantId: string, type: AlertType, payload: NotifyPayload): Promise<void> {
  try {
    await deliverAlert(tenantId, type, payload)
  } catch (error) {
    // alerts must never break the caller
    logError('notifications/notify', error, { type, dedupeKey: payload.dedupeKey })
  }
}
