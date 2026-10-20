// Apply phase of a bulk import (background, resumable, exactly-once progress).
//
// Pending rows are processed in chunks of CHUNK_SIZE. Each chunk is ONE
// transaction that:
//   1. locks the job row (serialises concurrent runners / resume calls),
//   2. resolves + auto-creates lookups (categories, suppliers …),
//   3. tries a fast path for the whole chunk inside a SAVEPOINT,
//   4. on any failure rolls back to that savepoint and applies every row in its
//      own savepoint, so one bad row never loses the others,
//   5. writes each row's status, the job counters and the heartbeat.
// Because row status and data changes commit together, a crash can never
// double-apply or lose a row; resume simply continues with 'pending' rows.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { withTenantTransaction } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { notify } from '@/lib/notifications/notify'
import { DuplicateError, getPgError } from '@/lib/db/errors'
import { withSavepoint, type DbTx } from '@/lib/inventory/db-types'
import { createItem, type CreateItemData } from '@/lib/inventory/create-item'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { recordItemChange } from '@/lib/inventory/item-audit'
import { bumpItemCodeSequence } from '@/lib/inventory/item-codes'
import type { EntityType } from '@/lib/websocket/events'
import { getEntityConfig, isStockColumnKey, type EntityConfig, type EntityFieldConfig, type StockImportMode } from './entity-config'
import { applyDefaults, getMappedImportFields } from './import-utils'
import { getSchemaTable } from './import-validate'
import {
  broadcastJob, getJob, updateJob,
  type ImportJobOptions, type ImportJobRecord, type ImportRowPayload, type ImportStockLine,
} from './import-job-store'

export const CHUNK_SIZE = 200

/** Keys in row data that are not columns of the target table. */
const COMPAT_KEYS = new Set(['compatibleModels', 'compatibleMake', 'compatibleModel', 'compatibleYearFrom', 'compatibleYearTo'])
const STOCK_KEYS = new Set(['warehouse', 'openingStock', 'minStock', 'reorderQty'])

declare global {
  var __importRunners: Set<string> | undefined
}
function runningSet(): Set<string> {
  if (!globalThis.__importRunners) globalThis.__importRunners = new Set()
  return globalThis.__importRunners
}

/** True while this process is running the job (best-effort; the DB lock is authoritative). */
export function isRunningLocally(jobId: string): boolean {
  return runningSet().has(jobId)
}

export interface RunImportJobParams {
  jobId: string
  tenantId: string
  /** Stop after this many chunks without finalising (tests / time-boxing). */
  maxChunks?: number
  chunkSize?: number
}

interface PendingRow {
  rowIndex: number
  action: string
  payload: ImportRowPayload
  entityId: string | null
}

interface RowOutcome {
  rowIndex: number
  status: 'done' | 'skipped' | 'error'
  action: string
  error?: string | null
  entityId?: string | null
  autoCreated?: number
}

interface CompatMaps {
  makes: Map<string, string>
  models: Map<string, Map<string, string>>
}

interface RunContext {
  job: ImportJobRecord
  tenantId: string
  userId: string
  config: EntityConfig
  fields: EntityFieldConfig[]
  fieldsByKey: Map<string, EntityFieldConfig>
  lookupFields: EntityFieldConfig[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  stockMode: StockImportMode
  /** field key → lower(name) → id (survives chunks of one run) */
  lookupCache: Map<string, Map<string, string>>
  compat: CompatMaps | null
}

function lookupFkColumn(field: EntityFieldConfig): string {
  const e = field.lookup!.entity
  return e === 'categories' ? 'categoryId'
    : e === 'suppliers' ? 'supplierId'
    : e === 'customers' ? 'customerId'
    : e === 'serviceTypeGroups' ? 'groupId'
    : field.key.replace('Name', 'Id')
}

function errorMessage(err: unknown): string {
  if (err instanceof DuplicateError) {
    return `Duplicate ${err.field}${err.value ? ` "${err.value}"` : ''} already exists`
  }
  const pg = getPgError(err)
  if (pg?.code === '23505') return `Duplicate value${pg.detail ? `: ${pg.detail}` : ''}`
  if (pg?.code === '23503') return 'Referenced record does not exist'
  if (pg?.code === '22001') return 'A value is too long'
  if (pg?.code === '22P02' || pg?.code === '22003') return `Invalid value${pg.message ? `: ${pg.message}` : ''}`
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.startsWith('INSUFFICIENT_STOCK:')) return `Insufficient stock: ${msg.slice('INSUFFICIENT_STOCK:'.length)}`
  return msg.slice(0, 500)
}

// ---------------------------------------------------------------- lookups

async function resolveChunkLookups(tx: DbTx, ctx: RunContext, rows: PendingRow[]): Promise<number> {
  let autoCreated = 0
  for (const field of ctx.lookupFields) {
    const cache = ctx.lookupCache.get(field.key) || new Map<string, string>()
    ctx.lookupCache.set(field.key, cache)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table: any = getSchemaTable(field.lookup!.table)
    if (!table) continue
    const wanted = new Map<string, string>() // lower → original
    for (const r of rows) {
      const v = r.payload.data[field.key]
      if (typeof v === 'string' && v.trim()) {
        const key = v.trim().toLowerCase()
        if (!cache.has(key) && !wanted.has(key)) wanted.set(key, v.trim())
      }
    }
    if (wanted.size === 0) continue
    const found = await tx.select({ id: table.id, name: table.name }).from(table)
      .where(and(eq(table.tenantId, ctx.tenantId), inArray(sql`lower(trim(${table.name}))`, Array.from(wanted.keys())))) as { id: string; name: string }[]
    for (const f of found) {
      const key = String(f.name).trim().toLowerCase()
      if (!cache.has(key)) cache.set(key, f.id)
    }
    for (const [key, name] of wanted) {
      if (cache.has(key)) continue
      try {
        const created = await withSavepoint(tx, async (sp) => {
          const [row] = await sp.insert(table).values({ tenantId: ctx.tenantId, name }).returning({ id: table.id }) as { id: string }[]
          return row
        })
        if (created?.id) {
          cache.set(key, created.id)
          autoCreated++
        }
      } catch (err) {
        // Row-level apply reports "Could not resolve …" for rows using this value
        logError('import-job-autocreate', err, { errorSource: 'system', context: { jobId: ctx.job.id, table: field.lookup!.table } })
      }
    }
  }
  return autoCreated
}

async function loadCompat(tx: DbTx): Promise<CompatMaps> {
  const makes = new Map<string, string>()
  const models = new Map<string, Map<string, string>>()
  const allMakes = await tx.select({ id: schema.vehicleMakes.id, name: schema.vehicleMakes.name }).from(schema.vehicleMakes)
  const idToName = new Map<string, string>()
  for (const m of allMakes) {
    makes.set(m.name.toLowerCase(), m.id)
    idToName.set(m.id, m.name.toLowerCase())
  }
  const allModels = await tx.select({ id: schema.vehicleModels.id, name: schema.vehicleModels.name, makeId: schema.vehicleModels.makeId })
    .from(schema.vehicleModels)
  for (const m of allModels) {
    const makeName = idToName.get(m.makeId)
    if (!makeName) continue
    if (!models.has(makeName)) models.set(makeName, new Map())
    models.get(makeName)!.set(m.name.toLowerCase(), m.id)
  }
  return { makes, models }
}

function compatRawOf(data: Record<string, unknown>): string {
  const s = (k: string) => (data[k] != null ? String(data[k]).trim() : '')
  const separateMake = s('compatibleMake')
  const combinedRaw = s('compatibleModels')
  if (!separateMake) return combinedRaw
  const makes = separateMake.split(';').map(x => x.trim()).filter(Boolean)
  const models = s('compatibleModel') ? s('compatibleModel').split(';').map(x => x.trim()) : []
  const yearsFrom = s('compatibleYearFrom') ? s('compatibleYearFrom').split(';').map(x => x.trim()) : []
  const yearsTo = s('compatibleYearTo') ? s('compatibleYearTo').split(';').map(x => x.trim()) : []
  const entries = makes.map((make, i) => {
    let entry = make
    if (models[i]) entry += ` ${models[i]}`
    if (yearsFrom[i] && yearsTo[i]) entry += ` ${yearsFrom[i]}-${yearsTo[i]}`
    else if (yearsFrom[i]) entry += ` ${yearsFrom[i]}-${yearsFrom[i]}`
    return entry
  })
  return combinedRaw ? `${combinedRaw}; ${entries.join('; ')}` : entries.join('; ')
}

function parseCompatibleModels(raw: string): { makeName: string; modelName?: string; yearFrom?: number; yearTo?: number }[] {
  if (!raw || !raw.trim()) return []
  return raw.split(';').map(s => s.trim()).filter(Boolean).map(entry => {
    const yearMatch = entry.match(/\s+(\d{4})\s*[-–]\s*(\d{4})$/)
    let yearFrom: number | undefined
    let yearTo: number | undefined
    let rest = entry
    if (yearMatch) {
      yearFrom = parseInt(yearMatch[1])
      yearTo = parseInt(yearMatch[2])
      rest = entry.slice(0, yearMatch.index!).trim()
    } else {
      const singleYear = rest.match(/\s+(\d{4})$/)
      if (singleYear) {
        yearFrom = parseInt(singleYear[1])
        yearTo = yearFrom
        rest = rest.slice(0, singleYear.index!).trim()
      }
    }
    const parts = rest.split(/\s+/)
    return { makeName: parts[0] || '', modelName: parts.slice(1).join(' ') || undefined, yearFrom, yearTo }
  }).filter(e => e.makeName)
}

/** Returns the number of auto-created makes/models. */
async function insertCompatibility(tx: DbTx, ctx: RunContext, itemId: string, compatRaw: string): Promise<number> {
  if (!ctx.compat) ctx.compat = await loadCompat(tx)
  const { makes, models } = ctx.compat
  let created = 0
  for (const entry of parseCompatibleModels(compatRaw)) {
    const makeKey = entry.makeName.toLowerCase()
    let makeId = makes.get(makeKey)
    if (!makeId) {
      const [m] = await tx.insert(schema.vehicleMakes).values({ name: entry.makeName }).returning({ id: schema.vehicleMakes.id })
      makeId = m.id
      makes.set(makeKey, makeId)
      models.set(makeKey, new Map())
      created++
    }
    let modelId: string | null = null
    if (entry.modelName) {
      const modelMap = models.get(makeKey) || new Map<string, string>()
      models.set(makeKey, modelMap)
      modelId = modelMap.get(entry.modelName.toLowerCase()) || null
      if (!modelId) {
        const [m] = await tx.insert(schema.vehicleModels).values({ makeId, name: entry.modelName }).returning({ id: schema.vehicleModels.id })
        modelId = m.id
        modelMap.set(entry.modelName.toLowerCase(), modelId)
        created++
      }
    }
    await tx.insert(schema.partCompatibility).values({
      tenantId: ctx.tenantId, itemId, makeId, modelId,
      yearFrom: entry.yearFrom || null, yearTo: entry.yearTo || null,
    })
  }
  return created
}

// ---------------------------------------------------------------- value building

/**
 * Convert row data into table column values.
 * `forInsert`: defaults are applied for absent fields.
 * update: only present keys are written (blank = keep); `null` clears the
 * field (not-null fields with a default fall back to that default).
 */
function buildValues(ctx: RunContext, data: Record<string, unknown>, forInsert: boolean): Record<string, unknown> {
  const src = forInsert ? applyDefaults(data, ctx.fields) : data
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(src)) {
    if (value === undefined) continue
    if (COMPAT_KEYS.has(key) || STOCK_KEYS.has(key) || isStockColumnKey(key)) continue
    const field = ctx.fieldsByKey.get(key)
    if (!field) continue
    if (field.type === 'lookup' && field.lookup) {
      const fk = lookupFkColumn(field)
      if (value === null) { out[fk] = null; continue }
      const id = ctx.lookupCache.get(key)?.get(String(value).trim().toLowerCase())
      if (!id) throw new Error(`Could not resolve ${field.label}: "${value}"`)
      out[fk] = id
      continue
    }
    if (!(key in ctx.table)) continue
    if (value === null && field.defaultValue !== undefined) {
      out[key] = applyDefaults({}, [field])[key]
      continue
    }
    out[key] = value
  }
  return out
}

// ---------------------------------------------------------------- stock

async function applyRowStock(tx: DbTx, ctx: RunContext, row: PendingRow, itemId: string, isInsert: boolean): Promise<void> {
  const lines: ImportStockLine[] = row.payload.stock || []
  for (const line of lines) {
    if (line.qty != null && (isInsert || ctx.stockMode !== 'none')) {
      const mode = isInsert || ctx.stockMode === 'set' ? 'set' : 'delta'
      await applyStockChange(tx, {
        tenantId: ctx.tenantId,
        warehouseId: line.warehouseId,
        itemId,
        mode,
        qty: Number(line.qty),
        ...(isInsert ? { type: 'in' as const } : {}),
        referenceType: 'import',
        referenceId: ctx.job.id,
        notes: `Import row ${row.rowIndex}${isInsert ? ' (opening stock)' : ''}`,
        userId: ctx.userId,
        source: 'import',
        idempotencyKey: `import:${ctx.job.id}:${row.rowIndex}:${line.warehouseId}`,
      })
    }
    if (line.minStock != null || line.reorderQty != null) {
      await tx.execute(sql`
        INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock, min_stock, reorder_qty)
        VALUES (${ctx.tenantId}, ${line.warehouseId}, ${itemId}, 0,
                ${String(line.minStock ?? 0)}::numeric, ${line.reorderQty != null ? String(line.reorderQty) : null}::numeric)
        ON CONFLICT (warehouse_id, item_id, tenant_id) DO UPDATE
          SET min_stock = CASE WHEN ${line.minStock != null} THEN EXCLUDED.min_stock ELSE warehouse_stock.min_stock END,
              reorder_qty = CASE WHEN ${line.reorderQty != null} THEN EXCLUDED.reorder_qty ELSE warehouse_stock.reorder_qty END,
              updated_at = now()
      `)
      const parts: string[] = []
      if (line.minStock != null) parts.push(`min stock ${line.minStock}`)
      if (line.reorderQty != null) parts.push(`reorder qty ${line.reorderQty}`)
      await recordItemChange(tx, {
        tenantId: ctx.tenantId,
        itemId,
        userId: ctx.userId,
        source: 'import',
        action: 'stock_threshold',
        importJobId: ctx.job.id,
        notes: `Import set ${parts.join(', ')} (${line.warehouseCode})`,
      })
    }
  }
}

// ---------------------------------------------------------------- row apply

async function applyItemRow(tx: DbTx, ctx: RunContext, row: PendingRow): Promise<RowOutcome> {
  const data = row.payload.data
  const compatRaw = compatRawOf(data)
  let autoCreated = 0

  if (row.action === 'insert') {
    const values = buildValues(ctx, data, true) as CreateItemData
    const { item } = await createItem(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      source: 'import',
      data: values,
      importJobId: ctx.job.id,
    })
    await applyRowStock(tx, ctx, row, item.id, true)
    if (compatRaw) autoCreated += await insertCompatibility(tx, ctx, item.id, compatRaw)
    return { rowIndex: row.rowIndex, status: 'done', action: 'insert', entityId: item.id, autoCreated }
  }

  // update
  if (!row.entityId) throw new Error('No matching record found')
  const [before] = await tx.select().from(schema.items)
    .where(and(eq(schema.items.id, row.entityId), eq(schema.items.tenantId, ctx.tenantId)))
    .for('update')
  if (!before) throw new Error('Record no longer exists')
  const patch = buildValues(ctx, data, false)
  if (typeof patch.itemCode === 'string') await bumpItemCodeSequence(tx, ctx.tenantId, patch.itemCode)
  if (Object.keys(patch).length > 0) {
    const [after] = await tx.update(schema.items).set({
      ...patch,
      version: sql`${schema.items.version} + 1`,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    }).where(eq(schema.items.id, before.id)).returning()
    await recordItemChange(tx, {
      tenantId: ctx.tenantId,
      itemId: before.id,
      userId: ctx.userId,
      source: 'import',
      action: 'update',
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      importJobId: ctx.job.id,
    })
  }
  await applyRowStock(tx, ctx, row, before.id, false)
  return { rowIndex: row.rowIndex, status: 'done', action: 'update', entityId: before.id, autoCreated }
}

async function applyGenericRow(tx: DbTx, ctx: RunContext, row: PendingRow): Promise<RowOutcome> {
  const table = ctx.table
  if (row.action === 'insert') {
    const values = { ...buildValues(ctx, row.payload.data, true), tenantId: ctx.tenantId }
    const [created] = await tx.insert(table).values(values).returning({ id: table.id }) as { id: string }[]
    return { rowIndex: row.rowIndex, status: 'done', action: 'insert', entityId: created?.id ?? null }
  }
  if (!row.entityId) throw new Error('No matching record found')
  const patch = buildValues(ctx, row.payload.data, false)
  if ('updatedAt' in table) patch.updatedAt = new Date()
  if (Object.keys(patch).length === 0) {
    return { rowIndex: row.rowIndex, status: 'done', action: 'update', entityId: row.entityId }
  }
  const res = await tx.update(table).set(patch)
    .where(and(eq(table.id, row.entityId), eq(table.tenantId, ctx.tenantId)))
    .returning({ id: table.id }) as { id: string }[]
  if (res.length === 0) throw new Error('Record no longer exists')
  return { rowIndex: row.rowIndex, status: 'done', action: 'update', entityId: row.entityId }
}

function applyRow(tx: DbTx, ctx: RunContext, row: PendingRow): Promise<RowOutcome> {
  return ctx.config.name === 'items' ? applyItemRow(tx, ctx, row) : applyGenericRow(tx, ctx, row)
}

function failedOutcome(ctx: RunContext, row: PendingRow, err: unknown): RowOutcome {
  // In insert mode a row that became a duplicate after validation is "already exists" (skipped)
  const dup = err instanceof DuplicateError || getPgError(err)?.code === '23505'
  if (dup && row.action === 'insert' && ctx.job.mode === 'insert') {
    return { rowIndex: row.rowIndex, status: 'skipped', action: 'skip', error: `already exists (${errorMessage(err)})` }
  }
  return { rowIndex: row.rowIndex, status: 'error', action: row.action, error: errorMessage(err) }
}

/** Fast path for the whole chunk inside one savepoint; throws on any row failure. */
async function fastPath(tx: DbTx, ctx: RunContext, rows: PendingRow[]): Promise<RowOutcome[]> {
  return withSavepoint(tx, async () => {
    const plainInserts = ctx.config.name !== 'items' && rows.every(r => r.action === 'insert')
    if (plainInserts) {
      const values = rows.map(r => ({ ...buildValues(ctx, r.payload.data, true), tenantId: ctx.tenantId }))
      const created = await tx.insert(ctx.table).values(values).returning({ id: ctx.table.id }) as { id: string }[]
      if (created.length !== rows.length) throw new Error('Bulk insert returned an unexpected row count')
      return rows.map((r, i) => ({ rowIndex: r.rowIndex, status: 'done' as const, action: 'insert', entityId: created[i].id }))
    }
    const out: RowOutcome[] = []
    for (const r of rows) out.push(await applyRow(tx, ctx, r))
    return out
  })
}

async function applyChunk(tx: DbTx, ctx: RunContext, rows: PendingRow[]): Promise<{ outcomes: RowOutcome[]; autoCreated: number }> {
  const autoCreated = await resolveChunkLookups(tx, ctx, rows)
  try {
    return { outcomes: await fastPath(tx, ctx, rows), autoCreated }
  } catch {
    // Savepoint rolled back: makes/models cached during the fast path may be gone
    ctx.compat = null
    const outcomes: RowOutcome[] = []
    for (const r of rows) {
      try {
        outcomes.push(await withSavepoint(tx, () => applyRow(tx, ctx, r)))
      } catch (err) {
        if (compatRawOf(r.payload.data)) ctx.compat = null
        outcomes.push(failedOutcome(ctx, r, err))
      }
    }
    return { outcomes, autoCreated }
  }
}

// ---------------------------------------------------------------- runner

function buildContext(job: ImportJobRecord): RunContext {
  const config = getEntityConfig(job.entityName)
  if (!config || !config.importable) throw new Error(`Unknown import entity: ${job.entityName}`)
  const options = (job.options || {}) as ImportJobOptions
  const fields = getMappedImportFields(config, options.columnMapping || {}, options.businessType)
  const table = getSchemaTable(config.table)
  if (!table) throw new Error('Schema table not found')
  return {
    job,
    tenantId: job.tenantId,
    userId: job.userId,
    config,
    fields,
    fieldsByKey: new Map(fields.map(f => [f.key, f])),
    lookupFields: fields.filter(f => f.type === 'lookup' && f.lookup),
    table,
    stockMode: options.stockMode || 'none',
    lookupCache: new Map(),
    compat: null,
  }
}

type ChunkResult =
  | { kind: 'stopped'; status: string }
  | { kind: 'empty' }
  | { kind: 'applied'; count: number }

async function processNextChunk(ctx: RunContext, chunkSize: number): Promise<ChunkResult> {
  const { tenantId } = ctx
  const jobId = ctx.job.id
  return withTenantTransaction(tenantId, async (tx) => {
    const [locked] = await tx.select({ status: schema.importJobs.status }).from(schema.importJobs)
      .where(and(eq(schema.importJobs.id, jobId), eq(schema.importJobs.tenantId, tenantId)))
      .for('update')
    if (!locked || locked.status !== 'processing') return { kind: 'stopped', status: locked?.status || 'missing' }

    const pending = await tx.select({
      rowIndex: schema.importJobRows.rowIndex,
      action: schema.importJobRows.action,
      payload: schema.importJobRows.payload,
      entityId: schema.importJobRows.entityId,
    }).from(schema.importJobRows)
      .where(and(eq(schema.importJobRows.jobId, jobId), eq(schema.importJobRows.status, 'pending')))
      .orderBy(schema.importJobRows.rowIndex)
      .limit(chunkSize)
    if (pending.length === 0) return { kind: 'empty' }

    const rows: PendingRow[] = pending.map(p => ({
      rowIndex: p.rowIndex,
      action: p.action,
      payload: p.payload as unknown as ImportRowPayload,
      entityId: p.entityId,
    }))
    const { outcomes, autoCreated } = await applyChunk(tx, ctx, rows)

    const statusJson = JSON.stringify(outcomes.map(o => ({
      row_index: o.rowIndex, status: o.status, action: o.action, error: o.error ?? null, entity_id: o.entityId ?? null,
    })))
    await tx.execute(sql`
      UPDATE import_job_rows r
      SET status = v.status, action = v.action, error = v.error, entity_id = COALESCE(v.entity_id, r.entity_id)
      FROM jsonb_to_recordset(${statusJson}::jsonb) AS v(row_index int, status text, action text, error text, entity_id uuid)
      WHERE r.job_id = ${jobId} AND r.row_index = v.row_index AND r.status = 'pending'
    `)

    const inserted = outcomes.filter(o => o.status === 'done' && o.action === 'insert').length
    const updated = outcomes.filter(o => o.status === 'done' && o.action === 'update').length
    const skipped = outcomes.filter(o => o.status === 'skipped').length
    const failed = outcomes.filter(o => o.status === 'error').length
    const created = autoCreated + outcomes.reduce((s, o) => s + (o.status === 'done' ? o.autoCreated || 0 : 0), 0)
    await tx.update(schema.importJobs).set({
      processed: sql`${schema.importJobs.processed} + ${outcomes.length}`,
      inserted: sql`${schema.importJobs.inserted} + ${inserted}`,
      updated: sql`${schema.importJobs.updated} + ${updated}`,
      skipped: sql`${schema.importJobs.skipped} + ${skipped}`,
      failed: sql`${schema.importJobs.failed} + ${failed}`,
      autoCreated: sql`${schema.importJobs.autoCreated} + ${created}`,
      heartbeatAt: new Date(),
    }).where(eq(schema.importJobs.id, jobId))
    return { kind: 'applied', count: outcomes.length }
  })
}

const ENTITY_BROADCAST: Record<string, EntityType> = {
  items: 'item', customers: 'customer', suppliers: 'supplier', categories: 'category',
  vehicles: 'vehicle', 'service-types': 'service',
}

/**
 * Run (or resume) a persisted import job until no pending rows remain.
 * Safe to call concurrently: chunks serialise on the job row lock.
 */
export async function runImportJob(params: RunImportJobParams): Promise<ImportJobRecord | null> {
  const { jobId, tenantId } = params
  const chunkSize = params.chunkSize || CHUNK_SIZE
  const running = runningSet()
  if (running.has(jobId)) return getJob(tenantId, jobId)
  running.add(jobId)
  try {
    const initial = await getJob(tenantId, jobId)
    if (!initial || initial.status === 'done' || initial.status === 'cancelled') return initial

    const started = await updateJob(tenantId, jobId, {
      status: 'processing',
      startedAt: initial.startedAt ?? new Date(),
      heartbeatAt: new Date(),
      errorMessage: null,
      completedAt: null,
    }, ['queued', 'validating', 'processing', 'error', 'interrupted'])
    if (!started) return getJob(tenantId, jobId)
    broadcastJob(started)

    const ctx = buildContext(started)
    let chunks = 0
    for (;;) {
      if (params.maxChunks !== undefined && chunks >= params.maxChunks) return getJob(tenantId, jobId)
      const res = await processNextChunk(ctx, chunkSize)
      if (res.kind === 'stopped') return getJob(tenantId, jobId)
      if (res.kind === 'empty') break
      chunks++
      const snap = await getJob(tenantId, jobId)
      if (snap) broadcastJob(snap)
    }

    const done = await updateJob(tenantId, jobId, { status: 'done', completedAt: new Date(), heartbeatAt: new Date() }, ['processing'])
    const finalJob = done || await getJob(tenantId, jobId)
    if (finalJob) {
      broadcastJob(finalJob)
      const broadcastType = ENTITY_BROADCAST[finalJob.entityName]
      if (done && broadcastType) {
        const imported = finalJob.inserted + finalJob.updated
        logAndBroadcast(tenantId, broadcastType, 'created', '', {
          userId: finalJob.userId,
          activityAction: 'import',
          description: `Imported ${imported} ${ctx.config.label.toLowerCase()} records (${finalJob.inserted} new, ${finalJob.updated} updated, ${finalJob.skipped} skipped, ${finalJob.failed} failed${finalJob.autoCreated > 0 ? `, ${finalJob.autoCreated} lookups auto-created` : ''})`,
          metadata: {
            jobId, mode: finalJob.mode, inserted: finalJob.inserted, updated: finalJob.updated,
            skipped: finalJob.skipped, failed: finalJob.failed, autoCreated: finalJob.autoCreated,
          },
        })
      }
    }
    if (done) {
      const imported = done.inserted + done.updated
      void notify(tenantId, 'import_finished', {
        title: `Import finished: ${ctx.config.label}`,
        body: `${imported} imported (${done.inserted} new, ${done.updated} updated), ${done.skipped} skipped, ${done.failed} failed${done.fileName ? ` — ${done.fileName}` : ''}.`,
        data: { screen: 'alerts', jobId, entity: done.entityName },
        userIds: [done.userId],
      })
    }
    return finalJob
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logError('import-job', err, { errorSource: 'system', context: { jobId } })
    const failed = await updateJob(tenantId, jobId, { status: 'error', errorMessage: message.slice(0, 1000), heartbeatAt: new Date() })
      .catch(() => null)
    if (failed) broadcastJob(failed)
    return failed
  } finally {
    running.delete(jobId)
  }
}

/** Start a job in the background (detached promise). */
export function startImportJobInBackground(jobId: string, tenantId: string): void {
  runImportJob({ jobId, tenantId }).catch((err) => {
    logError('import-job-unhandled', err, { errorSource: 'system', context: { jobId } })
  })
}
