/**
 * Grandfather pricing helpers.
 * When a subscriber's locked-in price differs from the current tier price,
 * the subscriber is "grandfathered" — they keep their old price.
 */

export function getSubscriptionPrice(
  subscription: { subscribedPriceMonthly?: string | null; subscribedPriceYearly?: string | null },
  tier: { priceMonthly: string | null; priceYearly: string | null },
  billingCycle: 'monthly' | 'yearly'
): number {
  if (billingCycle === 'yearly') {
    return subscription.subscribedPriceYearly
      ? Number(subscription.subscribedPriceYearly)
      : Number(tier.priceYearly)
  }
  return subscription.subscribedPriceMonthly
    ? Number(subscription.subscribedPriceMonthly)
    : Number(tier.priceMonthly)
}

export function isGrandfathered(
  subscription: { subscribedPriceMonthly?: string | null },
  tier: { priceMonthly: string | null }
): boolean {
  if (!subscription.subscribedPriceMonthly) return false
  return Number(subscription.subscribedPriceMonthly) !== Number(tier.priceMonthly)
}
