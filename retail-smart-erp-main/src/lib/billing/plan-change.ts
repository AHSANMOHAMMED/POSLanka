import { calculateProration, cycleLengthDays, getPriceForCycle } from '@/lib/billing/proration'
import { getSubscriptionPrice } from '@/lib/billing/pricing'

type Cycle = 'monthly' | 'yearly'

export interface PlanChangeSubscription {
  status: string
  billingCycle: string | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  subscribedPriceMonthly?: string | null
  subscribedPriceYearly?: string | null
}

export interface PlanChangeTier {
  id: string
  priceMonthly: string | null
  priceYearly: string | null
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
  const currentCycle = (subscription.billingCycle || 'monthly') as Cycle
  const currentPrice = getSubscriptionPrice(subscription, currentTier, currentCycle)
  const newPrice = getPriceForCycle(Number(newTier.priceMonthly), Number(newTier.priceYearly), billingCycle)

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
    newPlanCycleDays: currentCycle !== billingCycle ? cycleLengthDays(now, billingCycle) : undefined,
  })
  return { ok: true, noProration: false, currentPrice, newPrice, amountDue: proration.amountDue, proration }
}
