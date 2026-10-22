'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FeatureFlag, FeatureFlagsMap } from '@/lib/features/flags'
import { DEFAULT_VENDOR_FEATURE_FLAGS, isFeatureEnabled } from '@/lib/features/flags'
import { sharedJson } from '@/lib/client/shared-fetch'

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlagsMap>(DEFAULT_VENDOR_FEATURE_FLAGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Shared by every component using this hook — one request per minute
        const data = await sharedJson<{ flags?: FeatureFlagsMap }>('/api/features', { maxAgeMs: 60_000 })
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
