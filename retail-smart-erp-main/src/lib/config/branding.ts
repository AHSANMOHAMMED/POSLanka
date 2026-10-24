/**
 * skyERPOS product branding — driven by env with safe defaults.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS'
export const APP_SHORT_NAME = process.env.NEXT_PUBLIC_APP_SHORT_NAME || 'skyERPOS'
export const APP_TAGLINE =
  process.env.NEXT_PUBLIC_APP_TAGLINE ||
  'Powerful. Reliable. Complete POS solution for your business.'

export const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'poslanka.lk'
export const LANDING_DOMAIN =
  process.env.NEXT_PUBLIC_LANDING_DOMAIN || `www.${BASE_DOMAIN}`
export const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || `app.${BASE_DOMAIN}`

export const DEFAULT_COUNTRY = 'LK'
export const DEFAULT_CURRENCY = 'LKR'
export const DEFAULT_TIMEZONE = 'Asia/Colombo'
export const DEFAULT_LOCALE = 'en'
export const SUPPORTED_LOCALES = ['en', 'si'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || `support@${BASE_DOMAIN}`

export function cookieDomainFromBase(): string {
  const base = BASE_DOMAIN.split(':')[0]
  if (base === 'localhost' || base === '127.0.0.1') return base
  return `.${base}`
}
