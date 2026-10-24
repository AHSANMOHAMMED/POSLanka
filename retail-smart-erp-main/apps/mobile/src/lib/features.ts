// The business's feature switches (super admin → vendor → Features), from GET /api/features.
// Loaded once per app session and refreshed every few minutes; while unknown everything counts as on
// (the server refuses switched-off features anyway).
import { useEffect, useState } from 'react'
import { apiGet } from './api'

export type FeatureFlags = Record<string, boolean>

let cached: { flags: FeatureFlags; at: number } | null = null
let inflight: Promise<FeatureFlags | null> | null = null
const TTL_MS = 5 * 60 * 1000

export async function loadFeatureFlags(force = false): Promise<FeatureFlags | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.flags
  if (!inflight) {
    inflight = apiGet<{ flags: FeatureFlags }>('/api/features')
      .then((res) => {
        if (res.ok && res.data?.flags) cached = { flags: res.data.flags, at: Date.now() }
        return cached?.flags ?? null
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

/** Forget the switches (sign-out / business change) */
export function clearFeatureFlags() {
  cached = null
}

export function useFeatureFlags(): { has: (flag: string) => boolean; flags: FeatureFlags | null } {
  const [flags, setFlags] = useState<FeatureFlags | null>(cached?.flags ?? null)
  useEffect(() => {
    let alive = true
    loadFeatureFlags().then((f) => { if (alive && f) setFlags(f) })
    return () => { alive = false }
  }, [])
  return { flags, has: (flag) => flags?.[flag] !== false }
}
