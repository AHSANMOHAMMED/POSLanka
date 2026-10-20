import { PoolClient } from 'pg'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema'
import { getSharedPool } from './pool'

// Use a more flexible type that works with both Pool and PoolClient
export type TenantDb = NodePgDatabase<typeof schema>

// Reuse the shared pool from pool.ts (single pool for the entire app)
function getPool() {
  return getSharedPool()
}

/**
 * Get the application role name for RLS enforcement.
 * When set, withTenant/withTenantTransaction will SET LOCAL ROLE to this role,
 * causing PostgreSQL to enforce RLS policies (superusers bypass RLS by default).
 * If not set, RLS enforcement via role switching is skipped (backward compatible).
 */
function getAppRole(): string | undefined {
  return process.env.DATABASE_APP_ROLE || undefined
}

// Validate role name to prevent SQL injection (only alphanumeric and underscores)
const VALID_ROLE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function validateRoleName(role: string): boolean {
  return VALID_ROLE_PATTERN.test(role) && role.length <= 63
}

/**
 * Execute database operations with tenant context for RLS.
 * Sets app.tenant_id session variable before running the callback.
 *
 * @param tenantId - The tenant UUID for RLS filtering
 * @param callback - Function receiving a tenant-scoped Drizzle instance
 * @returns The result of the callback
 *
 * @example
 * const items = await withTenant(session.user.tenantId, async (db) => {
 *   return db.query.items.findMany() // RLS auto-filters by tenant
 * })
 */
export async function withTenant<T>(
  tenantId: string,
  callback: (db: TenantDb) => Promise<T>
): Promise<T> {
  const client = await getPool().connect()

  try {
    // SET LOCAL is transaction-scoped, so we need a transaction
    await client.query('BEGIN')

    // Set the tenant context - RLS policies use this value
    // Use set_config() instead of SET LOCAL because SET doesn't support parameterized queries
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])

    // Switch to non-superuser role so RLS policies are enforced.
    // Superusers bypass RLS by default - SET LOCAL ROLE makes the session
    // act as the app role for this transaction only.
    const appRole = getAppRole()
    if (appRole) {
      if (!validateRoleName(appRole)) {
        throw new Error(`Invalid DATABASE_APP_ROLE: "${appRole}". Must be alphanumeric/underscores only.`)
      }
      await client.query(`SET LOCAL ROLE ${appRole}`)
    }

    // Create a Drizzle instance bound to this client
    const db = drizzle(client, { schema })

    // Execute the callback
    const result = await callback(db)

    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Execute database operations with tenant context inside an explicit transaction.
 * Use when you need access to the raw client for advanced operations.
 *
 * @param tenantId - The tenant UUID for RLS filtering
 * @param callback - Function receiving tenant-scoped db and raw client
 * @returns The result of the callback
 *
 * @example
 * const result = await withTenantTransaction(tenantId, async (db, client) => {
 *   const [item] = await db.select().from(items).where(eq(items.id, id)).for('update')
 *   // ... more operations
 *   return item
 * })
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  callback: (db: TenantDb, client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect()

  try {
    await client.query('BEGIN')
    // Use set_config() instead of SET LOCAL because SET doesn't support parameterized queries
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])

    // Switch to non-superuser role so RLS policies are enforced.
    // SET LOCAL ROLE is automatically reset at transaction end.
    const appRole = getAppRole()
    if (appRole) {
      if (!validateRoleName(appRole)) {
        throw new Error(`Invalid DATABASE_APP_ROLE: "${appRole}". Must be alphanumeric/underscores only.`)
      }
      await client.query(`SET LOCAL ROLE ${appRole}`)
    }

    const db = drizzle(client, { schema })
    const result = await callback(db, client)

    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Execute database operations WITHOUT tenant context (bypasses RLS).
 *
 * USE ONLY FOR:
 * - Super admin operations (sys-control routes)
 * - Cross-tenant queries
 * - Account mode (no tenant selected)
 * - Authentication flows (tenant lookup)
 * - Background jobs processing multiple tenants
 *
 * @param callback - Function receiving an unrestricted Drizzle instance
 * @returns The result of the callback
 *
 * @example
 * // Super admin listing all tenants
 * const tenants = await withoutTenant(async (db) => {
 *   return db.query.tenants.findMany()
 * })
 */
/**
 * Close all database pools (for graceful shutdown).
 * Pool is now shared - close via pool.ts
 */
export async function closeAllPools(): Promise<void> {
  const { closeSharedPool } = await import('./pool')
  await closeSharedPool()
}

export async function withoutTenant<T>(
  callback: (db: TenantDb) => Promise<T>
): Promise<T> {
  const client = await getPool().connect()

  try {
    await client.query('BEGIN')
    // Reset role to superuser so RLS is bypassed entirely.
    // Pool connections may retain app_user role from leaked SET LOCAL ROLE
    // if a previous transaction didn't clean up properly.
    await client.query('RESET ROLE')
    await client.query(`RESET app.tenant_id`)

    const db = drizzle(client, { schema })
    const result = await callback(db)

    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}


// ==================== Tenant isolation self-check ====================

export type TenantIsolationMode = 'app_role' | 'owner_force_rls' | 'UNSAFE_SUPERUSER_NO_ROLE'

let isolationCache: { mode: TenantIsolationMode; checkedAt: number } | null = null

/**
 * Reports how tenant isolation is enforced for this process.
 * - app_role: DATABASE_APP_ROLE is set → every tenant query runs under that role (RLS enforced).
 * - owner_force_rls: no app role, but the connection user is not a superuser, so
 *   FORCE ROW LEVEL SECURITY policies still apply.
 * - UNSAFE_SUPERUSER_NO_ROLE: superuser connection without DATABASE_APP_ROLE → RLS is bypassed
 *   and tenants are NOT isolated. Fix by setting DATABASE_APP_ROLE=app_user.
 */
export async function checkTenantIsolation(): Promise<TenantIsolationMode> {
  if (isolationCache && Date.now() - isolationCache.checkedAt < 5 * 60 * 1000) return isolationCache.mode
  let mode: TenantIsolationMode = 'owner_force_rls'
  if (getAppRole()) {
    mode = 'app_role'
  } else {
    const pool = getSharedPool()
    const { rows } = await pool.query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')
    if (rows[0]?.rolsuper) mode = 'UNSAFE_SUPERUSER_NO_ROLE'
  }
  isolationCache = { mode, checkedAt: Date.now() }
  if (mode === 'UNSAFE_SUPERUSER_NO_ROLE') {
    console.error('[SECURITY] DATABASE_APP_ROLE is not set and the database user is a superuser: row-level security is BYPASSED and tenants are not isolated. Set DATABASE_APP_ROLE=app_user.')
  }
  return mode
}
