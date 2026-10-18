'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  formatCurrencyAuto, 
  formatCurrencyWithSymbol,
  getCurrencySymbol,
  createCurrencyFormatter,
  CurrencyContext
} from '@/lib/utils/currency'

interface CurrencyDisplayResult {
  currency: string
  symbol: string
  country: string
  loading: boolean
  convertFromLKR: (amountLKR: number) => number
  formatPrice: (amountLKR: number) => string
  // Enhanced methods
  format: (amount: number | string, options?: { precision?: number; showSymbol?: boolean }) => string
  formatWithSymbol: (amount: number | string) => string
  getFormatter: (context?: Partial<CurrencyContext>) => ReturnType<typeof createCurrencyFormatter>
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  LKR: 'Rs', USD: '$', GBP: '£', EUR: '€', INR: '₹',
  AUD: 'A$', CAD: 'C$', JPY: '¥', CNY: '¥', SGD: 'S$',
  AED: 'د.إ', MYR: 'RM', THB: '฿', PHP: '₱', PKR: '₨',
  BDT: '৳', ZAR: 'R', NGN: '₦', BRL: 'R$', KRW: '₩',
  NZD: 'NZ$', SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'CHF',
  MXN: '$', SAR: '﷼', NPR: 'रू', KES: 'KSh',
}

/**
 * Hook for displaying prices in the visitor's local currency
 * @param mode - 'geoip' for landing page (auto-detect), 'profile' for account pages (user preference)
 * @param tenantCurrency - Optional tenant currency code for tenant-specific contexts
 */
export function useCurrencyDisplay(
  mode: 'geoip' | 'profile' | 'tenant' = 'geoip',
  tenantCurrency?: string
): CurrencyDisplayResult {
  const [currency, setCurrency] = useState('LKR')
  const [symbol, setSymbol] = useState('Rs')
  const [country, setCountry] = useState('LK')
  const [rates, setRates] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function detect() {
      try {
        if (mode === 'geoip') {
          // Detect from IP
          const geoRes = await fetch('/api/geoip')
          if (!cancelled && geoRes.ok) {
            const geo = await geoRes.json()
            setCurrency(geo.currency)
            setSymbol(geo.symbol)
            setCountry(geo.country)
          }
        } else if (mode === 'profile') {
          // Use account preference
          const accRes = await fetch('/api/account')
          if (!cancelled && accRes.ok) {
            const acc = await accRes.json()
            const cur = acc.currency || 'LKR'
            setCurrency(cur)
            setSymbol(CURRENCY_SYMBOLS[cur] || cur)
            setCountry(acc.country || 'LK')
          }
        } else if (mode === 'tenant' && tenantCurrency) {
          // Use tenant currency
          setCurrency(tenantCurrency)
          setSymbol(getCurrencySymbol(tenantCurrency))
          setCountry('LK') // Default for tenant context
        }

        // Fetch exchange rates
        const ratesRes = await fetch('/api/exchange-rates')
        if (!cancelled && ratesRes.ok) {
          const data = await ratesRes.json()
          setRates(data.rates || {})
        }
      } catch (error) {
        console.warn('Currency detection failed, using LKR:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    detect()
    return () => { cancelled = true }
  }, [mode, tenantCurrency])

  const convertFromLKR = useCallback((amountLKR: number): number => {
    if (currency === 'LKR') return amountLKR

    const lkrRate = rates['LKR']
    const targetRate = rates[currency]

    if (!lkrRate || !targetRate) return amountLKR

    // Convert: LKR → USD → target currency
    const amountUsd = amountLKR / lkrRate
    const converted = amountUsd * targetRate

    return Math.round(converted * 100) / 100
  }, [currency, rates])

  const formatPrice = useCallback((amountLKR: number): string => {
    const converted = convertFromLKR(amountLKR)
    return formatCurrencyWithSymbol(converted, currency)
  }, [convertFromLKR, currency])

  // Enhanced formatting methods
  const format = useCallback((amount: number | string, options?: { precision?: number; showSymbol?: boolean }): string => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return '0'
    
    // For LKR amounts, convert if needed
    const convertedAmount = mode === 'geoip' || mode === 'profile' ? convertFromLKR(numAmount) : numAmount
    return formatCurrencyAuto(convertedAmount, currency, options)
  }, [currency, convertFromLKR, mode])

  const formatWithSymbol = useCallback((amount: number | string): string => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return '0'
    
    const convertedAmount = mode === 'geoip' || mode === 'profile' ? convertFromLKR(numAmount) : numAmount
    return formatCurrencyWithSymbol(convertedAmount, currency)
  }, [currency, convertFromLKR, mode])

  const getFormatter = useCallback((context?: Partial<CurrencyContext>) => {
    const finalContext: CurrencyContext = {
      source: mode === 'tenant' ? 'tenant' : mode === 'profile' ? 'account' : 'geoip',
      currencyCode: currency,
      locale: 'en-US', // Default, can be extended
      ...context
    }
    return createCurrencyFormatter(finalContext)
  }, [currency, mode])

  return { 
    currency, 
    symbol, 
    country, 
    loading, 
    convertFromLKR, 
    formatPrice,
    format,
    formatWithSymbol,
    getFormatter
  }
}

/**
 * Hook for tenant-specific currency formatting
 * @param tenantId - Tenant ID to fetch currency from
 * @param fallbackCurrency - Fallback currency if tenant not found (defaults to 'LKR')
 */
export function useTenantCurrency(tenantId?: string, fallbackCurrency: string = 'LKR') {
  const [tenantCurrency, setTenantCurrency] = useState(fallbackCurrency)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenantId) {
      setTenantCurrency(fallbackCurrency)
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchTenantCurrency() {
      try {
        const res = await fetch(`/api/tenants/${tenantId}/currency`)
        if (!cancelled && res.ok) {
          const data = await res.json()
          setTenantCurrency(data.currency || fallbackCurrency)
        } else {
          setTenantCurrency(fallbackCurrency)
        }
      } catch (error) {
        console.warn('Failed to fetch tenant currency:', error)
        setTenantCurrency(fallbackCurrency)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchTenantCurrency()
    return () => { cancelled = true }
  }, [tenantId, fallbackCurrency])

  const format = useCallback((amount: number | string, options?: { precision?: number; showSymbol?: boolean }) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return '0'
    return formatCurrencyAuto(numAmount, tenantCurrency, options)
  }, [tenantCurrency])

  const formatWithSymbol = useCallback((amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return '0'
    return formatCurrencyWithSymbol(numAmount, tenantCurrency)
  }, [tenantCurrency])

  return {
    currency: tenantCurrency,
    symbol: getCurrencySymbol(tenantCurrency),
    loading,
    format,
    formatWithSymbol,
    getFormatter: () => createCurrencyFormatter({
      source: 'tenant',
      currencyCode: tenantCurrency,
      locale: 'en-US'
    })
  }
}

/**
 * Hook for account-specific currency formatting
 * @param accountId - Account ID to fetch currency from
 * @param fallbackCurrency - Fallback currency if account not found (defaults to 'LKR')
 */
export function useAccountCurrency(accountId?: string, fallbackCurrency: string = 'LKR') {
  const [accountCurrency, setAccountCurrency] = useState(fallbackCurrency)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!accountId) {
      setAccountCurrency(fallbackCurrency)
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchAccountCurrency() {
      try {
        const res = await fetch(`/api/accounts/${accountId}/currency`)
        if (!cancelled && res.ok) {
          const data = await res.json()
          setAccountCurrency(data.currency || fallbackCurrency)
        } else {
          setAccountCurrency(fallbackCurrency)
        }
      } catch (error) {
        console.warn('Failed to fetch account currency:', error)
        setAccountCurrency(fallbackCurrency)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchAccountCurrency()
    return () => { cancelled = true }
  }, [accountId, fallbackCurrency])

  const format = useCallback((amount: number | string, options?: { precision?: number; showSymbol?: boolean }) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return '0'
    return formatCurrencyAuto(numAmount, accountCurrency, options)
  }, [accountCurrency])

  const formatWithSymbol = useCallback((amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return '0'
    return formatCurrencyWithSymbol(numAmount, accountCurrency)
  }, [accountCurrency])

  return {
    currency: accountCurrency,
    symbol: getCurrencySymbol(accountCurrency),
    loading,
    format,
    formatWithSymbol,
    getFormatter: () => createCurrencyFormatter({
      source: 'account',
      currencyCode: accountCurrency,
      locale: 'en-US'
    })
  }
}
