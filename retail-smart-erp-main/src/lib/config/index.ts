/**
 * Application configuration
 * Centralizes configurable values that were previously hardcoded
 */

// Polling intervals (in milliseconds)
export const POLLING_INTERVALS = {
  DEFAULT: 10000, // 10 seconds - used for most data refresh
  SLOW: 30000,    // 30 seconds - used for less frequently changing data
  FAST: 5000,     // 5 seconds - used for real-time critical data
} as const

// Default currency (can be extended for tenant-specific currencies later)
export const DEFAULT_CURRENCY = {
  code: 'USD',
  symbol: '$',
  locale: 'en-US',
} as const

/**
 * @deprecated Use `formatCurrency` from `@/lib/utils/currency` instead.
 * Format a number as currency
 */
export function formatCurrencyConfig(amount: number | string, currency = DEFAULT_CURRENCY): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(numAmount)) return `${currency.code} 0.00`

  return `${currency.code} ${numAmount.toLocaleString(currency.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Format a number as currency (short format without code)
 */
export function formatCurrencyShort(amount: number | string, currency = DEFAULT_CURRENCY): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(numAmount)) return '0.00'

  return numAmount.toLocaleString(currency.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Get currency code
 */
export function getCurrencyCode(): string {
  return DEFAULT_CURRENCY.code
}
