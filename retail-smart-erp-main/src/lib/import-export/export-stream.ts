// Streaming export: rows are read in chunks of EXPORT_CHUNK (separate short
// tenant transactions) and written to a ReadableStream, so exports are not
// capped and never hold the whole result set in memory.

import { PassThrough, Readable } from 'stream'
import { sql, ilike, and, or, gte, lte, inArray, eq, type SQL } from 'drizzle-orm'
import { withTenant, type TenantDb } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import { escapeLikePattern } from '@/lib/utils/sql'
import { getEntityConfig, getExportFields, STOCK_COLUMN_PREFIX, type EntityConfig, type EntityFieldConfig } from './entity-config'
import { formatExportValue, flattenParentChildRows } from './export-utils'

export const EXPORT_CHUNK = 1000

export interface ExportFilters {
  search?: string | null
  status?: string | null
  startDate?: string | null
  endDate?: string | null
  categoryId?: string | null
  supplierId?: string | null
  warehouseId?: string | null
  movementType?: string | null
  referenceType?: string | null
  orderType?: string | null
  action?: string | null
  entityType?: string | null
}

export interface ExportRequest {
  tenantId: string
  entityName: string
  format: 'csv' | 'xlsx'
  /** Selected field keys (null = all). `warehouseStock` expands to `stock:<CODE>` columns. */
  fields?: string[] | null
  filters?: ExportFilters
  businessType?: string
  chunkSize?: number
}

// Map entity names to their Drizzle table + query config
function getEntityQuery(entityName: string) {
  switch (entityName) {
    case 'items':
      return {
        table: schema.items,
        searchFields: [schema.items.name, schema.items.sku, schema.items.barcode, schema.items.itemCode],
        relations: { category: true, supplier: true },
        orderBy: (t: typeof schema.items) => [sql`${t.name} ASC`],
        transform: (row: Record<string, unknown>) => {
          const cat = row.category as { name: string } | null
          const sup = row.supplier as { name: string } | null
          return { ...row, categoryName: cat?.name || '', supplierName: sup?.name || '' }
        },
      }
    case 'customers':
      return {
        table: schema.customers,
        searchFields: [schema.customers.name, schema.customers.email, schema.customers.phone],
        orderBy: (t: typeof schema.customers) => [sql`${t.name} ASC`],
      }
    case 'suppliers':
      return {
        table: schema.suppliers,
        searchFields: [schema.suppliers.name, schema.suppliers.email],
        orderBy: (t: typeof schema.suppliers) => [sql`${t.name} ASC`],
      }
    case 'categories':
      return {
        table: schema.categories,
        searchFields: [schema.categories.name],
        orderBy: (t: typeof schema.categories) => [sql`${t.name} ASC`],
      }
    case 'vehicles':
      return {
        table: schema.vehicles,
        searchFields: [schema.vehicles.make, schema.vehicles.model, schema.vehicles.licensePlate, schema.vehicles.vin],
        orderBy: (t: typeof schema.vehicles) => [sql`${t.make} ASC`],
      }
    case 'service-types':
      return {
        table: schema.serviceTypes,
        searchFields: [schema.serviceTypes.name],
        relations: { group: true },
        orderBy: (t: typeof schema.serviceTypes) => [sql`${t.name} ASC`],
        transform: (row: Record<string, unknown>) => {
          const grp = row.group as { name: string } | null
          return { ...row, groupName: grp?.name || '' }
        },
      }
    case 'sales':
      return {
        table: schema.sales,
        searchFields: [schema.sales.invoiceNo, schema.sales.customerName],
        dateField: schema.sales.createdAt,
        statusField: schema.sales.status,
        orderBy: (t: typeof schema.sales) => [sql`${t.createdAt} DESC`],
        children: [
          { childTable: schema.saleItems, parentKey: 'saleId', configName: 'saleItems' },
        ],
      }
    case 'purchases':
      return {
        table: schema.purchases,
        searchFields: [schema.purchases.purchaseNo],
        dateField: schema.purchases.createdAt,
        statusField: schema.purchases.status,
        orderBy: (t: typeof schema.purchases) => [sql`${t.createdAt} DESC`],
        children: [
          { childTable: schema.purchaseItems, parentKey: 'purchaseId', configName: 'purchaseItems' },
        ],
      }
    case 'purchase-orders':
      return {
        table: schema.purchaseOrders,
        searchFields: [schema.purchaseOrders.orderNo],
        dateField: schema.purchaseOrders.createdAt,
        statusField: schema.purchaseOrders.status,
        orderBy: (t: typeof schema.purchaseOrders) => [sql`${t.createdAt} DESC`],
      }
    case 'sales-orders':
      return {
        table: schema.salesOrders,
        searchFields: [schema.salesOrders.orderNo],
        dateField: schema.salesOrders.createdAt,
        statusField: schema.salesOrders.status,
        orderBy: (t: typeof schema.salesOrders) => [sql`${t.createdAt} DESC`],
      }
    case 'work-orders':
      return {
        table: schema.workOrders,
        searchFields: [schema.workOrders.orderNo, schema.workOrders.customerName, schema.workOrders.vehiclePlate],
        dateField: schema.workOrders.createdAt,
        statusField: schema.workOrders.status,
        orderBy: (t: typeof schema.workOrders) => [sql`${t.createdAt} DESC`],
        children: [
          { childTable: schema.workOrderServices, parentKey: 'workOrderId', configName: 'workOrderServices' },
          { childTable: schema.workOrderParts, parentKey: 'workOrderId', configName: 'workOrderParts' },
        ],
      }
    case 'stock-movements':
      return {
        table: schema.stockMovements,
        searchFields: [],
        dateField: schema.stockMovements.createdAt,
        orderBy: (t: typeof schema.stockMovements) => [sql`${t.createdAt} DESC`],
      }
    case 'appointments':
      return {
        table: schema.appointments,
        searchFields: [schema.appointments.customerName, schema.appointments.vehiclePlate],
        statusField: schema.appointments.status,
        orderBy: (t: typeof schema.appointments) => [sql`${t.scheduledDate} DESC`],
      }
    case 'activity-logs':
      return {
        table: schema.activityLogs,
        searchFields: [],
        dateField: schema.activityLogs.createdAt,
        orderBy: (t: typeof schema.activityLogs) => [sql`${t.createdAt} DESC`],
      }
    case 'restaurant-orders':
      return {
        table: schema.restaurantOrders,
        searchFields: [schema.restaurantOrders.orderNo],
        dateField: schema.restaurantOrders.createdAt,
        orderBy: (t: typeof schema.restaurantOrders) => [sql`${t.createdAt} DESC`],
      }
    case 'waste-log':
      return {
        table: schema.wasteLog,
        searchFields: [],
        dateField: schema.wasteLog.recordedAt,
        orderBy: (t: typeof schema.wasteLog) => [sql`${t.recordedAt} DESC`],
      }
    case 'refunds':
      return {
        table: schema.refunds,
        searchFields: [],
        dateField: schema.refunds.createdAt,
        orderBy: (t: typeof schema.refunds) => [sql`${t.createdAt} DESC`],
      }
    default:
      return null
  }
}

type EntityQuery = NonNullable<ReturnType<typeof getEntityQuery>>

export function isExportSupported(entityName: string): boolean {
  return getEntityQuery(entityName) !== null
}

function buildWhere(entityName: string, q: EntityQuery, f: ExportFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = []
  if (f.search && q.searchFields.length > 0) {
    const escaped = escapeLikePattern(f.search)
    conditions.push(or(...q.searchFields.map(field => ilike(field, `%${escaped}%`))))
  }
  if (f.status && 'statusField' in q && q.statusField) conditions.push(sql`${q.statusField} = ${f.status}`)
  if ('dateField' in q && q.dateField) {
    if (f.startDate) conditions.push(gte(q.dateField, new Date(f.startDate)))
    if (f.endDate) conditions.push(lte(q.dateField, new Date(f.endDate + 'T23:59:59')))
  }
  if (f.categoryId && entityName === 'items') conditions.push(sql`${schema.items.categoryId} = ${f.categoryId}`)
  if (f.supplierId) {
    if (entityName === 'items') conditions.push(sql`${schema.items.supplierId} = ${f.supplierId}`)
    if (entityName === 'purchases') conditions.push(sql`${schema.purchases.supplierId} = ${f.supplierId}`)
    if (entityName === 'purchase-orders') conditions.push(sql`${schema.purchaseOrders.supplierId} = ${f.supplierId}`)
  }
  if (f.warehouseId && entityName === 'stock-movements') conditions.push(sql`${schema.stockMovements.warehouseId} = ${f.warehouseId}`)
  if (f.movementType && entityName === 'stock-movements') conditions.push(sql`${schema.stockMovements.type} = ${f.movementType}`)
  if (f.referenceType && entityName === 'stock-movements') conditions.push(sql`${schema.stockMovements.referenceType} = ${f.referenceType}`)
  if (f.orderType && entityName === 'restaurant-orders') conditions.push(sql`${schema.restaurantOrders.orderType} = ${f.orderType}`)
  if (f.action && entityName === 'activity-logs') conditions.push(sql`${schema.activityLogs.action} = ${f.action}`)
  if (f.entityType && entityName === 'activity-logs') conditions.push(sql`${schema.activityLogs.entityType} = ${f.entityType}`)
  const present = conditions.filter(Boolean) as SQL[]
  return present.length > 0 ? and(...present) : undefined
}

export async function countExport(req: ExportRequest): Promise<{ count: number; totalCount: number }> {
  const q = getEntityQuery(req.entityName)
  if (!q) throw new Error(`Export not supported for: ${req.entityName}`)
  const where = buildWhere(req.entityName, q, req.filters || {})
  return withTenant(req.tenantId, async (db) => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(q.table).where(where)
    let totalCount = count
    if (where) {
      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(q.table)
      totalCount = total
    }
    return { count, totalCount }
  })
}

async function nameMap(db: TenantDb, ids: string[], kind: 'items' | 'warehouses' | 'users' | 'suppliers' | 'customers' | 'sales'): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  if (kind === 'items') {
    for (const r of await db.select({ id: schema.items.id, v: schema.items.name }).from(schema.items).where(inArray(schema.items.id, ids))) out.set(r.id, r.v)
  } else if (kind === 'warehouses') {
    for (const r of await db.select({ id: schema.warehouses.id, v: schema.warehouses.name }).from(schema.warehouses).where(inArray(schema.warehouses.id, ids))) out.set(r.id, r.v)
  } else if (kind === 'users') {
    for (const r of await db.select({ id: schema.users.id, v: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, ids))) out.set(r.id, r.v)
  } else if (kind === 'suppliers') {
    for (const r of await db.select({ id: schema.suppliers.id, v: schema.suppliers.name }).from(schema.suppliers).where(inArray(schema.suppliers.id, ids))) out.set(r.id, r.v)
  } else if (kind === 'customers') {
    for (const r of await db.select({ id: schema.customers.id, v: schema.customers.name }).from(schema.customers).where(inArray(schema.customers.id, ids))) out.set(r.id, r.v)
  } else {
    for (const r of await db.select({ id: schema.sales.id, v: schema.sales.invoiceNo }).from(schema.sales).where(inArray(schema.sales.id, ids))) out.set(r.id, r.v)
  }
  return out
}

const uniq = (vals: unknown[]) => [...new Set(vals.filter((v): v is string => typeof v === 'string' && v !== ''))]

interface ExportPlan {
  config: EntityConfig
  query: EntityQuery
  where: SQL | undefined
  /** Columns written to the file (flattened for parent-child exports). */
  fields: EntityFieldConfig[]
  /** Parent field list (before child flattening). */
  parentFields: EntityFieldConfig[]
  warehouses: { id: string; code: string }[]
}

export async function planExport(req: ExportRequest): Promise<ExportPlan> {
  const config = getEntityConfig(req.entityName)
  const query = getEntityQuery(req.entityName)
  if (!config || !query) throw new Error(`Export not supported for: ${req.entityName}`)
  let exportFields = getExportFields(config, req.businessType)
  if (req.fields && req.fields.length > 0) {
    const selected = new Set(req.fields)
    exportFields = exportFields.filter(f => selected.has(f.key))
  }
  let warehouses: { id: string; code: string }[] = []
  if (req.entityName === 'items' && exportFields.some(f => f.key === 'warehouseStock')) {
    warehouses = await withTenant(req.tenantId, (db) =>
      db.select({ id: schema.warehouses.id, code: schema.warehouses.code }).from(schema.warehouses)
        .where(eq(schema.warehouses.tenantId, req.tenantId))
        .orderBy(schema.warehouses.code))
    const stockFields: EntityFieldConfig[] = warehouses.map(w => ({
      key: `${STOCK_COLUMN_PREFIX}${w.code.trim().toUpperCase()}`,
      label: `${STOCK_COLUMN_PREFIX}${w.code.trim().toUpperCase()}`,
      type: 'decimal',
      exportOnly: true,
    }))
    exportFields = exportFields.flatMap(f => (f.key === 'warehouseStock' ? stockFields : [f]))
  }
  let fields = exportFields
  if (config.children && config.children.length > 0) {
    fields = flattenParentChildRows([], exportFields, config.children.map(cc => ({ config: cc, data: new Map() }))).fields
  }
  return { config, query, where: buildWhere(req.entityName, query, req.filters || {}), fields, parentFields: exportFields, warehouses }
}

/** Read one chunk of export rows (enriched and, for parent-child entities, flattened). */
async function fetchChunk(db: TenantDb, req: ExportRequest, plan: ExportPlan, offset: number, limit: number): Promise<{ rows: Record<string, unknown>[]; parents: number }> {
  const { query: q, where, config } = plan
  const table = q.table
  const orderBy = [...q.orderBy(table as never), sql`${table.id} ASC`]
  let data: Record<string, unknown>[]

  if ('relations' in q && q.relations) {
    const tableName = config.table.replace(/_([a-z])/g, (_, l) => l.toUpperCase()) as keyof typeof db.query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryObj = db.query[tableName] as any
    data = await queryObj.findMany({ where, with: q.relations, limit, offset, orderBy }) as Record<string, unknown>[]
  } else {
    data = await db.select().from(table).where(where).orderBy(...orderBy).limit(limit).offset(offset) as Record<string, unknown>[]
  }
  const parents = data.length
  if (data.length === 0) return { rows: [], parents }

  if ('transform' in q && q.transform) data = data.map(row => q.transform!(row) as Record<string, unknown>)

  const name = req.entityName
  if (name === 'items') {
    const users = await nameMap(db, uniq(data.map(d => d.updatedBy ?? d.createdBy)), 'users')
    data = data.map(d => ({ ...d, updatedByName: users.get((d.updatedBy ?? d.createdBy) as string) || '' }))
    if (plan.warehouses.length > 0) {
      const ids = data.map(d => d.id as string)
      const stock = await db.select({
        itemId: schema.warehouseStock.itemId, warehouseId: schema.warehouseStock.warehouseId, qty: schema.warehouseStock.currentStock,
      }).from(schema.warehouseStock).where(inArray(schema.warehouseStock.itemId, ids))
      const codeById = new Map(plan.warehouses.map(w => [w.id, `${STOCK_COLUMN_PREFIX}${w.code.trim().toUpperCase()}`]))
      const byItem = new Map<string, Record<string, string>>()
      for (const s of stock) {
        const key = codeById.get(s.warehouseId)
        if (!key) continue
        const m = byItem.get(s.itemId) || {}
        m[key] = String(Number(s.qty))
        byItem.set(s.itemId, m)
      }
      data = data.map(d => {
        const m = byItem.get(d.id as string) || {}
        const out = { ...d }
        for (const w of plan.warehouses) {
          const key = `${STOCK_COLUMN_PREFIX}${w.code.trim().toUpperCase()}`
          out[key] = m[key] ?? '0'
        }
        return out
      })
    }
  }
  if (name === 'stock-movements' || name === 'waste-log') {
    const items = await nameMap(db, uniq(data.map(d => d.itemId)), 'items')
    const whs = name === 'stock-movements' ? await nameMap(db, uniq(data.map(d => d.warehouseId)), 'warehouses') : new Map()
    data = data.map(d => ({ ...d, itemName: items.get(d.itemId as string) || '', warehouseName: whs.get(d.warehouseId as string) || '' }))
  }
  if (name === 'activity-logs') {
    const users = await nameMap(db, uniq(data.map(d => d.userId)), 'users')
    data = data.map(d => ({ ...d, userName: users.get(d.userId as string) || 'System' }))
  }
  if (name === 'purchases' || name === 'purchase-orders') {
    const sup = await nameMap(db, uniq(data.map(d => d.supplierId)), 'suppliers')
    data = data.map(d => ({ ...d, supplierName: sup.get(d.supplierId as string) || '' }))
  }
  if (name === 'refunds') {
    const inv = await nameMap(db, uniq([...data.map(d => d.saleId), ...data.map(d => d.originalSaleId)]), 'sales')
    data = data.map(d => ({ ...d, saleInvoiceNo: inv.get(d.saleId as string) || '', originalInvoiceNo: inv.get(d.originalSaleId as string) || '' }))
  }
  if (name === 'sales-orders') {
    const cus = await nameMap(db, uniq(data.map(d => d.customerId)), 'customers')
    data = data.map(d => ({ ...d, customerName: cus.get(d.customerId as string) || '' }))
  }

  if ('children' in q && q.children && config.children) {
    const parentIds = data.map(d => d.id as string)
    const childData = new Map<string, Map<string, Record<string, unknown>[]>>()
    for (const childDef of q.children) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const childTable = childDef.childTable as any
      const childRows = await db.select().from(childTable).where(inArray(childTable[childDef.parentKey], parentIds)) as Record<string, unknown>[]
      if (childDef.configName === 'workOrderParts') {
        const names = await nameMap(db, uniq(childRows.map(r => r.itemId)), 'items')
        for (const r of childRows) r.itemName = names.get(r.itemId as string) || ''
      }
      const grouped = new Map<string, Record<string, unknown>[]>()
      for (const row of childRows) {
        const pid = row[childDef.parentKey] as string
        if (!grouped.has(pid)) grouped.set(pid, [])
        grouped.get(pid)!.push(row)
      }
      childData.set(childDef.configName, grouped)
    }
    const flat = flattenParentChildRows(data, plan.parentFields, config.children.map(cc => ({
      config: cc, data: childData.get(cc.name) || new Map<string, Record<string, unknown>[]>(),
    })))
    return { rows: flat.rows, parents }
  }
  return { rows: data, parents }
}

/** Async iterator over export row chunks (each chunk is its own short tenant transaction). */
export async function* iterateExportRows(req: ExportRequest, plan?: ExportPlan): AsyncGenerator<Record<string, unknown>[]> {
  const p = plan || await planExport(req)
  const size = req.chunkSize || EXPORT_CHUNK
  for (let offset = 0; ; offset += size) {
    const { rows, parents } = await withTenant(req.tenantId, (db) => fetchChunk(db, req, p, offset, size))
    if (rows.length > 0) yield rows
    if (parents < size) return
  }
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export interface ExportStreamResult {
  stream: ReadableStream<Uint8Array>
  contentType: string
  fileName: string
  fields: EntityFieldConfig[]
  /** Resolves with the number of data rows written once the stream has finished. */
  done: Promise<number>
}

export async function createExportStream(req: ExportRequest): Promise<ExportStreamResult> {
  const plan = await planExport(req)
  const { fields } = plan
  const dateStr = new Date().toISOString().split('T')[0]
  let resolveDone!: (n: number) => void
  let rejectDone!: (e: unknown) => void
  const done = new Promise<number>((res, rej) => { resolveDone = res; rejectDone = rej })
  done.catch(() => { /* surfaced through the stream */ })

  if (req.format === 'xlsx') {
    const mod = await import('exceljs')
    // CJS interop: under some loaders only `default` carries the `stream` namespace
    const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod
    const pass = new PassThrough()
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true, useSharedStrings: false })
    const sheet = workbook.addWorksheet((plan.config.label || 'Export').slice(0, 31))
    sheet.columns = fields.map(f => ({ header: f.label, key: f.key, width: Math.max(f.label.length + 4, 15) }))
    const header = sheet.getRow(1)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    header.commit()
    ;(async () => {
      let n = 0
      for await (const chunk of iterateExportRows(req, plan)) {
        for (const row of chunk) {
          const values: Record<string, unknown> = {}
          for (const f of fields) values[f.key] = formatExportValue(row[f.key], f)
          sheet.addRow(values).commit()
          n++
        }
        // let the consumer drain between chunks
        if (pass.writableNeedDrain) await new Promise(r => pass.once('drain', r))
      }
      sheet.commit()
      await workbook.commit()
      resolveDone(n)
    })().catch((err) => {
      rejectDone(err)
      pass.destroy(err instanceof Error ? err : new Error(String(err)))
    })
    return {
      stream: Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `${req.entityName}_${dateStr}.xlsx`,
      fields,
      done,
    }
  }

  const encoder = new TextEncoder()
  const iterator = iterateExportRows(req, plan)
  let n = 0
  let headerSent = false
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true
          controller.enqueue(encoder.encode('﻿' + fields.map(f => escapeCsv(f.label)).join(',') + '\r\n'))
          return
        }
        const next = await iterator.next()
        if (next.done) {
          controller.close()
          resolveDone(n)
          return
        }
        const lines = next.value.map(row => fields.map(f => escapeCsv(formatExportValue(row[f.key], f))).join(','))
        n += lines.length
        controller.enqueue(encoder.encode(lines.join('\r\n') + '\r\n'))
      } catch (err) {
        rejectDone(err)
        controller.error(err)
      }
    },
    async cancel() {
      await iterator.return(undefined)
      resolveDone(n)
    },
  })
  return { stream, contentType: 'text/csv; charset=utf-8', fileName: `${req.entityName}_${dateStr}.csv`, fields, done }
}
