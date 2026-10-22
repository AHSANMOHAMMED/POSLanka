import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import {
  purchaseOrders, purchaseOrderItems, purchaseRequisitions, purchaseRequisitionItems,
  suppliers, warehouses, items as itemsTable, tenants,
} from '@/lib/db/schema'
import { db as rootDb, withTenantTransaction } from '@/lib/db'
import { nextDocNo } from '@/lib/documents/numbering'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { roundCurrency } from '@/lib/utils/currency'
import { getReorderSuggestions } from '@/lib/reports/inventory'
import { logError } from '@/lib/ai/error-logger'
import { resolvePurchasingSettings } from './settings'

/**
 * H3 — turn reorder suggestions into draft purchasing documents.
 *  - 'purchase_order': one draft PO per supplier + warehouse (lines without a supplier are refused)
 *  - 'requisition':    one draft purchase requisition per warehouse (preferred supplier per line)
 * Open POs (incl. drafts) and open requisitions count as "on order" in the suggestions, so the
 * same shortage is not ordered twice.
 */

export interface ReorderLine {
  itemId: string
  warehouseId: string
  supplierId?: string | null
  quantity: number
  unitPrice?: number | null
}

export interface ReorderDocument {
  type: 'purchase_order' | 'requisition'
  id: string
  number: string
  supplierId: string | null
  warehouseId: string
  lineCount: number
  total: number
}

export class ReorderError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'ReorderError'
  }
}

export async function createReorderDocuments(
  tx: DbTx,
  opts: { tenantId: string; userId: string | null; mode: 'purchase_order' | 'requisition'; lines: ReorderLine[]; source?: 'reorder' | 'reorder_auto' },
): Promise<ReorderDocument[]> {
  const lines = opts.lines.filter(l => l.quantity > 0)
  if (lines.length === 0) throw new ReorderError('Nothing to order: all quantities are 0')

  const itemIds = [...new Set(lines.map(l => l.itemId))]
  const itemRows = await tx.select({ id: itemsTable.id, name: itemsTable.name, costPrice: itemsTable.costPrice })
    .from(itemsTable).where(inArray(itemsTable.id, itemIds))
  const itemById = new Map(itemRows.map(r => [r.id, r]))
  for (const id of itemIds) if (!itemById.has(id)) throw new ReorderError('Item not found', 404)
  const whIds = [...new Set(lines.map(l => l.warehouseId))]
  const whRows = await tx.select({ id: warehouses.id }).from(warehouses).where(inArray(warehouses.id, whIds))
  if (whRows.length !== whIds.length) throw new ReorderError('Warehouse not found', 404)
  const supIds = [...new Set(lines.map(l => l.supplierId).filter((x): x is string => !!x))]
  if (supIds.length > 0) {
    const supRows = await tx.select({ id: suppliers.id }).from(suppliers).where(inArray(suppliers.id, supIds))
    if (supRows.length !== supIds.length) throw new ReorderError('Supplier not found', 404)
  }
  // last price from that supplier when the caller did not give one
  const priceOf = async (l: ReorderLine) => {
    if (l.unitPrice !== undefined && l.unitPrice !== null && l.unitPrice >= 0) return roundCurrency(l.unitPrice)
    if (l.supplierId) {
      const res = await tx.execute(sql`
        SELECT last_cost_price FROM item_supplier_costs WHERE item_id = ${l.itemId} AND supplier_id = ${l.supplierId} LIMIT 1
      `)
      const p = parseFloat(((res as unknown as { rows?: { last_cost_price: string }[] }).rows || [])[0]?.last_cost_price || '0')
      if (p > 0) return roundCurrency(p)
    }
    return roundCurrency(parseFloat(itemById.get(l.itemId)!.costPrice || '0'))
  }

  const docs: ReorderDocument[] = []
  if (opts.mode === 'purchase_order') {
    const missing = lines.filter(l => !l.supplierId)
    if (missing.length > 0) {
      throw new ReorderError(`Choose a supplier for: ${missing.map(l => itemById.get(l.itemId)!.name).join(', ')}`)
    }
    const groups = new Map<string, ReorderLine[]>()
    for (const l of lines) {
      const key = `${l.supplierId}:${l.warehouseId}`
      groups.set(key, [...(groups.get(key) || []), l])
    }
    for (const group of groups.values()) {
      const { supplierId, warehouseId } = group[0]
      const orderNo = await nextDocNo(tx, opts.tenantId, 'purchase_order')
      const [po] = await tx.insert(purchaseOrders).values({
        tenantId: opts.tenantId,
        orderNo,
        supplierId: supplierId!,
        warehouseId,
        notes: opts.source === 'reorder_auto' ? 'Auto-reorder' : 'Created from reorder suggestions',
        status: 'draft',
        createdBy: opts.userId,
      }).returning()
      const rowsToInsert = []
      let subtotal = 0
      for (const l of group) {
        const price = await priceOf(l)
        const lineTotal = roundCurrency(l.quantity * price)
        subtotal += lineTotal
        rowsToInsert.push({
          tenantId: opts.tenantId,
          purchaseOrderId: po.id,
          itemId: l.itemId,
          itemName: itemById.get(l.itemId)!.name,
          quantity: l.quantity.toString(),
          unitPrice: price.toString(),
          tax: '0',
          total: lineTotal.toString(),
        })
      }
      await tx.insert(purchaseOrderItems).values(rowsToInsert)
      const taxResult = await recalculateDocumentTax(tx, opts.tenantId,
        rowsToInsert.map(r => ({ itemId: r.itemId, lineTotal: parseFloat(r.quantity) * parseFloat(r.unitPrice) })), { type: 'purchase' })
      let total = roundCurrency(subtotal)
      if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
        total = taxResult.total
        await tx.update(purchaseOrders).set({
          subtotal: taxResult.subtotal.toString(), taxAmount: taxResult.totalTax.toString(),
          taxBreakdown: taxResult.taxBreakdown, total: taxResult.total.toString(), updatedAt: new Date(),
        }).where(eq(purchaseOrders.id, po.id))
      } else {
        await tx.update(purchaseOrders).set({ subtotal: total.toString(), taxAmount: '0', total: total.toString(), updatedAt: new Date() })
          .where(eq(purchaseOrders.id, po.id))
      }
      docs.push({ type: 'purchase_order', id: po.id, number: orderNo, supplierId: supplierId!, warehouseId, lineCount: group.length, total })
    }
    return docs
  }

  const byWarehouse = new Map<string, ReorderLine[]>()
  for (const l of lines) byWarehouse.set(l.warehouseId, [...(byWarehouse.get(l.warehouseId) || []), l])
  for (const [warehouseId, group] of byWarehouse) {
    const requisitionNo = await nextDocNo(tx, opts.tenantId, 'purchase_requisition')
    const priced = []
    for (const l of group) priced.push({ l, price: await priceOf(l) })
    const estimatedTotal = roundCurrency(priced.reduce((s, p) => s + p.l.quantity * p.price, 0))
    const [req] = await tx.insert(purchaseRequisitions).values({
      tenantId: opts.tenantId,
      requisitionNo,
      status: 'draft',
      requestedBy: opts.userId,
      purpose: opts.source === 'reorder_auto' ? 'Auto-reorder (stock at or below minimum)' : 'Reorder (stock at or below minimum)',
      estimatedTotal: estimatedTotal.toString(),
      source: opts.source || 'reorder',
    }).returning()
    await tx.insert(purchaseRequisitionItems).values(priced.map(({ l, price }) => ({
      tenantId: opts.tenantId,
      requisitionId: req.id,
      itemId: l.itemId,
      itemName: itemById.get(l.itemId)!.name,
      quantity: l.quantity.toString(),
      estimatedUnitPrice: price.toString(),
      estimatedTotal: roundCurrency(l.quantity * price).toString(),
      preferredSupplierId: l.supplierId || null,
      warehouseId,
    })))
    docs.push({ type: 'requisition', id: req.id, number: requisitionNo, supplierId: null, warehouseId, lineCount: group.length, total: estimatedTotal })
  }
  return docs
}

/**
 * Daily auto-reorder (cron): for every active tenant with settings.purchasing.autoReorder, turn
 * the current reorder suggestions into draft purchase requisitions (source 'reorder_auto').
 * Requisitions already open for an item count as on order, so a re-run creates nothing new.
 */
export async function runAutoReorder(opts: { tenantIds?: string[] } = {}): Promise<{ tenants: number; requisitions: number; lines: number }> {
  const conds = [eq(tenants.status, 'active'), sql`(${tenants.settings} -> 'purchasing' ->> 'autoReorder') = 'true'`]
  if (opts.tenantIds?.length) conds.push(inArray(tenants.id, opts.tenantIds))
  const list = await rootDb.select({ id: tenants.id, settings: tenants.settings }).from(tenants).where(and(...conds))
  const summary = { tenants: 0, requisitions: 0, lines: 0 }
  for (const t of list) {
    if (!resolvePurchasingSettings(t.settings).autoReorder) continue
    summary.tenants++
    try {
      await withTenantTransaction(t.id, async (tx) => {
        const suggestions = await getReorderSuggestions(tx, t.id)
        const lines: ReorderLine[] = suggestions.data.map(s => ({
          itemId: s.itemId, warehouseId: s.warehouseId, supplierId: s.supplierId, quantity: s.suggestedQty, unitPrice: s.unitCost,
        }))
        if (lines.length === 0) return
        const docs = await createReorderDocuments(tx as unknown as DbTx, { tenantId: t.id, userId: null, mode: 'requisition', lines, source: 'reorder_auto' })
        summary.requisitions += docs.length
        summary.lines += lines.length
      })
    } catch (error) {
      logError('cron/auto-reorder', error, { tenantId: t.id })
    }
  }
  return summary
}
