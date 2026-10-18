'use client'

import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import { getTerms, type TerminologyMap } from '@/lib/terminology'

/**
 * React hook that returns business-type-specific terminology.
 * Uses the current company context to determine the business type.
 * Falls back to retail terminology if no company context is available.
 */
export function useTerminology(): TerminologyMap {
  const company = useCompanyOptional()
  return getTerms(company?.businessType)
}
