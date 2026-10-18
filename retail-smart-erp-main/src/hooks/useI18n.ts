'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import { getMessages, resolveLocale, t, type Locale } from '@/lib/i18n'

const STORAGE_KEY = 'poslanka_locale'

function subscribe(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange)
  window.addEventListener('poslanka-locale-change', onStoreChange)
  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener('poslanka-locale-change', onStoreChange)
  }
}

function getSnapshot(): Locale {
  if (typeof window === 'undefined') return 'en'
  return resolveLocale(localStorage.getItem(STORAGE_KEY))
}

function getServerSnapshot(): Locale {
  return 'en'
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [, bump] = useState(0)

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.lang = next === 'si' ? 'si' : 'en'
    window.dispatchEvent(new Event('poslanka-locale-change'))
    bump((n) => n + 1)
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
