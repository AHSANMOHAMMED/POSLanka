/**
 * Shared work-order helpers (automotive vertical): stock availability for parts and the
 * per-line tax recalculation of a work order's totals.
 *
 * Work orders, held sales, hold-stock estimates and outbound transfers all reserve stock without
 * moving it; parts only leave stock (through the ledger) when the work order is invoiced. Every
 * place that adds parts must therefore check against the same "available" figure.
 */
import { eq, and, sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import {
  workOrderParts, workOrders, items, heldSales, insuranceEstimates, insuranceEstimateItems,
  warehouseStock, stockTransfers, stockTransferItems,
} from '@/lib/db/schema'
import { roundCurrency } from '@/lib/utils/currency'
import { calculateItemTax, aggregateTaxBreakdown } from '@/lib/utils/tax-template'
import { resolveTaxTemplatesForItems, getDefaultTaxTemplate, getEffectiveTaxTemplate } from '@/lib/utils/tax-template-resolver'

/** Work order statuses whose parts hold (reserve) stock. */
export const RESERVING_WORK_ORDER_STATUSES = ['draft', 'confirmed', 'in_progress', 'completed'] as const

export interface AvailableStockOptions {
  /** Ignore this work order's own reservations (the caller accounts for them itself). */
  excludeWorkOrderId?: string
  /** Ignore this estimate's own reservations (the caller accounts for them itself). */
  excludeEstimateId?: string
  /** Lock the warehouse_stock row(s) FOR UPDATE (only inside a transaction). */
  lock?: boolean
}

/**
 * Stock of `itemId` in `warehouseId` (or across all warehouses when null) minus every
 * reservation: active work orders, non-expired held sales, hold-stock estimates and approved /
 * in-transit outbound transfers. Never negative.
 */
export async function getAvailableStock(
  db: DbTx,
  itemId: string,
  warehouseId: string | null,
  opts: AvailableStockOptions = {},
): Promise<number> {
  const item = await db.query.items.findFirst({ where: eq(items.id, itemId), columns: { id: true } })
  if (!item) return 0

  let totalReserved = 0

  // 1. Active (not invoiced / cancelled) work orders in the same warehouse
  const woReserved = await db
    .select({ reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)` })
    .from(workOrderParts)
    .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
    .where(and(
      eq(workOrderParts.itemId, itemId),
      sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`,
      warehouseId ? eq(workOrders.warehouseId, warehouseId) : sql`1=1`,
      opts.excludeWorkOrderId ? sql`${workOrders.id} != ${opts.excludeWorkOrderId}` : sql`1=1`,
    ))
  totalReserved += parseFloat(woReserved[0]?.reservedQty || '0')

  // 2. Non-expired held sales (JSONB cart)
  const held = await db.query.heldSales.findMany({
    where: warehouseId
      ? and(eq(heldSales.warehouseId, warehouseId), sql`${heldSales.expiresAt} > NOW()`)
      : sql`${heldSales.expiresAt} > NOW()`,
  })
  for (const h of held) {
    const cart = h.cartItems as Array<{ itemId: string; quantity: number }>
    if (!Array.isArray(cart)) continue
    for (const c of cart) if (c.itemId === itemId) totalReserved += Number(c.quantity) || 0
  }

  // 3. Hold-stock estimates that have not been turned into a work order yet
  const estReserved = await db
    .select({ reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)` })
    .from(insuranceEstimateItems)
    .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
    .where(and(
      eq(insuranceEstimateItems.itemId, itemId),
      eq(insuranceEstimates.holdStock, true),
      warehouseId ? eq(insuranceEstimates.warehouseId, warehouseId) : sql`1=1`,
      sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
      opts.excludeEstimateId ? sql`${insuranceEstimates.id} != ${opts.excludeEstimateId}` : sql`1=1`,
    ))
  totalReserved += parseFloat(estReserved[0]?.reservedQty || '0')

  // 4. Outbound transfers that are approved / in transit
  if (warehouseId) {
    const trReserved = await db
      .select({ reservedQty: sql<string>`COALESCE(SUM(CAST(${stockTransferItems.quantity} AS DECIMAL)), 0)` })
      .from(stockTransferItems)
      .innerJoin(stockTransfers, eq(stockTransferItems.transferId, stockTransfers.id))
      .where(and(
        eq(stockTransferItems.itemId, itemId),
        eq(stockTransfers.fromWarehouseId, warehouseId),
        sql`${stockTransfers.status} IN ('approved', 'in_transit')`,
      ))
    totalReserved += parseFloat(trReserved[0]?.reservedQty || '0')
  }

  let current = 0
  if (warehouseId) {
    const q = db
      .select({ totalStock: sql<string>`COALESCE(${warehouseStock.currentStock}, '0')` })
      .from(warehouseStock)
      .where(and(eq(warehouseStock.warehouseId, warehouseId), eq(warehouseStock.itemId, itemId)))
    const [row] = opts.lock ? await q.for('update') : await q
    current = parseFloat(row?.totalStock || '0')
  } else {
    const [row] = await db
      .select({ totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)` })
      .from(warehouseStock)
      .where(eq(warehouseStock.itemId, itemId))
    current = parseFloat(row?.totalStock || '0')
  }

  return Math.max(0, current - totalReserved)
}

/** Quantity of `itemId` already on this work order (optionally excluding one part line). */
export async function workOrderItemQty(db: DbTx, workOrderId: string, itemId: string, excludePartId?: string): Promise<number> {
  const [row] = await db
    .select({ qty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)` })
    .from(workOrderParts)
    .where(and(
      eq(workOrderParts.workOrderId, workOrderId),
      eq(workOrderParts.itemId, itemId),
      excludePartId ? sql`${workOrderParts.id} != ${excludePartId}` : sql`1=1`,
    ))
  return parseFloat(row?.qty || '0')
}

/**
 * Recompute subtotal / tax / total of a work order from its lines (per-item tax templates for
 * parts, the tenant default template for labour) and store them on the work order.
 */
export async function recalculateWorkOrderTotals(db: DbTx, workOrderId: string, tenantId: string) {
  const parts = await db.query.workOrderParts.findMany({
    where: eq(workOrderParts.workOrderId, workOrderId),
    columns: { itemId: true, total: true },
  })

  const [servicesResult] = await db
    .select({ servicesTotal: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL)), 0)` })
    .from(sql`work_order_services`)
    .where(sql`work_order_id = ${workOrderId} AND tenant_id = ${tenantId}`)

  const servicesTotal = parseFloat(servicesResult?.servicesTotal || '0')
  const partsTotal = roundCurrency(parts.reduce((s, p) => s + parseFloat(p.total), 0))
  const subtotal = roundCurrency(servicesTotal + partsTotal)

  const defaultTemplate = await getDefaultTaxTemplate(db, tenantId)
  const partItemIds = parts.map(p => p.itemId).filter(Boolean)
  const itemTemplateMap = partItemIds.length > 0 ? await resolveTaxTemplatesForItems(db, partItemIds) : new Map()

  const allBreakdowns = []
  let totalTax = 0
  for (const part of parts) {
    const lineTotal = parseFloat(part.total)
    if (lineTotal <= 0) continue
    const template = getEffectiveTaxTemplate(itemTemplateMap, part.itemId, defaultTemplate)
    const taxResult = calculateItemTax(lineTotal, template)
    totalTax += taxResult.totalTax
    if (taxResult.breakdown.length > 0) allBreakdowns.push(taxResult.breakdown)
  }
  if (servicesTotal > 0) {
    const taxResult = calculateItemTax(servicesTotal, defaultTemplate)
    totalTax += taxResult.totalTax
    if (taxResult.breakdown.length > 0) allBreakdowns.push(taxResult.breakdown)
  }

  totalTax = roundCurrency(totalTax)
  const taxBreakdown = allBreakdowns.length > 0 ? aggregateTaxBreakdown(allBreakdowns) : null
  // Inclusive tax is already inside the line amounts; only exclusive tax is added on top
  const exclusiveTax = roundCurrency(
    (taxBreakdown || []).filter(b => !b.includedInPrice).reduce((s, b) => s + b.amount, 0),
  )
  const total = roundCurrency(subtotal + exclusiveTax)

  await db.update(workOrders)
    .set({ subtotal: String(subtotal), taxAmount: String(totalTax), taxBreakdown, total: String(total), updatedAt: new Date() })
    .where(eq(workOrders.id, workOrderId))

  return { subtotal, taxAmount: totalTax, taxBreakdown, total }
}
