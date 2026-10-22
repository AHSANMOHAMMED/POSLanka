/**
 * Data retention: deletes old operational logs in small batches (no long locks, no huge WAL
 * bursts). Run daily by /api/cron/retention (.github/workflows/cron.yml).
 *
 * The whole policy lives in RETENTION_POLICY. Business and audit records are deliberately NOT
 * here and are kept indefinitely: GL / journal entries, sales, payments, stock movements,
 * admin_audit_logs, supplier_balance_audit, item_change_log, lockout_events.
 * Each window can be overridden with RETENTION_<TABLE>_DAYS (e.g. RETENTION_ACTIVITY_LOGS_DAYS=730);
 * 0 disables that rule.
 */
import type { PoolClient } from 'pg'
import { getSharedPool } from '@/lib/db/pool'
import { sessionTimeoutsSql } from '@/lib/db/pg-connection'
import { createLogger } from '@/lib/logger'

const log = createLogger('retention')

export interface RetentionRule {
  table: string
  /** timestamp expression compared with the cutoff */
  column: string
  days: number
  description: string
  /** primary key column used for batching (default id) */
  key?: string
}

export const RETENTION_POLICY: readonly RetentionRule[] = [
  { table: 'activity_logs', column: 'created_at', days: 400, description: 'user activity feed (13 months, covers a full year-end review)' },
  { table: 'ai_error_logs', column: 'created_at', days: 90, description: 'application error log' },
  { table: 'notification_logs', column: 'created_at', days: 180, description: 'SMS / e-mail delivery log' },
  { table: 'file_audit_logs', column: 'created_at', days: 365, description: 'file access log' },
  { table: 'rate_limit_attempts', column: 'first_attempt_at', days: 1, description: 'login / lookup rate-limit counters (only rows without an active lock)' },
  { table: 'admin_rate_limits', column: 'window_start', days: 1, description: 'platform admin rate-limit windows' },
  { table: 'admin_impersonation_tokens', column: 'expires_at', days: 30, description: 'expired single-use impersonation links', key: 'jti' },
]

const BATCH_SIZE = 5000
const IDENT = /^[a-z_][a-z0-9_]*$/

function effectiveDays(rule: RetentionRule): number {
  const raw = process.env[`RETENTION_${rule.table.toUpperCase()}_DAYS`]
  if (raw === undefined || raw === '') return rule.days
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : rule.days
}

export interface RetentionResult {
  table: string
  days: number
  deleted: number
  skipped?: string
  error?: string
}

async function deleteBatched(client: PoolClient, rule: RetentionRule, cutoff: Date, deadline: number): Promise<number> {
  const key = rule.key || 'id'
  if (!IDENT.test(rule.table) || !IDENT.test(key)) throw new Error(`invalid table ${rule.table}`)
  const extra = rule.table === 'rate_limit_attempts' ? ' AND (locked_until IS NULL OR locked_until < now())' : ''
  let total = 0
  for (;;) {
    const res = await client.query(
      `DELETE FROM ${rule.table} WHERE ${key} IN (
         SELECT ${key} FROM ${rule.table} WHERE ${rule.column} < $1${extra} LIMIT ${BATCH_SIZE}
       )`,
      // ISO (UTC) like the app writes timestamps; a Date param would be sent in local time
      [cutoff.toISOString()],
    )
    const n = res.rowCount ?? 0
    total += n
    if (n < BATCH_SIZE || Date.now() > deadline) break
  }
  return total
}

/**
 * Apply the retention policy. `now` is injectable for tests; `budgetMs` bounds the run (the
 * rest is picked up by the next day's run).
 */
export async function runRetention(opts: { now?: Date; budgetMs?: number; tables?: string[] } = {}): Promise<{
  results: RetentionResult[]
  usageDeltasFolded: number | null
  durationMs: number
}> {
  const started = Date.now()
  const now = opts.now ?? new Date()
  const deadline = started + (opts.budgetMs ?? 4 * 60 * 1000)
  const results: RetentionResult[] = []
  const client = await getSharedPool().connect()
  try {
    // Maintenance runs as the connection owner, outside any tenant context
    await client.query('RESET ROLE')
    await client.query('RESET app.tenant_id')
    // Bulk deletes legitimately take longer than the request statement_timeout
    await client.query(`SET statement_timeout = '5min'`)
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [RETENTION_POLICY.map((r) => r.table)],
    )
    const existing = new Set(rows.map((r) => r.table_name))
    for (const rule of RETENTION_POLICY) {
      if (opts.tables && !opts.tables.includes(rule.table)) continue
      const days = effectiveDays(rule)
      if (days === 0) { results.push({ table: rule.table, days, deleted: 0, skipped: 'disabled' }); continue }
      if (!existing.has(rule.table)) { results.push({ table: rule.table, days, deleted: 0, skipped: 'table missing' }); continue }
      if (Date.now() > deadline) { results.push({ table: rule.table, days, deleted: 0, skipped: 'time budget' }); continue }
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      try {
        const deleted = await deleteBatched(client, rule, cutoff, deadline)
        results.push({ table: rule.table, days, deleted })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('retention rule failed', { table: rule.table, err })
        results.push({ table: rule.table, days, deleted: 0, error: message })
      }
    }

    // Usage counter deltas are not deleted (that would lose counts): fold them into tenant_usage.
    let usageDeltasFolded: number | null = null
    if (!opts.tables || opts.tables.includes('tenant_usage_deltas')) {
      try {
        const r = await client.query<{ n: number | string | null }>('SELECT fold_tenant_usage() AS n')
        usageDeltasFolded = Number(r.rows[0]?.n ?? 0)
      } catch (err) {
        log.warn('fold_tenant_usage failed', { err })
      }
    }
    return { results, usageDeltasFolded, durationMs: Date.now() - started }
  } finally {
    // Back to the pool's session limits before the connection is reused
    const limits = sessionTimeoutsSql()
    await client.query(limits || 'RESET statement_timeout').catch(() => undefined)
    client.release()
  }
}
