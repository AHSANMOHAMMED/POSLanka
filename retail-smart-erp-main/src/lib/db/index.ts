import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'
import { getSharedPool } from './pool'

// Lazy-load the database connection (uses shared pool)
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getSharedPool(), { schema })
  }
  return dbInstance
}

// For backwards compatibility - bypasses RLS (table owner access)
// WARNING: Use withTenant/withAuthTenant for tenant-scoped queries with RLS
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return getDb()[prop as keyof ReturnType<typeof drizzle<typeof schema>>]
  },
})

// Export all schema for easy access
export * from './schema'

// Close the shared DB pool for graceful shutdown
export async function closeAllPools(): Promise<void> {
  dbInstance = null
  const { closeSharedPool } = await import('./pool')
  await closeSharedPool()
}

// Export RLS tenant context helpers
export { withTenant, withTenantTransaction, withoutTenant, type TenantDb } from './tenant-context'
export { withAuthTenant, withAuthTenantTransaction, isUnauthorized } from './with-auth-tenant'
