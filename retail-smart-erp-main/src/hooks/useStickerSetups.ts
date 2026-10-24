'use client'

import { useCallback, useEffect, useState } from 'react'
import { sanitizeStickerSetups, type StickerSetup } from '@/lib/labels/sticker-stock'

let cache: StickerSetup[] | null = null
const listeners = new Set<(l: StickerSetup[]) => void>()

/** Tenant sticker stock / label printer setups (GET/PUT /api/label-settings/sticker-setups). */
export function useStickerSetups(enabled = true) {
  const [setups, setSetups] = useState<StickerSetup[]>(cache || [])
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    const l = (list: StickerSetup[]) => setSetups(list)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/label-settings/sticker-setups')
      if (res.ok) {
        const data = await res.json()
        cache = sanitizeStickerSetups(data.stickerSetups)
        listeners.forEach((fn) => fn(cache!))
      }
    } catch {
      /* offline: keep cache */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled && !cache) reload()
  }, [enabled, reload])

  /** Save the whole list. Returns an error message or null. */
  const save = useCallback(async (list: StickerSetup[]): Promise<string | null> => {
    try {
      const res = await fetch('/api/label-settings/sticker-setups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stickerSetups: list }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return data.error || 'Failed to save label setups'
      cache = sanitizeStickerSetups(data.stickerSetups)
      listeners.forEach((fn) => fn(cache!))
      return null
    } catch {
      return 'Network error saving label setups'
    }
  }, [])

  return { setups, loading, reload, save }
}
