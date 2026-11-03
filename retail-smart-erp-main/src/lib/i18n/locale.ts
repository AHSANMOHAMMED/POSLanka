/** Shared locale codes for UI + SA → vendor notices (English, Sinhala, Tamil). */
export const LOCALES = ['en', 'si', 'ta'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  si: 'සිංහල',
  ta: 'தமிழ்',
}

export function resolveLocale(input?: string | null): Locale {
  const v = (input || '').trim().toLowerCase()
  if (v === 'si' || v.startsWith('si-') || v === 'sinhala') return 'si'
  if (v === 'ta' || v.startsWith('ta-') || v === 'tamil') return 'ta'
  return 'en'
}

export function htmlLang(locale: Locale): string {
  if (locale === 'si') return 'si'
  if (locale === 'ta') return 'ta'
  return 'en'
}

/** Pick the best available string from a locale map (fallback: en → first non-empty). */
export function pickLocalizedText(
  map: Partial<Record<Locale, string | null | undefined>> | null | undefined,
  locale: Locale,
  fallback = '',
): string {
  if (!map) return fallback
  const order: Locale[] = [locale, 'en', 'si', 'ta']
  for (const key of order) {
    const v = map[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return fallback
}

export type LocalizedPair = { title?: string; body?: string }

export function pickLocalizedPair(
  translations: Partial<Record<Locale, LocalizedPair>> | null | undefined,
  locale: Locale,
  defaults: { title: string; body: string },
): { title: string; body: string } {
  const order: Locale[] = [locale, 'en', 'si', 'ta']
  let title = defaults.title
  let body = defaults.body
  for (const key of order) {
    const t = translations?.[key]
    if (t?.title?.trim()) {
      title = t.title.trim()
      break
    }
  }
  for (const key of order) {
    const t = translations?.[key]
    if (t?.body?.trim()) {
      body = t.body.trim()
      break
    }
  }
  return { title, body }
}
