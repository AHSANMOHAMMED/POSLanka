/**
 * Scheduled alert jobs (called by /api/cron/* routes; exported for tests).
 *
 *   runStockAlerts           hourly  — per user at their local digest hour: low-stock digest +
 *                                      expiring items / batches; housekeeping of the inbox.
 *   runSubscriptionReminders daily   — trial / period ends in 7 and 1 days → company owners.
 *   runImportMaintenance     15 min  — resume interrupted import jobs, delete jobs finished > 30 days ago.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { notificationPreferences, subscriptions, tenants, users } from '@/lib/db/schema'
import { hasPermission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'
import { HEARTBEAT_STALE_MS } from '@/lib/import-export/import-job-store'
import { isRunningLocally, runImportJob, startImportJobInBackground } from '@/lib/import-export/run-import-job'
import { deliverAlert, type NotifyOutcome } from './notify'
import { getAlertSettings, localParts, toPreferences, wantsType } from './alert-settings'

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))

interface TenantFilter {
  now?: Date
  /** restrict to these tenants (tests / manual runs) */
  tenantIds?: string[]
}

async function activeTenants(tenantIds?: string[]) {
  const conds = [eq(tenants.status, 'active')]
  if (tenantIds?.length) conds.push(inArray(tenants.id, tenantIds))
  return db.select({ id: tenants.id, timezone: tenants.timezone }).from(tenants).where(and(...conds))
}

// ---------------------------------------------------------------------------
// Stock digest + expiring stock
// ---------------------------------------------------------------------------

export interface LowStockRow { itemId: string; name: string; warehouse: string; current: number; min: number }
export interface ExpiringRow { kind: 'item' | 'batch'; itemId: string; name: string; batchNumber: string | null; expiryDate: string; qty: number }

export interface StockAlertsSummary {
  tenants: number
  dueUsers: number
  digests: number
  expiring: number
  outcomes: Array<{ tenantId: string; userId: string; type: string; outcome: NotifyOutcome }>
}

export async function runStockAlerts(opts: TenantFilter = {}): Promise<StockAlertsSummary> {
  const now = opts.now || new Date()
  const summary: StockAlertsSummary = { tenants: 0, dueUsers: 0, digests: 0, expiring: 0, outcomes: [] }
  for (const t of await activeTenants(opts.tenantIds)) {
    summary.tenants++
    try {
      await stockAlertsForTenant(t.id, t.timezone, now, summary)
    } catch (error) {
      logError('cron/stock-alerts', error, { tenantId: t.id })
    }
  }
  return summary
}

async function stockAlertsForTenant(tenantId: string, tenantTz: string, now: Date, summary: StockAlertsSummary) {
  const settings = await getAlertSettings(tenantId)

  const due = await withTenant(tenantId, async (tdb) => {
    // housekeeping: old read notifications and stale de-dupe keys
    await tdb.execute(sql`DELETE FROM in_app_notifications WHERE tenant_id = ${tenantId}
      AND ((read_at IS NOT NULL AND read_at < ${new Date(now.getTime() - 90 * 86400000)})
        OR created_at < ${new Date(now.getTime() - 180 * 86400000)})`)
    await tdb.execute(sql`DELETE FROM alert_dedupe WHERE tenant_id = ${tenantId}
      AND last_sent_at < ${new Date(now.getTime() - 7 * 86400000)}`)

    const candidates = await tdb.select({ id: users.id, role: users.role, customRoleId: users.customRoleId })
      .from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
    const managers = candidates.filter((u) => hasPermission(u.role, 'manageInventory', tenantId, u.customRoleId))
    if (managers.length === 0) return []
    const prefRows = await tdb.select().from(notificationPreferences)
      .where(and(eq(notificationPreferences.tenantId, tenantId), inArray(notificationPreferences.userId, managers.map((m) => m.id))))
    const prefBy = new Map(prefRows.map((p) => [p.userId, toPreferences(p)]))
    const out: Array<{ userId: string; date: string; digest: boolean; expiring: boolean }> = []
    for (const m of managers) {
      const prefs = prefBy.get(m.id) || toPreferences(null)
      if (prefs.digestHour === null) continue
      const local = localParts(now, prefs.timezone || tenantTz)
      if (local.hour !== prefs.digestHour) continue
      const digest = settings.digestEnabled && wantsType(prefs, 'stock_digest')
      const expiring = wantsType(prefs, 'expiring_stock')
      if (digest || expiring) out.push({ userId: m.id, date: local.date, digest, expiring })
    }
    return out
  })
  if (due.length === 0) return
  summary.dueUsers += due.length

  const today = due[0].date
  const data = await withTenant(tenantId, async (tdb) => {
    const def = settings.defaultMinStock || 0
    const low = due.some((d) => d.digest) ? rows<{ total: number; item_id: string; name: string; warehouse: string; current: string; eff_min: string }>(await tdb.execute(sql`
      WITH low AS (
        SELECT i.id AS item_id, i.name, w.name AS warehouse, ws.current_stock AS current,
               CASE WHEN ws.min_stock > 0 THEN ws.min_stock ELSE ${def}::numeric END AS eff_min
        FROM warehouse_stock ws
        JOIN items i ON i.id = ws.item_id
        JOIN warehouses w ON w.id = ws.warehouse_id
        WHERE ws.tenant_id = ${tenantId} AND i.is_active AND i.track_stock AND w.is_active
      )
      SELECT count(*) OVER ()::int AS total, item_id, name, warehouse, current, eff_min
      FROM low
      WHERE eff_min > 0 AND current <= eff_min
      ORDER BY current / NULLIF(eff_min, 0), name
      LIMIT 10
    `)) : []

    const days = settings.expiryWarningDays
    const expiring = due.some((d) => d.expiring) ? rows<{ kind: 'item' | 'batch'; item_id: string; name: string; batch_number: string | null; expiry_date: string; qty: string }>(await tdb.execute(sql`
      SELECT * FROM (
        SELECT 'batch' AS kind, b.item_id, i.name, b.batch_number, b.expiry_date::text AS expiry_date, b.current_quantity AS qty
        FROM item_batches b JOIN items i ON i.id = b.item_id
        WHERE b.tenant_id = ${tenantId} AND b.status = 'active' AND b.current_quantity > 0
          AND b.expiry_date IS NOT NULL AND b.expiry_date <= ${today}::date + ${days}::int
        UNION ALL
        SELECT 'item' AS kind, i.id, i.name, NULL, i.expiry_date::text, s.qty
        FROM items i
        JOIN (SELECT item_id, sum(current_stock) AS qty FROM warehouse_stock WHERE tenant_id = ${tenantId} GROUP BY item_id) s ON s.item_id = i.id
        WHERE i.tenant_id = ${tenantId} AND i.is_active AND i.expiry_date IS NOT NULL
          AND i.expiry_date <= ${today}::date + ${days}::int AND s.qty > 0
          AND NOT EXISTS (SELECT 1 FROM item_batches b2 WHERE b2.item_id = i.id AND b2.tenant_id = ${tenantId} AND b2.expiry_date IS NOT NULL)
      ) x
      ORDER BY expiry_date, name
      LIMIT 200
    `)) : []
    return {
      lowTotal: low[0]?.total ?? 0,
      low: low.map<LowStockRow>((r) => ({ itemId: r.item_id, name: r.name, warehouse: r.warehouse, current: Number(r.current), min: Number(r.eff_min) })),
      expiring: expiring.map<ExpiringRow>((r) => ({ kind: r.kind, itemId: r.item_id, name: r.name, batchNumber: r.batch_number, expiryDate: r.expiry_date, qty: Number(r.qty) })),
    }
  })

  for (const d of due) {
    if (d.digest && data.lowTotal > 0) {
      const top = data.low.map((l) => `${l.name} ${fmtQty(l.current)}/${fmtQty(l.min)}`).join(', ')
      const outcome = await deliverAlert(tenantId, 'stock_digest', {
        title: `${data.lowTotal} item${data.lowTotal === 1 ? '' : 's'} at or below minimum stock`,
        body: `${top}${data.lowTotal > data.low.length ? ` +${data.lowTotal - data.low.length} more` : ''}`,
        data: { screen: 'inventory', count: data.lowTotal, items: data.low },
        dedupeKey: `stock_digest:${d.userId}:${d.date}`,
        userIds: [d.userId],
      }, now)
      summary.outcomes.push({ tenantId, userId: d.userId, type: 'stock_digest', outcome })
      if (outcome.inApp.length) summary.digests++
    }
    if (d.expiring && data.expiring.length > 0) {
      const expired = data.expiring.filter((e) => e.expiryDate < d.date).length
      const soon = data.expiring.length - expired
      const parts = [soon ? `${soon} expiring within ${settings.expiryWarningDays} days` : '', expired ? `${expired} already expired` : ''].filter(Boolean)
      const outcome = await deliverAlert(tenantId, 'expiring_stock', {
        title: `Expiry check: ${parts.join(', ')}`,
        body: data.expiring.slice(0, 5).map((e) => `${e.name}${e.batchNumber ? ` (${e.batchNumber})` : ''} ${e.expiryDate}`).join(', '),
        data: { screen: 'inventory', count: data.expiring.length, items: data.expiring.slice(0, 20) },
        dedupeKey: `expiring_stock:${d.userId}:${d.date}`,
        userIds: [d.userId],
      }, now)
      summary.outcomes.push({ tenantId, userId: d.userId, type: 'expiring_stock', outcome })
      if (outcome.inApp.length) summary.expiring++
    }
  }
}

// ---------------------------------------------------------------------------
// Subscription reminders
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_REMINDER_DAYS = [7, 1]

export interface SubscriptionRemindersSummary {
  checked: number
  sent: Array<{ tenantId: string; daysLeft: number; outcome: NotifyOutcome }>
}

export async function runSubscriptionReminders(opts: TenantFilter = {}): Promise<SubscriptionRemindersSummary> {
  const now = opts.now || new Date()
  const conds = [eq(tenants.status, 'active'), inArray(subscriptions.status, ['trial', 'active', 'past_due'])]
  if (opts.tenantIds?.length) conds.push(inArray(subscriptions.tenantId, opts.tenantIds))
  const subs = await db.select({
    id: subscriptions.id, tenantId: subscriptions.tenantId, status: subscriptions.status,
    trialEndsAt: subscriptions.trialEndsAt, currentPeriodEnd: subscriptions.currentPeriodEnd,
    cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd, tenantName: tenants.name,
  }).from(subscriptions).innerJoin(tenants, eq(tenants.id, subscriptions.tenantId)).where(and(...conds))

  const summary: SubscriptionRemindersSummary = { checked: subs.length, sent: [] }
  for (const s of subs) {
    try {
      const end = s.status === 'trial' ? s.trialEndsAt : s.currentPeriodEnd
      if (!end) continue
      const daysLeft = Math.ceil((new Date(end).getTime() - now.getTime()) / 86400000)
      if (!SUBSCRIPTION_REMINDER_DAYS.includes(daysLeft)) continue
      const owners = await withTenant(s.tenantId, (tdb) => tdb.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, s.tenantId), eq(users.role, 'owner'), eq(users.isActive, true))))
      if (owners.length === 0) continue
      const when = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`
      const date = new Date(end).toISOString().slice(0, 10)
      const title = s.status === 'trial'
        ? `Your free trial ends ${when}`
        : s.cancelAtPeriodEnd ? `Your subscription ends ${when}` : `Your subscription renews ${when}`
      const body = s.status === 'trial'
        ? `${s.tenantName}: the trial ends on ${date}. Choose a plan to keep using skyERPOS without interruption.`
        : s.cancelAtPeriodEnd
          ? `${s.tenantName}: the plan ends on ${date}. Renew to keep access to your data.`
          : `${s.tenantName}: the current period ends on ${date}. Make sure your payment is ready.`
      const outcome = await deliverAlert(s.tenantId, 'subscription_expiring', {
        title, body,
        data: { screen: 'alerts', subscriptionId: s.id, daysLeft, endsAt: new Date(end).toISOString() },
        dedupeKey: `subscription_expiring:${s.id}:${daysLeft}:${date}`,
        userIds: owners.map((o) => o.id),
      }, now)
      summary.sent.push({ tenantId: s.tenantId, daysLeft, outcome })
    } catch (error) {
      logError('cron/subscription-reminders', error, { tenantId: s.tenantId })
    }
  }
  return summary
}

// ---------------------------------------------------------------------------
// Import jobs maintenance
// ---------------------------------------------------------------------------

export const IMPORT_JOB_RETENTION_DAYS = 30

export interface ImportMaintenanceSummary {
  resumed: string[]
  deletedJobs: number
  deletedRows: number
}

export async function runImportMaintenance(opts: TenantFilter & { awaitRuns?: boolean } = {}): Promise<ImportMaintenanceSummary> {
  const now = opts.now || new Date()
  const summary: ImportMaintenanceSummary = { resumed: [], deletedJobs: 0, deletedRows: 0 }
  const staleBefore = new Date(now.getTime() - HEARTBEAT_STALE_MS)
  const tenantFilter = opts.tenantIds?.length
    ? sql`AND tenant_id IN (${sql.join(opts.tenantIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``

  // 1. interrupted jobs: processing / queued with a stale heartbeat
  const stale = rows<{ id: string; tenant_id: string }>(await db.execute(sql`
    SELECT id, tenant_id FROM import_jobs
    WHERE status IN ('processing', 'queued')
      AND COALESCE(heartbeat_at, started_at, created_at) < ${staleBefore}
      ${tenantFilter}
    ORDER BY created_at
    LIMIT 50
  `))
  const runs: Promise<unknown>[] = []
  for (const job of stale) {
    if (isRunningLocally(job.id)) continue
    try {
      // claim with a fresh heartbeat (another instance running the cron at the same time loses)
      const claimed = await withTenant(job.tenant_id, async (tdb) => rows<{ id: string }>(await tdb.execute(sql`
        UPDATE import_jobs SET status = 'processing', heartbeat_at = now(), error_message = NULL
        WHERE id = ${job.id} AND status IN ('processing', 'queued')
          AND COALESCE(heartbeat_at, started_at, created_at) < ${staleBefore}
        RETURNING id
      `)))
      if (claimed.length === 0) continue
      summary.resumed.push(job.id)
      if (opts.awaitRuns) runs.push(runImportJob({ jobId: job.id, tenantId: job.tenant_id }))
      else startImportJobInBackground(job.id, job.tenant_id)
    } catch (error) {
      logError('cron/import-maintenance', error, { tenantId: job.tenant_id, jobId: job.id })
    }
  }
  if (runs.length) await Promise.allSettled(runs)

  // 2. retention: finished jobs older than 30 days (rows first; FK also cascades)
  const cutoff = new Date(now.getTime() - IMPORT_JOB_RETENTION_DAYS * 86400000)
  const old = rows<{ id: string; tenant_id: string }>(await db.execute(sql`
    SELECT id, tenant_id FROM import_jobs
    WHERE status IN ('done', 'cancelled', 'error')
      AND COALESCE(completed_at, heartbeat_at, created_at) < ${cutoff}
      ${tenantFilter}
    LIMIT 500
  `))
  const byTenant = new Map<string, string[]>()
  for (const o of old) byTenant.set(o.tenant_id, [...(byTenant.get(o.tenant_id) || []), o.id])
  for (const [tenantId, ids] of byTenant) {
    try {
      await withTenant(tenantId, async (tdb) => {
        const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)
        const r = await tdb.execute(sql`DELETE FROM import_job_rows WHERE tenant_id = ${tenantId} AND job_id IN (${idList})`)
        const j = await tdb.execute(sql`DELETE FROM import_jobs WHERE tenant_id = ${tenantId} AND id IN (${idList})`)
        summary.deletedRows += (r as { rowCount?: number }).rowCount || 0
        summary.deletedJobs += (j as { rowCount?: number }).rowCount || 0
      })
    } catch (error) {
      logError('cron/import-maintenance', error, { tenantId, stage: 'cleanup' })
    }
  }
  return summary
}
