'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface StepSuggestionOptions {
  /** Step identifier sent to the API */
  step: string
  /** Business context */
  context: {
    businessType?: string
    country?: string
    countryName?: string
    currency?: string
    companyName?: string
  }
  /** Company slug for the API URL */
  companySlug: string
  /** Whether to fetch (default true) */
  enabled?: boolean
}

interface StepSuggestions<T> {
  suggestions: T | null
  loading: boolean
  dismissed: Set<string>
  dismiss: (key: string) => void
}

/**
 * Hook to fetch AI suggestions for a setup wizard step.
 * Fetches once on mount (when enabled and context is available).
 * Returns null silently on any error — suggestions are optional.
 */
export function useStepSuggestions<T>(options: StepSuggestionOptions): StepSuggestions<T> {
  const { step, context, companySlug, enabled = true } = options
  const [suggestions, setSuggestions] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const fetchedRef = useRef(false)

  const dismiss = useCallback((key: string) => {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  useEffect(() => {
    if (!enabled || !companySlug) return
    if (!context.country && !context.businessType) return

    // Prevent duplicate fetches on re-render with same deps
    fetchedRef.current = false

    const controller = new AbortController()
    let cancelled = false

    async function fetchSuggestions() {
      setLoading(true)
      try {
        const res = await fetch(`/api/c/${companySlug}/setup/ai-suggest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step, context }),
          signal: controller.signal,
        })
        if (res.ok && !cancelled) {
          const data = await res.json() as T
          setSuggestions(data)
          fetchedRef.current = true
        }
      } catch {
        // AI suggestions are optional — don't block the user
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchSuggestions()

    return () => {
      cancelled = true
      controller.abort()
    }
    // Only re-fetch when these key values change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, context.country, context.businessType, companySlug, enabled])

  return { suggestions, loading, dismissed, dismiss }
}
