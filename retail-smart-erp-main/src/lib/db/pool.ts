import { Pool, type PoolClient } from 'pg'
import { pgConnectionConfig, poolMax, sessionTimeoutsSql } from './pg-connection'
import { createLogger } from '@/lib/logger'
import { recordDbQuery } from '@/lib/observability/metrics'

// Single shared database connection pool for the entire process.
// Both db/index.ts (legacy queries) and tenant-context.ts (RLS queries) share this pool to
// prevent exhausting the database's connection limit (DATABASE_POOL_MAX). It lives on
// globalThis because server.js (esbuild bundle) and the Next.js route bundles load separate
// copies of this module in the same process; without that each copy opened its own pool.
declare global {
  var __poslankaPgPool: Pool | undefined
}

const log = createLogger('db')

function slowQueryMs(): number {
  const n = parseInt(process.env.SLOW_QUERY_MS || '', 10)
  return Number.isFinite(n) && n > 0 ? n : 500
}

function queryText(args: unknown[]): string {
  const first = args[0] as string | { text?: string } | undefined
  const text = typeof first === 'string' ? first : first?.text || ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * Time every promise-style query on a pooled client: count it for /api/metrics and log
 * statements slower than SLOW_QUERY_MS (default 500 ms). Parameters are never logged.
 * Callback / Submittable (cursor, stream) calls are passed through untouched.
 */
function instrumentClient(client: PoolClient): void {
  const marked = client as PoolClient & { __poslankaTimed?: boolean }
  if (marked.__poslankaTimed) return
  marked.__poslankaTimed = true
  const original = client.query.bind(client) as (...args: unknown[]) => unknown
  ;(client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const started = performance.now()
    const result = original(...args)
    if (result && typeof (result as Promise<unknown>).then === 'function' && typeof args[args.length - 1] !== 'function') {
      const done = (failed: boolean) => {
        const ms = performance.now() - started
        const slow = ms >= slowQueryMs()
        recordDbQuery(ms, failed, slow)
        if (slow) log.warn('slow query', { durationMs: Math.round(ms), sql: queryText(args), failed })
      }
      ;(result as Promise<unknown>).then(() => done(false), () => done(true))
    }
    return result
  }
}

export function getSharedPool(): Pool {
  if (!globalThis.__poslankaPgPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    const pool = new Pool({
      ...pgConnectionConfig(process.env.DATABASE_URL),
      max: poolMax(),
      min: 0,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    })
    pool.on('error', (err) => {
      log.warn('idle client error', { err: err.message })
    })
    const limits = sessionTimeoutsSql()
    pool.on('connect', (client) => {
      instrumentClient(client)
      // statement_timeout / idle_in_transaction_session_timeout for this session. Queued before
      // any query of the borrower (pg runs a client's queries in order).
      if (limits) client.query(limits).catch((err: Error) => log.warn('could not apply session timeouts', { err: err.message }))
    })
    // pool.query() checks a client out internally, so it is covered by the 'connect' hook.
    globalThis.__poslankaPgPool = pool
  }
  return globalThis.__poslankaPgPool
}

/** Pool if it was already created (for metrics/health without opening one). */
export function peekSharedPool(): Pool | null {
  return globalThis.__poslankaPgPool ?? null
}

export async function closeSharedPool(): Promise<void> {
  const pool = globalThis.__poslankaPgPool
  if (pool) {
    globalThis.__poslankaPgPool = undefined
    await pool.end()
  }
}
