/**
 * Logins and passwords made for people created without an email or password (super-admin vendor
 * creation, staff created by name only). They sign in with Business ID + this login + password.
 * The .poslanka.local domain never receives mail, so email senders skip it.
 */
import { randomBytes } from 'crypto'

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

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const DIGIT = '23456789'
const ALL = UPPER + LOWER + DIGIT

/** Readable 12-character password (no 0/O/1/l/I) with an upper, a lower and a digit — passes validatePasswordStrength */
export function generateReadablePassword(length = 12): string {
  const bytes = randomBytes(length * 2)
  const pick = (set: string, i: number) => set[bytes[i] % set.length]
  const chars = [pick(UPPER, 0), pick(LOWER, 1), pick(DIGIT, 2)]
  for (let i = 3; i < length; i++) chars.push(pick(ALL, i))
  // Shuffle so the classes are not always in front
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[length + i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
