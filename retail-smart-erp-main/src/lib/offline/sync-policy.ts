/**
 * Offline POS sync policy (pure; shared by the browser queue and tested under Node).
 *
 * Mirrors the mobile queue (apps/mobile/src/lib/offlineQueue.ts):
 * - only a confirmed sale (2xx carrying the sale for OUR clientSaleId) counts as synced — the server
 *   answers a replayed clientSaleId with the existing sale (200), never with a 409;
 * - OFFLINE_REF_CONFLICT (another sale already uses the printed offline number) is retried once
 *   with a deterministic unique reference instead of being dropped;
 * - other 4xx are rejections: kept locally ("Needs attention") and reported to the server;
 * - 5xx / 408 / 425 / 429 back off exponentially (5 s → 10 min), capped at MAX_AUTO_ATTEMPTS.
 */

export const MAX_AUTO_ATTEMPTS = 20
export const BACKOFF_BASE_MS = 5_000
export const BACKOFF_MAX_MS = 10 * 60_000
/** Periodic sweep while the POS is open (catches a server that came back without an 'online' event) */
export const SYNC_INTERVAL_MS = 30_000
export const OFFLINE_REF_MAX = 40

export type SyncOutcome =
  | { kind: 'synced'; sale: { id: string; invoiceNo?: string; clientSaleId?: string | null } }
  | { kind: 'ref_conflict'; error: string }
  | { kind: 'transient'; error: string }
  | { kind: 'rejected'; error: string }
  | { kind: 'auth'; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** RFC 4122 v4 UUID (sales.client_sale_id is a uuid column). */
export function generateClientSaleId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    // Very old browsers / insecure contexts without WebCrypto
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1)))
}

/**
 * Reference to retry with after OFFLINE_REF_CONFLICT: deterministic per sale, so repeated retries
 * reuse it. The printed ref travels as `offlineRefAlias` (sales.flags) so lookups still work.
 */
export function conflictOfflineRef(printedRef: string, clientSaleId: string): string {
  const suffix = `-${clientSaleId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`
  return printedRef.slice(0, OFFLINE_REF_MAX - suffix.length) + suffix
}

function errorText(status: number, body: unknown): string {
  const b = body as { error?: unknown; message?: unknown } | null
  const msg = typeof b?.error === 'string' ? b.error : typeof b?.message === 'string' ? b.message : ''
  return (msg || `HTTP ${status}`).slice(0, 1000)
}

/** Decide what a POST /api/sales reply means for a queued sale. */
export function classifySyncResponse(status: number, body: unknown, clientSaleId: string): SyncOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { id?: unknown; invoiceNo?: unknown; clientSaleId?: unknown; code?: unknown }
  if (status >= 200 && status < 300) {
    if (typeof b.id !== 'string') return { kind: 'transient', error: 'Server reply did not contain the sale' }
    if (b.clientSaleId && b.clientSaleId !== clientSaleId) {
      // Matched another sale (e.g. by offline receipt number): never treat that as ours.
      return { kind: 'rejected', error: 'Server matched this sale to a different sale' }
    }
    return {
      kind: 'synced',
      sale: { id: b.id, invoiceNo: typeof b.invoiceNo === 'string' ? b.invoiceNo : undefined, clientSaleId: (b.clientSaleId as string) ?? null },
    }
  }
  const error = errorText(status, body)
  if (status === 401) return { kind: 'auth', error }
  if (status === 409 && (b.code === 'OFFLINE_REF_CONFLICT' || /OFFLINE_REF_CONFLICT/.test(error))) {
    return { kind: 'ref_conflict', error }
  }
  if (status >= 500 || status === 408 || status === 425 || status === 429 || status === 0) {
    return { kind: 'transient', error }
  }
  return { kind: 'rejected', error }
}

/**
 * Offline receipt number, same format as the mobile app (apps/mobile/src/lib/offlineRef.ts):
 * OFF-<device code>-<seq>, ≤ 40 chars (sales.offline_ref). The server treats a sale carrying an
 * offlineRef as a completed offline sale (accepted and flagged instead of re-checked as online).
 */
export function formatOfflineRef(deviceCode: string, seq: number): string {
  return `OFF-${deviceCode}-${String(seq).padStart(5, '0')}`.slice(0, OFFLINE_REF_MAX)
}
