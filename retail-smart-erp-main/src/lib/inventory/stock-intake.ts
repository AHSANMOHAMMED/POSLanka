import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { items, stockIntakeBatches, stockIntakeLines, users, warehouses, warehouseStock } from '@/lib/db/schema'
import { isUniqueViolation } from '@/lib/db/errors'
import { nextSequence } from './item-codes'
import { withSavepoint, type DbTx } from './db-types'

/**
 * W3 stock intake: staged receipts / counts scanned on web or mobile.
 * Lines are matched live (itemId → barcode → sku → item_code) and posted to
 * stock by `syncIntakeBatch` (stock-intake-sync.ts). Everything here runs on a
 * tenant-scoped handle (withTenant / withAuthTenant), so RLS applies.
 */

export class IntakeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'IntakeError'
  }
}

export type IntakeLineMode = 'receive' | 'count'
export type IntakeBatchStatus = 'draft' | 'submitted' | 'syncing' | 'posted' | 'partially_posted' | 'cancelled'
export type IntakeBatchRow = typeof stockIntakeBatches.$inferSelect
export type IntakeLineRow = typeof stockIntakeLines.$inferSelect

/** Batch statuses in which lines / header may still change. */
export const EDITABLE_BATCH_STATUSES: IntakeBatchStatus[] = ['draft', 'submitted', 'partially_posted']
/** Line statuses that are still to be posted (and may be edited). */
export const OPEN_LINE_STATUSES = ['pending', 'error'] as const

const round3 = (n: number) => Math.round(n * 1000) / 1000
const qtyStr = (n: number) => round3(n).toFixed(3)
const blank = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : v
  return t ? t : null
}
const isOpen = (status: string) => (OPEN_LINE_STATUSES as readonly string[]).includes(status)

export function formatBatchNo(n: number): string {
  return 'INT-' + String(n).padStart(6, '0')
}

// ==================== Matching ====================

export interface MatchItem {
  id: string
  name: string
  itemCode: string
  barcode: string | null
  sku: string | null
  sellingPrice: string
  costPrice: string
  unit: string | null
  isActive: boolean
  trackStock: boolean
}

export type MatchType = 'item' | 'barcode' | 'sku' | 'item_code'

export type MatchResult =
  | { kind: 'matched'; matchType: MatchType; item: MatchItem }
  | { kind: 'new' }
  | { kind: 'conflict'; barcodeItem: MatchItem; skuItem: MatchItem }
  | { kind: 'invalid'; error: string }

export interface MatchKey {
  itemId?: string | null
  barcode?: string | null
  sku?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve many lines in one query. Order per line:
 *  itemId (must exist + be active) → barcode → sku → (scanned value as sku) → item_code.
 * A barcode and a sku that resolve to two different items is a conflict.
 */
export async function resolveMatches(db: DbTx, tenantId: string, keys: MatchKey[]): Promise<MatchResult[]> {
  const ids = new Set<string>()
  const barcodes = new Set<string>()
  const skus = new Set<string>()
  const codes = new Set<string>()
  for (const k of keys) {
    if (k.itemId && UUID_RE.test(k.itemId)) ids.add(k.itemId)
    const bc = blank(k.barcode)
    const sku = blank(k.sku)
    if (bc) { barcodes.add(bc); skus.add(bc); codes.add(bc.toUpperCase()) }
    if (sku) { skus.add(sku); codes.add(sku.toUpperCase()) }
  }
  const conds: SQL[] = []
  if (ids.size) conds.push(inArray(items.id, [...ids]))
  if (barcodes.size) conds.push(inArray(items.barcode, [...barcodes]))
  if (skus.size) conds.push(inArray(items.sku, [...skus]))
  if (codes.size) conds.push(inArray(items.itemCode, [...codes]))

  const found: MatchItem[] = conds.length === 0 ? [] : await db.select({
    id: items.id,
    name: items.name,
    itemCode: items.itemCode,
    barcode: items.barcode,
    sku: items.sku,
    sellingPrice: items.sellingPrice,
    costPrice: items.costPrice,
    unit: items.unit,
    isActive: items.isActive,
    trackStock: items.trackStock,
  }).from(items).where(and(eq(items.tenantId, tenantId), or(...conds)))

  const byId = new Map<string, MatchItem>()
  const byBarcode = new Map<string, MatchItem>()
  const bySku = new Map<string, MatchItem>()
  const byCode = new Map<string, MatchItem>()
  for (const it of found) {
    byId.set(it.id, it)
    if (it.barcode) byBarcode.set(it.barcode, it)
    if (it.sku) bySku.set(it.sku, it)
    byCode.set(it.itemCode.toUpperCase(), it)
  }

  return keys.map((k): MatchResult => {
    if (k.itemId) {
      const it = byId.get(k.itemId)
      if (!it) return { kind: 'invalid', error: 'Item not found' }
      if (!it.isActive) return { kind: 'invalid', error: `Item "${it.name}" is inactive` }
      return { kind: 'matched', matchType: 'item', item: it }
    }
    const bc = blank(k.barcode)
    const sku = blank(k.sku)
    const b = bc ? byBarcode.get(bc) : undefined
    const s = sku ? bySku.get(sku) : undefined
    if (b && s && b.id !== s.id) return { kind: 'conflict', barcodeItem: b, skuItem: s }
    if (b) return { kind: 'matched', matchType: 'barcode', item: b }
    if (s) return { kind: 'matched', matchType: 'sku', item: s }
    const scannedAsSku = bc ? bySku.get(bc) : undefined
    if (scannedAsSku) return { kind: 'matched', matchType: 'sku', item: scannedAsSku }
    const code = (bc && byCode.get(bc.toUpperCase())) || (sku && byCode.get(sku.toUpperCase())) || undefined
    if (code) return { kind: 'matched', matchType: 'item_code', item: code }
    return { kind: 'new' }
  })
}

export async function resolveMatch(db: DbTx, tenantId: string, key: MatchKey): Promise<MatchResult> {
  const [r] = await resolveMatches(db, tenantId, [key])
  return r
}

export function matchTypeOf(r: MatchResult): string {
  return r.kind === 'matched' ? r.matchType : r.kind
}

/** Current stock per item in one warehouse (missing rows → 0). */
export async function stockInWarehouse(db: DbTx, tenantId: string, warehouseId: string, itemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(itemIds.filter(Boolean))]
  if (ids.length === 0) return out
  const rows = await db.select({ itemId: warehouseStock.itemId, qty: warehouseStock.currentStock })
    .from(warehouseStock)
    .where(and(
      eq(warehouseStock.tenantId, tenantId),
      eq(warehouseStock.warehouseId, warehouseId),
      inArray(warehouseStock.itemId, ids),
    ))
  for (const r of rows) out.set(r.itemId, round3(parseFloat(r.qty || '0')))
  return out
}

// ==================== Previews ====================

export interface LinePreviewItem {
  id: string
  name: string
  itemCode: string
  barcode: string | null
  sku: string | null
  sellingPrice: string
  costPrice: string
  unit: string | null
  isActive: boolean
  currentStock: number
}

export interface LineMatchPreview {
  status: 'matched' | 'new' | 'conflict' | 'invalid' | 'posted' | 'skipped'
  matchType: string
  item: LinePreviewItem | null
  conflict?: { barcodeItem: { id: string; name: string }; skuItem: { id: string; name: string } }
  error?: string
}

export type LinePreview = IntakeLineRow & { match: LineMatchPreview; warnings: string[] }

function previewItem(it: MatchItem, stock: Map<string, number>): LinePreviewItem {
  return {
    id: it.id, name: it.name, itemCode: it.itemCode, barcode: it.barcode, sku: it.sku,
    sellingPrice: it.sellingPrice, costPrice: it.costPrice, unit: it.unit, isActive: it.isActive,
    currentStock: stock.get(it.id) ?? 0,
  }
}

/** Live match preview + warnings for lines (posted lines show their result item). */
export async function buildLinePreviews(db: DbTx, tenantId: string, warehouseId: string, lines: IntakeLineRow[]): Promise<LinePreview[]> {
  const keys: MatchKey[] = lines.map((l) => (isOpen(l.status)
    ? { itemId: l.itemId, barcode: l.barcode, sku: l.sku }
    : { itemId: l.resultItemId ?? l.itemId }))
  const matches = await resolveMatches(db, tenantId, keys)
  const ids: string[] = []
  for (const m of matches) {
    if (m.kind === 'matched') ids.push(m.item.id)
  }
  const stock = await stockInWarehouse(db, tenantId, warehouseId, ids)

  return lines.map((l, i) => {
    const m = matches[i]
    const warnings: string[] = []
    let match: LineMatchPreview
    if (!isOpen(l.status)) {
      // posted/skipped lines: show the item they posted to (may since be inactive → invalid kind)
      const posted = m.kind === 'matched' ? previewItem(m.item, stock) : null
      match = { status: l.status === 'posted' ? 'posted' : 'skipped', matchType: l.matchType || '', item: posted }
    } else if (m.kind === 'matched') {
      match = { status: 'matched', matchType: m.matchType, item: previewItem(m.item, stock) }
      if (!m.item.isActive) warnings.push(`Item "${m.item.name}" is inactive`)
      if (l.lineMode === 'count' && l.systemQtySnapshot !== null) {
        const snap = round3(parseFloat(l.systemQtySnapshot))
        const now = stock.get(m.item.id) ?? 0
        if (snap !== now) {
          warnings.push(`Stock changed since the count (was ${snap}, now ${now}); sync applies only the counted difference`)
        }
      }
    } else if (m.kind === 'new') {
      match = { status: 'new', matchType: 'new', item: null }
      if (!blank(l.name)) warnings.push('New item: enter a name before syncing')
      if (l.sellingPrice === null) warnings.push('New item has no selling price (it will be created at 0)')
    } else if (m.kind === 'conflict') {
      const msg = `Barcode ${l.barcode} belongs to "${m.barcodeItem.name}" but SKU ${l.sku} belongs to "${m.skuItem.name}"`
      match = {
        status: 'conflict', matchType: 'conflict', item: null, error: msg,
        conflict: {
          barcodeItem: { id: m.barcodeItem.id, name: m.barcodeItem.name },
          skuItem: { id: m.skuItem.id, name: m.skuItem.name },
        },
      }
      warnings.push(msg)
    } else {
      match = { status: 'invalid', matchType: 'invalid', item: null, error: m.error }
      warnings.push(m.error)
    }
    return { ...l, match, warnings }
  })
}

// ==================== Batches ====================

export interface CreateBatchInput {
  tenantId: string
  userId: string
  warehouseId: string
  notes?: string | null
  clientBatchId?: string | null
  updateCost?: boolean
  supplierId?: string | null
  /** 'web' | 'mobile' */
  source?: string
}

async function findBatchByClientId(db: DbTx, tenantId: string, clientBatchId: string): Promise<IntakeBatchRow | undefined> {
  const [row] = await db.select().from(stockIntakeBatches)
    .where(and(eq(stockIntakeBatches.tenantId, tenantId), eq(stockIntakeBatches.clientBatchId, clientBatchId)))
  return row
}

async function assertWarehouse(db: DbTx, tenantId: string, warehouseId: string): Promise<{ id: string; name: string }> {
  const [wh] = await db.select({ id: warehouses.id, name: warehouses.name, isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, warehouseId)))
  if (!wh) throw new IntakeError('Warehouse not found', 404, 'WAREHOUSE_NOT_FOUND')
  if (!wh.isActive) throw new IntakeError('Warehouse is inactive', 400, 'WAREHOUSE_INACTIVE')
  return wh
}

/** Create a batch. A repeated clientBatchId returns the existing batch (created=false). */
export async function createIntakeBatch(db: DbTx, input: CreateBatchInput): Promise<{ batch: IntakeBatchRow; created: boolean }> {
  const { tenantId } = input
  if (input.clientBatchId) {
    const existing = await findBatchByClientId(db, tenantId, input.clientBatchId)
    if (existing) return { batch: existing, created: false }
  }
  await assertWarehouse(db, tenantId, input.warehouseId)
  const batchNo = formatBatchNo(await nextSequence(db, tenantId, 'stock_intake'))
  try {
    const batch = await withSavepoint(db, async (sp) => {
      const [row] = await sp.insert(stockIntakeBatches).values({
        tenantId,
        batchNo,
        warehouseId: input.warehouseId,
        source: input.source === 'mobile' ? 'mobile' : 'web',
        clientBatchId: input.clientBatchId || null,
        notes: input.notes || null,
        supplierId: input.supplierId || null,
        updateCost: !!input.updateCost,
        createdBy: input.userId,
      }).returning()
      return row
    })
    return { batch, created: true }
  } catch (err) {
    if (input.clientBatchId && isUniqueViolation(err, 'stock_intake_batches_tenant_client_unique')) {
      const existing = await findBatchByClientId(db, tenantId, input.clientBatchId)
      if (existing) return { batch: existing, created: false }
    }
    throw err
  }
}

export interface ListBatchesInput {
  tenantId: string
  status?: string
  warehouseId?: string
  createdBy?: string
  page?: number
  pageSize?: number
}

export async function listIntakeBatches(db: DbTx, input: ListBatchesInput) {
  const page = Math.max(1, input.page || 1)
  const pageSize = Math.min(200, Math.max(1, input.pageSize || 25))
  const conds: SQL[] = [eq(stockIntakeBatches.tenantId, input.tenantId)]
  if (input.status) conds.push(sql`${stockIntakeBatches.status}::text = ${input.status}`)
  if (input.warehouseId) conds.push(eq(stockIntakeBatches.warehouseId, input.warehouseId))
  if (input.createdBy) conds.push(eq(stockIntakeBatches.createdBy, input.createdBy))
  const where = and(...conds)

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(stockIntakeBatches).where(where)
  const data = await db.select({
    id: stockIntakeBatches.id,
    batchNo: stockIntakeBatches.batchNo,
    warehouseId: stockIntakeBatches.warehouseId,
    warehouseName: warehouses.name,
    status: stockIntakeBatches.status,
    source: stockIntakeBatches.source,
    notes: stockIntakeBatches.notes,
    updateCost: stockIntakeBatches.updateCost,
    totalLines: stockIntakeBatches.totalLines,
    postedLines: stockIntakeBatches.postedLines,
    errorLines: stockIntakeBatches.errorLines,
    createdBy: stockIntakeBatches.createdBy,
    createdByName: users.fullName,
    createdAt: stockIntakeBatches.createdAt,
    updatedAt: stockIntakeBatches.updatedAt,
    postedAt: stockIntakeBatches.postedAt,
    version: stockIntakeBatches.version,
  })
    .from(stockIntakeBatches)
    .leftJoin(warehouses, eq(warehouses.id, stockIntakeBatches.warehouseId))
    .leftJoin(users, eq(users.id, stockIntakeBatches.createdBy))
    .where(where)
    .orderBy(desc(stockIntakeBatches.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return { data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
}

export async function loadIntakeBatch(db: DbTx, tenantId: string, batchId: string, lock = false): Promise<IntakeBatchRow> {
  const q = db.select().from(stockIntakeBatches)
    .where(and(eq(stockIntakeBatches.tenantId, tenantId), eq(stockIntakeBatches.id, batchId)))
  const [row] = lock ? await q.for('update') : await q
  if (!row) throw new IntakeError('Stock intake batch not found', 404, 'NOT_FOUND')
  return row
}

function assertBatchEditable(batch: IntakeBatchRow) {
  if (batch.status === 'syncing') throw new IntakeError('Batch is being synced; try again shortly', 409, 'SYNC_IN_PROGRESS')
  if (!EDITABLE_BATCH_STATUSES.includes(batch.status as IntakeBatchStatus)) {
    throw new IntakeError(`Batch is ${batch.status}`, 409, 'BATCH_CLOSED')
  }
}

async function loadLines(db: DbTx, tenantId: string, batchId: string): Promise<IntakeLineRow[]> {
  return db.select().from(stockIntakeLines)
    .where(and(eq(stockIntakeLines.tenantId, tenantId), eq(stockIntakeLines.batchId, batchId)))
    .orderBy(stockIntakeLines.createdAt, stockIntakeLines.id)
}

/** Recompute and store the line counters on the batch. */
export async function refreshBatchCounters(db: DbTx, tenantId: string, batchId: string) {
  const res = await db.execute<{ total: number; posted: number; errors: number; pending: number; skipped: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'posted')::int AS posted,
           count(*) FILTER (WHERE status = 'error')::int AS errors,
           count(*) FILTER (WHERE status = 'pending')::int AS pending,
           count(*) FILTER (WHERE status = 'skipped')::int AS skipped
    FROM stock_intake_lines WHERE tenant_id = ${tenantId} AND batch_id = ${batchId}
  `)
  const c = res.rows[0] ?? { total: 0, posted: 0, errors: 0, pending: 0, skipped: 0 }
  await db.update(stockIntakeBatches).set({
    totalLines: c.total, postedLines: c.posted, errorLines: c.errors, updatedAt: new Date(),
  }).where(and(eq(stockIntakeBatches.tenantId, tenantId), eq(stockIntakeBatches.id, batchId)))
  return c
}

export async function getIntakeBatchDetail(db: DbTx, tenantId: string, batchId: string) {
  const batch = await loadIntakeBatch(db, tenantId, batchId)
  const [wh] = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, batch.warehouseId))
  const lines = await buildLinePreviews(db, tenantId, batch.warehouseId, await loadLines(db, tenantId, batchId))
  const summary = {
    total: lines.length,
    pending: lines.filter((l) => l.status === 'pending').length,
    posted: lines.filter((l) => l.status === 'posted').length,
    errors: lines.filter((l) => l.status === 'error').length,
    skipped: lines.filter((l) => l.status === 'skipped').length,
    newItems: lines.filter((l) => l.match.status === 'new').length,
    conflicts: lines.filter((l) => l.match.status === 'conflict').length,
  }
  return { batch: { ...batch, warehouseName: wh?.name ?? null }, lines, summary }
}

// ==================== Lines ====================

export interface IntakeLineInput {
  clientLineId?: string | null
  mode?: IntakeLineMode
  barcode?: string | null
  sku?: string | null
  itemId?: string | null
  quantity: number
  name?: string | null
  categoryId?: string | null
  unit?: string | null
  costPrice?: number | null
  sellingPrice?: number | null
  notes?: string | null
}

export interface AddLinesInput {
  tenantId: string
  userId: string
  batchId: string
  lines: IntakeLineInput[]
}

export interface AddLinesResult {
  lines: LinePreview[]
  warnings: Array<{ lineId: string; clientLineId: string | null; message: string }>
  /** what happened to each input line, in input order */
  outcomes: Array<{ lineId: string; action: 'inserted' | 'merged' | 'replaced' | 'updated' | 'replayed' }>
}

const money = (v: number | null | undefined): string | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(2)

function validateQuantity(mode: IntakeLineMode, q: number, label: string) {
  if (!Number.isFinite(q) || q < 0) throw new IntakeError(`${label}: quantity must be 0 or more`, 400, 'INVALID_QUANTITY')
  if (mode === 'receive' && q <= 0) throw new IntakeError(`${label}: received quantity must be greater than 0`, 400, 'INVALID_QUANTITY')
}

/**
 * Upsert lines into a batch.
 *  - a known clientLineId is an idempotent replay (a line that has had other
 *    scans merged into it, or was merged elsewhere, is left untouched; a plain
 *    open line gets its fields replaced),
 *  - receive: a line with the same itemId / barcode / resolved item ADDS to the
 *    existing open receive line,
 *  - count: the same key REPLACES the counted quantity (and re-snapshots).
 * The batch row is locked, so concurrent scans of one batch serialise.
 */
export async function addIntakeLines(db: DbTx, input: AddLinesInput): Promise<AddLinesResult> {
  const { tenantId, userId, batchId } = input
  const batch = await loadIntakeBatch(db, tenantId, batchId, true)
  assertBatchEditable(batch)

  const existing = await loadLines(db, tenantId, batchId)
  const existingMatches = await resolveMatches(db, tenantId,
    existing.map((l) => ({ itemId: l.itemId, barcode: l.barcode, sku: l.sku })))
  const resolvedIdOf = new Map<string, string | null>()
  existing.forEach((l, i) => {
    const m = existingMatches[i]
    resolvedIdOf.set(l.id, m.kind === 'matched' ? m.item.id : null)
  })

  const norm = input.lines.map((l) => ({
    ...l,
    mode: (l.mode || 'receive') as IntakeLineMode,
    barcode: blank(l.barcode),
    sku: blank(l.sku),
    itemId: blank(l.itemId),
    name: blank(l.name),
    unit: blank(l.unit),
    notes: blank(l.notes),
    categoryId: blank(l.categoryId),
    clientLineId: blank(l.clientLineId),
    quantity: Number(l.quantity),
  }))
  const matches = await resolveMatches(db, tenantId, norm)
  const stock = await stockInWarehouse(db, tenantId, batch.warehouseId,
    matches.flatMap((m) => (m.kind === 'matched' ? [m.item.id] : [])))

  const touched = new Set<string>()
  const outcomes: AddLinesResult['outcomes'] = []
  const now = new Date()

  for (let i = 0; i < norm.length; i++) {
    const l = norm[i]
    const label = `Line ${i + 1}`
    if (!l.itemId && !l.barcode && !l.sku) throw new IntakeError(`${label}: barcode, SKU or item is required`, 400, 'MISSING_IDENTIFIER')
    validateQuantity(l.mode, l.quantity, label)
    const m = matches[i]
    const resolvedId = m.kind === 'matched' ? m.item.id : null
    const snapshot = l.mode === 'count' && resolvedId ? qtyStr(stock.get(resolvedId) ?? 0) : null

    // 1. idempotent replay by clientLineId
    if (l.clientLineId) {
      const known = existing.find((e) => e.clientLineId === l.clientLineId || (e.mergedClientLineIds || []).includes(l.clientLineId!))
      if (known) {
        const plain = known.clientLineId === l.clientLineId && (known.mergedClientLineIds || []).length === 0
        if (plain && isOpen(known.status)) {
          const [row] = await db.update(stockIntakeLines).set({
            lineMode: l.mode,
            barcode: l.barcode,
            sku: l.sku,
            itemId: l.itemId,
            quantity: qtyStr(l.quantity),
            systemQtySnapshot: l.mode === 'count'
              ? (known.lineMode === 'count' && known.systemQtySnapshot !== null && resolvedIdOf.get(known.id) === resolvedId
                ? known.systemQtySnapshot
                : snapshot)
              : null,
            name: l.name ?? known.name,
            categoryId: l.categoryId ?? known.categoryId,
            unit: l.unit ?? known.unit,
            costPrice: money(l.costPrice) ?? known.costPrice,
            sellingPrice: money(l.sellingPrice) ?? known.sellingPrice,
            notes: l.notes ?? known.notes,
            matchType: matchTypeOf(m),
            status: 'pending',
            errorMessage: null,
            updatedAt: now,
          }).where(eq(stockIntakeLines.id, known.id)).returning()
          existing[existing.indexOf(known)] = row
          resolvedIdOf.set(row.id, resolvedId)
          outcomes.push({ lineId: row.id, action: 'updated' })
        } else {
          outcomes.push({ lineId: known.id, action: 'replayed' })
        }
        touched.add(known.id)
        continue
      }
    }

    // 2. merge (receive adds) / replace (count) into an open line with the same key
    const target = existing.find((e) => isOpen(e.status) && e.lineMode === l.mode && (
      (l.itemId && e.itemId === l.itemId)
      || (l.barcode && e.barcode === l.barcode)
      || (resolvedId && resolvedIdOf.get(e.id) === resolvedId)
    ))
    if (target) {
      const merged = l.clientLineId ? [...(target.mergedClientLineIds || []), l.clientLineId] : (target.mergedClientLineIds || [])
      const newQty = l.mode === 'receive' ? round3(parseFloat(target.quantity) + l.quantity) : l.quantity
      const [row] = await db.update(stockIntakeLines).set({
        quantity: qtyStr(newQty),
        systemQtySnapshot: l.mode === 'count' ? snapshot : target.systemQtySnapshot,
        mergedClientLineIds: merged,
        barcode: target.barcode ?? l.barcode,
        sku: target.sku ?? l.sku,
        name: l.name ?? target.name,
        categoryId: l.categoryId ?? target.categoryId,
        unit: l.unit ?? target.unit,
        costPrice: money(l.costPrice) ?? target.costPrice,
        sellingPrice: money(l.sellingPrice) ?? target.sellingPrice,
        notes: l.notes ?? target.notes,
        status: 'pending',
        errorMessage: null,
        updatedAt: now,
      }).where(eq(stockIntakeLines.id, target.id)).returning()
      existing[existing.indexOf(target)] = row
      touched.add(row.id)
      outcomes.push({ lineId: row.id, action: l.mode === 'receive' ? 'merged' : 'replaced' })
      continue
    }

    // 3. new line
    const [row] = await db.insert(stockIntakeLines).values({
      tenantId,
      batchId,
      clientLineId: l.clientLineId,
      lineMode: l.mode,
      barcode: l.barcode,
      sku: l.sku,
      itemId: l.itemId,
      quantity: qtyStr(l.quantity),
      systemQtySnapshot: snapshot,
      name: l.name,
      categoryId: l.categoryId,
      unit: l.unit,
      costPrice: money(l.costPrice),
      sellingPrice: money(l.sellingPrice),
      matchType: matchTypeOf(m),
      notes: l.notes,
      createdBy: userId,
    }).returning()
    existing.push(row)
    resolvedIdOf.set(row.id, resolvedId)
    touched.add(row.id)
    outcomes.push({ lineId: row.id, action: 'inserted' })
  }

  await refreshBatchCounters(db, tenantId, batchId)

  const previews = await buildLinePreviews(db, tenantId, batch.warehouseId, existing.filter((e) => touched.has(e.id)))
  const warnings = previews.flatMap((p) => p.warnings.map((message) => ({ lineId: p.id, clientLineId: p.clientLineId, message })))
  return { lines: previews, warnings, outcomes }
}

export type IntakeLinePatch = Partial<Omit<IntakeLineInput, 'clientLineId'>>

async function loadOpenLineForUpdate(db: DbTx, tenantId: string, batchId: string, lineId: string): Promise<IntakeLineRow> {
  const [line] = await db.select().from(stockIntakeLines)
    .where(and(eq(stockIntakeLines.tenantId, tenantId), eq(stockIntakeLines.batchId, batchId), eq(stockIntakeLines.id, lineId)))
    .for('update')
  if (!line) throw new IntakeError('Line not found', 404, 'LINE_NOT_FOUND')
  if (!isOpen(line.status)) throw new IntakeError(`Line is ${line.status} and can no longer be changed`, 409, 'LINE_CLOSED')
  return line
}

export async function updateIntakeLine(db: DbTx, input: { tenantId: string; batchId: string; lineId: string; patch: IntakeLinePatch }): Promise<LinePreview> {
  const { tenantId, batchId, lineId, patch } = input
  const batch = await loadIntakeBatch(db, tenantId, batchId, true)
  assertBatchEditable(batch)
  const line = await loadOpenLineForUpdate(db, tenantId, batchId, lineId)

  const has = (k: keyof IntakeLinePatch) => Object.prototype.hasOwnProperty.call(patch, k)
  const mode = (patch.mode || line.lineMode) as IntakeLineMode
  const barcode = has('barcode') ? blank(patch.barcode) : line.barcode
  const sku = has('sku') ? blank(patch.sku) : line.sku
  const itemId = has('itemId') ? blank(patch.itemId) : line.itemId
  const quantity = has('quantity') ? Number(patch.quantity) : parseFloat(line.quantity)
  if (!itemId && !barcode && !sku) throw new IntakeError('Barcode, SKU or item is required', 400, 'MISSING_IDENTIFIER')
  validateQuantity(mode, quantity, 'Line')

  const keyChanged = mode !== line.lineMode || barcode !== line.barcode || sku !== line.sku || itemId !== line.itemId
  const m = await resolveMatch(db, tenantId, { itemId, barcode, sku })
  let snapshot = mode === 'count' ? line.systemQtySnapshot : null
  if (mode === 'count' && (keyChanged || snapshot === null) && m.kind === 'matched') {
    const stock = await stockInWarehouse(db, tenantId, batch.warehouseId, [m.item.id])
    snapshot = qtyStr(stock.get(m.item.id) ?? 0)
  }

  const [row] = await db.update(stockIntakeLines).set({
    lineMode: mode,
    barcode,
    sku,
    itemId,
    quantity: qtyStr(quantity),
    systemQtySnapshot: snapshot,
    name: has('name') ? blank(patch.name) : line.name,
    categoryId: has('categoryId') ? blank(patch.categoryId) : line.categoryId,
    unit: has('unit') ? blank(patch.unit) : line.unit,
    costPrice: has('costPrice') ? money(patch.costPrice) : line.costPrice,
    sellingPrice: has('sellingPrice') ? money(patch.sellingPrice) : line.sellingPrice,
    notes: has('notes') ? blank(patch.notes) : line.notes,
    matchType: matchTypeOf(m),
    status: 'pending',
    errorMessage: null,
    updatedAt: new Date(),
  }).where(eq(stockIntakeLines.id, lineId)).returning()

  await refreshBatchCounters(db, tenantId, batchId)
  const [preview] = await buildLinePreviews(db, tenantId, batch.warehouseId, [row])
  return preview
}

export async function deleteIntakeLine(db: DbTx, input: { tenantId: string; batchId: string; lineId: string }): Promise<void> {
  const batch = await loadIntakeBatch(db, input.tenantId, input.batchId, true)
  assertBatchEditable(batch)
  await loadOpenLineForUpdate(db, input.tenantId, input.batchId, input.lineId)
  await db.delete(stockIntakeLines).where(eq(stockIntakeLines.id, input.lineId))
  await refreshBatchCounters(db, input.tenantId, input.batchId)
}

// ==================== Header updates ====================

export interface UpdateBatchInput {
  tenantId: string
  userId: string
  batchId: string
  expectedVersion: number
  notes?: string | null
  warehouseId?: string
  status?: 'draft' | 'submitted' | 'cancelled'
  updateCost?: boolean
  supplierId?: string | null
  /** caller holds postStockIntake (required to cancel) */
  canPost: boolean
}

export async function updateIntakeBatch(db: DbTx, input: UpdateBatchInput): Promise<IntakeBatchRow> {
  const { tenantId, batchId } = input
  const batch = await loadIntakeBatch(db, tenantId, batchId, true)
  if (batch.version !== input.expectedVersion) {
    throw new IntakeError('This batch was changed by someone else. Reload and try again.', 409, 'VERSION_CONFLICT', { current: batch })
  }
  if (batch.status === 'syncing') throw new IntakeError('Batch is being synced; try again shortly', 409, 'SYNC_IN_PROGRESS')

  const set: Partial<typeof stockIntakeBatches.$inferInsert> = {}
  const closed = batch.status === 'posted' || batch.status === 'cancelled'

  if (input.notes !== undefined) {
    if (batch.status === 'cancelled') throw new IntakeError('Batch is cancelled', 409, 'BATCH_CLOSED')
    set.notes = input.notes || null
  }
  if (input.updateCost !== undefined && input.updateCost !== batch.updateCost) {
    if (closed) throw new IntakeError(`Batch is ${batch.status}`, 409, 'BATCH_CLOSED')
    set.updateCost = input.updateCost
  }
  if (input.supplierId !== undefined && input.supplierId !== batch.supplierId) {
    if (closed) throw new IntakeError(`Batch is ${batch.status}`, 409, 'BATCH_CLOSED')
    set.supplierId = input.supplierId || null
  }
  if (input.warehouseId && input.warehouseId !== batch.warehouseId) {
    if (closed) throw new IntakeError(`Batch is ${batch.status}`, 409, 'BATCH_CLOSED')
    const [{ posted }] = await db.select({ posted: sql<number>`count(*)::int` }).from(stockIntakeLines)
      .where(and(eq(stockIntakeLines.batchId, batchId), eq(stockIntakeLines.status, 'posted')))
    if (posted > 0) throw new IntakeError('The branch cannot change after lines were posted', 409, 'WAREHOUSE_LOCKED')
    await assertWarehouse(db, tenantId, input.warehouseId)
    set.warehouseId = input.warehouseId
    // count snapshots refer to the old branch: re-take them for the new one
    const countLines = await db.select().from(stockIntakeLines)
      .where(and(eq(stockIntakeLines.batchId, batchId), eq(stockIntakeLines.lineMode, 'count')))
    if (countLines.length) {
      const ms = await resolveMatches(db, tenantId, countLines.map((l) => ({ itemId: l.itemId, barcode: l.barcode, sku: l.sku })))
      const stock = await stockInWarehouse(db, tenantId, input.warehouseId, ms.flatMap((m) => (m.kind === 'matched' ? [m.item.id] : [])))
      for (let i = 0; i < countLines.length; i++) {
        const m = ms[i]
        await db.update(stockIntakeLines).set({
          systemQtySnapshot: m.kind === 'matched' ? qtyStr(stock.get(m.item.id) ?? 0) : null,
          updatedAt: new Date(),
        }).where(eq(stockIntakeLines.id, countLines[i].id))
      }
    }
  }

  if (input.status && input.status !== batch.status) {
    const from = batch.status
    if (input.status === 'cancelled') {
      if (!input.canPost) throw new IntakeError('You do not have permission to cancel stock intake batches', 403, 'FORBIDDEN')
      if (closed) throw new IntakeError(`Batch is ${from}`, 409, 'BATCH_CLOSED')
      await db.update(stockIntakeLines).set({ status: 'skipped', updatedAt: new Date() })
        .where(and(eq(stockIntakeLines.batchId, batchId), inArray(stockIntakeLines.status, ['pending', 'error'])))
      set.status = 'cancelled'
    } else if (input.status === 'submitted') {
      if (from !== 'draft') throw new IntakeError(`Cannot submit a batch that is ${from}`, 409, 'INVALID_TRANSITION')
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(stockIntakeLines).where(eq(stockIntakeLines.batchId, batchId))
      if (n === 0) throw new IntakeError('Add at least one line before submitting', 400, 'EMPTY_BATCH')
      set.status = 'submitted'
      set.submittedBy = input.userId
      set.submittedAt = new Date()
    } else if (input.status === 'draft') {
      if (from !== 'submitted') throw new IntakeError(`Cannot reopen a batch that is ${from}`, 409, 'INVALID_TRANSITION')
      set.status = 'draft'
    }
  }

  const [row] = await db.update(stockIntakeBatches).set({
    ...set,
    version: batch.version + 1,
    updatedAt: new Date(),
  }).where(eq(stockIntakeBatches.id, batchId)).returning()
  if (set.status === 'cancelled') {
    await refreshBatchCounters(db, tenantId, batchId)
    return loadIntakeBatch(db, tenantId, batchId)
  }
  return row
}

// ==================== Validation (dry run) ====================

export interface IntakeValidation {
  batchId: string
  status: string
  willAdd: Array<{
    lineId: string; itemId: string; itemName: string; itemCode: string; mode: IntakeLineMode
    quantity: number; currentStock: number; delta: number; after: number
  }>
  willCreate: Array<{
    lineId: string; name: string; barcode: string | null; sku: string | null; mode: IntakeLineMode
    quantity: number; sellingPrice: number; costPrice: number | null
  }>
  conflicts: Array<{
    lineId: string; barcode: string | null; sku: string | null
    barcodeItem: { id: string; name: string }; skuItem: { id: string; name: string }
  }>
  errors: Array<{ lineId: string; error: string }>
  totals: { lines: number; willAdd: number; willCreate: number; conflicts: number; errors: number; alreadyPosted: number }
  canSync: boolean
}

export async function validateIntakeBatch(db: DbTx, tenantId: string, batchId: string): Promise<IntakeValidation> {
  const batch = await loadIntakeBatch(db, tenantId, batchId)
  const all = await loadLines(db, tenantId, batchId)
  const open = all.filter((l) => isOpen(l.status))
  const previews = await buildLinePreviews(db, tenantId, batch.warehouseId, open)
  const out: IntakeValidation = {
    batchId, status: batch.status, willAdd: [], willCreate: [], conflicts: [], errors: [],
    totals: { lines: open.length, willAdd: 0, willCreate: 0, conflicts: 0, errors: 0, alreadyPosted: all.length - open.length },
    canSync: false,
  }
  for (const p of previews) {
    const q = round3(parseFloat(p.quantity))
    const mode = p.lineMode as IntakeLineMode
    if (p.match.status === 'matched' && p.match.item) {
      if (!p.match.item.isActive) { out.errors.push({ lineId: p.id, error: `Item "${p.match.item.name}" is inactive` }); continue }
      const cur = p.match.item.currentStock
      const delta = mode === 'receive' ? q
        : p.systemQtySnapshot !== null ? round3(q - parseFloat(p.systemQtySnapshot)) : round3(q - cur)
      out.willAdd.push({
        lineId: p.id, itemId: p.match.item.id, itemName: p.match.item.name, itemCode: p.match.item.itemCode,
        mode, quantity: q, currentStock: cur, delta, after: round3(cur + delta),
      })
    } else if (p.match.status === 'new') {
      if (!blank(p.name)) { out.errors.push({ lineId: p.id, error: 'New item needs a name' }); continue }
      out.willCreate.push({
        lineId: p.id, name: p.name!, barcode: p.barcode, sku: p.sku, mode, quantity: q,
        sellingPrice: p.sellingPrice !== null ? parseFloat(p.sellingPrice) : 0,
        costPrice: p.costPrice !== null ? parseFloat(p.costPrice) : null,
      })
    } else if (p.match.status === 'conflict' && p.match.conflict) {
      out.conflicts.push({ lineId: p.id, barcode: p.barcode, sku: p.sku, ...p.match.conflict })
    } else {
      out.errors.push({ lineId: p.id, error: p.match.error || 'Cannot resolve item' })
    }
  }
  out.totals.willAdd = out.willAdd.length
  out.totals.willCreate = out.willCreate.length
  out.totals.conflicts = out.conflicts.length
  out.totals.errors = out.errors.length
  out.canSync = open.length > 0 && out.conflicts.length === 0 && out.errors.length === 0
  return out
}
