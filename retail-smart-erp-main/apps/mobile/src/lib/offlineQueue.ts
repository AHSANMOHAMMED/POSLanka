// Offline sale queue: when POST /api/sales cannot reach the server (or the device already knows it
// is offline), the payload is persisted to a JSON file and replayed as soon as connectivity
// returns. The server is idempotent on `clientSaleId` and on `offlineRef` (OFF-<device>-<seq>,
// printed on the customer's receipt), so a sale that actually reached the server is returned again.
//
// W6:
// - entries carry the tenant they were sold for and are only replayed while that tenant is signed in;
// - 4xx rejections are kept with the server's error ("Needs attention": Retry / Discard) and are
//   reported once to POST /api/sales/offline-rejected so managers are alerted;
// - 5xx / timeouts back off exponentially (5 s → 10 min) instead of hammering the server;
// - successful replays are kept in a short "Synced sales" history mapping the offline receipt
//   number to the real invoice number.
import * as FileSystem from 'expo-file-system'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { apiPost, getUser, isNetworkError } from './api'
import { conflictOfflineRef } from './offlineRef'

export interface QueuedSale {
  clientSaleId: string
  payload: Record<string, unknown>
  queuedAt: string
  attempts: number
  lastError?: string | null
  lastStatus?: number | null
  /** Set once the server has rejected the sale (4xx); it is no longer retried automatically. */
  rejected?: boolean
  /** Tenant the sale belongs to (only replayed while that tenant is signed in). */
  tenantSlug?: string | null
  /** OFF-<device>-<seq> printed on the receipt */
  offlineRef?: string | null
  /** epoch ms before which a transient failure is not retried */
  nextAttemptAt?: number | null
  /** the rejection was reported to the server (manager alert) */
  reported?: boolean
}

export interface SyncedSale {
  clientSaleId: string
  offlineRef: string | null
  invoiceNo: string
  saleId: string | null
  total: number
  queuedAt: string
  syncedAt: string
  tenantSlug?: string | null
}

export interface QueueState {
  pending: number
  rejected: number
  syncing: boolean
  online: boolean
  lastSyncAt: string | null
  lastError: string | null
  /** recently synced offline sales (newest first) */
  synced: number
}

const FILE = `${FileSystem.documentDirectory || ''}poslanka-sales-queue.json`
const SYNCED_FILE = `${FileSystem.documentDirectory || ''}poslanka-sales-synced.json`
const MAX_AUTO_ATTEMPTS = 20
const MAX_SYNCED_HISTORY = 100
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 10 * 60_000

let queue: QueuedSale[] | null = null
let synced: SyncedSale[] = []
let loading: Promise<QueuedSale[]> | null = null
let syncing = false
let online = true
let lastSyncAt: string | null = null
let lastError: string | null = null
let autoSyncStarted = false
let unsubscribeNetInfo: (() => void) | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(state: QueueState) => void>()

function snapshot(): QueueState {
  const q = queue || []
  return {
    pending: q.filter((s) => !s.rejected).length,
    rejected: q.filter((s) => s.rejected).length,
    syncing,
    online,
    lastSyncAt,
    lastError,
    synced: synced.length,
  }
}

function notify() {
  const state = snapshot()
  listeners.forEach((cb) => {
    try {
      cb(state)
    } catch {
      // ignore listener errors
    }
  })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const info = await FileSystem.getInfoAsync(file)
    if (!info.exists) return fallback
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(file))
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

async function load(): Promise<QueuedSale[]> {
  if (queue) return queue
  if (loading) return loading
  loading = (async () => {
    const parsed = await readJson<unknown>(FILE, [])
    queue = Array.isArray(parsed) ? (parsed as QueuedSale[]) : []
    const hist = await readJson<unknown>(SYNCED_FILE, [])
    synced = Array.isArray(hist) ? (hist as SyncedSale[]) : []
    loading = null
    return queue!
  })()
  return loading
}

async function persist() {
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(queue || []))
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'Failed to persist offline queue'
  }
  notify()
}

async function persistSynced() {
  try {
    await FileSystem.writeAsStringAsync(SYNCED_FILE, JSON.stringify(synced))
  } catch {
    // history is informational only
  }
}

export function subscribe(cb: (state: QueueState) => void): () => void {
  listeners.add(cb)
  load().then(() => cb(snapshot()))
  return () => {
    listeners.delete(cb)
  }
}

export function getQueueState(): QueueState {
  return snapshot()
}

export async function getQueuedSales(): Promise<QueuedSale[]> {
  return [...(await load())]
}

export async function getSyncedSales(): Promise<SyncedSale[]> {
  await load()
  return [...synced]
}

/** Methods that are safe to complete later. Credit / gift card / loyalty sales must never be queued. */
export function isQueueablePayload(payload: Record<string, unknown>): boolean {
  const method = payload.paymentMethod as string | undefined
  const splits = payload.paymentSplits as Array<{ method: string }> | undefined
  const methods = splits?.length ? splits.map((s) => s.method) : method ? [method] : []
  if (methods.length === 0) return false
  if (methods.some((m) => m === 'credit' || m === 'gift_card')) return false
  if (payload.giftCardId) return false
  if (Number(payload.loyaltyPointsRedeemed || 0) > 0) return false
  if (Number(payload.creditAmount || 0) > 0) return false
  return true
}

export async function enqueueSale(payload: Record<string, unknown>): Promise<QueuedSale> {
  const q = await load()
  const clientSaleId = String(payload.clientSaleId)
  const existing = q.find((s) => s.clientSaleId === clientSaleId)
  if (existing) return existing
  const user = await getUser()
  const entry: QueuedSale = {
    clientSaleId,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    tenantSlug: user?.tenantSlug || null,
    offlineRef: typeof payload.offlineRef === 'string' ? payload.offlineRef : null,
  }
  q.push(entry)
  await persist()
  return entry
}

export async function removeQueuedSale(clientSaleId: string) {
  const q = await load()
  const idx = q.findIndex((s) => s.clientSaleId === clientSaleId)
  if (idx >= 0) {
    q.splice(idx, 1)
    await persist()
  }
}

/** Manager action: drop a rejected sale from this device (it is NOT recorded on the server). */
export const discardRejected = removeQueuedSale

/** Retry one rejected sale (e.g. after fixing stock / the item on the server). */
export async function retryOne(clientSaleId: string): Promise<SyncResult> {
  const q = await load()
  const entry = q.find((s) => s.clientSaleId === clientSaleId)
  if (entry) {
    entry.rejected = false
    entry.attempts = 0
    entry.nextAttemptAt = null
    await persist()
  }
  return syncNow()
}

export async function retryRejected() {
  const q = await load()
  for (const s of q) {
    if (s.rejected) {
      s.rejected = false
      s.attempts = 0
      s.nextAttemptAt = null
    }
  }
  await persist()
  return syncNow()
}

export interface SyncResult {
  synced: number
  rejected: number
  remaining: number
  stoppedOffline: boolean
}

function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1)))
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  const q = queue || []
  const next = q.filter((s) => !s.rejected && s.nextAttemptAt).map((s) => s.nextAttemptAt as number)
  if (next.length === 0) return
  const wait = Math.max(1_000, Math.min(...next) - Date.now())
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (online) syncNow().catch(() => undefined)
  }, wait)
}

async function reportRejection(entry: QueuedSale) {
  const p = entry.payload
  const items = Array.isArray(p.cartItems) ? (p.cartItems as unknown[]) : []
  const res = await apiPost('/api/sales/offline-rejected', {
    clientSaleId: entry.clientSaleId,
    offlineRef: entry.offlineRef || undefined,
    error: (entry.lastError || 'Rejected').slice(0, 1000),
    status: entry.lastStatus ?? undefined,
    summary: {
      total: Number(p.total) || 0,
      itemCount: items.length,
      paymentMethod: typeof p.paymentMethod === 'string' ? p.paymentMethod : undefined,
      queuedAt: entry.queuedAt,
      warehouseId: typeof p.warehouseId === 'string' ? p.warehouseId : undefined,
    },
  })
  if (res.ok) entry.reported = true
}

function recordSynced(entry: QueuedSale, sale: any) {
  synced.unshift({
    clientSaleId: entry.clientSaleId,
    offlineRef: entry.offlineRef || null,
    invoiceNo: String(sale?.invoiceNo || '—'),
    saleId: sale?.id ? String(sale.id) : null,
    total: Number(sale?.total ?? entry.payload.total) || 0,
    queuedAt: entry.queuedAt,
    syncedAt: new Date().toISOString(),
    tenantSlug: entry.tenantSlug || null,
  })
  if (synced.length > MAX_SYNCED_HISTORY) synced = synced.slice(0, MAX_SYNCED_HISTORY)
}

/** Replays the queue FIFO. Stops at the first network failure (still offline). */
export async function syncNow(): Promise<SyncResult> {
  const q = await load()
  if (syncing) return { synced: 0, rejected: 0, remaining: q.filter((s) => !s.rejected).length, stoppedOffline: false }
  syncing = true
  lastError = null
  notify()

  let syncedCount = 0
  let rejected = 0
  let stoppedOffline = false
  const tenantSlug = (await getUser())?.tenantSlug || null

  try {
    for (const entry of [...q]) {
      // Another tenant's sale (shared phone): wait until that tenant signs in again.
      if (entry.tenantSlug && tenantSlug && entry.tenantSlug !== tenantSlug) continue
      if (entry.rejected) {
        if (!entry.reported) await reportRejection(entry).catch(() => undefined)
        continue
      }
      if (entry.nextAttemptAt && entry.nextAttemptAt > Date.now()) continue
      entry.attempts += 1
      let res = await apiPost<any>('/api/sales', entry.payload)

      // Another device printed the same OFF- number (device-code collision): keep the sale with a
      // unique reference instead of losing it. The number printed on the customer's receipt stays
      // in entry.offlineRef and is sent as offlineRefAlias (sales.flags) so lookups / returns by
      // the printed number still find the sale.
      if (!res.ok && res.status === 409 && /OFFLINE_REF_CONFLICT|already used/i.test(res.error || '') && entry.offlineRef) {
        const newRef = conflictOfflineRef(entry.offlineRef, entry.clientSaleId)
        entry.payload = { ...entry.payload, offlineRef: newRef, offlineRefAlias: entry.offlineRef }
        res = await apiPost<any>('/api/sales', entry.payload)
      }

      if (res.ok) {
        const idx = q.indexOf(entry)
        if (idx >= 0) q.splice(idx, 1)
        recordSynced(entry, res.data)
        syncedCount += 1
        await persistSynced()
        await persist()
        continue
      }
      entry.lastError = res.error
      entry.lastStatus = res.status
      if (isNetworkError(res)) {
        stoppedOffline = true
        online = false
        await persist()
        break
      }
      if (res.status === 401) {
        // Session expired; apiFetch already redirected to login. Keep the entry for after re-login.
        await persist()
        break
      }
      const transient = res.status >= 500 || res.status === 408 || res.status === 429
      if (!transient) {
        entry.rejected = true
        entry.nextAttemptAt = null
        rejected += 1
        await reportRejection(entry).catch(() => undefined)
      } else if (entry.attempts >= MAX_AUTO_ATTEMPTS) {
        entry.rejected = true
        entry.nextAttemptAt = null
        rejected += 1
        await reportRejection(entry).catch(() => undefined)
      } else {
        entry.nextAttemptAt = Date.now() + backoffMs(entry.attempts)
      }
      await persist()
    }
    if (!stoppedOffline) online = true
    lastSyncAt = new Date().toISOString()
  } finally {
    syncing = false
    notify()
    scheduleRetry()
  }

  return { synced: syncedCount, rejected, remaining: q.filter((s) => !s.rejected).length, stoppedOffline }
}

function isReachable(state: NetInfoState): boolean {
  return Boolean(state.isConnected) && state.isInternetReachable !== false
}

/** Call once (root layout). Listens for connectivity and replays the queue when back online. */
export function startAutoSync() {
  if (autoSyncStarted) return
  autoSyncStarted = true
  unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    const reachable = isReachable(state)
    const wasOnline = online
    online = reachable
    notify()
    if (reachable && (!wasOnline || snapshot().pending > 0)) {
      // Back online: transient back-off no longer applies.
      for (const s of queue || []) if (!wasOnline) s.nextAttemptAt = null
      syncNow().catch(() => undefined)
    }
  })
  load().then((q) => {
    if (q.some((s) => !s.rejected || !s.reported)) syncNow().catch(() => undefined)
  })
}

export function stopAutoSync() {
  unsubscribeNetInfo?.()
  unsubscribeNetInfo = null
  autoSyncStarted = false
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
}

export function isOnline() {
  return online
}
