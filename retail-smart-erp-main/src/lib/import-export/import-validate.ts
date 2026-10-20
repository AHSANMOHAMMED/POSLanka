// Validate phase of a bulk import (NO writes).
// Shared by the preview endpoint, the execute endpoint and tests so that the
// preview shows exactly what the runner will do.

import { and, eq, inArray, sql } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import type { DbTx } from '@/lib/inventory/db-types'
import {
  type EntityConfig, type EntityFieldConfig, type ImportMode, type StockImportMode,
  isStockColumnKey, STOCK_COLUMN_PREFIX,
} from './entity-config'
import { validateRows, getMappedImportFields, type ParsedRow } from './import-utils'
import type { ImportRowAction, ImportStockLine, NewImportRow } from './import-job-store'

export interface ImportValidationOptions {
  matchBy?: string[]
  stockMode?: StockImportMode
}

export interface ValidatedImportRow extends NewImportRow {
  warnings: string[]
}

export interface ImportValidationResult {
  rows: ValidatedImportRow[]
  counts: { total: number; insert: number; update: number; skip: number; error: number }
  matchBy: string[]
  fields: EntityFieldConfig[]
  errors: { row: number; column: string; message: string; value?: unknown }[]
  warnings: { row: number; column: string; message: string }[]
}

export interface ValidateImportParams {
  tenantId: string
  entityConfig: EntityConfig
  rawRows: Record<string, string>[]
  columnMapping: Record<string, string>
  mode: ImportMode
  options?: ImportValidationOptions
  businessType?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSchemaTable(tableName: string): any {
  const tableMap: Record<string, unknown> = {
    categories: schema.categories,
    items: schema.items,
    customers: schema.customers,
    suppliers: schema.suppliers,
    vehicles: schema.vehicles,
    service_types: schema.serviceTypes,
    service_type_groups: schema.serviceTypeGroups,
  }
  return tableMap[tableName] || null
}

/** Items identifiers are matched exactly (the unique indexes are case-sensitive). */
const EXACT_MATCH_FIELDS = new Set(['items.barcode', 'items.sku', 'items.itemCode', 'items.pluCode'])

function isExact(entity: string, field: string): boolean {
  return EXACT_MATCH_FIELDS.has(`${entity}.${field}`)
}

export function normalizeMatchValue(entity: string, field: string, v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (!s) return null
  if (field === 'itemCode') return s.toUpperCase()
  return isExact(entity, field) ? s : s.toLowerCase()
}

/** Effective match fields (options.matchBy filtered to the entity's unique fields, in the given order). */
export function resolveMatchBy(config: EntityConfig, matchBy?: string[]): string[] {
  const allowed = config.uniqueMatchFields || []
  const chosen = (matchBy || []).filter(f => allowed.includes(f))
  return chosen.length ? Array.from(new Set(chosen)) : allowed
}

function fieldLabel(fields: EntityFieldConfig[], key: string): string {
  return fields.find(f => f.key === key)?.label || key
}

interface WarehouseRow { id: string; code: string; name: string; isDefault: boolean; isActive: boolean }

export async function loadWarehouses(db: DbTx, tenantId: string): Promise<WarehouseRow[]> {
  return db.select({
    id: schema.warehouses.id, code: schema.warehouses.code, name: schema.warehouses.name,
    isDefault: schema.warehouses.isDefault, isActive: schema.warehouses.isActive,
  }).from(schema.warehouses).where(eq(schema.warehouses.tenantId, tenantId))
}

function chunkArr<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Existing records keyed by normalised match value, per field. */
async function lookupExisting(
  db: DbTx,
  tenantId: string,
  config: EntityConfig,
  fields: string[],
  rows: ParsedRow[],
): Promise<Map<string, Map<string, string>>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table: any = getSchemaTable(config.table)
  const out = new Map<string, Map<string, string>>()
  if (!table) return out
  for (const field of fields) {
    const col = table[field]
    const map = new Map<string, string>()
    out.set(field, map)
    if (!col) continue
    const values = new Set<string>()
    for (const r of rows) {
      const v = normalizeMatchValue(config.name, field, r.data[field])
      if (v) values.add(v)
    }
    if (values.size === 0) continue
    const exact = isExact(config.name, field)
    for (const part of chunkArr(Array.from(values), 1000)) {
      const target = exact
        ? (field === 'itemCode' ? sql`upper(${col})` : col)
        : sql`lower(trim(${col}))`
      const found = await db.select({ id: table.id, value: col }).from(table)
        .where(and(eq(table.tenantId, tenantId), inArray(target, part))) as { id: string; value: string }[]
      for (const f of found) {
        const key = normalizeMatchValue(config.name, field, f.value)
        if (key && !map.has(key)) map.set(key, f.id)
      }
    }
  }
  return out
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Validate an import without writing anything: normalise rows, detect in-file
 * duplicates, match existing records and decide each row's action.
 */
export async function validateImport(db: DbTx, params: ValidateImportParams): Promise<ImportValidationResult> {
  const { tenantId, entityConfig: config, rawRows, columnMapping, mode, businessType } = params
  const options = params.options || {}
  const stockMode: StockImportMode = options.stockMode || 'none'
  const fields = getMappedImportFields(config, columnMapping, businessType)
  const validation = validateRows(rawRows, config, columnMapping, mode, businessType)
  const isItems = config.name === 'items'

  const matchBy = resolveMatchBy(config, options.matchBy)
  const insertUnique = config.insertUniqueFields || config.uniqueMatchFields || []
  const uniqueFields = Array.from(new Set([...matchBy, ...insertUnique, ...(config.uniqueMatchFields || [])]))

  const errorsOut: ImportValidationResult['errors'] = [...validation.errors]
  const warningsOut: ImportValidationResult['warnings'] = [...validation.warnings]

  type Work = { parsed: ParsedRow; errors: string[]; warnings: string[]; stock: ImportStockLine[] }
  const work: Work[] = [...validation.validRows, ...validation.invalidRows]
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .map(parsed => ({
      parsed,
      errors: parsed.errors.map(e => `${e.column}: ${e.message}`),
      warnings: parsed.warnings.map(w => w.message),
      stock: [],
    }))

  const addError = (w: Work, column: string, message: string, value?: unknown) => {
    w.errors.push(column ? `${column}: ${message}` : message)
    errorsOut.push({ row: w.parsed.rowIndex, column, message, value })
  }
  const addWarning = (w: Work, column: string, message: string) => {
    w.warnings.push(column ? `${column}: ${message}` : message)
    warningsOut.push({ row: w.parsed.rowIndex, column, message })
  }

  // ---- Stock columns (items): resolve warehouses ----
  if (isItems) {
    const usesStock = work.some(w => Object.keys(w.parsed.data).some(k =>
      isStockColumnKey(k) || k === 'warehouse' || k === 'openingStock' || k === 'minStock' || k === 'reorderQty'))
    if (usesStock) {
      const warehouses = await loadWarehouses(db, tenantId)
      const byCode = new Map(warehouses.map(w => [w.code.trim().toUpperCase(), w]))
      const byName = new Map(warehouses.map(w => [w.name.trim().toLowerCase(), w]))
      const active = warehouses.filter(w => w.isActive)
      const fallback = active.find(w => w.isDefault) || (active.length === 1 ? active[0] : undefined)

      for (const w of work) {
        const d = w.parsed.data
        const lines = new Map<string, ImportStockLine>()
        const wantsMain = d.openingStock != null || d.minStock != null || d.reorderQty != null
        if (d.warehouse != null || wantsMain) {
          let wh: WarehouseRow | undefined
          if (d.warehouse != null) {
            const ref = String(d.warehouse).trim()
            wh = byCode.get(ref.toUpperCase()) || byName.get(ref.toLowerCase())
            if (!wh) addError(w, 'Warehouse', `Unknown warehouse "${ref}"`, ref)
          } else {
            wh = fallback
            if (!wh) addError(w, 'Warehouse', 'Warehouse is required for Opening Stock / Min Stock / Reorder Qty')
          }
          if (wh) {
            const qty = toNum(d.openingStock)
            if (qty !== null && qty < 0) addError(w, 'Opening Stock', 'Stock cannot be negative', qty)
            const minStock = toNum(d.minStock)
            if (minStock !== null && minStock < 0) addError(w, 'Min Stock', 'Cannot be negative', minStock)
            const reorderQty = toNum(d.reorderQty)
            if (reorderQty !== null && reorderQty < 0) addError(w, 'Reorder Qty', 'Cannot be negative', reorderQty)
            if (qty !== null || minStock !== null || reorderQty !== null) {
              lines.set(wh.id, { warehouseId: wh.id, warehouseCode: wh.code, qty, minStock, reorderQty })
            }
          }
        }
        for (const key of Object.keys(d)) {
          if (!isStockColumnKey(key)) continue
          const code = key.slice(STOCK_COLUMN_PREFIX.length).toUpperCase()
          const qty = toNum(d[key])
          if (qty === null) continue
          const wh = byCode.get(code)
          if (!wh) { addError(w, key, `Unknown warehouse code "${code}"`); continue }
          if (qty < 0) { addError(w, key, 'Stock cannot be negative', qty); continue }
          const existing = lines.get(wh.id)
          if (existing && existing.qty != null && existing.qty !== qty) {
            addError(w, key, `Conflicts with Opening Stock for warehouse ${wh.code}`)
            continue
          }
          lines.set(wh.id, { ...(existing || { warehouseId: wh.id, warehouseCode: wh.code }), qty })
        }
        w.stock = Array.from(lines.values())
      }
    }
  }

  // ---- Lookup warnings (auto-created during apply) ----
  const lookupFields = fields.filter(f => f.type === 'lookup' && f.lookup)
  for (const field of lookupFields) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table: any = getSchemaTable(field.lookup!.table)
    if (!table) continue
    const values = new Set<string>()
    for (const w of work) {
      const v = w.parsed.data[field.key]
      if (typeof v === 'string' && v.trim()) values.add(v.trim().toLowerCase())
    }
    if (values.size === 0) continue
    const known = new Set<string>()
    for (const part of chunkArr(Array.from(values), 1000)) {
      const found = await db.select({ name: table.name }).from(table)
        .where(and(eq(table.tenantId, tenantId), inArray(sql`lower(trim(${table.name}))`, part))) as { name: string }[]
      for (const f of found) known.add(String(f.name).trim().toLowerCase())
    }
    const warned = new Set<string>()
    for (const w of work) {
      const v = w.parsed.data[field.key]
      if (typeof v !== 'string' || !v.trim()) continue
      const key = v.trim().toLowerCase()
      if (!known.has(key) && !warned.has(key)) {
        warned.add(key)
        addWarning(w, field.label, `"${v}" not found in ${field.lookup!.entity} — will be auto-created`)
      }
    }
  }

  // ---- In-file duplicates on unique fields: later rows are errors ----
  for (const field of uniqueFields) {
    const seen = new Map<string, number>()
    for (const w of work) {
      if (w.errors.length) continue
      const v = normalizeMatchValue(config.name, field, w.parsed.data[field])
      if (!v) continue
      const first = seen.get(v)
      if (first !== undefined) {
        addError(w, fieldLabel(fields, field), `duplicate of row ${first} (${fieldLabel(fields, field)} "${w.parsed.data[field]}")`)
      } else {
        seen.set(v, w.parsed.rowIndex)
      }
    }
  }

  // ---- Match existing records ----
  const existing = await lookupExisting(db, tenantId, config, uniqueFields, work.filter(w => !w.errors.length).map(w => w.parsed))
  const existingId = (field: string, value: unknown) => {
    const v = normalizeMatchValue(config.name, field, value)
    return v ? existing.get(field)?.get(v) ?? null : null
  }

  const rows: ValidatedImportRow[] = []
  const counts = { total: work.length, insert: 0, update: 0, skip: 0, error: 0 }
  const updateTargets = new Map<string, number>()

  for (const w of work) {
    const d = w.parsed.data
    let action: ImportRowAction = 'none'
    let status: NewImportRow['status'] = 'error'
    let entityId: string | null = null
    let message: string | null = null

    if (!w.errors.length) {
      let matchId: string | null = null
      let hasMatchValue = false
      for (const f of matchBy) {
        if (normalizeMatchValue(config.name, f, d[f])) hasMatchValue = true
        const id = existingId(f, d[f])
        if (id) { matchId = id; break }
      }

      // Unique values in the row that belong to some record
      const conflicts = (excludeId: string | null) => insertUnique
        .map(f => ({ f, id: existingId(f, d[f]) }))
        .filter(c => c.id && c.id !== excludeId)

      if (mode === 'insert') {
        const c = conflicts(null)
        if (c.length) {
          action = 'skip'; status = 'skipped'; entityId = c[0].id
          message = `already exists (${fieldLabel(fields, c[0].f)} "${d[c[0].f]}")`
        } else {
          action = 'insert'; status = 'pending'
        }
      } else if (matchId) {
        const c = conflicts(matchId)
        const firstRow = updateTargets.get(matchId)
        if (c.length) {
          message = `${fieldLabel(fields, c[0].f)} "${d[c[0].f]}" belongs to another record`
        } else if (firstRow !== undefined) {
          message = `duplicate of row ${firstRow} (same record)`
        } else {
          updateTargets.set(matchId, w.parsed.rowIndex)
          action = 'update'; status = 'pending'; entityId = matchId
        }
      } else if (mode === 'update') {
        message = hasMatchValue
          ? 'No matching record found'
          : `A match value is required (${matchBy.map(f => fieldLabel(fields, f)).join(' / ')})`
      } else {
        // upsert → insert
        const missing = w.parsed.missingRequired || []
        const c = conflicts(null)
        if (missing.length) {
          message = missing.map(l => `${l} is required`).join('; ')
        } else if (c.length) {
          message = `${fieldLabel(fields, c[0].f)} "${d[c[0].f]}" already used by another record`
        } else {
          action = 'insert'; status = 'pending'
        }
      }
      if (status === 'error' && message) addError(w, '', message)
    } else {
      message = w.errors.join('; ')
    }

    if (action === 'update' && isItems && stockMode === 'none' && w.stock.some(l => l.qty != null)) {
      addWarning(w, 'Stock', 'stock quantities ignored for existing items (stock mode: none)')
    }

    counts[action === 'insert' ? 'insert' : action === 'update' ? 'update' : action === 'skip' ? 'skip' : 'error']++
    rows.push({
      rowIndex: w.parsed.rowIndex,
      action,
      status,
      error: message,
      entityId,
      warnings: w.warnings,
      payload: {
        raw: w.parsed.raw || {},
        data: d,
        ...(w.stock.length ? { stock: w.stock } : {}),
        ...(w.warnings.length ? { warnings: w.warnings } : {}),
      },
    })
  }

  return { rows, counts, matchBy, fields, errors: errorsOut, warnings: warningsOut }
}
