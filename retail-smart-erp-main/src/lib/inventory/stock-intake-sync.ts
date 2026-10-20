import { and, eq, inArray, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-context'
import { itemCostHistory, items, stockIntakeBatches, stockIntakeLines } from '@/lib/db/schema'
import { DuplicateError, getPgError } from '@/lib/db/errors'
import { withSavepoint, type DbTx } from './db-types'
import { applyStockChange, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from './apply-stock-change'
import { createItem } from './create-item'
import { recordItemChange } from './item-audit'
import {
  IntakeError, OPEN_LINE_STATUSES, resolveMatch, resolveMatches, type IntakeBatchRow, type IntakeLineRow, type MatchResult,
} from './stock-intake'

/**
 * Post a stock intake batch into stock.
 *
 *  1. A short "claim" transaction locks the batch row with NOWAIT (busy → 409),
 *     replays the stored result for a repeated Idempotency-Key, and flips the
 *     batch to 'syncing' with a run token (sync_started_at).
 *  2. Open lines (pending | error) are processed in chunks (default 200), each
 *     chunk its own transaction that re-locks the batch and checks the token, so
 *     progress persists even if a later chunk fails.
 *  3. Each line runs in a SAVEPOINT: resolve (or create) the item, apply the
 *     stock change through the ledger with idempotency key 'intake:<lineId>'
 *     (so a line can never be applied twice), optional weighted-average cost
 *     update. A failing line rolls back its savepoint and is marked 'error'.
 *  4. A final transaction recomputes counters and sets posted / partially_posted.
 */

export interface SyncIntakeInput {
  tenantId: string
  userId: string
  batchId: string
  idempotencyKey?: string | null
  chunkSize?: number
  /** a 'syncing' batch older than this is considered abandoned and may be taken over */
  staleAfterMs?: number
}

export interface SyncCreatedItem {
  lineId: string
  itemId: string
  itemCode: string
  name: string
  barcode: string | null
}

export interface SyncIntakeResult {
  batchId: string
  batchNo: string
  warehouseId: string
  status: string
  /** lines posted by this run */
  posted: number
  /** all lines currently in error */
  errors: Array<{ lineId: string; error: string }>
  createdItems: SyncCreatedItem[]
  totals: { total: number; posted: number; errors: number; pending: number; skipped: number }
  affectedItemIds: string[]
  /** true when the result is the stored result of an earlier sync with the same key */
  replayed?: boolean
  /** true when the batch was already posted / cancelled and nothing ran */
  noop?: boolean
}

class LineError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

interface LinePostOutcome {
  itemId: string
  movementId: string | null
  createdItem: SyncCreatedItem | null
  matchType: string
  stock: StockChangeResult
  stockInput: StockChangeInput
}

function describeMatch(r: MatchResult): string {
  return r.kind === 'matched' ? r.matchType : r.kind
}

async function postLine(db: DbTx, batch: IntakeBatchRow, line: IntakeLineRow, userId: string): Promise<LinePostOutcome> {
  const { tenantId } = batch
  let match = await resolveMatch(db, tenantId, { itemId: line.itemId, barcode: line.barcode, sku: line.sku })
  if (match.kind === 'conflict') {
    throw new LineError(`Conflict: barcode ${line.barcode} is "${match.barcodeItem.name}" but SKU ${line.sku} is "${match.skuItem.name}"`)
  }
  if (match.kind === 'invalid') throw new LineError(match.error)

  let itemId: string
  let created: SyncCreatedItem | null = null
  if (match.kind === 'matched') {
    if (!match.item.isActive) throw new LineError(`Item "${match.item.name}" is inactive`)
    itemId = match.item.id
  } else {
    const name = line.name?.trim()
    if (!name) throw new LineError('New item needs a name')
    try {
      const { item } = await createItem(db, {
        tenantId,
        userId,
        source: 'intake',
        intakeBatchId: batch.id,
        notes: `Stock intake ${batch.batchNo}`,
        data: {
          name,
          sellingPrice: line.sellingPrice ?? '0',
          costPrice: line.costPrice ?? '0',
          ...(line.unit ? { unit: line.unit } : {}),
          categoryId: line.categoryId ?? null,
          supplierId: batch.supplierId ?? null,
          barcode: line.barcode,
          sku: line.sku,
        },
      })
      itemId = item.id
      created = { lineId: line.id, itemId: item.id, itemCode: item.itemCode, name: item.name, barcode: item.barcode }
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err
      // Someone created the same barcode / sku meanwhile: use that item, never a duplicate
      match = await resolveMatch(db, tenantId, { barcode: line.barcode, sku: line.sku })
      if (match.kind !== 'matched') throw new LineError(`Duplicate ${err.field}${err.value ? ` ${err.value}` : ''}`)
      if (!match.item.isActive) throw new LineError(`Item "${match.item.name}" is inactive`)
      itemId = match.item.id
    }
  }

  const q = round3(parseFloat(line.quantity))
  const base = {
    tenantId,
    warehouseId: batch.warehouseId,
    itemId,
    referenceType: 'stock_intake',
    referenceId: batch.id,
    notes: `Stock intake ${batch.batchNo}`,
    userId,
    source: batch.source === 'mobile' ? 'mobile' : 'intake',
    idempotencyKey: `intake:${line.id}`,
  }
  let stockInput: StockChangeInput
  if (line.lineMode === 'receive') {
    stockInput = { ...base, mode: 'delta', qty: q, type: 'in' }
  } else if (line.systemQtySnapshot !== null && !created) {
    // relative: keeps sales / receipts that happened after the count
    stockInput = { ...base, mode: 'delta', qty: round3(q - parseFloat(line.systemQtySnapshot)), type: 'adjustment', allowNegative: true }
  } else {
    stockInput = { ...base, mode: 'set', qty: q, type: 'adjustment', allowNegative: true }
  }
  const stock = await applyStockChange(db, stockInput)

  if (batch.updateCost && line.costPrice !== null && line.lineMode === 'receive' && !created && !stock.skipped && stock.delta > 0) {
    await applyWeightedCost(db, batch, line, itemId, stock.delta, parseFloat(line.costPrice), userId)
  }

  return {
    itemId,
    movementId: stock.movementId,
    createdItem: created,
    matchType: created ? 'new' : describeMatch(match),
    stock,
    stockInput,
  }
}

async function applyWeightedCost(db: DbTx, batch: IntakeBatchRow, line: IntakeLineRow, itemId: string, qty: number, unitCost: number, userId: string) {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).for('update')
  if (!item) return
  const res = await db.execute<{ total: string | null }>(sql`
    SELECT COALESCE(SUM(current_stock), 0)::text AS total FROM warehouse_stock
    WHERE tenant_id = ${batch.tenantId} AND item_id = ${itemId}
  `)
  const totalAfter = round3(parseFloat(res.rows[0]?.total || '0'))
  const totalBefore = round3(totalAfter - qty)
  const oldCost = parseFloat(item.costPrice || '0')
  const newCost = totalBefore <= 0 || oldCost <= 0
    ? round2(unitCost)
    : round2((totalBefore * oldCost + qty * unitCost) / (totalBefore + qty))

  await db.insert(itemCostHistory).values({
    tenantId: batch.tenantId,
    itemId,
    supplierId: batch.supplierId ?? null,
    source: 'stock_intake',
    previousCostPrice: oldCost.toFixed(2),
    newCostPrice: newCost.toFixed(2),
    purchasePrice: unitCost.toFixed(2),
    quantity: qty.toFixed(3),
    stockBefore: totalBefore.toFixed(3),
    stockAfter: totalAfter.toFixed(3),
    referenceId: batch.id,
    referenceNo: batch.batchNo,
    notes: `Stock intake line ${line.id}`,
    createdBy: userId,
  })
  if (newCost !== round2(oldCost)) {
    const [after] = await db.update(items).set({
      costPrice: newCost.toFixed(2),
      updatedBy: userId,
      updatedAt: new Date(),
      version: sql`${items.version} + 1`,
    }).where(eq(items.id, itemId)).returning()
    await recordItemChange(db, {
      tenantId: batch.tenantId,
      itemId,
      userId,
      source: 'intake',
      action: 'update',
      before: item as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      intakeBatchId: batch.id,
      notes: `Weighted-average cost from stock intake ${batch.batchNo}`,
    })
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof LineError) return err.message
  if (err instanceof DuplicateError) return `Duplicate ${err.field}${err.value ? ` ${err.value}` : ''}`
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.startsWith('INSUFFICIENT_STOCK:')) return `Insufficient stock: ${msg.slice('INSUFFICIENT_STOCK:'.length)}`
  const pg = getPgError(err)
  if (pg?.code === '55P03' || pg?.code === '40P01') return 'Stock row busy; retry the sync'
  return msg.slice(0, 500)
}

async function lockBatch(db: DbTx, tenantId: string, batchId: string, nowait: boolean): Promise<IntakeBatchRow | undefined> {
  const q = db.select().from(stockIntakeBatches)
    .where(and(eq(stockIntakeBatches.tenantId, tenantId), eq(stockIntakeBatches.id, batchId)))
  const [row] = nowait ? await q.for('update', { noWait: true }) : await q.for('update')
  return row
}

async function tokenOf(db: DbTx, batchId: string): Promise<string | null> {
  const r = await db.execute<{ token: string | null }>(sql`
    SELECT sync_started_at::text AS token FROM stock_intake_batches WHERE id = ${batchId}
  `)
  return r.rows[0]?.token ?? null
}

async function counters(db: DbTx, tenantId: string, batchId: string) {
  const res = await db.execute<{ total: number; posted: number; errors: number; pending: number; skipped: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'posted')::int AS posted,
           count(*) FILTER (WHERE status = 'error')::int AS errors,
           count(*) FILTER (WHERE status = 'pending')::int AS pending,
           count(*) FILTER (WHERE status = 'skipped')::int AS skipped
    FROM stock_intake_lines WHERE tenant_id = ${tenantId} AND batch_id = ${batchId}
  `)
  return res.rows[0] ?? { total: 0, posted: 0, errors: 0, pending: 0, skipped: 0 }
}

async function errorList(db: DbTx, batchId: string) {
  const rows = await db.select({ lineId: stockIntakeLines.id, error: stockIntakeLines.errorMessage })
    .from(stockIntakeLines)
    .where(and(eq(stockIntakeLines.batchId, batchId), eq(stockIntakeLines.status, 'error')))
  return rows.map((r) => ({ lineId: r.lineId, error: r.error || 'Error' }))
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function syncIntakeBatch(input: SyncIntakeInput): Promise<SyncIntakeResult> {
  const { tenantId, userId, batchId } = input
  const key = input.idempotencyKey?.trim() || null
  const chunkSize = Math.max(1, input.chunkSize ?? 200)
  const staleMs = input.staleAfterMs ?? 10 * 60 * 1000

  // ---- 1. claim
  type Claim =
    | { kind: 'result'; result: SyncIntakeResult }
    | { kind: 'run'; batch: IntakeBatchRow; token: string; prevStatus: string; lineIds: string[] }
  const claim = await withTenant<Claim>(tenantId, async (db) => {
    let batch: IntakeBatchRow | undefined
    try {
      batch = await lockBatch(db, tenantId, batchId, true)
    } catch (err) {
      if (getPgError(err)?.code === '55P03') {
        throw new IntakeError('Sync already in progress for this batch', 409, 'SYNC_IN_PROGRESS')
      }
      throw err
    }
    if (!batch) throw new IntakeError('Stock intake batch not found', 404, 'NOT_FOUND')

    if (key && batch.lastSyncKey === key && batch.lastSyncResult
      && (batch.status === 'posted' || batch.status === 'partially_posted')) {
      return { kind: 'result', result: { ...(batch.lastSyncResult as unknown as SyncIntakeResult), replayed: true } }
    }
    if (batch.status === 'posted' || batch.status === 'cancelled') {
      return {
        kind: 'result',
        result: {
          batchId, batchNo: batch.batchNo, warehouseId: batch.warehouseId, status: batch.status, posted: 0,
          errors: await errorList(db, batchId), createdItems: [], totals: await counters(db, tenantId, batchId),
          affectedItemIds: [], noop: true,
        },
      }
    }
    if (batch.status === 'syncing') {
      const startedAt = batch.syncStartedAt ? new Date(batch.syncStartedAt).getTime() : 0
      const fresh = await db.execute<{ fresh: boolean }>(sql`
        SELECT (sync_started_at IS NOT NULL AND sync_started_at > now() - make_interval(secs => ${staleMs / 1000})) AS fresh
        FROM stock_intake_batches WHERE id = ${batchId}
      `)
      if (fresh.rows[0]?.fresh && startedAt !== 0) {
        throw new IntakeError('Sync already in progress for this batch', 409, 'SYNC_IN_PROGRESS')
      }
    }

    const open = await db.select().from(stockIntakeLines)
      .where(and(eq(stockIntakeLines.batchId, batchId), inArray(stockIntakeLines.status, [...OPEN_LINE_STATUSES])))
    const c = await counters(db, tenantId, batchId)
    if (open.length === 0 && c.posted === 0) throw new IntakeError('Nothing to sync: the batch has no lines', 400, 'EMPTY_BATCH')

    // deterministic order (resolved item id, barcode) keeps lock order stable across concurrent writers
    const ms = await resolveMatches(db, tenantId, open.map((l) => ({ itemId: l.itemId, barcode: l.barcode, sku: l.sku })))
    const ordered = open.map((l, i) => ({ id: l.id, k1: ms[i].kind === 'matched' ? (ms[i] as { item: { id: string } }).item.id : '~', k2: l.barcode || '' }))
      .sort((a, b) => (a.k1 === b.k1 ? (a.k2 < b.k2 ? -1 : a.k2 > b.k2 ? 1 : 0) : a.k1 < b.k1 ? -1 : 1))

    const prevStatus = batch.status === 'syncing' ? (c.posted > 0 ? 'partially_posted' : 'submitted') : batch.status
    await db.execute(sql`
      UPDATE stock_intake_batches
      SET status = 'syncing', sync_started_at = date_trunc('milliseconds', clock_timestamp()),
          sync_attempts = sync_attempts + 1, updated_at = now()
      WHERE id = ${batchId}
    `)
    const token = await tokenOf(db, batchId)
    return { kind: 'run', batch, token: token!, prevStatus, lineIds: ordered.map((o) => o.id) }
  })
  if (claim.kind === 'result') return claim.result

  // ---- 2./3. chunks
  const createdItems: SyncCreatedItem[] = []
  const affected = new Set<string>()
  const decreases: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
  let postedThisRun = 0
  let failure: unknown = null

  try {
    for (const ids of chunk(claim.lineIds, chunkSize)) {
      await withTenant(tenantId, async (db) => {
        const batch = await lockBatch(db, tenantId, batchId, false)
        if (!batch || batch.status !== 'syncing' || (await tokenOf(db, batchId)) !== claim.token) {
          throw new IntakeError('The sync was taken over by another request', 409, 'SYNC_TAKEN_OVER')
        }
        const lines = await db.select().from(stockIntakeLines)
          .where(and(inArray(stockIntakeLines.id, ids), inArray(stockIntakeLines.status, [...OPEN_LINE_STATUSES])))
          .for('update')
        const order = new Map(ids.map((id, i) => [id, i]))
        lines.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

        for (const line of lines) {
          try {
            const out = await withSavepoint(db, async (sp) => {
              const r = await postLine(sp, batch, line, userId)
              await sp.update(stockIntakeLines).set({
                status: 'posted',
                resultItemId: r.itemId,
                resultMovementId: r.movementId,
                createdItem: !!r.createdItem,
                matchType: r.matchType,
                postedAt: new Date(),
                errorMessage: null,
                updatedAt: new Date(),
              }).where(eq(stockIntakeLines.id, line.id))
              return r
            })
            postedThisRun++
            affected.add(out.itemId)
            if (out.createdItem) createdItems.push(out.createdItem)
            if (!out.stock.skipped && out.stock.delta < 0) decreases.push({ result: out.stock, input: out.stockInput })
          } catch (err) {
            await db.update(stockIntakeLines).set({
              status: 'error',
              errorMessage: errorMessage(err),
              updatedAt: new Date(),
            }).where(eq(stockIntakeLines.id, line.id))
          }
        }
      })
    }
  } catch (err) {
    failure = err
  }

  // ---- 4. finalize (also after a failed chunk, so the batch never stays 'syncing')
  const result = await withTenant(tenantId, async (db) => {
    const batch = await lockBatch(db, tenantId, batchId, false)
    if (!batch) throw new IntakeError('Stock intake batch not found', 404, 'NOT_FOUND')
    const c = await counters(db, tenantId, batchId)
    const errors = await errorList(db, batchId)
    const mine = batch.status === 'syncing' && (await tokenOf(db, batchId)) === claim.token
    const status = !mine ? batch.status
      : c.pending + c.errors === 0 ? 'posted'
        : c.posted > 0 ? 'partially_posted' : claim.prevStatus
    const res: SyncIntakeResult = {
      batchId, batchNo: batch.batchNo, warehouseId: batch.warehouseId, status, posted: postedThisRun,
      errors, createdItems, totals: c, affectedItemIds: [...affected],
    }
    if (mine) {
      await db.update(stockIntakeBatches).set({
        status: status as IntakeBatchRow['status'],
        totalLines: c.total,
        postedLines: c.posted,
        errorLines: c.errors,
        syncStartedAt: null,
        ...(failure ? {} : { lastSyncKey: key, lastSyncResult: res as unknown as Record<string, unknown> }),
        ...(postedThisRun > 0 ? { postedBy: userId, postedAt: new Date() } : {}),
        version: batch.version + 1,
        updatedAt: new Date(),
      }).where(eq(stockIntakeBatches.id, batchId))
    }
    return res
  })

  notifyStockDecreased(decreases)
  if (failure) throw failure
  return result
}
