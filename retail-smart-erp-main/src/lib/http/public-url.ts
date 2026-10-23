import type { NextRequest } from 'next/server'
import { isTrustedOrigin } from '@/lib/security/origin'

/**
 * Absolute URL on the host the browser actually used, for redirects.
 *
 * Under the custom server (server.ts) Next builds request.url from its own address
 * (http://localhost:<port>), not from the Host header, so `new URL(path, request.url)` sent
 * redirects — e.g. "Open as owner" — to a host where the user's cookies don't exist. The host comes
 * from X-Forwarded-Host (reverse proxy) or Host and is only used when it is a trusted origin
 * (same-origin, base domain, ALLOWED_HOSTS), so a forged header can't redirect anywhere else;
 * otherwise NEXTAUTH_URL, then request.url.
 */
export function publicUrl(request: NextRequest, path: string): URL {
  const headers = request.headers
  const host = (headers.get('x-forwarded-host') || headers.get('host') || '').split(',')[0].trim()
  const proto = (headers.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https' ? 'https' : 'http'
  if (host) {
    const origin = `${proto}://${host}`
    if (isTrustedOrigin(origin, headers.get('host'))) return new URL(path, origin)
  }
  return new URL(path, process.env.NEXTAUTH_URL || request.url)
}
