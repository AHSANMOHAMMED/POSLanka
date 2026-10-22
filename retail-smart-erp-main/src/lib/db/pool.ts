import { Pool } from 'pg'
import { pgConnectionConfig, poolMax } from './pg-connection'

// Single shared database connection pool for the entire application.
// Both db/index.ts (legacy queries) and tenant-context.ts (RLS queries)
// share this pool to prevent exhausting the database's connection limit (DATABASE_POOL_MAX).
let pool: Pool | null = null

export function getSharedPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    pool = new Pool({
      ...pgConnectionConfig(process.env.DATABASE_URL),
      max: poolMax(),
      min: 1,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      query_timeout: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    })
    pool.on('error', (err) => {
      console.warn('[Postgres Pool] Idle client error:', err.message)
    })
  }
  return pool

}

export async function closeSharedPool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
