import type { NextRequest } from 'next/server'
import { isTrustedOrigin } from '@/lib/security/origin'

/** Deployed production origin for this project (DigitalOcean sslip). */
export const PRODUCTION_PUBLIC_ORIGIN = 'https://168-144-216-104.sslip.io'

function isLocalhostOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1'
  } catch {
    return /localhost|127\.0\.0\.1/i.test(origin)
  }
}

/**
 * Canonical public origin for emails, mobile deep-links, and admin “open on web”.
 * Never returns localhost in production — falls back to the sslip deploy host.
 */
export function publicAppOrigin(fallbackOrigin?: string | null): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_DOMAIN
      ? `${process.env.NEXT_PUBLIC_APP_DOMAIN.includes('://') ? '' : 'https://'}${process.env.NEXT_PUBLIC_APP_DOMAIN}`
      : null,
    process.env.NEXTAUTH_URL,
    fallbackOrigin,
  ]
  for (const raw of candidates) {
    if (!raw) continue
    const origin = raw.replace(/\/$/, '')
    if (!/^https?:\/\//i.test(origin)) continue
    if (process.env.NODE_ENV === 'production' && isLocalhostOrigin(origin)) continue
    return origin
  }
  return PRODUCTION_PUBLIC_ORIGIN
}

/**
 * Absolute URL on the host the browser actually used, for redirects.
 *
 * Under the custom server (server.ts) Next builds request.url from its own address
 * (http://localhost:<port>), not from the Host header, so `new URL(path, request.url)` sent
 * redirects — e.g. "Open as owner" — to a host where the user's cookies don't exist. The host comes
 * from X-Forwarded-Host (reverse proxy) or Host and is only used when it is a trusted origin
 * (same-origin, base domain, ALLOWED_HOSTS), so a forged header can't redirect anywhere else;
 * otherwise publicAppOrigin / NEXTAUTH_URL, then request.url.
 */
export function publicUrl(request: NextRequest, path: string): URL {
  const headers = request.headers
  const host = (headers.get('x-forwarded-host') || headers.get('host') || '').split(',')[0].trim()
  const proto = (headers.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https' ? 'https' : 'http'
  if (host) {
    const origin = `${proto}://${host}`
    if (isTrustedOrigin(origin, headers.get('host'))) {
      if (!(process.env.NODE_ENV === 'production' && isLocalhostOrigin(origin))) {
        return new URL(path, origin)
      }
    }
  }
  return new URL(path, publicAppOrigin(request.nextUrl?.origin || request.url))
}
