/**
 * Who is signing in: staff type an email or just a username. A username is the part before the
 * "@" of their login — e.g. "cashier1" for cashier1@alisha-shop.poslanka.local (logins created
 * without an email) or "kamal" for kamal@gmail.com when no one else in the shop is "kamal".
 */
import { and, eq, sql } from 'drizzle-orm'
import { users } from '@/lib/db/schema'
import type { TenantDb } from '@/lib/db'
import { placeholderLogin } from '@/lib/users/generated-login'

type User = typeof users.$inferSelect

export async function findLoginUser(tdb: TenantDb, tenant: { id: string; slug: string }, login: string, opts: { activeOnly?: boolean } = {}): Promise<User | undefined> {
  const value = login.trim().toLowerCase()
  if (!value) return undefined
  const active = opts.activeOnly ? [eq(users.isActive, true)] : []
  if (value.includes('@')) {
    return tdb.query.users.findFirst({ where: and(eq(users.email, value), eq(users.tenantId, tenant.id), ...active) })
  }
  // Username: the shop's own login first, then any login whose name part matches (only if unique)
  const own = await tdb.query.users.findFirst({ where: and(eq(users.email, placeholderLogin(value, tenant.slug)), eq(users.tenantId, tenant.id), ...active) })
  if (own) return own
  const rows = await tdb.select().from(users)
    .where(and(eq(users.tenantId, tenant.id), sql`split_part(lower(${users.email}), '@', 1) = ${value}`, ...active))
    .limit(2)
  return rows.length === 1 ? rows[0] : undefined
}

export { displayLogin } from '@/lib/users/display-login'
