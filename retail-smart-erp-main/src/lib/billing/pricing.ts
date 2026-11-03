/**
 * Grandfather pricing helpers.
 * When a subscriber's locked-in price differs from the current tier price,
 * the subscriber is "grandfathered" — they keep their old price.
 */

export function getSubscriptionPrice(
  subscription: {
    subscribedPriceMonthly?: string | null
    subscribedPriceYearly?: string | null
    subscribedPriceLifetime?: string | null
  },
  tier: { priceMonthly: string | null; priceYearly: string | null; priceLifetime?: string | null },
  billingCycle: 'monthly' | 'yearly' | 'lifetime'
): number {
  if (billingCycle === 'lifetime') {
    return subscription.subscribedPriceLifetime != null && subscription.subscribedPriceLifetime !== ''
      ? Number(subscription.subscribedPriceLifetime)
      : Number(tier.priceLifetime ?? 0)
  }
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
