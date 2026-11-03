'use client'

import { useI18n } from '@/hooks/useI18n'
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n'

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n()

  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className={className || 'text-xs border rounded px-2 py-1 bg-white'}
    >
      {LOCALES.map((code) => (
        <option key={code} value={code}>{LOCALE_LABELS[code]}</option>
      ))}
    </select>
  )
}
