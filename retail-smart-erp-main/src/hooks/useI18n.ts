'use client'

import { useCallback, useEffect, useState } from 'react'
import { getMessages, resolveLocale, t, type Locale } from '@/lib/i18n'

const STORAGE_KEY = 'poslanka_locale'

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    setLocaleState(resolveLocale(saved))
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.lang = next === 'si' ? 'si' : 'en'
  }, [])

  const translate = useCallback(
    (path: string, fallback?: string) => t(locale, path, fallback),
    [locale]
  )

  return {
    locale,
    setLocale,
    t: translate,
    messages: getMessages(locale),
  }
}
