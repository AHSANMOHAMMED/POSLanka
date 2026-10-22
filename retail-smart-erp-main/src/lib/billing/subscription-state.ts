/**
 * Small, shared rules about a vendor's subscription state.
 *
 * Used by the super-admin console (vendor lifecycle actions, bank-slip approval) and the
 * PayHere webhook so every path that moves a subscription period also keeps
 * `tenants.plan_expires_at` in step — sign-in (web + mobile) refuses a tenant whose
 * plan_expires_at is in the past, so a renewal that forgot to move it locked paying vendors out.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { subscriptions, tenants } from '@/lib/db/schema'

/** End date stored for plans that never expire (the free plan). */
export const NEVER_EXPIRES = new Date('2099-12-31T00:00:00Z')

/** Days a lapsed paid subscription keeps working before the billing job locks it (enforce-subscriptions cron). */
export const PAID_GRACE_DAYS = 3

type Tx = Pick<typeof db, 'update' | 'query'>

export function isFreeTier(tier: { priceMonthly: string | null; priceYearly: string | null } | null | undefined): boolean {
  if (!tier) return false
  return Number(tier.priceMonthly ?? 0) === 0 && Number(tier.priceYearly ?? 0) === 0
}

export interface SubscriptionTiming {
  status: string
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
}

/** A subscription that never lapses: the free plan (trial status without an end, or the 2099 sentinel). */
export function neverExpires(sub: SubscriptionTiming): boolean {
  if (sub.status === 'trial' && !sub.trialEndsAt) return true
  return !!sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() >= NEVER_EXPIRES.getTime() - 86_400_000
}

/** The moment sign-in should stop working for this subscription (null = never). */
export function planExpiryFor(sub: SubscriptionTiming): Date | null {
  if (neverExpires(sub)) return null
  if (sub.status === 'trial' && sub.trialEndsAt) return new Date(sub.trialEndsAt)
  if (!sub.currentPeriodEnd) return null
  return new Date(sub.currentPeriodEnd.getTime() + PAID_GRACE_DAYS * 86_400_000)
}

/** Re-derive tenants.plan_expires_at from the tenant's subscription row. */
export async function syncTenantPlanExpiry(tenantId: string, tx: Tx = db): Promise<Date | null> {
  const sub = await tx.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenantId),
    columns: { status: true, trialEndsAt: true, currentPeriodEnd: true },
  })
  const expiry = sub ? planExpiryFor(sub) : null
  await tx.update(tenants).set({ planExpiresAt: expiry }).where(eq(tenants.id, tenantId))
  return expiry
}

/**
 * Status a locked/cancelled subscription should return to when the vendor is reactivated,
 * judged by its dates only (never resurrects an expired period as "active").
 */
export function resumedSubscriptionStatus(sub: Omit<SubscriptionTiming, 'status'>, now = new Date()): 'trial' | 'active' | 'past_due' {
  if (sub.trialEndsAt && sub.trialEndsAt.getTime() > now.getTime()) return 'trial'
  if (!sub.trialEndsAt && neverExpires({ status: 'active', ...sub })) return 'trial'
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime()) return 'active'
  return 'past_due'
}
