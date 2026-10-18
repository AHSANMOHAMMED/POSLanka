import { authWithCompany, CompanySession } from '@/lib/auth'
import { withTenant, withTenantTransaction, TenantDb } from './tenant-context'
import { PoolClient } from 'pg'

/**
 * Execute tenant-scoped database operations with automatic auth.
 * Combines session validation with RLS tenant context setup.
 *
 * @param callback - Function receiving session and tenant-scoped db
 * @returns The result of the callback, or null if unauthorized/no tenant
 *
 * @example
 * export async function GET() {
 *   const result = await withAuthTenant(async (session, db) => {
 *     // RLS auto-filters by tenant - no manual tenantId filter needed!
 *     return db.query.items.findMany()
 *   })
 *
 *   if (!result) {
 *     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *   }
 *
 *   return NextResponse.json(result)
 * }
 */
export async function withAuthTenant<T>(
  callback: (session: CompanySession, db: TenantDb) => Promise<T>
): Promise<T | null> {
  const session = await authWithCompany()
  if (!session) {
    return null
  }

  return withTenant(session.user.tenantId, (db) => callback(session, db))
}

/**
 * Execute tenant-scoped transaction with automatic auth.
 * Use when you need manual transaction control with RLS + auth.
 *
 * @param callback - Function receiving session, tenant-scoped db, and raw client
 * @returns The result of the callback, or null if unauthorized/no tenant
 *
 * @example
 * const result = await withAuthTenantTransaction(async (session, db, client) => {
 *   const [item] = await db.select()
 *     .from(items)
 *     .where(eq(items.id, id))
 *     .for('update')
 *
 *   // Update with optimistic locking...
 *   return item
 * })
 */
export async function withAuthTenantTransaction<T>(
  callback: (
    session: CompanySession,
    db: TenantDb,
    client: PoolClient
  ) => Promise<T>
): Promise<T | null> {
  const session = await authWithCompany()
  if (!session) {
    return null
  }

  return withTenantTransaction(
    session.user.tenantId,
    (db, client) => callback(session, db, client)
  )
}

/**
 * Type guard to check if a result from withAuthTenant is authorized.
 * Useful when the callback can return falsy values that aren't null.
 *
 * @example
 * const result = await withAuthTenant(async (session, db) => {
 *   return db.query.items.findFirst({ where: eq(items.id, id) })
 * })
 *
 * // result could be null (unauthorized) or undefined (not found)
 * if (result === null) {
 *   return unauthorized()
 * }
 * if (result === undefined) {
 *   return notFound()
 * }
 */
export function isUnauthorized<T>(result: T | null): result is null {
  return result === null
}
