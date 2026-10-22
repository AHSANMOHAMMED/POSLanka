/**
 * Promo codes (coupon_codes) applied when a vendor pays for a plan.
 *
 *   quoteCoupon()             validates a code for a purchase and computes the discount (server-side
 *                             price only — the client never says how much a code is worth)
 *   recordCouponRedemption()  counts one use, inside the transaction that confirms the payment
 *                             (PayHere success, wallet charge, bank slip approval). Unique per
 *                             PayHere transaction / bank slip: a retry never counts twice.
 *
 * Rules: active, inside valid_from / valid_until, used_count < max_uses, the paying account has
 * fewer than max_uses_per_account redemptions, the plan bought is in applicable_tiers (when set)
 * and the billing cycle meets min_billing_cycle ('annual' = yearly only).
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { couponCodes, couponRedemptions, pendingCompanies, pricingTiers, subscriptions } from '@/lib/db/schema'
import { getSubscriptionPrice } from '@/lib/billing/pricing'

type Executor = Pick<typeof db, 'select' | 'insert' | 'update'>
export type CouponRow = typeof couponCodes.$inferSelect

export interface CouponPurchase {
  code: string
  accountId: string
  /** pricing tier being bought (applicable_tiers check) */
  tierId: string | null
  billingCycle: 'monthly' | 'yearly'
  /** price before the discount (LKR) */
  amount: number
  now?: Date
}

export type CouponQuote =
  | { ok: true; coupon: CouponRow; code: string; listAmount: number; discount: number; finalAmount: number; label: string }
  | { ok: false; error: string }

const round2 = (n: number) => Math.round(n * 100) / 100

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase()
}

/** Discount a coupon gives on `amount` (never more than the amount). */
export function couponDiscount(coupon: Pick<CouponRow, 'discountType' | 'discountValue'>, amount: number): number {
  const value = Number(coupon.discountValue) || 0
  if (amount <= 0 || value <= 0) return 0
  const raw = coupon.discountType === 'percentage' ? amount * Math.min(value, 100) / 100 : value
  return round2(Math.min(amount, raw))
}

export function couponLabel(coupon: Pick<CouponRow, 'discountType' | 'discountValue'>): string {
  const v = Number(coupon.discountValue)
  return coupon.discountType === 'percentage' ? `${v}% off` : `LKR ${v.toLocaleString('en-LK', { maximumFractionDigits: 2 })} off`
}

/** Validate a code for this purchase and price it. Never throws for a bad code. */
export async function quoteCoupon(input: CouponPurchase, executor: Executor = db): Promise<CouponQuote> {
  const code = normalizeCouponCode(input.code)
  if (!code) return { ok: false, error: 'Enter a promo code' }
  const now = input.now ?? new Date()
  const [coupon] = await executor.select().from(couponCodes).where(eq(couponCodes.code, code)).limit(1)
  if (!coupon) return { ok: false, error: 'This promo code does not exist' }
  if (!coupon.isActive) return { ok: false, error: 'This promo code is no longer active' }
  if (coupon.validFrom && now < new Date(coupon.validFrom)) return { ok: false, error: 'This promo code is not valid yet' }
  if (coupon.validUntil && now > new Date(coupon.validUntil)) return { ok: false, error: 'This promo code has expired' }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return { ok: false, error: 'This promo code has reached its usage limit' }

  const tiers = Array.isArray(coupon.applicableTiers) ? (coupon.applicableTiers as unknown[]).filter((t): t is string => typeof t === 'string') : []
  if (tiers.length > 0 && (!input.tierId || !tiers.includes(input.tierId))) {
    return { ok: false, error: 'This promo code does not apply to this plan' }
  }
  if ((coupon.minBillingCycle === 'annual' || coupon.minBillingCycle === 'yearly') && input.billingCycle !== 'yearly') {
    return { ok: false, error: 'This promo code is for yearly billing only' }
  }

  if (coupon.maxUsesPerAccount > 0) {
    const [used] = await executor.select({ n: sql<number>`count(*)::int` }).from(couponRedemptions)
      .where(and(eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.accountId, input.accountId)))
    if ((used?.n ?? 0) >= coupon.maxUsesPerAccount) {
      return { ok: false, error: coupon.maxUsesPerAccount === 1 ? 'You have already used this promo code' : 'You have used this promo code the maximum number of times' }
    }
  }

  const listAmount = round2(input.amount)
  const discount = couponDiscount(coupon, listAmount)
  if (discount <= 0) return { ok: false, error: 'This promo code gives no discount on this payment' }
  return { ok: true, coupon, code, listAmount, discount, finalAmount: round2(listAmount - discount), label: couponLabel(coupon) }
}

export interface RedemptionInput {
  couponId: string | null
  couponCode: string
  accountId: string
  source: 'payhere' | 'wallet' | 'bank_deposit'
  payhereTransactionId?: string | null
  paymentDepositId?: string | null
  subscriptionId?: string | null
  listAmount: number | string
  discountAmount: number | string
  paidAmount: number | string
}

/**
 * Count one use of a coupon. Call inside the transaction that confirms the payment. Returns
 * false (and changes nothing) when this payment's use was already recorded.
 */
export async function recordCouponRedemption(tx: Executor, r: RedemptionInput): Promise<boolean> {
  const inserted = await tx.insert(couponRedemptions).values({
    couponId: r.couponId,
    couponCode: r.couponCode,
    accountId: r.accountId,
    source: r.source,
    payhereTransactionId: r.payhereTransactionId ?? null,
    paymentDepositId: r.paymentDepositId ?? null,
    subscriptionId: r.subscriptionId ?? null,
    listAmount: Number(r.listAmount).toFixed(2),
    discountAmount: Number(r.discountAmount).toFixed(2),
    paidAmount: Number(r.paidAmount).toFixed(2),
  }).onConflictDoNothing().returning({ id: couponRedemptions.id })
  if (inserted.length === 0) return false
  if (r.couponId) {
    await tx.update(couponCodes)
      .set({ usedCount: sql`${couponCodes.usedCount} + 1`, updatedAt: new Date() })
      .where(eq(couponCodes.id, r.couponId))
  }
  return true
}

/**
 * Price a promo code for a bank-transfer slip: the list price of what the slip pays for (the
 * pending company's plan, or `periodMonths` of the subscription at its locked-in price; whole
 * years at the yearly price) and the discount on it. The slip itself records the amount the
 * customer says they transferred; the reviewer sees both.
 */
export async function quoteCouponForDeposit(input: {
  code: string
  accountId: string
  subscriptionId?: string | null
  pendingCompanyId?: string | null
  periodMonths: number
}): Promise<CouponQuote & { periodMonths?: number }> {
  if (input.pendingCompanyId) {
    const [pending] = await db.select({ accountId: pendingCompanies.accountId, tierId: pendingCompanies.tierId, billingCycle: pendingCompanies.billingCycle })
      .from(pendingCompanies).where(eq(pendingCompanies.id, input.pendingCompanyId)).limit(1)
    if (!pending || pending.accountId !== input.accountId) return { ok: false, error: 'Pending company not found' }
    const [tier] = await db.select().from(pricingTiers).where(eq(pricingTiers.id, pending.tierId)).limit(1)
    if (!tier) return { ok: false, error: 'Pricing tier not found' }
    const cycle = pending.billingCycle === 'yearly' ? 'yearly' : 'monthly'
    const amount = cycle === 'yearly' ? Number(tier.priceYearly) : Number(tier.priceMonthly)
    return quoteCoupon({ code: input.code, accountId: input.accountId, tierId: tier.id, billingCycle: cycle, amount })
  }
  if (input.subscriptionId) {
    const [row] = await db.select({ sub: subscriptions, tier: pricingTiers })
      .from(subscriptions)
      .innerJoin(pricingTiers, eq(pricingTiers.id, subscriptions.tierId))
      .where(eq(subscriptions.id, input.subscriptionId)).limit(1)
    if (!row || row.sub.billingAccountId !== input.accountId) return { ok: false, error: 'Subscription not found' }
    const months = Math.max(1, input.periodMonths)
    const yearly = months % 12 === 0
    const amount = yearly
      ? getSubscriptionPrice(row.sub, row.tier, 'yearly') * (months / 12)
      : getSubscriptionPrice(row.sub, row.tier, 'monthly') * months
    return quoteCoupon({ code: input.code, accountId: input.accountId, tierId: row.tier.id, billingCycle: yearly ? 'yearly' : 'monthly', amount })
  }
  return { ok: false, error: 'Promo codes apply to plan payments only' }
}
