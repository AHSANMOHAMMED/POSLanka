/**
 * PostgreSQL connection options (keep in sync with scripts/pg-connection.mjs).
 *
 *   DATABASE_SSL      disable | no-verify | verify   (optional)
 *   DATABASE_CA_CERT  PEM of the server CA (DigitalOcean: "Download CA certificate").
 *                     Newlines may be written as \n. When set, the certificate is verified.
 *   DATABASE_POOL_MAX connections per app instance (default 15). Keep
 *                     instances × DATABASE_POOL_MAX below the database's connection limit.
 */
import type { PoolConfig } from 'pg'

const MANAGED_HOST = /ondigitalocean\.com|railway|render\.com|neon\.tech|supabase|amazonaws\.com/i

export function pgConnectionConfig(url = process.env.DATABASE_URL): Pick<PoolConfig, 'connectionString' | 'ssl'> {
  if (!url) throw new Error('DATABASE_URL environment variable is not set')
  const mode = (process.env.DATABASE_SSL || '').toLowerCase()
  const ca = (process.env.DATABASE_CA_CERT || '').replace(/\\n/g, '\n').trim()
  let parsed: URL
  try { parsed = new URL(url) } catch { return { connectionString: url } }
  const sslmode = (parsed.searchParams.get('sslmode') || '').toLowerCase()
  if (mode === 'disable' || sslmode === 'disable') {
    parsed.searchParams.delete('sslmode')
    return { connectionString: parsed.toString(), ssl: false }
  }
  const wantsSsl = mode === 'no-verify' || mode === 'verify' || !!ca
    || ['require', 'verify-ca', 'verify-full', 'prefer'].includes(sslmode) || MANAGED_HOST.test(parsed.hostname)
  if (!wantsSsl) return { connectionString: url }
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslaccept']) parsed.searchParams.delete(k)
  const ssl = ca
    ? { ca, rejectUnauthorized: true }
    : { rejectUnauthorized: mode === 'verify' || sslmode === 'verify-full' || sslmode === 'verify-ca' }
  return { connectionString: parsed.toString(), ssl }
}

export function poolMax(): number {
  const n = parseInt(process.env.DATABASE_POOL_MAX || '', 10)
  return Number.isFinite(n) && n > 0 ? n : 15
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * Server-side safety limits for every pooled connection:
 *
 *   DB_STATEMENT_TIMEOUT_MS            default 15000 (0 = off). Long jobs (backups) raise it
 *                                      per transaction with set_config('statement_timeout', …, true).
 *   DB_IDLE_IN_TRANSACTION_TIMEOUT_MS  default 60000 (0 = off). Kills sessions that hold locks
 *                                      while the app forgot to COMMIT/ROLLBACK.
 *
 * Applied with SET right after each pooled connection opens (not as startup parameters, which
 * PgBouncer — e.g. DigitalOcean connection pools — rejects as "unsupported startup parameter").
 */
export function sessionTimeouts(): { statementTimeoutMs: number; idleInTransactionMs: number } {
  return {
    statementTimeoutMs: envMs('DB_STATEMENT_TIMEOUT_MS', 15000),
    idleInTransactionMs: envMs('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 60000),
  }
}

/** SQL that (re)applies the session limits; empty string when both are disabled. */
export function sessionTimeoutsSql(): string {
  const { statementTimeoutMs, idleInTransactionMs } = sessionTimeouts()
  const parts: string[] = []
  if (statementTimeoutMs > 0) parts.push(`SET statement_timeout = ${Math.floor(statementTimeoutMs)}`)
  if (idleInTransactionMs > 0) parts.push(`SET idle_in_transaction_session_timeout = ${Math.floor(idleInTransactionMs)}`)
  return parts.join('; ')
}
