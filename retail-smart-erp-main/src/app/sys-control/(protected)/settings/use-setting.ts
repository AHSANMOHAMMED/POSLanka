'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

export type FieldErrors = Record<string, string>

export interface SettingsPayload {
  settings: Record<string, unknown>
  updatedAt: Record<string, string | null>
  tiers: Array<{ id: string; displayName: string; isActive: boolean }>
  platform: {
    appName: string
    baseUrl: string
    environment: string
    emailConfigured: boolean
    emailFrom: string
    storageConfigured: boolean
    payhere: { configured: boolean; sandbox: boolean }
    graceDays: number
  }
}

/**
 * Local form state for one platform setting: edit, validate on the server, show field errors.
 * `errors` keys are the dotted field paths returned by PUT /api/sys-control/settings.
 */
export function useSetting<T extends object>(key: string, initial: T, savedAt: string | null, onSaved: (key: string, value: T, updatedAt: string) => void) {
  const [value, setValue] = useState<T>(initial)
  const [baseline, setBaseline] = useState<string>(JSON.stringify(initial))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  // A reload from the server replaces the form
  useEffect(() => {
    setValue(initial)
    setBaseline(JSON.stringify(initial))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAt])

  const dirty = useMemo(() => JSON.stringify(value) !== baseline, [value, baseline])

  const set = useCallback(<K extends keyof T>(field: K, v: T[K]) => {
    setValue((prev) => ({ ...prev, [field]: v }))
    setMessage(null)
    setErrors((e) => {
      if (!e[field as string]) return e
      const next = { ...e }
      delete next[field as string]
      return next
    })
  }, [])

  const save = useCallback(async (override?: T) => {
    const body = override ?? value
    setSaving(true)
    setErrors({})
    setMessage(null)
    try {
      const res = await fetch('/api/sys-control/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, value: body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const details: Array<{ field?: string; message?: string }> = Array.isArray(data?.details) ? data.details : []
        const map: FieldErrors = {}
        for (const d of details) if (d.field && d.message && !map[d.field]) map[d.field] = d.message
        setErrors(map)
        setMessage({ tone: 'danger', text: details.length && !Object.keys(map).length ? details.map((d) => d.message).join(' ') : data?.error || `Could not save (${res.status})` })
        return false
      }
      const saved = (data.value ?? body) as T
      setValue(saved)
      setBaseline(JSON.stringify(saved))
      setMessage({ tone: 'success', text: 'Saved.' })
      onSaved(key, saved, data.updatedAt ?? new Date().toISOString())
      return true
    } catch {
      setMessage({ tone: 'danger', text: 'Network error — nothing was saved.' })
      return false
    } finally {
      setSaving(false)
    }
  }, [key, value, onSaved])

  const reset = useCallback(() => {
    setValue(JSON.parse(baseline) as T)
    setErrors({})
    setMessage(null)
  }, [baseline])

  return { value, setValue, set, save, saving, dirty, errors, message, reset }
}
