import * as SecureStore from 'expo-secure-store'

export type AppLocale = 'en' | 'si' | 'ta'

const KEY = 'poslanka_locale'

export const LOCALE_OPTIONS: Array<{ value: AppLocale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'si', label: 'සිංහල' },
  { value: 'ta', label: 'தமிழ்' },
]

export function resolveAppLocale(input?: string | null): AppLocale {
  const v = (input || '').trim().toLowerCase()
  if (v === 'si' || v.startsWith('si')) return 'si'
  if (v === 'ta' || v.startsWith('ta')) return 'ta'
  return 'en'
}

export async function getAppLocale(): Promise<AppLocale> {
  try {
    return resolveAppLocale(await SecureStore.getItemAsync(KEY))
  } catch {
    return 'en'
  }
}

export async function setAppLocale(locale: AppLocale): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, locale)
  } catch {
    // ignore
  }
}

export function pickLocalizedPair(
  translations: Partial<Record<AppLocale, { title?: string; body?: string }>> | null | undefined,
  locale: AppLocale,
  defaults: { title: string; body: string },
): { title: string; body: string } {
  const order: AppLocale[] = [locale, 'en', 'si', 'ta']
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
