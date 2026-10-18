'use client'

import { useI18n } from '@/hooks/useI18n'

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n()

  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={(e) => setLocale(e.target.value as 'en' | 'si')}
      className="text-xs border rounded px-2 py-1 bg-white"
    >
      <option value="en">English</option>
      <option value="si">සිංහල</option>
    </select>
  )
}
