import en from './messages/en.json'
import { siMessages } from './messages/si-nav'
import { taMessages } from './messages/ta-nav'
import type { Locale } from './locale'

export type { Locale } from './locale'
export {
  LOCALES,
  LOCALE_LABELS,
  htmlLang,
  pickLocalizedText,
  pickLocalizedPair,
  resolveLocale,
} from './locale'

const catalogs: Record<Locale, typeof en> = {
  en,
  si: siMessages as unknown as typeof en,
  ta: taMessages as unknown as typeof en,
}

export function getMessages(locale: Locale = 'en') {
  return catalogs[locale] || catalogs.en
}

export function t(
  locale: Locale,
  path: string,
  fallback?: string
): string {
  const messages = getMessages(locale) as Record<string, unknown>
  const parts = path.split('.')
  let cur: unknown = messages
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return fallback || path
    }
  }
  return typeof cur === 'string' ? cur : fallback || path
}
