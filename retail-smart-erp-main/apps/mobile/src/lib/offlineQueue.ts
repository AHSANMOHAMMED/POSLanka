// Offline sale queue: when POST /api/sales fails because the network is down
// (not a 4xx/5xx), the payload is persisted to a JSON file and retried FIFO as
// soon as connectivity returns. The server is idempotent on `clientSaleId`, so a
// sale that actually reached the server is simply returned again on retry.
import * as FileSystem from 'expo-file-system'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { apiPost, isNetworkError } from './api'

export interface QueuedSale {
  clientSaleId: string
  payload: Record<string, unknown>
  queuedAt: string
  attempts: number
  lastError?: string | null
  /** Set once the server has rejected the sale (4xx/5xx); it is no longer retried automatically. */
  rejected?: boolean
}

export interface QueueState {
  pending: number
  rejected: number
  syncing: boolean
  online: boolean
  lastSyncAt: string | null
  lastError: string | null
}

const FILE = `${FileSystem.documentDirectory || ''}poslanka-sales-queue.json`
const MAX_AUTO_ATTEMPTS = 20

let queue: QueuedSale[] | null = null
let loading: Promise<QueuedSale[]> | null = null
let syncing = false
let online = true
let lastSyncAt: string | null = null
let lastError: string | null = null
let autoSyncStarted = false
let unsubscribeNetInfo: (() => void) | null = null
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

async function load(): Promise<QueuedSale[]> {
  if (queue) return queue
  if (loading) return loading
  loading = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(FILE)
      if (!info.exists) {
        queue = []
      } else {
        const raw = await FileSystem.readAsStringAsync(FILE)
        const parsed = JSON.parse(raw)
        queue = Array.isArray(parsed) ? parsed : []
      }
    } catch {
      queue = []
    }
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
  const entry: QueuedSale = { clientSaleId, payload, queuedAt: new Date().toISOString(), attempts: 0, lastError: null }
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

export async function retryRejected() {
  const q = await load()
  for (const s of q) {
    if (s.rejected) {
      s.rejected = false
      s.attempts = 0
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

/** Replays the queue FIFO. Stops at the first network failure (still offline). */
export async function syncNow(): Promise<SyncResult> {
  const q = await load()
  if (syncing) return { synced: 0, rejected: 0, remaining: q.filter((s) => !s.rejected).length, stoppedOffline: false }
  syncing = true
  lastError = null
  notify()

  let synced = 0
  let rejected = 0
  let stoppedOffline = false

  try {
    for (const entry of [...q]) {
      if (entry.rejected) continue
      entry.attempts += 1
      const res = await apiPost('/api/sales', entry.payload)
      if (res.ok) {
        const idx = q.indexOf(entry)
        if (idx >= 0) q.splice(idx, 1)
        synced += 1
        await persist()
        continue
      }
      if (isNetworkError(res)) {
        entry.lastError = res.error
        stoppedOffline = true
        online = false
        await persist()
        break
      }
      if (res.status === 401) {
        // Session expired; apiFetch already redirected to login. Keep the entry for after re-login.
        entry.lastError = res.error
        await persist()
        break
      }
      entry.lastError = res.error
      if (res.status >= 400 && res.status < 500) {
        entry.rejected = true
        rejected += 1
      } else if (entry.attempts >= MAX_AUTO_ATTEMPTS) {
        entry.rejected = true
        rejected += 1
      }
      await persist()
    }
    if (!stoppedOffline) online = true
    lastSyncAt = new Date().toISOString()
  } finally {
    syncing = false
    notify()
  }

  return { synced, rejected, remaining: q.filter((s) => !s.rejected).length, stoppedOffline }
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
      syncNow().catch(() => undefined)
    }
  })
  load().then((q) => {
    if (q.some((s) => !s.rejected)) syncNow().catch(() => undefined)
  })
}

export function stopAutoSync() {
  unsubscribeNetInfo?.()
  unsubscribeNetInfo = null
  autoSyncStarted = false
}

export function isOnline() {
  return online
}
