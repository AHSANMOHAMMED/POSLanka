import { calculateProration, cycleLengthDays, getPriceForCycle, type BillingCycle } from '@/lib/billing/proration'
import { getSubscriptionPrice } from '@/lib/billing/pricing'

type Cycle = BillingCycle

export interface PlanChangeSubscription {
  status: string
  billingCycle: string | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  subscribedPriceMonthly?: string | null
  subscribedPriceYearly?: string | null
  subscribedPriceLifetime?: string | null
}

export interface PlanChangeTier {
  id: string
  priceMonthly: string | null
  priceYearly: string | null
  priceLifetime?: string | null
}

export type PlanChangeQuote =
  | {
      ok: true
      /** Trial → paid: full price of the new plan, no proration */
      noProration: boolean
      currentPrice: number
      newPrice: number
      amountDue: number
      proration: ReturnType<typeof calculateProration> | null
    }
  | { ok: false; error: string }

function normalizeCycle(cycle: string | null | undefined): Cycle {
  if (cycle === 'yearly' || cycle === 'lifetime') return cycle
  return 'monthly'
}

/**
 * Server-side amount for changing a subscription to `newTier` / `billingCycle`.
 * Single source of truth for the upgrade preview/execute route AND the PayHere checkout,
 * so a client can never choose what it pays for an upgrade.
 */
export function quotePlanChange(
  subscription: PlanChangeSubscription,
  currentTier: PlanChangeTier,
  newTier: PlanChangeTier,
  billingCycle: Cycle,
  now: Date = new Date(),
): PlanChangeQuote {
  const currentCycle = normalizeCycle(subscription.billingCycle)
  const targetCycle = normalizeCycle(billingCycle)
  const currentPrice = getSubscriptionPrice(subscription, currentTier, currentCycle)
  const newPrice =
    targetCycle === 'lifetime'
      ? getSubscriptionPrice({ subscribedPriceLifetime: null }, newTier, 'lifetime')
      : getPriceForCycle(Number(newTier.priceMonthly), Number(newTier.priceYearly), targetCycle)

  // Lifetime is prepaid once — charge the full new price (no day-based proration).
  if (targetCycle === 'lifetime' || currentCycle === 'lifetime') {
    return { ok: true, noProration: true, currentPrice, newPrice, amountDue: newPrice, proration: null }
  }

  if (subscription.status === 'trial') {
    return { ok: true, noProration: true, currentPrice, newPrice, amountDue: newPrice, proration: null }
  }
  if (!subscription.currentPeriodStart || !subscription.currentPeriodEnd) {
    return { ok: false, error: 'Subscription period not set' }
  }
  const proration = calculateProration({
    currentPlanPrice: currentPrice,
    newPlanPrice: newPrice,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    changeDate: now,
    newPlanCycleDays: currentCycle !== targetCycle ? cycleLengthDays(now, targetCycle) : undefined,
  })
  return { ok: true, noProration: false, currentPrice, newPrice, amountDue: proration.amountDue, proration }
}
