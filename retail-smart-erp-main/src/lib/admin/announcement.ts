import { pickLocalizedText, resolveLocale, type Locale } from '@/lib/i18n/locale'

export type AnnouncementType = 'info' | 'warning' | 'error' | 'maintenance'

export interface SystemAnnouncementValue {
  enabled: boolean
  /** Legacy / English default body */
  message?: string
  messages?: Partial<Record<Locale, string>>
  type: AnnouncementType
  /** Show on company / staff login screens before sign-in */
  showOnLogin?: boolean
}

export function normalizeAnnouncement(raw: unknown): SystemAnnouncementValue {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const messagesRaw = (v.messages && typeof v.messages === 'object' ? v.messages : {}) as Record<string, unknown>
  const message = typeof v.message === 'string' ? v.message : ''
  const messages: Partial<Record<Locale, string>> = {
    en: typeof messagesRaw.en === 'string' && messagesRaw.en.trim() ? messagesRaw.en : message,
    si: typeof messagesRaw.si === 'string' ? messagesRaw.si : '',
    ta: typeof messagesRaw.ta === 'string' ? messagesRaw.ta : '',
  }
  return {
    enabled: !!v.enabled,
    message: messages.en || message,
    messages,
    type: v.type === 'warning' || v.type === 'error' || v.type === 'maintenance' ? v.type : 'info',
    showOnLogin: v.showOnLogin !== false,
  }
}

export function announcementTextForLocale(ann: SystemAnnouncementValue, localeInput?: string | null): string {
  const locale = resolveLocale(localeInput)
  return pickLocalizedText(
    {
      en: ann.messages?.en || ann.message,
      si: ann.messages?.si,
      ta: ann.messages?.ta,
    },
    locale,
    ann.message || '',
  )
}
