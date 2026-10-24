// W6 offline catalog: a local SQLite copy of the items a POS device sells, kept fresh with
// GET /api/items/sync (keyset delta: price/name changes, stock movements, deletions) and the
// offline bundle (GET /api/pos/offline-bundle: tax templates, scale-label layout, open shift,
// categories). Search and scanning read this database first, so they are instant and keep
// working during a power cut.
//
// Isolation: one catalog database per tenant + warehouse (file name), so vendors and branches
// never mix on a shared phone. Device-level state (offline receipt sequence, bundles keyed by
// tenant + user) lives in a separate small database.
import * as SQLite from 'expo-sqlite'
import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { apiGet, getUser, qs } from './api'
import { analyseScan, normalizeScaleConfig, type ScaleBarcodeConfig, type ScanAnalysis } from './barcodeParse'
import { buildExtraBarcodeIndex, extraBarcodeScan, type ExtraBarcode, type OfflinePricingBundle } from './catalogUnits'
import { getQueuedSales } from './offlineQueue'
import { pendingStockFromQueue, recomputeLocalStock } from './pendingStock'
import { formatOfflineRef } from './offlineRef'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface LocalItem {
  id: string
  itemCode: string
  name: string
  barcode: string | null
  pluCode: string | null
  genericName?: string | null
  sku: string | null
  sellingPrice: string
  taxTemplateId: string | null
  unit: string | null
  isWeighable: boolean
  trackStock: boolean
  trackSerialNumbers: boolean
  isGiftCard: boolean
  categoryId: string | null
  categoryName: string | null
  imageUrl: string | null
  availableStock: number | null
  isActive: boolean
  updatedAt: string
}

export interface OfflineBundleTaxTemplate {
  id: string
  name: string
  isActive: boolean
  items: Array<{ taxName: string; rate: string | number; accountId: string | null; includedInPrice: boolean }>
}

export interface OfflineBundle {
  taxTemplates: OfflineBundleTaxTemplate[]
  accountingSettings: { defaultTaxTemplateId: string | null }
  scaleBarcode: Partial<ScaleBarcodeConfig> | null
  shift: any | null
  posProfile: any | null
  categories: Array<{ id: string; name: string; parentId?: string | null }>
  serverTime: string
  /** device time when the bundle was saved */
  savedAt?: string
  /** false for a device-made stub that only carries the cached shift (no tax data yet) */
  complete?: boolean
  /** H5: price lists, promotions, units, unit conversions and additional barcodes (newer servers) */
  pricing?: OfflinePricingBundle
}

interface SyncPage {
  items: LocalItem[]
  deleted: string[]
  nextCursor: string
  hasMore: boolean
  full: boolean
  serverTime: string
}

export interface CatalogStatus {
  key: string | null
  itemCount: number
  lastSyncAt: string | null
  lastFullSyncAt: string | null
  syncing: boolean
  error: string | null
}

// ---------------------------------------------------------------------------
// Database handles
// ---------------------------------------------------------------------------
const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY NOT NULL,
  item_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  name_lc TEXT NOT NULL,
  barcode TEXT,
  plu_code TEXT,
  sku TEXT,
  selling_price TEXT NOT NULL DEFAULT '0',
  tax_template_id TEXT,
  unit TEXT,
  is_weighable INTEGER NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 1,
  track_serial INTEGER NOT NULL DEFAULT 0,
  is_gift_card INTEGER NOT NULL DEFAULT 0,
  category_id TEXT,
  category_name TEXT,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  sync_gen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
CREATE INDEX IF NOT EXISTS idx_items_plu ON items(plu_code);
CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku);
CREATE INDEX IF NOT EXISTS idx_items_code ON items(item_code);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name_lc);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE TABLE IF NOT EXISTS stock (
  item_id TEXT PRIMARY KEY NOT NULL,
  available REAL
);
CREATE TABLE IF NOT EXISTS stock_server (
  item_id TEXT PRIMARY KEY NOT NULL,
  available REAL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
`

const DEVICE_SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS offline_seq (
  scope TEXT PRIMARY KEY NOT NULL,
  seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
`

let deviceDb: Promise<SQLite.SQLiteDatabase> | null = null
const catalogDbs = new Map<string, Promise<SQLite.SQLiteDatabase>>()

function safePart(s: string): string {
  return String(s || 'x').toLowerCase().replace(/[^a-z0-9-]/g, '_').slice(0, 60)
}

export function catalogKey(tenantSlug: string, warehouseId: string): string {
  return `${safePart(tenantSlug)}__${safePart(warehouseId)}`
}

function getDeviceDb(): Promise<SQLite.SQLiteDatabase> {
  if (!deviceDb) {
    deviceDb = (async () => {
      const db = await SQLite.openDatabaseAsync('poslanka-device.db')
      await db.execAsync(DEVICE_SCHEMA)
      return db
    })()
    deviceDb.catch(() => {
      deviceDb = null
    })
  }
  return deviceDb
}

export function openCatalog(tenantSlug: string, warehouseId: string): Promise<SQLite.SQLiteDatabase> {
  const key = catalogKey(tenantSlug, warehouseId)
  let p = catalogDbs.get(key)
  if (!p) {
    p = (async () => {
      const db = await SQLite.openDatabaseAsync(`poslanka-catalog-${key}.db`)
      await db.execAsync(SCHEMA)
      return db
    })()
    p.catch(() => catalogDbs.delete(key))
    catalogDbs.set(key, p)
  }
  return p
}

async function getMeta(db: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', key)
  return row?.value ?? null
}

async function setMeta(db: SQLite.SQLiteDatabase, key: string, value: string | null): Promise<void> {
  if (value === null) await db.runAsync('DELETE FROM meta WHERE key = ?', key)
  else await db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
}

// ---------------------------------------------------------------------------
// Active catalog (the POS screen's tenant + warehouse) and status listeners
// ---------------------------------------------------------------------------
let active: { tenantSlug: string; warehouseId: string } | null = null
let status: CatalogStatus = { key: null, itemCount: 0, lastSyncAt: null, lastFullSyncAt: null, syncing: false, error: null }
const listeners = new Set<(s: CatalogStatus) => void>()

function emit(patch: Partial<CatalogStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((cb) => {
    try {
      cb(status)
    } catch {
      // ignore listener errors
    }
  })
}

export function subscribeCatalog(cb: (s: CatalogStatus) => void): () => void {
  listeners.add(cb)
  cb(status)
  return () => {
    listeners.delete(cb)
  }
}

export function getCatalogStatus(): CatalogStatus {
  return status
}

/** Select the catalog the POS reads from (call when the shift / warehouse is known). */
export async function setActiveCatalog(tenantSlug: string, warehouseId: string): Promise<void> {
  const key = catalogKey(tenantSlug, warehouseId)
  active = { tenantSlug, warehouseId }
  const db = await openCatalog(tenantSlug, warehouseId)
  const [count, lastSyncAt, lastFullSyncAt] = await Promise.all([
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE is_active = 1'),
    getMeta(db, 'lastSyncAt'),
    getMeta(db, 'lastFullSyncAt'),
  ])
  if (active && catalogKey(active.tenantSlug, active.warehouseId) !== key) return
  emit({ key, itemCount: count?.n ?? 0, lastSyncAt, lastFullSyncAt, error: null })
}

async function activeDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (!active) return null
  return openCatalog(active.tenantSlug, active.warehouseId)
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
const FULL_REFRESH_MS = 24 * 60 * 60 * 1000
const PAGE_LIMIT = 1000
const inFlight = new Map<string, Promise<SyncResult>>()

export interface SyncResult {
  ok: boolean
  upserted: number
  deleted: number
  full: boolean
  offline?: boolean
  error?: string
}

const UPSERT_SQL = `INSERT INTO items (id, item_code, name, name_lc, barcode, plu_code, sku, selling_price, tax_template_id, unit,
  is_weighable, track_stock, track_serial, is_gift_card, category_id, category_name, image_url, is_active, updated_at, sync_gen)
  VALUES ($id, $itemCode, $name, $nameLc, $barcode, $plu, $sku, $price, $tax, $unit, $weighable, $track, $serial, $gift,
  $cat, $catName, $img, $active, $updated, $gen)
  ON CONFLICT(id) DO UPDATE SET item_code = excluded.item_code, name = excluded.name, name_lc = excluded.name_lc,
  barcode = excluded.barcode, plu_code = excluded.plu_code, sku = excluded.sku, selling_price = excluded.selling_price,
  tax_template_id = excluded.tax_template_id, unit = excluded.unit, is_weighable = excluded.is_weighable,
  track_stock = excluded.track_stock, track_serial = excluded.track_serial, is_gift_card = excluded.is_gift_card,
  category_id = excluded.category_id, category_name = excluded.category_name, image_url = excluded.image_url,
  is_active = excluded.is_active, updated_at = excluded.updated_at, sync_gen = excluded.sync_gen`

async function applyPage(db: SQLite.SQLiteDatabase, page: SyncPage, gen: number): Promise<{ upserted: number; deleted: number }> {
  let upserted = 0
  let deleted = 0
  await db.withExclusiveTransactionAsync(async (txn) => {
    const upsert = await txn.prepareAsync(UPSERT_SQL)
    const setStock = await txn.prepareAsync('INSERT INTO stock (item_id, available) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET available = excluded.available')
    const delItem = await txn.prepareAsync('DELETE FROM items WHERE id = ?')
    const delStock = await txn.prepareAsync('DELETE FROM stock WHERE item_id = ?')
    // Server figure kept separately so pending offline sales can be re-applied idempotently.
    const setServer = await txn.prepareAsync('INSERT INTO stock_server (item_id, available) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET available = excluded.available')
    const delServer = await txn.prepareAsync('DELETE FROM stock_server WHERE item_id = ?')
    try {
      for (const it of page.items) {
        if (!it.isActive) {
          await delItem.executeAsync(it.id)
          await delStock.executeAsync(it.id)
          await delServer.executeAsync(it.id)
          deleted++
          continue
        }
        await upsert.executeAsync({
          $id: it.id,
          $itemCode: it.itemCode || '',
          $name: it.name,
          // Generic name (pharmacy) folded into the search text: "paracetamol" finds Panadol
          $nameLc: `${it.name || ''}${it.genericName ? ` ${it.genericName}` : ''}`.toLowerCase(),
          $barcode: it.barcode || null,
          $plu: it.pluCode || null,
          $sku: it.sku || null,
          $price: String(it.sellingPrice ?? '0'),
          $tax: it.taxTemplateId || null,
          $unit: it.unit || null,
          $weighable: it.isWeighable ? 1 : 0,
          $track: it.trackStock === false ? 0 : 1,
          $serial: it.trackSerialNumbers ? 1 : 0,
          $gift: it.isGiftCard ? 1 : 0,
          $cat: it.categoryId || null,
          $catName: it.categoryName || null,
          $img: it.imageUrl || null,
          $active: 1,
          $updated: it.updatedAt || null,
          $gen: gen,
        })
        if (it.availableStock !== null && it.availableStock !== undefined) {
          await setStock.executeAsync(it.id, Number(it.availableStock))
          await setServer.executeAsync(it.id, Number(it.availableStock))
        }
        upserted++
      }
      for (const id of page.deleted || []) {
        await delItem.executeAsync(id)
        await delStock.executeAsync(id)
        await delServer.executeAsync(id)
        deleted++
      }
    } finally {
      await setServer.finalizeAsync()
      await delServer.finalizeAsync()
      await upsert.finalizeAsync()
      await setStock.finalizeAsync()
      await delItem.finalizeAsync()
      await delStock.finalizeAsync()
    }
  })
  return { upserted, deleted }
}

/**
 * Pull catalog changes for `warehouseId` until the server reports no more pages.
 * Delta by default; `full` (or no cursor yet / cursor older than a day) re-downloads everything
 * and removes local items the server no longer sells. Interrupted runs resume from the stored cursor.
 */
export async function syncCatalog(warehouseId: string, opts: { full?: boolean; tenantSlug?: string } = {}): Promise<SyncResult> {
  const tenantSlug = opts.tenantSlug || (await getUser())?.tenantSlug
  if (!tenantSlug) return { ok: false, upserted: 0, deleted: 0, full: false, error: 'Not signed in' }
  const key = catalogKey(tenantSlug, warehouseId)
  const running = inFlight.get(key)
  if (running) return running
  const p = runSync(tenantSlug, warehouseId, !!opts.full).finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

async function runSync(tenantSlug: string, warehouseId: string, forceFull: boolean): Promise<SyncResult> {
  const key = catalogKey(tenantSlug, warehouseId)
  const isActive = () => !!active && catalogKey(active.tenantSlug, active.warehouseId) === key
  if (isActive()) emit({ syncing: true, error: null })
  const db = await openCatalog(tenantSlug, warehouseId)
  let upserted = 0
  let deleted = 0
  try {
    const lastFull = await getMeta(db, 'lastFullSyncAt')
    let cursor = await getMeta(db, 'cursor')
    let gen = Number(await getMeta(db, 'fullGen')) || 0
    const fullInProgress = (await getMeta(db, 'fullInProgress')) === '1'
    const stale = !lastFull || Date.now() - Date.parse(lastFull) > FULL_REFRESH_MS
    let full = fullInProgress
    if (!fullInProgress && (forceFull || !cursor || stale)) {
      full = true
      cursor = null
      gen = Date.now()
      await setMeta(db, 'fullGen', String(gen))
      await setMeta(db, 'fullInProgress', '1')
      await setMeta(db, 'cursor', null)
    }

    for (let guard = 0; guard < 500; guard++) {
      const res = await apiGet<SyncPage>(`/api/items/sync${qs({ warehouseId, cursor: cursor || undefined, limit: PAGE_LIMIT })}`, { timeoutMs: 60_000 })
      if (!res.ok) {
        if (res.status === 400 && /cursor/i.test(res.error || '')) {
          // Server no longer understands the cursor: start over with a full snapshot next time.
          await setMeta(db, 'cursor', null)
          await setMeta(db, 'fullInProgress', null)
          await setMeta(db, 'lastFullSyncAt', null)
        }
        const offline = res.status === 0
        if (isActive()) emit({ syncing: false, error: offline ? null : res.error })
        return { ok: false, upserted, deleted, full, offline, error: res.error }
      }
      const page = res.data
      const r = await applyPage(db, page, full ? gen : 0)
      upserted += r.upserted
      deleted += r.deleted
      cursor = page.nextCursor
      await setMeta(db, 'cursor', cursor)
      if (!page.hasMore) break
    }

    if (full) {
      // Sweep: anything not delivered by this snapshot is gone from the server.
      const swept = await db.runAsync('DELETE FROM items WHERE sync_gen <> ?', gen)
      deleted += swept.changes
      await db.runAsync('DELETE FROM stock WHERE item_id NOT IN (SELECT id FROM items)')
      await db.runAsync('DELETE FROM stock_server WHERE item_id NOT IN (SELECT id FROM items)')
      await setMeta(db, 'fullInProgress', null)
      await setMeta(db, 'lastFullSyncAt', new Date().toISOString())
    }
    await reapplyPendingStock(db, tenantSlug, warehouseId)
    const now = new Date().toISOString()
    await setMeta(db, 'lastSyncAt', now)
    await setMeta(db, 'tenantSlug', tenantSlug)
    await setMeta(db, 'warehouseId', warehouseId)
    if (isActive()) {
      const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE is_active = 1')
      emit({
        syncing: false,
        error: null,
        itemCount: count?.n ?? 0,
        lastSyncAt: now,
        lastFullSyncAt: full ? now : status.lastFullSyncAt,
      })
    }
    return { ok: true, upserted, deleted, full }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Catalog sync failed'
    if (isActive()) emit({ syncing: false, error: msg })
    return { ok: false, upserted, deleted, full: false, error: msg }
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
interface ItemRow {
  id: string
  item_code: string
  name: string
  barcode: string | null
  plu_code: string | null
  sku: string | null
  selling_price: string
  tax_template_id: string | null
  unit: string | null
  is_weighable: number
  track_stock: number
  track_serial: number
  is_gift_card: number
  category_id: string | null
  category_name: string | null
  image_url: string | null
  is_active: number
  updated_at: string | null
  available: number | null
}

const SELECT_ITEM = `SELECT i.*, s.available FROM items i LEFT JOIN stock s ON s.item_id = i.id`

function toItem(r: ItemRow): LocalItem {
  return {
    id: r.id,
    itemCode: r.item_code,
    name: r.name,
    barcode: r.barcode,
    pluCode: r.plu_code,
    sku: r.sku,
    sellingPrice: r.selling_price,
    taxTemplateId: r.tax_template_id,
    unit: r.unit,
    isWeighable: !!r.is_weighable,
    trackStock: !!r.track_stock,
    trackSerialNumbers: !!r.track_serial,
    isGiftCard: !!r.is_gift_card,
    categoryId: r.category_id,
    categoryName: r.category_name,
    imageUrl: r.image_url,
    availableStock: r.available === null || r.available === undefined ? null : Number(r.available),
    isActive: !!r.is_active,
    updatedAt: r.updated_at || '',
  }
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

export interface SearchOptions {
  categoryId?: string | null
  limit?: number
  offset?: number
  inStockOnly?: boolean
}

/** Local catalog search: name contains, item code / barcode / SKU / PLU prefix. */
export async function searchItems(query: string, opts: SearchOptions = {}): Promise<{ items: LocalItem[]; total: number }> {
  const db = await activeDb()
  if (!db) return { items: [], total: 0 }
  const where: string[] = ['i.is_active = 1']
  const params: (string | number)[] = []
  const q = query.trim()
  if (q) {
    const lc = q.toLowerCase()
    const pre = `${likeEscape(q)}%`
    where.push(`(i.name_lc LIKE ? ESCAPE '\\' OR i.item_code LIKE ? ESCAPE '\\' OR i.barcode LIKE ? ESCAPE '\\' OR i.sku LIKE ? ESCAPE '\\' OR i.plu_code LIKE ? ESCAPE '\\')`)
    params.push(`%${likeEscape(lc)}%`, pre, pre, pre, pre)
  }
  if (opts.categoryId) {
    where.push('i.category_id = ?')
    params.push(opts.categoryId)
  }
  if (opts.inStockOnly) where.push('(i.track_stock = 0 OR COALESCE(s.available, 0) > 0)')
  const whereSql = where.join(' AND ')
  const limit = Math.max(1, Math.min(500, opts.limit ?? 60))
  const offset = Math.max(0, opts.offset ?? 0)
  const exact = q ? `CASE WHEN i.barcode = ? OR i.sku = ? OR i.item_code = ? OR i.plu_code = ? THEN 0 WHEN i.name_lc LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, ` : ''
  const orderParams = q ? [q, q, q.toUpperCase(), q, `${likeEscape(q.toLowerCase())}%`] : []
  const [rows, count] = await Promise.all([
    db.getAllAsync<ItemRow>(`${SELECT_ITEM} WHERE ${whereSql} ORDER BY ${exact}i.name_lc LIMIT ? OFFSET ?`, [...params, ...orderParams, limit, offset]),
    db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM items i LEFT JOIN stock s ON s.item_id = i.id WHERE ${whereSql}`, params),
  ])
  return { items: rows.map(toItem), total: count?.n ?? 0 }
}

export async function getLocalItem(id: string): Promise<LocalItem | null> {
  const db = await activeDb()
  if (!db) return null
  const row = await db.getFirstAsync<ItemRow>(`${SELECT_ITEM} WHERE i.id = ?`, id)
  return row ? toItem(row) : null
}

export interface LocalScanMatch {
  item: LocalItem
  matchedBy: 'barcode' | 'plu' | 'sku' | 'item_barcode' | 'uom_barcode'
  /** H5: unit of the scanned code (null = base unit), its factor, quantity per scan and unit price */
  uom?: string | null
  uomFactor?: number
  packQty?: number
  uomPrice?: number
  /** item_barcodes.price_override (the code fixes the price) */
  priceOverride?: number | null
  /** the additional / unit barcode that matched */
  matchedBarcode?: string
  /** weight / count from a scale or GS1 label */
  quantity?: number
  /** unit price from a price-embedded label */
  unitPrice?: number
  /** amount payable printed on the label (price-embedded scale label, GS1 AI 392n) = line total */
  lineTotal?: number
  scan: ScanAnalysis
}

/**
 * Resolve a scanned code against the local catalog using the same candidate order as
 * GET /api/items/barcode-lookup (EAN/UPC variants, GS1, weighing-scale labels, PLU, SKU).
 * Also accepts the item code (ITM-000123) printed on shelf labels.
 */
export async function findByCode(code: string, scaleConfig?: Partial<ScaleBarcodeConfig> | null): Promise<LocalScanMatch | null> {
  const db = await activeDb()
  if (!db) return null
  const scan = analyseScan(code, normalizeScaleConfig(scaleConfig))
  for (const cand of scan.candidates) {
    let row: ItemRow | null = null
    if (cand.field === 'barcode') {
      row = await db.getFirstAsync<ItemRow>(`${SELECT_ITEM} WHERE i.is_active = 1 AND i.barcode = ? LIMIT 1`, cand.lookup)
      // H5: additional / unit barcodes from the offline bundle
      const extra = row ? undefined : (await extraBarcodes()).get(cand.lookup)
      if (extra) {
        const xrow = await db.getFirstAsync<ItemRow>(`${SELECT_ITEM} WHERE i.is_active = 1 AND i.id = ? LIMIT 1`, extra.itemId)
        if (xrow) {
          const item = toItem(xrow)
          const x = extraBarcodeScan(extra, Number(item.sellingPrice) || 0)
          return { item, matchedBy: extra.source, scan, uom: x.uom, uomFactor: x.uomFactor, packQty: x.packQty, uomPrice: x.uomPrice, priceOverride: extra.priceOverride, matchedBarcode: cand.lookup,
            quantity: x.quantity, unitPrice: x.unitPrice, lineTotal: x.lineTotal }
        }
      }
    } else if (cand.field === 'plu') {
      row = await db.getFirstAsync<ItemRow>(`${SELECT_ITEM} WHERE i.is_active = 1 AND i.plu_code = ? LIMIT 1`, cand.lookup)
    } else {
      row = await db.getFirstAsync<ItemRow>(`${SELECT_ITEM} WHERE i.is_active = 1 AND (i.sku = ? OR i.item_code = ?) LIMIT 1`, cand.lookup, cand.lookup.toUpperCase())
    }
    if (!row) continue
    const item = toItem(row)
    const match: LocalScanMatch = { item, matchedBy: cand.field, scan }
    // Scale weight/price only applies when found via the label's PLU (same rule as the server)
    if (scan.scale && cand.field === 'plu') {
      if (scan.scale.valueType === 'weight') {
        match.quantity = scan.scale.value
      } else {
        const unitPrice = Number(item.sellingPrice)
        match.quantity = unitPrice > 0 ? Math.round((scan.scale.value / unitPrice) * 1000) / 1000 : 1
        match.unitPrice = unitPrice > 0 ? unitPrice : scan.scale.value
        match.lineTotal = scan.scale.value
      }
    }
    if (scan.gs1) {
      if (scan.gs1.netWeightKg) match.quantity = scan.gs1.netWeightKg
      else if (scan.gs1.count) match.quantity = scan.gs1.count
      // AI 392n is the amount payable for the whole trade item (weight / count), not a unit price
      if (scan.gs1.price) match.lineTotal = scan.gs1.price
    }
    return match
  }
  return null
}

/**
 * After a sync the stock rows hold server figures, which do not include sales still waiting in the
 * offline queue. Re-apply them: local = server − pending, recomputed from `stock_server` (never
 * from the current local value), so running it after every sync never double-subtracts. Items
 * that were pending at the previous run are recomputed too, so an uploaded sale is not left
 * subtracted when the server figure for that item did not change.
 */
async function reapplyPendingStock(db: SQLite.SQLiteDatabase, tenantSlug: string, warehouseId: string): Promise<void> {
  try {
    const pending = pendingStockFromQueue(await getQueuedSales(), { tenantSlug, warehouseId })
    let previous: string[] = []
    try {
      const raw = await getMeta(db, 'pendingStockItems')
      previous = raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      previous = []
    }
    const ids = Array.from(new Set([...pending.keys(), ...previous]))
    const server = new Map<string, number>()
    for (const id of ids) {
      const row = await db.getFirstAsync<{ available: number | null }>('SELECT available FROM stock_server WHERE item_id = ?', id)
      if (row && row.available !== null && row.available !== undefined) server.set(id, Number(row.available))
    }
    const rows = recomputeLocalStock(server, pending, previous)
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const r of rows) {
        await txn.runAsync('INSERT INTO stock (item_id, available) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET available = excluded.available', r.itemId, r.available)
      }
    })
    await setMeta(db, 'pendingStockItems', pending.size ? JSON.stringify([...pending.keys()]) : null)
  } catch {
    // best effort: the next sync tries again
  }
}

/** Reflect a sale made on this device in the local stock (until the next sync brings server truth). */
export async function adjustLocalStock(lines: Array<{ itemId: string; quantity: number }>): Promise<void> {
  const db = await activeDb()
  if (!db) return
  try {
    for (const l of lines) {
      await db.runAsync('UPDATE stock SET available = available - ? WHERE item_id = ?', l.quantity, l.itemId)
    }
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Offline bundle (tax templates, scale layout, open shift, categories) — device DB,
// keyed by tenant + user because the shift (hence the warehouse) is only known from it.
// ---------------------------------------------------------------------------
async function bundleKey(): Promise<string | null> {
  const user = await getUser()
  if (!user?.tenantSlug) return null
  return `bundle:${user.tenantSlug}:${user.id}`
}

let bundleCache: { key: string; bundle: OfflineBundle | null } | null = null
let extraIndexCache: { bundle: OfflineBundle | null; index: Map<string, ExtraBarcode> } | null = null

/** H5: barcode index of the cached bundle's additional / unit barcodes (rebuilt when the bundle changes). */
async function extraBarcodes(): Promise<Map<string, ExtraBarcode>> {
  const bundle = await getBundle().catch(() => null)
  if (extraIndexCache && extraIndexCache.bundle === bundle) return extraIndexCache.index
  const index = buildExtraBarcodeIndex(bundle?.pricing)
  extraIndexCache = { bundle, index }
  return index
}

export async function getBundle(): Promise<OfflineBundle | null> {
  const key = await bundleKey()
  if (!key) return null
  if (bundleCache?.key === key) return bundleCache.bundle
  try {
    const db = await getDeviceDb()
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)
    const bundle = row?.value ? (JSON.parse(row.value) as OfflineBundle) : null
    bundleCache = { key, bundle }
    return bundle
  } catch {
    return null
  }
}

export async function saveBundle(bundle: OfflineBundle): Promise<void> {
  const key = await bundleKey()
  if (!key) return
  const value: OfflineBundle = { ...bundle, savedAt: new Date().toISOString() }
  bundleCache = { key, bundle: value }
  try {
    const db = await getDeviceDb()
    await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value))
  } catch {
    // memory copy still serves this session
  }
}

/** Patch part of the cached bundle (e.g. the shift after GET /api/pos-opening-entries?current=true). */
export async function patchBundle(patch: Partial<OfflineBundle>): Promise<void> {
  const current = await getBundle()
  if (!current) {
    if (patch.shift === undefined) return
    await saveBundle({
      taxTemplates: [],
      accountingSettings: { defaultTaxTemplateId: null },
      scaleBarcode: null,
      shift: null,
      posProfile: null,
      categories: [],
      serverTime: new Date().toISOString(),
      ...patch,
      complete: false,
    })
    return
  }
  await saveBundle({ ...current, ...patch })
}

/**
 * GET /api/pos/offline-bundle and cache it. Returns the fresh bundle, or the cached one with
 * `offline: true` when the server cannot be reached.
 */
export async function refreshBundle(): Promise<{ bundle: OfflineBundle | null; offline: boolean; error?: string }> {
  const res = await apiGet<OfflineBundle>('/api/pos/offline-bundle')
  if (res.ok && res.data) {
    await saveBundle(res.data)
    return { bundle: res.data, offline: false }
  }
  return { bundle: await getBundle(), offline: res.status === 0, error: res.error || undefined }
}

// ---------------------------------------------------------------------------
// Offline receipt numbers: OFF-<deviceCode>-<seq>
// ---------------------------------------------------------------------------
const DEVICE_CODE_KEY = 'poslanka.deviceCode'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DEVICE_CODE_LENGTH = 6
let deviceCodeCache: string | null = null

export async function getDeviceCode(): Promise<string> {
  if (deviceCodeCache) return deviceCodeCache
  let code = await SecureStore.getItemAsync(DEVICE_CODE_KEY)
  // Devices that already printed OFF-<4 chars>- receipts keep their code; new devices get 6
  // random characters (32^6 ≈ 1e9 codes), so two devices of one tenant practically never share one.
  if (!code || !/^[A-Z0-9]{4}([A-Z0-9]{2})?$/.test(code)) {
    const bytes = Crypto.getRandomBytes(DEVICE_CODE_LENGTH)
    code = Array.from(bytes).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
    await SecureStore.setItemAsync(DEVICE_CODE_KEY, code)
  }
  deviceCodeCache = code
  return code
}

/** Next offline receipt number for this device and tenant, e.g. OFF-K7QD2X-00042. */
export async function nextOfflineRef(tenantSlug?: string): Promise<string> {
  const slug = tenantSlug || (await getUser())?.tenantSlug || 'default'
  const [code, db] = await Promise.all([getDeviceCode(), getDeviceDb()])
  let seq = 1
  await db.withExclusiveTransactionAsync(async (txn) => {
    const row = await txn.getFirstAsync<{ seq: number }>('SELECT seq FROM offline_seq WHERE scope = ?', slug)
    seq = (row?.seq ?? 0) + 1
    await txn.runAsync('INSERT INTO offline_seq (scope, seq) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET seq = excluded.seq', slug, seq)
  })
  return formatOfflineRef(code, seq)
}

/** "12 min ago" style age for banners. */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'never'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}
