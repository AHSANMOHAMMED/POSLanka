import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Shared secret for internal requests (proxy → /api/lookup-tenant, API routes → the server's
 * /_internal/broadcast). Derived per purpose from NEXTAUTH_SECRET with HMAC, so the master
 * secret itself never travels in a header and one purpose's value cannot be reused for another.
 */
export function internalSecret(purpose: 'lookup-tenant' | 'broadcast'): string {
  const master = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || ''
  if (!master) return ''
  return createHmac('sha256', master).update(`poslanka-internal:${purpose}`).digest('hex')
}

/** Constant-time check of a presented internal secret; false when no master secret is set. */
export function verifyInternalSecret(purpose: 'lookup-tenant' | 'broadcast', presented: string | string[] | null | undefined): boolean {
  const expected = internalSecret(purpose)
  const value = Array.isArray(presented) ? presented[0] : presented
  if (!expected || !value || value.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}
