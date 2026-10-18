'use client'

import { useCallback } from 'react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatTenantDate, formatTenantDateTime } from '@/lib/utils/date-format'

/**
 * Hook for formatting dates/datetimes using tenant settings.
 * Uses the dateFormat and timeFormat from CompanyContext.
 *
 * Usage:
 *   const { fDate, fDateTime } = useDateFormat()
 *   fDate(sale.createdAt)           // "28/01/2026"
 *   fDateTime(sale.createdAt)       // "28/01/2026 2:30 PM"
 */
export function useDateFormat() {
  const { dateFormat, timeFormat } = useCompany()

  const fDate = useCallback(
    (date: string | Date | null | undefined) => formatTenantDate(date, dateFormat),
    [dateFormat]
  )

  const fDateTime = useCallback(
    (date: string | Date | null | undefined) => formatTenantDateTime(date, dateFormat, timeFormat),
    [dateFormat, timeFormat]
  )

  return { fDate, fDateTime, dateFormat, timeFormat }
}
