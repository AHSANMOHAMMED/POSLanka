// The business's feature switches (super admin → vendor → Features), from GET /api/features.
// Loaded once per app session, refreshed every minute while used and whenever the app comes back to
// the foreground (a super admin may have changed them); while unknown everything counts as on (the
// server refuses switched-off features anyway).
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { apiGet } from './api'

export type FeatureFlags = Record<string, boolean>

let cached: { flags: FeatureFlags; at: number } | null = null
let inflight: Promise<FeatureFlags | null> | null = null
const TTL_MS = 60 * 1000
const listeners = new Set<(flags: FeatureFlags) => void>()

export async function loadFeatureFlags(force = false): Promise<FeatureFlags | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.flags
  if (!inflight) {
    inflight = apiGet<{ flags: FeatureFlags }>('/api/features')
      .then((res) => {
        if (res.ok && res.data?.flags) {
          cached = { flags: res.data.flags, at: Date.now() }
          for (const l of listeners) l(res.data.flags)
        }
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
    const onFlags = (f: FeatureFlags) => { if (alive) setFlags(f) }
    listeners.add(onFlags)
    loadFeatureFlags().then((f) => { if (alive && f) setFlags(f) })
    // Back from the background: fetch again so switches changed meanwhile apply at once
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadFeatureFlags(true)
    })
    return () => { alive = false; listeners.delete(onFlags); sub.remove() }
  }, [])
  return { flags, has: (flag) => flags?.[flag] !== false }
}
