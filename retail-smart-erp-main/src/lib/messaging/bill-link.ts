/**
 * Public bill links sent to customers by SMS / WhatsApp: /api/public/bill/<token>.
 * The token is the sale id plus an HMAC (NEXTAUTH_SECRET), so links cannot be guessed or
 * enumerated, and needs no table. Short enough for one SMS (≈40 characters). Server-only.
 */
import crypto from 'crypto'

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('NEXTAUTH_SECRET is required to sign bill links')
  return 'poslanka-dev-bill-link-secret'
}

function mac(idBytes: Buffer): string {
  return crypto.createHmac('sha256', secret()).update(Buffer.concat([Buffer.from('bill-link:'), idBytes])).digest().subarray(0, 12).toString('base64url')
}

export function billToken(saleId: string): string {
  const bytes = Buffer.from(saleId.replace(/-/g, ''), 'hex')
  return `${bytes.toString('base64url')}.${mac(bytes)}`
}

/** The sale id, or null for a malformed / forged token. */
export function verifyBillToken(token: string): string | null {
  const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16})$/.exec(token)
  if (!m) return null
  const bytes = Buffer.from(m[1], 'base64url')
  if (bytes.length !== 16) return null
  const expected = Buffer.from(mac(bytes))
  const given = Buffer.from(m[2])
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function appBaseUrl(fallback?: string): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || fallback || 'http://localhost:3000').replace(/\/$/, '')
}

export function billUrl(saleId: string, base?: string): string {
  return `${appBaseUrl(base)}/api/public/bill/${billToken(saleId)}`
}
