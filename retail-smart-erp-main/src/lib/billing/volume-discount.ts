// Volume discount logic for multi-company billing
// NOTE: For server-side code that can be async, prefer using
// getVolumeDiscountPercentAsync() from '@/lib/billing/settings'
// which reads dynamic tiers from the database.

/**
 * Volume discount tiers (hardcoded fallback):
 * 1 company: 0% discount
 * 2-5 companies: 15% discount
 * 6-10 companies: 25% discount
 * 11+ companies: 30% discount
 */

export interface VolumeDiscountResult {
  companyCount: number
  discountPercent: number
  subtotal: number
  discountAmount: number
  total: number
}

/** Synchronous fallback - uses hardcoded tiers. Prefer async version for server code. */
export function getVolumeDiscountPercent(companyCount: number): number {
  if (companyCount >= 11) return 30
  if (companyCount >= 6) return 25
  if (companyCount >= 2) return 15
  return 0
}

export function calculateVolumeDiscount(
  companies: Array<{ planPrice: number }>
): VolumeDiscountResult {
  const companyCount = companies.length
  const subtotal = companies.reduce((sum, c) => sum + c.planPrice, 0)
  const discountPercent = getVolumeDiscountPercent(companyCount)
  const discountAmount = Math.round(subtotal * (discountPercent / 100) * 100) / 100
  const total = Math.round((subtotal - discountAmount) * 100) / 100

  return {
    companyCount,
    discountPercent,
    subtotal,
    discountAmount,
    total,
  }
}

/**
 * Get descriptive text for the volume discount tier
 */
export function getVolumeDiscountLabel(companyCount: number): string {
  const discount = getVolumeDiscountPercent(companyCount)
  if (discount === 0) return 'No volume discount'
  return `${discount}% volume discount (${companyCount} companies)`
}

/**
 * Get the next discount tier info
 */
export function getNextDiscountTier(companyCount: number): {
  companiesNeeded: number
  nextDiscount: number
} | null {
  if (companyCount >= 11) return null
  if (companyCount >= 6) return { companiesNeeded: 11 - companyCount, nextDiscount: 30 }
  if (companyCount >= 2) return { companiesNeeded: 6 - companyCount, nextDiscount: 25 }
  return { companiesNeeded: 2 - companyCount, nextDiscount: 15 }
}
