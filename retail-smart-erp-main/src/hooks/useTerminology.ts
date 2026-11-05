'use client'

import { useBusinessScope } from '@/hooks/useBusinessScope'
import { getTerms, type TerminologyMap } from '@/lib/terminology'

/**
 * React hook that returns business-type-specific terminology.
 * Uses the current company context to determine the business type (a mall uses its primary type).
 * Falls back to retail terminology if no company context is available.
 */
export function useTerminology(): TerminologyMap {
  const { primary } = useBusinessScope()
  return getTerms(primary || undefined)
}
