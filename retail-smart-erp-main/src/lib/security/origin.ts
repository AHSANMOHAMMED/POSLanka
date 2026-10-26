/**
 * Origin checks shared by src/proxy.ts (CSRF) and server.ts (SSE CORS).
 *
 * Trusted browser origins are: the request's own host (same-origin), the configured base domain
 * (NEXT_PUBLIC_BASE_DOMAIN) and every subdomain of it (tenant subdomains, app., www.),
 * poslanka.lk and its subdomains, hosts listed in ALLOWED_HOSTS, and — outside production —
 * localhost / 127.0.0.1. Shared platform suffixes (*.ondigitalocean.app, *.up.railway.app) are
 * deliberately NOT trusted wholesale: anyone can deploy an app there. Only the exact host the
 * request was made to is accepted for those.
 */

function baseDomain(): string {
  return (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'retailsmarterp.com').split(':')[0].toLowerCase()
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Host header value (may include a port) → bare lowercase hostname. */
export function bareHost(host: string | null | undefined): string {
  return (host || '').split(',')[0].trim().split(':')[0].toLowerCase()
}

export function isTrustedOrigin(origin: string, requestHost?: string | null): boolean {
  const host = hostOf(origin)
  if (!host) return false
  if (requestHost && host === bareHost(requestHost)) return true
  const base = baseDomain()
  if (base && base !== 'localhost' && (host === base || host.endsWith(`.${base}`))) return true
  if (host === 'poslanka.lk' || host.endsWith('.poslanka.lk') || host === 'skyerpos.com' || host.endsWith('.skyerpos.com') || host.endsWith('.sslip.io') || host.endsWith('.nip.io')) return true
  const allowed = (process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  if (allowed.includes(host)) return true
  if (process.env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost'))) {
    return true
  }
  return false
}
