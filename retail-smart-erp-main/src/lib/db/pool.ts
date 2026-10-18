import { Pool } from 'pg'

// Single shared database connection pool for the entire application.
// Both db/index.ts (legacy queries) and tenant-context.ts (RLS queries)
// share this pool to prevent exhausting Railway's connection limit.
let pool: Pool | null = null

export function getSharedPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
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
