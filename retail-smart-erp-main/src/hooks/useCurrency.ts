'use client'

import { useCallback } from 'react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatCurrencyWithSymbol, getCurrencySymbol } from '@/lib/utils/currency'

/**
 * Hook for formatting currency using tenant settings.
 * Uses the currency from CompanyContext.
 *
 * Usage:
 *   const { fCurrency, currency, currencySymbol } = useCurrency()
 *   fCurrency(1500)        // "Rs 1,500.00"
 *   fCurrency(1500, 0)     // "Rs 1,500"
 */
export function useCurrency() {
  const { currency } = useCompany()

  const fCurrency = useCallback(
    (amount: number | string | null | undefined, decimals?: number) => {
      const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0)
      if (isNaN(num)) return `${getCurrencySymbol(currency)} 0.00`

      if (decimals !== undefined) {
        const symbol = getCurrencySymbol(currency)
        const formatted = num.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
        return `${symbol} ${formatted}`
      }

      return formatCurrencyWithSymbol(num, currency)
    },
    [currency]
  )

  return {
    fCurrency,
    currency,
    currencySymbol: getCurrencySymbol(currency),
  }
}
