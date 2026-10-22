import { NextResponse } from 'next/server'
import { db, withTenant } from '@/lib/db'
import { subscriptions, pricingTiers, users } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'

/**
 * Plan user limit (pricing_tiers.max_users; NULL = unlimited).
 * Counts ACTIVE users of the tenant (owner included) — deactivated staff do not use a seat.
 */
export async function getUserLimit(tenantId: string): Promise<{ maxUsers: number | null; activeUsers: number }> {
  const [row] = await db
    .select({ maxUsers: pricingTiers.maxUsers })
    .from(subscriptions)
    .innerJoin(pricingTiers, eq(pricingTiers.id, subscriptions.tierId))
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1)
  const maxUsers = row?.maxUsers ?? null
  if (maxUsers === null) return { maxUsers: null, activeUsers: 0 }
  const activeUsers = await withTenant(tenantId, async (tdb) => {
    const [c] = await tdb
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
    return Number(c?.n ?? 0)
  })
  return { maxUsers, activeUsers }
}

/** 402 response when adding `adding` more active users would exceed the plan's limit. */
export async function requireUserSeat(tenantId: string, adding = 1): Promise<NextResponse | null> {
  const { maxUsers, activeUsers } = await getUserLimit(tenantId)
  if (maxUsers === null) return null
  if (activeUsers + adding > maxUsers) {
    return NextResponse.json(
      {
        error: `Your plan allows ${maxUsers} active user${maxUsers === 1 ? '' : 's'}. Upgrade your plan or deactivate a user first.`,
        code: 'USER_LIMIT',
        maxUsers,
        activeUsers,
      },
      { status: 402 },
    )
  }
  return null
}
