/**
 * Offline POS queue using IndexedDB (browser).
 * Stores catalog snapshot + pending sales for sync when online.
 *
 * H4 (reliability, see ./sync-policy.ts):
 * - a sale leaves the queue only when the server confirms it (2xx with the sale for our clientSaleId);
 * - OFFLINE_REF_CONFLICT is retried once with a unique reference, other 4xx mark the sale
 *   `rejected` (kept locally, reported once to POST /api/sales/offline-rejected for a manager alert);
 * - transient failures back off exponentially and become `rejected` after MAX_AUTO_ATTEMPTS;
 * - a module-level engine retries on 'online', on a backoff timer and on a periodic sweep, and is
 *   shared by every component that uses useOfflinePos (one sync loop per tab, one per browser
 *   when navigator.locks is available);
 * - entries remember the company they were sold for and are only replayed while that company is open.
 */
import {
  MAX_AUTO_ATTEMPTS, SYNC_INTERVAL_MS, backoffMs, classifySyncResponse, conflictOfflineRef,
} from './sync-policy'

const DB_NAME = 'poslanka-offline'
const DB_VERSION = 1
const STORE_SALES = 'pending_sales'
const STORE_CATALOG = 'catalog'

export type PendingSale = {
  clientSaleId: string
  payload: Record<string, unknown>
  createdAt: string
  attempts: number
  lastError?: string
  /** HTTP status of the last failed attempt (0 = network) */
  lastStatus?: number | null
  /** The server rejected the sale (or retries were exhausted); no longer retried automatically. */
  rejected?: boolean
  /** epoch ms before which a transient failure is not retried */
  nextAttemptAt?: number | null
  /** The rejection was reported to the server (manager alert) */
  reported?: boolean
  /** Company (tenant slug) the sale was made for; legacy entries have none. */
  tenantSlug?: string | null
  /** Offline receipt number printed for the customer, if any */
  offlineRef?: string | null
}

/** Storage used by the sync loop (IndexedDB in the browser, in-memory in tests). */
export interface PendingSaleStore {
  list(): Promise<PendingSale[]>
  put(sale: PendingSale): Promise<void>
  remove(clientSaleId: string): Promise<void>
}

export interface SyncReply { status: number; body: unknown }

/** Network layer used by the sync loop. Both functions THROW on a network failure. */
export interface SyncTransport {
  postSale(payload: Record<string, unknown>): Promise<SyncReply>
  reportRejected(report: Record<string, unknown>): Promise<SyncReply>
}

export interface SyncResult {
  synced: number
  rejected: number
  failed: number
  remaining: number
  stoppedOffline: boolean
  stoppedAuth: boolean
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_SALES)) {
        db.createObjectStore(STORE_SALES, { keyPath: 'clientSaleId' })
      }
      if (!db.objectStoreNames.contains(STORE_CATALOG)) {
        db.createObjectStore(STORE_CATALOG, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function enqueuePendingSale(sale: PendingSale): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SALES, 'readwrite')
    tx.objectStore(STORE_SALES).put(sale)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  notify()
}

export async function listPendingSales(): Promise<PendingSale[]> {
  const db = await openDb()
  const list = await new Promise<PendingSale[]>((resolve, reject) => {
    const tx = db.transaction(STORE_SALES, 'readonly')
    const req = tx.objectStore(STORE_SALES).getAll()
    req.onsuccess = () => resolve(req.result as PendingSale[])
    req.onerror = () => reject(req.error)
  })
  return list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function removePendingSale(clientSaleId: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SALES, 'readwrite')
    tx.objectStore(STORE_SALES).delete(clientSaleId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  notify()
}

async function putPendingSale(sale: PendingSale): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SALES, 'readwrite')
    tx.objectStore(STORE_SALES).put(sale)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const indexedDbSaleStore: PendingSaleStore = {
  list: listPendingSales,
  put: putPendingSale,
  remove: async (id) => {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SALES, 'readwrite')
      tx.objectStore(STORE_SALES).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },
}

export async function saveCatalogSnapshot(items: unknown[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CATALOG, 'readwrite')
    tx.objectStore(STORE_CATALOG).put({
      key: 'items',
      items,
      savedAt: new Date().toISOString(),
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Merge items into the catalog snapshot by id (keeps items from other pages/searches). */
export async function mergeCatalogSnapshot(items: unknown[]): Promise<void> {
  const existing = await loadCatalogSnapshot()
  const byId = new Map<string, unknown>()
  for (const it of existing?.items || []) {
    const id = (it as { id?: string })?.id
    if (id) byId.set(id, it)
  }
  for (const it of items) {
    const id = (it as { id?: string })?.id
    if (id) byId.set(id, it)
  }
  await saveCatalogSnapshot(Array.from(byId.values()))
}

export async function loadCatalogSnapshot(): Promise<{ items: unknown[]; savedAt: string } | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CATALOG, 'readonly')
    const req = tx.objectStore(STORE_CATALOG).get('items')
    req.onsuccess = () => resolve((req.result as { items: unknown[]; savedAt: string }) || null)
    req.onerror = () => reject(req.error)
  })
}

// ==================== Sync loop (store/transport injectable) ====================

function rejectionReport(entry: PendingSale): Record<string, unknown> {
  const p = entry.payload
  const items = Array.isArray(p.cartItems) ? (p.cartItems as unknown[]) : []
  return {
    clientSaleId: entry.clientSaleId,
    offlineRef: entry.offlineRef || undefined,
    error: (entry.lastError || 'Rejected').slice(0, 1000),
    status: entry.lastStatus ?? undefined,
    summary: {
      total: Number(p.total) || 0,
      itemCount: items.length,
      paymentMethod: typeof p.paymentMethod === 'string' ? p.paymentMethod : undefined,
      queuedAt: entry.createdAt,
      warehouseId: typeof p.warehouseId === 'string' ? p.warehouseId : undefined,
    },
  }
}

/**
 * Report a rejected sale once. Returns true when the server says the sale exists after all
 * (the original attempt went through), in which case the caller drops the entry.
 */
async function reportRejection(store: PendingSaleStore, transport: SyncTransport, entry: PendingSale): Promise<boolean> {
  try {
    const res = await transport.reportRejected(rejectionReport(entry))
    if (res.status >= 200 && res.status < 300) {
      const body = res.body as { recorded?: boolean; sale?: { id?: string } } | null
      if (body?.recorded === false && body.sale?.id) {
        await store.remove(entry.clientSaleId)
        return true
      }
      entry.reported = true
      await store.put(entry)
    }
  } catch {
    // offline: report on a later sweep
  }
  return false
}

/**
 * Replay pending sales FIFO. Stops at the first network failure (still offline) or 401.
 * `tenantSlug`: only entries of this company (and legacy entries without one) are replayed.
 */
export async function syncPendingSales(
  transport: SyncTransport,
  opts: { store?: PendingSaleStore; tenantSlug?: string | null; now?: () => number; force?: boolean } = {},
): Promise<SyncResult> {
  const store = opts.store || indexedDbSaleStore
  const now = opts.now || Date.now
  const pending = await store.list()
  const result: SyncResult = { synced: 0, rejected: 0, failed: 0, remaining: 0, stoppedOffline: false, stoppedAuth: false }

  for (const sale of pending) {
    if (opts.tenantSlug && sale.tenantSlug && sale.tenantSlug !== opts.tenantSlug) continue
    if (sale.rejected) {
      if (!sale.reported && (await reportRejection(store, transport, sale))) result.synced++
      continue
    }
    if (!opts.force && sale.nextAttemptAt && sale.nextAttemptAt > now()) {
      result.failed++
      continue
    }

    sale.attempts = (sale.attempts || 0) + 1
    let reply: SyncReply
    try {
      reply = await transport.postSale({ ...sale.payload, clientSaleId: sale.clientSaleId })
      let outcome = classifySyncResponse(reply.status, reply.body, sale.clientSaleId)
      const printed = sale.offlineRef || (typeof sale.payload.offlineRef === 'string' ? sale.payload.offlineRef : null)
      if (outcome.kind === 'ref_conflict' && printed) {
        // Another device printed the same offline number: keep the sale with a unique reference.
        const newRef = conflictOfflineRef(printed, sale.clientSaleId)
        sale.payload = { ...sale.payload, offlineRef: newRef, offlineRefAlias: printed }
        reply = await transport.postSale({ ...sale.payload, clientSaleId: sale.clientSaleId })
        outcome = classifySyncResponse(reply.status, reply.body, sale.clientSaleId)
      }

      if (outcome.kind === 'synced') {
        await store.remove(sale.clientSaleId)
        result.synced++
        continue
      }
      sale.lastError = outcome.error
      sale.lastStatus = reply.status
      if (outcome.kind === 'auth') {
        // Session expired: keep the sale for after the next sign-in.
        sale.attempts -= 1
        await store.put(sale)
        result.stoppedAuth = true
        break
      }
      if (outcome.kind === 'transient' && sale.attempts < MAX_AUTO_ATTEMPTS) {
        sale.nextAttemptAt = now() + backoffMs(sale.attempts)
        await store.put(sale)
        result.failed++
        continue
      }
      // Rejected by the server, an unresolvable ref conflict, or out of retries.
      if (outcome.kind === 'transient') sale.lastError = `${outcome.error} (gave up after ${sale.attempts} attempts)`
      sale.rejected = true
      sale.nextAttemptAt = null
      sale.reported = false
      await store.put(sale)
      result.rejected++
      if (await reportRejection(store, transport, sale)) {
        result.rejected--
        result.synced++
      }
    } catch (error) {
      // Network failure: still offline. Not counted as an attempt.
      sale.attempts -= 1
      sale.lastError = error instanceof Error ? error.message : 'Network error'
      sale.lastStatus = 0
      await store.put(sale)
      result.stoppedOffline = true
      break
    }
  }

  const after = await store.list()
  result.remaining = after.filter((s) => !s.rejected).length
  return result
}

/** Manager action: make a rejected / backed-off sale eligible again. */
export async function resetPendingSale(clientSaleId: string, store: PendingSaleStore = indexedDbSaleStore): Promise<void> {
  const all = await store.list()
  const entry = all.find((s) => s.clientSaleId === clientSaleId)
  if (!entry) return
  entry.rejected = false
  entry.reported = false
  entry.attempts = 0
  entry.nextAttemptAt = null
  await store.put(entry)
}

// ==================== Browser engine (singleton per tab) ====================

export interface OfflineQueueState {
  pending: number
  rejected: number
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
  entries: PendingSale[]
}

let state: OfflineQueueState = { pending: 0, rejected: 0, syncing: false, lastSyncAt: null, lastError: null, entries: [] }
const listeners = new Set<(s: OfflineQueueState) => void>()
let activeTenant: string | null = null
let engineUsers = 0
let intervalTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let running: Promise<SyncResult | null> | null = null

function emit() {
  listeners.forEach((cb) => {
    try { cb(state) } catch { /* ignore listener errors */ }
  })
}

/** Re-read IndexedDB and notify subscribers. */
export async function refreshQueueState(): Promise<OfflineQueueState> {
  try {
    const list = await listPendingSales()
    const visible = list.filter((s) => !activeTenant || !s.tenantSlug || s.tenantSlug === activeTenant)
    state = {
      ...state,
      entries: visible,
      pending: visible.filter((s) => !s.rejected).length,
      rejected: visible.filter((s) => s.rejected).length,
    }
    emit()
    scheduleRetry(visible)
  } catch {
    // IndexedDB unavailable
  }
  return state
}

function notify() {
  if (typeof window !== 'undefined') void refreshQueueState()
}

export function subscribeQueue(cb: (s: OfflineQueueState) => void): () => void {
  listeners.add(cb)
  cb(state)
  return () => { listeners.delete(cb) }
}

export function getQueueState(): OfflineQueueState {
  return state
}

async function readReply(res: Response): Promise<SyncReply> {
  let body: unknown = null
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body }
}

const browserTransport: SyncTransport = {
  postSale: async (payload) => readReply(await fetch('/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })),
  reportRejected: async (report) => readReply(await fetch('/api/sales/offline-rejected', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  })),
}

function scheduleRetry(entries: PendingSale[]) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (engineUsers === 0) return
  const next = entries.filter((s) => !s.rejected && s.nextAttemptAt).map((s) => s.nextAttemptAt as number)
  if (next.length === 0) return
  const wait = Math.max(1_000, Math.min(...next) - Date.now())
  retryTimer = setTimeout(() => {
    retryTimer = null
    void syncNow()
  }, wait)
}

/** Run one sync pass (no-op while another pass runs in this tab or, via Web Locks, another tab). */
export async function syncNow(opts: { force?: boolean } = {}): Promise<SyncResult | null> {
  if (running) return running
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  const pass = async (): Promise<SyncResult | null> => {
    state = { ...state, syncing: true }
    emit()
    try {
      const result = await syncPendingSales(browserTransport, { tenantSlug: activeTenant, force: opts.force })
      state = {
        ...state,
        lastSyncAt: new Date().toISOString(),
        lastError: result.stoppedOffline ? 'Server unreachable' : result.stoppedAuth ? 'Signed out — sign in to sync' : null,
      }
      return result
    } catch (error) {
      state = { ...state, lastError: error instanceof Error ? error.message : 'Sync failed' }
      return null
    } finally {
      state = { ...state, syncing: false }
      await refreshQueueState()
    }
  }
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  const task: Promise<SyncResult | null> = locks
    ? (locks.request('poslanka-offline-sync', { ifAvailable: true }, async (lock) => (lock ? pass() : null)) as unknown as Promise<SyncResult | null>)
    : pass()
  running = task.finally(() => { running = null })
  return running
}

/** Manager action from the failed-sales list: retry one sale now. */
export async function retryPendingSale(clientSaleId: string): Promise<SyncResult | null> {
  await resetPendingSale(clientSaleId)
  await refreshQueueState()
  return syncNow({ force: true })
}

/** Manager action: drop a sale from this device (it is NOT recorded on the server). */
export async function discardPendingSale(clientSaleId: string): Promise<void> {
  await removePendingSale(clientSaleId)
}

function onOnline() {
  void syncNow({ force: true })
}

function onVisible() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') void syncNow()
}

/** Start the shared engine (reference counted). Returns a stop function. */
export function startOfflineSync(tenantSlug: string | null): () => void {
  if (tenantSlug !== undefined) activeTenant = tenantSlug
  engineUsers++
  if (engineUsers === 1 && typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    intervalTimer = setInterval(() => {
      if (state.pending > 0 || state.entries.some((s) => s.rejected && !s.reported)) void syncNow()
    }, SYNC_INTERVAL_MS)
  }
  void refreshQueueState().then((s) => {
    if (s.pending > 0 || s.entries.some((e) => e.rejected && !e.reported)) void syncNow()
  })
  return () => {
    engineUsers = Math.max(0, engineUsers - 1)
    if (engineUsers === 0 && typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      if (intervalTimer) clearInterval(intervalTimer)
      intervalTimer = null
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
    }
  }
}
