/**
 * Cross-instance invalidation for small in-process TTL caches (system billing settings, tenant
 * alert settings, storage quota). `invalidate(cache, key)` drops the entry here immediately and
 * publishes it on the `cache_invalidate` NOTIFY channel; every other app instance drops it as
 * soon as the notification arrives (shared LISTEN connection, src/lib/db/listen-hub.ts).
 * The TTL stays as the fallback; after a listener reconnect each cache is cleared entirely.
 */
import { getSharedPool } from '@/lib/db/pool'
import { listenEnabled, subscribe } from '@/lib/db/listen-hub'

export const CACHE_CHANNEL = 'cache_invalidate'
const ALL = '*'

type Dropper = (key: string | null) => void

declare global {
  var __poslankaCacheDroppers: Map<string, Set<Dropper>> | undefined
  var __poslankaCacheSubscribed: boolean | undefined
  var __poslankaCacheOrigin: string | undefined
}

function droppers(): Map<string, Set<Dropper>> {
  return (globalThis.__poslankaCacheDroppers ||= new Map())
}

function origin(): string {
  return (globalThis.__poslankaCacheOrigin ||= `${process.pid}-${globalThis.crypto.randomUUID().slice(0, 8)}`)
}

function apply(cache: string, key: string | null): void {
  for (const drop of droppers().get(cache) ?? []) {
    try { drop(key) } catch { /* ignore */ }
  }
}

function ensureSubscribed(): void {
  if (globalThis.__poslankaCacheSubscribed || !listenEnabled()) return
  globalThis.__poslankaCacheSubscribed = true
  subscribe(CACHE_CHANNEL, (payload) => {
    if (!payload) return
    try {
      const msg = JSON.parse(payload) as { o?: string; c?: string; k?: string }
      if (!msg.c || msg.o === origin()) return
      apply(msg.c, msg.k && msg.k !== ALL ? msg.k : null)
    } catch { /* malformed */ }
  }, () => {
    for (const cache of droppers().keys()) apply(cache, null)
  })
}

/**
 * Register a cache. `drop(key)` removes one entry, `drop(null)` clears it.
 * Call once at module load of the cache owner.
 */
export function registerCache(cache: string, drop: Dropper): void {
  let set = droppers().get(cache)
  if (!set) { set = new Set(); droppers().set(cache, set) }
  set.add(drop)
  ensureSubscribed()
}

/** Drop `key` (or everything when omitted) from `cache` in this and every other instance. */
export function invalidate(cache: string, key?: string | null): void {
  apply(cache, key ?? null)
  if (!listenEnabled()) return
  const payload = JSON.stringify({ o: origin(), c: cache, k: key ?? ALL })
  if (Buffer.byteLength(payload) > 7900) return
  getSharedPool().query('SELECT pg_notify($1, $2)', [CACHE_CHANNEL, payload]).catch(() => undefined)
}
