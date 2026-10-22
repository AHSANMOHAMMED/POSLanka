/**
 * Short-lived cache of successful company-session checks (tenant active, user active, password
 * unchanged), so clicking around doesn't hit the database for every request. Entries live 20 s
 * and are dropped for a whole tenant whenever its staff, roles or status change: permission-cache
 * calls clearSessionValidation() for local invalidations and for the cross-instance NOTIFY, so a
 * deactivated or demoted user loses access on the next request, as before the cache existed.
 */

export const SESSION_VALIDATION_TTL_MS = 20_000
const MAX_ENTRIES = 20_000

interface Entry {
  validatedAt: number
  logoUrl?: string
  aiEnabled?: boolean
}

type TenantListener = (tenantId: string) => void

declare global {
  var __sessionValidationCache: Map<string, Entry> | undefined
  var __tenantInvalidationListeners: Set<TenantListener> | undefined
}

// globalThis: server.js and the route bundles load separate copies of this module
const cache = (globalThis.__sessionValidationCache ||= new Map<string, Entry>())
const listeners = (globalThis.__tenantInvalidationListeners ||= new Set<TenantListener>())

/**
 * Other per-process caches of a tenant's staff/status (e.g. the company layout) subscribe here
 * so they are cleared by the same local + cross-instance invalidation. Returns an unsubscribe.
 */
export function onTenantInvalidated(listener: TenantListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Key on the stable sign-in time (authAt); iat is re-issued on refresh and grew the map forever. */
export function sessionValidationKey(tenantId: string, userId: string, signedInAt: number | undefined): string {
  return `${tenantId}:${userId}:${signedInAt ?? 0}`
}

export function getSessionValidation(key: string, now = Date.now()): Entry | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (now - hit.validatedAt >= SESSION_VALIDATION_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return hit
}

export function setSessionValidation(key: string, entry: Entry): void {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (now - v.validatedAt >= SESSION_VALIDATION_TTL_MS) cache.delete(k)
    }
    // Still full of fresh entries: drop the oldest insertions
    for (const k of cache.keys()) {
      if (cache.size < MAX_ENTRIES) break
      cache.delete(k)
    }
  }
  cache.set(key, entry)
}

export function deleteSessionValidation(key: string): void {
  cache.delete(key)
}

/** Drop every cached session check of a tenant ('*' = all tenants). */
export function clearSessionValidation(tenantId: string): void {
  if (tenantId === '*') {
    cache.clear()
  } else {
    const prefix = `${tenantId}:`
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) cache.delete(k)
    }
  }
  for (const listener of listeners) {
    try { listener(tenantId) } catch { /* a broken listener must not block invalidation */ }
  }
}
