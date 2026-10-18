/**
 * Tax template calculation utility
 * Handles per-item tax calculation using multi-component tax templates
 * Supports mixed inclusive/exclusive tax components within a single template
 */

import { roundCurrency } from './currency'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolvedTaxTemplate {
  id: string
  name: string
  items: ResolvedTaxTemplateItem[]
}

export interface ResolvedTaxTemplateItem {
  taxName: string
  rate: number       // percentage (e.g. 15 for 15%)
  accountId: string | null
  includedInPrice: boolean
}

export interface TaxBreakdownItem {
  taxName: string
  rate: number       // percentage
  amount: number     // calculated tax amount
  accountId: string | null
  includedInPrice: boolean
}

export interface ItemTaxResult {
  /** Amount before any exclusive tax is added (inclusive tax extracted) */
  baseAmount: number
  /** Sum of all tax components */
  totalTax: number
  /** baseAmount + exclusive taxes (equals original amount when all components are inclusive) */
  totalAmount: number
  /** Per-component breakdown */
  breakdown: TaxBreakdownItem[]
  /** Combined effective tax rate as percentage */
  effectiveRate: number
}

// ─── Main Calculation ────────────────────────────────────────────────────────

/**
 * Calculate tax for an item amount using a tax template.
 *
 * Handles mixed inclusive/exclusive components:
 * 1. Separate template items into inclusive vs exclusive groups
 * 2. Inclusive: combinedRate = sum of inclusive rates.
 *    Base = amount / (1 + combinedRate/100). Distribute extracted tax proportionally.
 * 3. Exclusive: each component = baseAmount * rate/100
 * 4. totalAmount = amount + sum of exclusive taxes
 *
 * @param amount - Line total (could include inclusive taxes already)
 * @param template - Resolved tax template (or null for zero tax)
 * @param taxExempt - If true, returns zero tax
 */
export function calculateItemTax(
  amount: number,
  template: ResolvedTaxTemplate | null,
  taxExempt: boolean = false,
): ItemTaxResult {
  // No template or tax exempt → zero tax
  if (!template || taxExempt || template.items.length === 0 || amount === 0) {
    return {
      baseAmount: roundCurrency(amount),
      totalTax: 0,
      totalAmount: roundCurrency(amount),
      breakdown: [],
      effectiveRate: 0,
    }
  }

  const inclusiveItems = template.items.filter(i => i.includedInPrice)
  const exclusiveItems = template.items.filter(i => !i.includedInPrice)

  const breakdown: TaxBreakdownItem[] = []
  let totalTax = 0

  // Step 1: Extract inclusive taxes
  const inclusiveRateSum = inclusiveItems.reduce((sum, i) => sum + i.rate, 0)
  let baseAmount: number

  if (inclusiveRateSum > 0) {
    baseAmount = amount / (1 + inclusiveRateSum / 100)
    const totalInclusiveTax = amount - baseAmount

    // Distribute proportionally across inclusive components
    for (const item of inclusiveItems) {
      const proportion = item.rate / inclusiveRateSum
      const taxAmount = roundCurrency(totalInclusiveTax * proportion)
      breakdown.push({
        taxName: item.taxName,
        rate: item.rate,
        amount: taxAmount,
        accountId: item.accountId,
        includedInPrice: true,
      })
      totalTax += taxAmount
    }
  } else {
    baseAmount = amount
  }

  // Step 2: Calculate exclusive taxes on the base amount
  for (const item of exclusiveItems) {
    const taxAmount = roundCurrency(baseAmount * item.rate / 100)
    breakdown.push({
      taxName: item.taxName,
      rate: item.rate,
      amount: taxAmount,
      accountId: item.accountId,
      includedInPrice: false,
    })
    totalTax += taxAmount
  }

  totalTax = roundCurrency(totalTax)
  const exclusiveTaxSum = breakdown
    .filter(b => !b.includedInPrice)
    .reduce((sum, b) => sum + b.amount, 0)

  const totalAmount = roundCurrency(amount + exclusiveTaxSum)
  baseAmount = roundCurrency(baseAmount)

  // Effective rate = totalTax / baseAmount * 100
  const effectiveRate = baseAmount > 0 ? roundCurrency(totalTax / baseAmount * 100) : 0

  return {
    baseAmount,
    totalTax,
    totalAmount,
    breakdown,
    effectiveRate,
  }
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Aggregate multiple per-item tax breakdowns into a single summary.
 * Groups by accountId and sums amounts. Useful for GL posting and sale-level storage.
 */
export function aggregateTaxBreakdown(
  breakdowns: TaxBreakdownItem[][],
): TaxBreakdownItem[] {
  const map = new Map<string, TaxBreakdownItem>()

  for (const bd of breakdowns) {
    for (const item of bd) {
      const key = item.accountId || '__no_account__'
      const existing = map.get(key)
      if (existing) {
        existing.amount = roundCurrency(existing.amount + item.amount)
      } else {
        map.set(key, { ...item })
      }
    }
  }

  return Array.from(map.values())
}
