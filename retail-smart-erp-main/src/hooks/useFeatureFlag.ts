'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FeatureFlag, FeatureFlagsMap } from '@/lib/features/flags'
import { DEFAULT_VENDOR_FEATURE_FLAGS, isFeatureEnabled } from '@/lib/features/flags'
import { sharedJson } from '@/lib/client/shared-fetch'

const FLAGS_MAX_AGE_MS = 15_000

function sameFlags(a: FeatureFlagsMap, b: FeatureFlagsMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<FeatureFlag>
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlagsMap>(DEFAULT_VENDOR_FEATURE_FLAGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // Shared by every component using this hook: at most one request per FLAGS_MAX_AGE_MS
        const data = await sharedJson<{ flags?: FeatureFlagsMap }>('/api/features', { maxAgeMs: FLAGS_MAX_AGE_MS })
        if (!cancelled && data?.flags) {
          const next = data.flags
          setFlags((prev) => (sameFlags(prev, next) ? prev : next))
        }
      } catch {
        // keep what we have
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    // A super admin may switch features while this tab is open: pick changes up when the tab
    // comes back into view and every minute while it is visible.
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(timer)
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
