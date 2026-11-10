/**
 * Public bill links sent to customers by SMS / WhatsApp: /api/public/bill/<token>.
 * The token is the sale id plus an HMAC (NEXTAUTH_SECRET), so links cannot be guessed or
 * enumerated, and needs no table. Short enough for one SMS (≈40 characters). Server-only.
 */
import crypto from 'crypto'
import type { NextRequest } from 'next/server'

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

/**
 * Extracts public origin from a Request or NextRequest, taking reverse proxies
 * (Caddy, Nginx: x-forwarded-proto, x-forwarded-host) into account.
 */
export function extractRequestOrigin(request?: Request | NextRequest | null): string | null {
  if (!request) return null
  try {
    const headers = request.headers
    const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const host = forwardedHost || headers.get('host')

    if (host) {
      let proto = forwardedProto
      if (!proto) {
        proto = (host.includes('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https'
      }
      return `${proto}://${host}`
    }

    if ('nextUrl' in request && (request as NextRequest).nextUrl?.origin) {
      const orig = (request as NextRequest).nextUrl.origin
      if (orig && orig !== 'null') return orig
    }

    if (request.url) {
      const u = new URL(request.url)
      if (u.origin && u.origin !== 'null') return u.origin
    }
  } catch {
    // fallback
  }
  return null
}

export function appBaseUrl(fallback?: string | Request | NextRequest | null): string {
  let fallbackOrigin: string | null = null
  if (fallback) {
    if (typeof fallback === 'string') {
      fallbackOrigin = fallback.trim().replace(/\/$/, '')
    } else {
      fallbackOrigin = extractRequestOrigin(fallback)
    }
  }

  const envPublic = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/$/, '')
  // If NEXT_PUBLIC_APP_URL is explicitly set and not a local loopback:
  if (envPublic && !envPublic.startsWith('http://localhost') && !envPublic.startsWith('http://127.0.0.1')) {
    // If NEXT_PUBLIC_APP_URL is http:// but fallback is https, prefer the secure HTTPS origin:
    if (envPublic.startsWith('http://') && fallbackOrigin?.startsWith('https://')) {
      return fallbackOrigin
    }
    return envPublic
  }

  // If a request was supplied and gave us an active origin, that reflects the current client access:
  if (fallbackOrigin && fallbackOrigin.startsWith('http')) {
    return fallbackOrigin
  }

  // NEXTAUTH_URL fallback:
  let authUrl = (process.env.NEXTAUTH_URL || '').trim().replace(/\/$/, '')
  if (authUrl === 'http://168.144.216.104') {
    authUrl = 'https://168-144-216-104.sslip.io'
  }
  if (authUrl && !authUrl.startsWith('http://localhost') && !authUrl.startsWith('http://127.0.0.1')) {
    if (authUrl.startsWith('http://') && fallbackOrigin?.startsWith('https://')) {
      return fallbackOrigin
    }
    return authUrl
  }

  return fallbackOrigin || authUrl || 'http://localhost:3000'
}

export function billUrl(saleId: string, base?: string | Request | NextRequest | null): string {
  return `${appBaseUrl(base)}/api/public/bill/${billToken(saleId)}`
}
