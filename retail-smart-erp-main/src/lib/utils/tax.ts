/**
 * @deprecated Legacy flat-rate tax calculation utility.
 * New code should use `recalculateDocumentTax()` from `@/lib/utils/tax-recalculate`
 * which uses the template-based tax system (ERPNext-style).
 *
 * This module is only kept for the sales POST route's backward-compatibility fallback
 * when old POS clients don't send template data. Do not add new callers.
 */

import { roundCurrency } from './currency'

export interface TaxCalculationOptions {
  /** Tax rate as a decimal (e.g., 0.15 for 15%) */
  taxRate: number
  /** Whether tax is included in the base amount */
  taxInclusive: boolean
  /** Whether the transaction is tax exempt */
  taxExempt?: boolean
  /** Whether to round the tax amount (default: true) */
  roundTax?: boolean
  /** Precision for rounding (default: 2 decimal places) */
  precision?: number
}

export interface TaxCalculationResult {
  /** Original amount before tax */
  baseAmount: number
  /** Tax amount */
  taxAmount: number
  /** Total amount after tax */
  totalAmount: number
  /** Tax rate used (as decimal) */
  taxRate: number
  /** Whether tax was included in base amount */
  taxInclusive: boolean
  /** Whether transaction was tax exempt */
  taxExempt: boolean
}

/**
 * @deprecated Use `recalculateDocumentTax()` from `@/lib/utils/tax-recalculate` instead.
 * Calculate tax for a given amount
 *
 * @param amount - The amount to calculate tax for
 * @param options - Tax calculation options
 * @returns Tax calculation result
 */
export function calculateTax(
  amount: number,
  options: TaxCalculationOptions
): TaxCalculationResult {
  const {
    taxRate,
    taxInclusive,
    taxExempt = false,
    roundTax = true,
    precision = 2
  } = options

  // Handle tax exempt
  if (taxExempt || taxRate <= 0) {
    return {
      baseAmount: amount,
      taxAmount: 0,
      totalAmount: amount,
      taxRate,
      taxInclusive,
      taxExempt
    }
  }

  let taxAmount: number
  let baseAmount: number
  let totalAmount: number

  if (taxInclusive) {
    // Tax is already included in the amount
    // Extract tax: amount = base + (base * taxRate) => base = amount / (1 + taxRate)
    baseAmount = amount / (1 + taxRate)
    taxAmount = amount - baseAmount
    totalAmount = amount
  } else {
    // Tax is added to the amount
    baseAmount = amount
    taxAmount = amount * taxRate
    totalAmount = amount + taxAmount
  }

  // Round tax amount if requested
  if (roundTax) {
    taxAmount = roundTaxAmount(taxAmount, precision)
    
    // Recalculate total to ensure consistency
    if (taxInclusive) {
      baseAmount = roundCurrency(amount - taxAmount, precision)
    } else {
      totalAmount = roundCurrency(baseAmount + taxAmount, precision)
    }
  }

  return {
    baseAmount: roundCurrency(baseAmount, precision),
    taxAmount,
    totalAmount: roundCurrency(totalAmount, precision),
    taxRate,
    taxInclusive,
    taxExempt
  }
}

/**
 * Round tax amount to specified precision
 * Uses same rounding logic as roundCurrency but allows custom precision
 */
function roundTaxAmount(amount: number, precision: number = 2): number {
  const factor = Math.pow(10, precision)
  return Math.round(amount * factor) / factor
}

/**
 * @deprecated Use `recalculateDocumentTax()` from `@/lib/utils/tax-recalculate` instead.
 * Calculate tax from a percentage rate (converts percentage to decimal)
 *
 * @param amount - The amount to calculate tax for
 * @param taxRatePercent - Tax rate as percentage (e.g., 15 for 15%)
 * @param taxInclusive - Whether tax is included in the base amount
 * @param taxExempt - Whether transaction is tax exempt
 * @returns Tax calculation result
 */
export function calculateTaxFromPercent(
  amount: number,
  taxRatePercent: number,
  taxInclusive: boolean,
  taxExempt: boolean = false
): TaxCalculationResult {
  const taxRateDecimal = taxRatePercent / 100
  return calculateTax(amount, {
    taxRate: taxRateDecimal,
    taxInclusive,
    taxExempt
  })
}

/**
 * Extract tax amount from a tax-inclusive total
 * 
 * @param totalAmount - Total amount including tax
 * @param taxRate - Tax rate as decimal
 * @returns Object with base amount and tax amount
 */
export function extractTaxFromInclusive(
  totalAmount: number,
  taxRate: number,
  precision: number = 2
): { baseAmount: number; taxAmount: number } {
  if (taxRate <= 0) {
    return {
      baseAmount: roundCurrency(totalAmount, precision),
      taxAmount: 0
    }
  }

  const baseAmount = totalAmount / (1 + taxRate)
  const taxAmount = totalAmount - baseAmount

  return {
    baseAmount: roundCurrency(baseAmount, precision),
    taxAmount: roundTaxAmount(taxAmount, precision)
  }
}

/**
 * Add tax to a tax-exclusive amount
 * 
 * @param baseAmount - Amount before tax
 * @param taxRate - Tax rate as decimal
 * @returns Object with tax amount and total amount
 */
export function addTaxToExclusive(
  baseAmount: number,
  taxRate: number,
  precision: number = 2
): { taxAmount: number; totalAmount: number } {
  if (taxRate <= 0) {
    return {
      taxAmount: 0,
      totalAmount: roundCurrency(baseAmount, precision)
    }
  }

  const taxAmount = baseAmount * taxRate
  const totalAmount = baseAmount + taxAmount

  return {
    taxAmount: roundTaxAmount(taxAmount, precision),
    totalAmount: roundCurrency(totalAmount, precision)
  }
}

/**
 * Calculate tax for multiple items with different tax rates
 * Useful for orders with mixed tax items
 */
export function calculateTaxForItems<T extends { amount: number; taxRate?: number; taxInclusive?: boolean }>(
  items: T[],
  defaultTaxRate: number,
  defaultTaxInclusive: boolean,
  taxExempt: boolean = false
): {
  items: Array<T & { taxAmount: number; totalAmount: number }>,
  subtotal: number,
  taxTotal: number,
  grandTotal: number
} {
  if (taxExempt || defaultTaxRate <= 0) {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0)
    return {
      items: items.map(item => ({
        ...item,
        taxAmount: 0,
        totalAmount: item.amount
      })),
      subtotal: roundCurrency(subtotal),
      taxTotal: 0,
      grandTotal: roundCurrency(subtotal)
    }
  }

  let subtotal = 0
  let taxTotal = 0
  let grandTotal = 0

  const processedItems = items.map(item => {
    const itemTaxRate = item.taxRate !== undefined ? item.taxRate : defaultTaxRate
    const itemTaxInclusive = item.taxInclusive !== undefined ? item.taxInclusive : defaultTaxInclusive
    
    const result = calculateTax(item.amount, {
      taxRate: itemTaxRate,
      taxInclusive: itemTaxInclusive,
      taxExempt: false
    })

    subtotal += result.baseAmount
    taxTotal += result.taxAmount
    grandTotal += result.totalAmount

    return {
      ...item,
      taxAmount: result.taxAmount,
      totalAmount: result.totalAmount
    }
  })

  return {
    items: processedItems,
    subtotal: roundCurrency(subtotal),
    taxTotal: roundCurrency(taxTotal),
    grandTotal: roundCurrency(grandTotal)
  }
}

/**
 * Validate tax configuration
 * Returns error message if invalid, null if valid
 */
export function validateTaxConfig(
  taxRate: number | string,
  _taxInclusive: boolean
): string | null {
  const rate = typeof taxRate === 'string' ? parseFloat(taxRate) : taxRate
  
  if (isNaN(rate)) {
    return 'Tax rate must be a valid number'
  }
  
  if (rate < 0) {
    return 'Tax rate cannot be negative'
  }
  
  if (rate > 100 && typeof taxRate === 'string' && parseFloat(taxRate) > 100) {
    // Assuming percentage format - warn about unusually high rates
    return 'Tax rate appears unusually high. Please verify.'
  }
  
  return null
}

/**
 * Format tax rate for display
 * 
 * @param taxRate - Tax rate as decimal or percentage
 * @param asPercentage - Whether to format as percentage (default: true)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted tax rate string
 */
export function formatTaxRate(
  taxRate: number,
  asPercentage: boolean = true,
  decimals: number = 2
): string {
  if (asPercentage) {
    // Convert decimal to percentage (e.g., 0.15 -> 15%)
    return `${(taxRate * 100).toFixed(decimals)}%`
  }
  
  return taxRate.toFixed(decimals)
}

/**
 * @deprecated Tax settings now come from tax templates, not tenant fields.
 * Use `recalculateDocumentTax()` from `@/lib/utils/tax-recalculate` instead.
 * Helper to get tax calculation options from tenant settings
 */
export function getTaxOptionsFromTenant(
  tenant: { taxRate?: string | number | null; taxInclusive?: boolean | null },
  taxExempt: boolean = false
): TaxCalculationOptions {
  const taxRate = tenant.taxRate 
    ? (typeof tenant.taxRate === 'string' ? parseFloat(tenant.taxRate) : tenant.taxRate) / 100
    : 0
  
  const taxInclusive = tenant.taxInclusive || false
  
  return {
    taxRate,
    taxInclusive,
    taxExempt
  }
}