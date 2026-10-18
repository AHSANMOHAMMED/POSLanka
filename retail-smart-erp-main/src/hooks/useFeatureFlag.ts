'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FeatureFlag, FeatureFlagsMap } from '@/lib/features/flags'
import { DEFAULT_VENDOR_FEATURE_FLAGS, isFeatureEnabled } from '@/lib/features/flags'

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlagsMap>(DEFAULT_VENDOR_FEATURE_FLAGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/features')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.flags) {
          setFlags(data.flags)
        }
      } catch {
        // keep defaults
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const hasFeature = useCallback(
    (flag: FeatureFlag) => isFeatureEnabled(flags, flag),
    [flags]
  )

  return { flags, loading, hasFeature }
}

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { hasFeature } = useFeatureFlags()
  return hasFeature(flag)
}
