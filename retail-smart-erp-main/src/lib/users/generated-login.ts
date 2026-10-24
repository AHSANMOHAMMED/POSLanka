/**
 * Logins and passwords made for people created without an email or password (super-admin vendor
 * creation, staff created by name only). They sign in with Business ID + this login + password.
 * The .poslanka.local domain never receives mail, so email senders skip it.
 */
import { randomInt } from 'crypto'

export const PLACEHOLDER_LOGIN_DOMAIN = 'poslanka.local'

export function isPlaceholderLogin(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`.${PLACEHOLDER_LOGIN_DOMAIN}`)
}

/** `<local>@<tenant slug>.poslanka.local` */
export function placeholderLogin(local: string, tenantSlug: string): string {
  return `${local}@${tenantSlug}.${PLACEHOLDER_LOGIN_DOMAIN}`.toLowerCase()
}

/** Login local part from a person's name: "Nimal Perera" → "nimal.perera"; non-Latin names → "staff" */
export function loginLocalPart(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 40).replace(/\.+$/g, '')
  return s.length >= 2 ? s : 'staff'
}

/** Simple 6-digit password (e.g. 482915) for people created without one — easy to read out; shown once */
export function generateReadablePassword(length = 6): string {
  return Array.from({ length }, () => String(randomInt(0, 10))).join('')
}
