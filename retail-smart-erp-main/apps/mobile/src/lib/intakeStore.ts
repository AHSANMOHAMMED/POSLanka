// Local-first stock intake: batches and scanned lines are written to a JSON
// file first (so nothing is lost when the network is down) and uploaded to
// /api/stock-intake as soon as the server is reachable. Uploads are idempotent:
// the server keys batches on clientBatchId and lines on clientLineId, so a
// retried upload never double-counts. Uploaded lines are pruned locally (the
// server is then the source of truth).
import * as FileSystem from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { apiPost, isNetworkError } from './api'
import { isTransientStatus } from './httpStatus'

export type IntakeMode = 'receive' | 'count'

export interface LocalIntakeLine {
  clientLineId: string
  mode: IntakeMode
  barcode?: string | null
  itemId?: string | null
  quantity: number
  name?: string | null
  sellingPrice?: number | null
  costPrice?: number | null
  scannedAt: string
  /** the server rejected THIS line (validation); other lines keep uploading */
  rejected?: boolean
  error?: string | null
}

export interface LocalIntakeBatch {
  clientBatchId: string
  /** server id once the batch exists on the server */
  serverId?: string | null
  batchNo?: string | null
  warehouseId: string
  warehouseName?: string | null
  notes?: string | null
  createdAt: string
  /** scans not yet confirmed by the server */
  lines: LocalIntakeLine[]
  lastError?: string | null
  /** set when the server rejected the batch itself (e.g. creation 4xx, batch closed); needs user attention */
  rejected?: boolean
}

export interface IntakeStoreState {
  batches: LocalIntakeBatch[]
  pendingLines: number
  uploading: boolean
  online: boolean
}

const FILE = `${FileSystem.documentDirectory || ''}poslanka-intake.json`
const MAX_LINES_PER_REQUEST = 500

let batches: LocalIntakeBatch[] | null = null
let loading: Promise<LocalIntakeBatch[]> | null = null
let uploading = false
let online = true
let autoStarted = false
const listeners = new Set<(s: IntakeStoreState) => void>()

export function newId(): string {
  return Crypto.randomUUID()
}

function snapshot(): IntakeStoreState {
  const list = batches || []
  return {
    batches: list.map((b) => ({ ...b, lines: [...b.lines] })),
    pendingLines: list.reduce((n, b) => n + b.lines.filter((l) => !l.rejected).length, 0),
    uploading,
    online,
  }
}

function notify() {
  const s = snapshot()
  listeners.forEach((cb) => {
    try {
      cb(s)
    } catch {
      // ignore listener errors
    }
  })
}

async function load(): Promise<LocalIntakeBatch[]> {
  if (batches) return batches
  if (loading) return loading
  loading = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(FILE)
      if (!info.exists) {
        batches = []
      } else {
        const parsed = JSON.parse(await FileSystem.readAsStringAsync(FILE))
        batches = Array.isArray(parsed) ? parsed : []
      }
    } catch {
      batches = []
    }
    loading = null
    return batches!
  })()
  return loading
}

async function persist() {
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(batches || []))
  } catch {
    // keep in memory; next write retries
  }
  notify()
}

export function subscribeIntake(cb: (s: IntakeStoreState) => void): () => void {
  listeners.add(cb)
  load().then(() => cb(snapshot()))
  return () => {
    listeners.delete(cb)
  }
}

export async function getLocalBatch(clientBatchId: string): Promise<LocalIntakeBatch | undefined> {
  return (await load()).find((b) => b.clientBatchId === clientBatchId)
}

export async function createLocalBatch(input: { warehouseId: string; warehouseName?: string | null; notes?: string | null }): Promise<LocalIntakeBatch> {
  const list = await load()
  const batch: LocalIntakeBatch = {
    clientBatchId: newId(),
    warehouseId: input.warehouseId,
    warehouseName: input.warehouseName || null,
    notes: input.notes || null,
    createdAt: new Date().toISOString(),
    lines: [],
  }
  list.unshift(batch)
  await persist()
  return batch
}

/** Track a batch that already exists on the server (opened from the server list). */
export async function adoptServerBatch(server: { id: string; batchNo: string; warehouseId: string; warehouseName?: string | null; clientBatchId?: string | null }): Promise<LocalIntakeBatch> {
  const list = await load()
  const existing = list.find((b) => b.serverId === server.id || (server.clientBatchId && b.clientBatchId === server.clientBatchId))
  if (existing) return existing
  const batch: LocalIntakeBatch = {
    clientBatchId: server.clientBatchId || newId(),
    serverId: server.id,
    batchNo: server.batchNo,
    warehouseId: server.warehouseId,
    warehouseName: server.warehouseName || null,
    createdAt: new Date().toISOString(),
    lines: [],
  }
  list.unshift(batch)
  await persist()
  return batch
}

export async function addLocalLine(clientBatchId: string, line: Omit<LocalIntakeLine, 'clientLineId' | 'scannedAt'>): Promise<LocalIntakeLine> {
  const b = await getLocalBatch(clientBatchId)
  if (!b) throw new Error('Batch not found on this device')
  const entry: LocalIntakeLine = { ...line, clientLineId: newId(), scannedAt: new Date().toISOString() }
  b.lines.push(entry)
  await persist()
  return entry
}

export async function removeLocalLine(clientBatchId: string, clientLineId: string) {
  const b = await getLocalBatch(clientBatchId)
  if (!b) return
  b.lines = b.lines.filter((l) => l.clientLineId !== clientLineId)
  await persist()
}

/** Clear a rejected line's error so the next upload tries it again (e.g. after creating the item). */
export async function retryLocalLine(clientBatchId: string, clientLineId: string) {
  const b = await getLocalBatch(clientBatchId)
  const l = b?.lines.find((x) => x.clientLineId === clientLineId)
  if (!b || !l) return
  l.rejected = false
  l.error = null
  b.rejected = false
  await persist()
}

/** Forget a batch on this device (does not touch the server). */
export async function forgetLocalBatch(clientBatchId: string) {
  const list = await load()
  const idx = list.findIndex((b) => b.clientBatchId === clientBatchId)
  if (idx >= 0) {
    list.splice(idx, 1)
    await persist()
  }
}

export interface UploadOutcome {
  ok: boolean
  serverId?: string
  uploaded?: number
  /** the server could not be reached (scans stay on the device) */
  offline?: boolean
  error?: string
  /** lines rejected by the server during this upload (kept on the device with their error) */
  newlyRejected?: number
  /** rejected lines still waiting on the device */
  rejectedLines?: number
}

const uploadsInFlight = new Map<string, Promise<UploadOutcome>>()

/**
 * Create the server batch if needed, then push all unconfirmed lines. Calls for the same batch
 * share one run (Sync button + auto-sync on reconnect), so lines are never sent twice in parallel
 * and the batch is never created twice.
 */
export function uploadBatch(clientBatchId: string): Promise<UploadOutcome> {
  const running = uploadsInFlight.get(clientBatchId)
  if (running) return running
  const p = runUploadBatch(clientBatchId).finally(() => uploadsInFlight.delete(clientBatchId))
  uploadsInFlight.set(clientBatchId, p)
  return p
}

async function runUploadBatch(clientBatchId: string): Promise<UploadOutcome> {
  const b = await getLocalBatch(clientBatchId)
  if (!b) return { ok: false, offline: false, error: 'Batch not found on this device' }

  if (!b.serverId) {
    const res = await apiPost<{ id: string; batchNo: string }>('/api/stock-intake', {
      warehouseId: b.warehouseId,
      notes: b.notes || undefined,
      clientBatchId: b.clientBatchId,
      source: 'mobile',
    })
    if (!res.ok) {
      const offline = isNetworkError(res)
      b.lastError = res.error
      // 5xx / 408 / 429 / 401 are retried later; only a real 4xx refusal needs the user.
      if (!isTransientStatus(res.status) && res.status !== 401) b.rejected = true
      if (offline) online = false
      await persist()
      return { ok: false, offline, error: res.error }
    }
    b.serverId = res.data.id
    b.batchNo = res.data.batchNo
    b.lastError = null
    online = true
    await persist()
  }

  let uploaded = 0
  let lineErrors = 0
  const toWire = (l: LocalIntakeLine) => ({
    clientLineId: l.clientLineId,
    mode: l.mode,
    barcode: l.barcode || undefined,
    itemId: l.itemId || undefined,
    quantity: l.quantity,
    name: l.name || undefined,
    sellingPrice: l.sellingPrice ?? undefined,
    costPrice: l.costPrice ?? undefined,
  })
  const markDone = (ids: Set<string>) => {
    b.lines = b.lines.filter((l) => !ids.has(l.clientLineId))
  }
  // Errors that concern the whole batch (not one line): stop and keep every line.
  const isBatchLevel = (status: number) => status === 401 || status === 403 || status === 404 || status === 409

  for (;;) {
    const chunk = b.lines.filter((l) => !l.rejected).slice(0, MAX_LINES_PER_REQUEST)
    if (chunk.length === 0) break
    const res = await apiPost(`/api/stock-intake/${b.serverId}/lines`, { lines: chunk.map(toWire) })
    if (res.ok) {
      markDone(new Set(chunk.map((l) => l.clientLineId)))
      uploaded += chunk.length
      b.lastError = null
      b.rejected = false
      online = true
      await persist()
      continue
    }
    const offline = isNetworkError(res)
    if (offline || isBatchLevel(res.status) || isTransientStatus(res.status) || chunk.length === 1) {
      if (chunk.length === 1 && !offline && !isBatchLevel(res.status) && !isTransientStatus(res.status)) {
        // a single bad line: mark it and carry on with the rest
        chunk[0].rejected = true
        chunk[0].error = res.error
        lineErrors++
        await persist()
        continue
      }
      b.lastError = res.error
      if (offline) online = false
      // closed / missing batch needs the user; 409 "being synced" and 5xx are retried later
      if (!offline && (res.status === 403 || res.status === 404 || (res.status === 409 && !/sync/i.test(res.error || '')))) b.rejected = true
      await persist()
      return { ok: false, offline, error: res.error }
    }
    // Validation failure somewhere in the chunk: upload line by line so only the bad lines stay.
    for (const l of chunk) {
      const one = await apiPost(`/api/stock-intake/${b.serverId}/lines`, { lines: [toWire(l)] })
      if (one.ok) {
        markDone(new Set([l.clientLineId]))
        uploaded++
        continue
      }
      if (isNetworkError(one) || isBatchLevel(one.status) || isTransientStatus(one.status)) {
        b.lastError = one.error
        if (isNetworkError(one)) online = false
        await persist()
        return { ok: false, offline: isNetworkError(one), error: one.error }
      }
      l.rejected = true
      l.error = one.error
      lineErrors++
    }
    online = true
    await persist()
  }
  const remainingBad = b.lines.filter((l) => l.rejected).length
  b.lastError = remainingBad > 0 ? `${remainingBad} scan(s) were rejected — fix or remove them` : null
  await persist()
  // Good lines are on the server; rejected ones stay visible on the device with their error.
  return { ok: true, serverId: b.serverId!, uploaded, newlyRejected: lineErrors, rejectedLines: remainingBad, error: b.lastError || undefined }
}

/** Upload every batch with unconfirmed work (skips ones the server rejected). */
export async function uploadAllPending(): Promise<void> {
  if (uploading) return
  uploading = true
  notify()
  try {
    const list = await load()
    for (const b of [...list]) {
      if (b.rejected) continue
      if (b.serverId && b.lines.every((l) => l.rejected)) continue
      const r = await uploadBatch(b.clientBatchId)
      if (!r.ok && r.offline) break
    }
  } finally {
    uploading = false
    notify()
  }
}

/** Upload pending intake work whenever connectivity returns. Safe to call more than once. */
export function startIntakeAutoSync() {
  if (autoStarted) return
  autoStarted = true
  NetInfo.addEventListener((state: NetInfoState) => {
    const now = !!state.isConnected && state.isInternetReachable !== false
    const wasOffline = !online
    online = now
    notify()
    if (now && wasOffline) void uploadAllPending()
  })
  void load().then(() => uploadAllPending())
}
