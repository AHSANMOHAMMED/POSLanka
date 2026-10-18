// E-H4/E-H5: Currency utilities for precise money calculations
// Handles decimal precision to avoid floating point errors
// Includes exchange rate conversion with multiple API fallbacks

// ==================== EXCHANGE RATE CONVERSION ====================

interface ExchangeRates {
  base: string
  date: string
  rates: Record<string, number>
  source?: string
}

interface CachedRates {
  rates: ExchangeRates
  timestamp: number
}

// Cache exchange rates for 1 hour
const CACHE_DURATION_MS = 60 * 60 * 1000
let ratesCache: CachedRates | null = null

// Fallback rates for supported currencies (approximate, updated periodically)
// These are used only when ALL APIs fail
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  LKR: 320,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.5,
  AUD: 1.53,
  CAD: 1.36,
  JPY: 150,
  CNY: 7.25,
  SGD: 1.34,
  AED: 3.67,
  MYR: 4.72,
  THB: 35.5,
  PHP: 56.2,
  PKR: 279,
  BDT: 110,
  ZAR: 18.5,
  NGN: 1550,
  BRL: 4.95,
  KRW: 1330,
  NZD: 1.65,
  SEK: 10.5,
  NOK: 10.6,
  DKK: 6.88,
  CHF: 0.88,
  MXN: 17.2,
  SAR: 3.75,
  NPR: 133,
  KES: 155,
}

// Supported currencies for the selector
export const commonCurrencies = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'PKR', name: 'Pakistan Rupee', symbol: '₨' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
]

/**
 * Get currency symbol by code
 */
export function getCurrencySymbol(code: string): string {
  const currency = commonCurrencies.find(c => c.code === code)
  return currency?.symbol || code
}

/**
 * Try fetching from ExchangeRate-API (supports 161+ currencies including LKR)
 * Free tier: 1500 requests/month, no API key needed for open access
 */
async function fetchFromExchangeRateAPI(): Promise<ExchangeRates | null> {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const data = await response.json()
    if (data.result !== 'success') throw new Error('API returned error')

    return {
      base: 'USD',
      date: data.time_last_update_utc?.split(' ')[0] || new Date().toISOString().split('T')[0],
      rates: data.rates,
      source: 'exchangerate-api',
    }
  } catch (error) {
    console.warn('ExchangeRate-API failed:', error)
    return null
  }
}

/**
 * Try fetching from Currency API (free, no key required)
 * Supports many currencies
 */
async function fetchFromCurrencyAPI(): Promise<ExchangeRates | null> {
  try {
    const response = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const data = await response.json()

    // Convert lowercase keys to uppercase and flatten the structure
    const rates: Record<string, number> = { USD: 1 }
    if (data.usd) {
      for (const [key, value] of Object.entries(data.usd)) {
        if (typeof value === 'number') {
          rates[key.toUpperCase()] = value
        }
      }
    }

    return {
      base: 'USD',
      date: data.date || new Date().toISOString().split('T')[0],
      rates,
      source: 'currency-api',
    }
  } catch (error) {
    console.warn('Currency-API failed:', error)
    return null
  }
}

/**
 * Try fetching from Frankfurter API (ECB data, limited currencies)
 */
async function fetchFromFrankfurter(): Promise<ExchangeRates | null> {
  try {
    const response = await fetch('https://api.frankfurter.app/latest?from=USD', {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const data = await response.json()

    return {
      base: 'USD',
      date: data.date,
      rates: { USD: 1, ...data.rates },
      source: 'frankfurter',
    }
  } catch (error) {
    console.warn('Frankfurter API failed:', error)
    return null
  }
}

/**
 * Fetch exchange rates with multiple API fallbacks
 * Priority: ExchangeRate-API -> Currency-API -> Frankfurter -> Fallback rates
 */
export async function fetchExchangeRates(): Promise<ExchangeRates | null> {
  // Check cache first
  if (ratesCache && Date.now() - ratesCache.timestamp < CACHE_DURATION_MS) {
    return ratesCache.rates
  }

  // Try APIs in order of preference (ExchangeRate-API has best currency coverage)
  let rates: ExchangeRates | null = null

  // Try ExchangeRate-API first (best coverage, includes LKR)
  rates = await fetchFromExchangeRateAPI()

  // Fallback to Currency-API (CDN-based, very reliable)
  if (!rates) {
    rates = await fetchFromCurrencyAPI()
  }

  // Fallback to Frankfurter (ECB data, limited currencies)
  if (!rates) {
    rates = await fetchFromFrankfurter()
  }

  // If all APIs fail, use fallback rates with staleness warning
  if (!rates) {
    console.warn(
      '⚠️ All exchange rate APIs failed — using hardcoded fallback rates.',
      'These rates may be stale and should not be relied upon for precise conversions.',
      'Rates will be retried on next cache expiry (1 hour).'
    )
    rates = {
      base: 'USD',
      date: 'fallback', // Marked as fallback, not a real date
      rates: { ...FALLBACK_RATES },
      source: 'fallback',
    }
  }

  // Cache the rates
  ratesCache = {
    rates,
    timestamp: Date.now(),
  }

  return rates
}

/**
 * Convert amount from one currency to another
 */
export async function convertCurrencyAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<number | null> {
  if (fromCurrency === toCurrency) {
    return amount
  }

  const rates = await fetchExchangeRates()
  if (!rates) {
    return null
  }

  const fromRate = rates.rates[fromCurrency]
  const toRate = rates.rates[toCurrency]

  if (!fromRate || !toRate) {
    console.error(`Currency not supported: ${!fromRate ? fromCurrency : toCurrency}`)
    return null
  }

  // Convert: amount in fromCurrency -> USD -> toCurrency
  const amountInUsd = amount / fromRate
  const convertedAmount = amountInUsd * toRate

  return Math.round(convertedAmount * 100) / 100
}

/**
 * Exchange rate result with source information
 */
export interface ExchangeRateResult {
  rate: number
  source: 'live' | 'fallback'
  date?: string
}

/**
 * Get exchange rate between two currencies
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string
): Promise<number | null> {
  if (fromCurrency === toCurrency) {
    return 1
  }

  const rates = await fetchExchangeRates()
  if (!rates) {
    return null
  }

  const fromRate = rates.rates[fromCurrency]
  const toRate = rates.rates[toCurrency]

  if (!fromRate || !toRate) {
    return null
  }

  return toRate / fromRate
}

/**
 * Get exchange rate with source information
 * Returns both the rate and whether it came from live API or fallback
 */
export async function getExchangeRateWithSource(
  fromCurrency: string,
  toCurrency: string
): Promise<ExchangeRateResult | null> {
  if (fromCurrency === toCurrency) {
    return { rate: 1, source: 'live' }
  }

  const rates = await fetchExchangeRates()
  if (!rates) {
    return null
  }

  const fromRate = rates.rates[fromCurrency]
  const toRate = rates.rates[toCurrency]

  if (!fromRate || !toRate) {
    // Try to use fallback for the missing currency
    const fallbackFrom = FALLBACK_RATES[fromCurrency]
    const fallbackTo = FALLBACK_RATES[toCurrency]

    if (fallbackFrom && fallbackTo) {
      return {
        rate: fallbackTo / fallbackFrom,
        source: 'fallback',
      }
    }
    return null
  }

  return {
    rate: toRate / fromRate,
    source: rates.source === 'fallback' ? 'fallback' : 'live',
    date: rates.date,
  }
}

/**
 * Format currency amount with symbol
 */
export function formatCurrencyWithSymbol(amount: number, currencyCode: string): string {
  const symbol = getCurrencySymbol(currencyCode)
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  // For LKR, put "Rs" before the number (e.g., "Rs 1,234.56")
  // For USD, put "$" before the number (e.g., "$1,234.56")
  return `${symbol} ${formatted}`
}

/**
 * Format currency amount with automatic symbol placement based on locale
 * Uses proper locale formatting rules (symbol before/after amount, spacing)
 */
export function formatCurrencyLocale(amount: number, currencyCode: string, locale?: string): string {
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }
  
  try {
    return new Intl.NumberFormat(locale || 'en-US', options).format(amount)
  } catch {
    // Fallback to simple formatting if locale fails
    return formatCurrencyWithSymbol(amount, currencyCode)
  }
}

/**
 * Get currency display configuration based on currency code
 * Returns symbol placement and formatting rules
 */
export function getCurrencyConfig(currencyCode: string): {
  symbol: string
  symbolPlacement: 'before' | 'after'
  spacing: boolean
  decimalDigits: number
  thousandsSeparator: string
  decimalSeparator: string
} {
  const symbol = getCurrencySymbol(currencyCode)
  
  // Default configuration (Western style: symbol before, space, 2 decimals)
  const defaultConfig = {
    symbol,
    symbolPlacement: 'before' as const,
    spacing: true,
    decimalDigits: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
  }
  
  // Special handling for specific currencies
  switch (currencyCode) {
    case 'JPY':
    case 'KRW':
      return { ...defaultConfig, decimalDigits: 0 }
    case 'EUR':
      // Euro often placed after amount in some European countries
      return { ...defaultConfig, symbolPlacement: 'after', spacing: true }
    case 'LKR':
      return { ...defaultConfig, symbol: 'Rs' }
    default:
      return defaultConfig
  }
}

/**
 * Format amount with currency code, automatically determining formatting rules
 * This is the recommended function for general use
 */
export function formatCurrencyAuto(
  amount: number | string,
  currencyCode: string,
  options?: {
    locale?: string
    precision?: number
    showSymbol?: boolean
  }
): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(numAmount)) return '0'
  
  const {
    locale,
    precision = 2,
    showSymbol = true
  } = options || {}
  
  if (showSymbol) {
    return formatCurrencyLocale(numAmount, currencyCode, locale)
  } else {
    return numAmount.toLocaleString(locale || 'en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    })
  }
}

// ==================== CONTEXT-AWARE CURRENCY HELPERS ====================

/**
 * Context interface for currency resolution
 */
export interface CurrencyContext {
  source: 'tenant' | 'account' | 'geoip' | 'default'
  currencyCode: string
  locale?: string
}

/**
 * Create a currency formatter with cached configuration
 */
export function createCurrencyFormatter(context: CurrencyContext) {
  const { currencyCode, locale } = context
  
  return {
    format: (amount: number | string, options?: { precision?: number; showSymbol?: boolean }) => 
      formatCurrencyAuto(amount, currencyCode, { locale, ...options }),
    
    formatWithSymbol: (amount: number | string) => 
      formatCurrencyWithSymbol(typeof amount === 'string' ? parseFloat(amount) : amount, currencyCode),
    
    getSymbol: () => getCurrencySymbol(currencyCode),
    
    getConfig: () => getCurrencyConfig(currencyCode),
    
    context,
  }
}

// ==================== PRECISION UTILITIES ====================

/**
 * Round a number to specified decimal places for currency
 * Uses Math.round with multiplication to avoid floating point errors
 * @param value - The value to round
 * @param precision - Number of decimal places (default: 2)
 */
export function roundCurrency(value: number, precision: number = 2): number {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

/**
 * Parse a string or number to a currency value with proper rounding
 */
export function parseCurrency(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const num = typeof value === 'string' ? parseFloat(value) : value
  return isNaN(num) ? 0 : roundCurrency(num)
}

/**
 * Format a number as currency string with 2 decimal places and thousand separators.
 * When currencyCode is provided, includes the currency symbol prefix.
 */
export function formatCurrency(value: number | string | null | undefined, currencyCode?: string): string {
  const num = parseCurrency(value)
  const formatted = num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (currencyCode) {
    return `${getCurrencySymbol(currencyCode)} ${formatted}`
  }
  return formatted
}

/**
 * Add two currency values with proper precision
 */
export function addCurrency(a: number | string, b: number | string): number {
  return roundCurrency(parseCurrency(a) + parseCurrency(b))
}

/**
 * Subtract two currency values with proper precision
 */
export function subtractCurrency(a: number | string, b: number | string): number {
  return roundCurrency(parseCurrency(a) - parseCurrency(b))
}

/**
 * Multiply currency by quantity with proper precision
 */
export function multiplyCurrency(price: number | string, quantity: number | string): number {
  return roundCurrency(parseCurrency(price) * parseCurrency(quantity))
}

/**
 * Calculate total from items with hours/rate or quantity/price
 */
export function calculateItemTotal(
  items: Array<{
    hours?: string | number | null
    rate?: string | number | null
    quantity?: string | number | null
    unitPrice?: string | number | null
  }>
): number {
  let total = 0
  for (const item of items) {
    if (item.hours !== undefined && item.rate !== undefined) {
      total = addCurrency(total, multiplyCurrency(item.hours || 0, item.rate || 0))
    } else if (item.quantity !== undefined && item.unitPrice !== undefined) {
      total = addCurrency(total, multiplyCurrency(item.quantity || 0, item.unitPrice || 0))
    }
  }
  return total
}

// ==================== COMPARISON UTILITIES (CALC-2, RC-1) ====================

/**
 * Compare two currency values with proper precision handling
 * Returns -1 if a < b, 0 if equal, 1 if a > b
 * Handles string/number inputs and floating point precision
 */
export function compareCurrency(a: number | string, b: number | string): number {
  const aRounded = parseCurrency(a)
  const bRounded = parseCurrency(b)
  if (aRounded < bRounded) return -1
  if (aRounded > bRounded) return 1
  return 0
}

/**
 * Check if two currency values are equal (within 2 decimal places)
 */
export function currencyEquals(a: number | string, b: number | string): boolean {
  return compareCurrency(a, b) === 0
}

/**
 * Check if currency a is greater than or equal to b
 */
export function currencyGte(a: number | string, b: number | string): boolean {
  return compareCurrency(a, b) >= 0
}

/**
 * Check if currency a is less than or equal to b
 */
export function currencyLte(a: number | string, b: number | string): boolean {
  return compareCurrency(a, b) <= 0
}

/**
 * Convert a number to a decimal string with specified scale
 * Used for database storage to avoid precision loss
 */
export function toDecimalString(value: number, scale: number = 2): string {
  return roundCurrency(value).toFixed(scale)
}
