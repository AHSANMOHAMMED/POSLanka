/**
 * W8 — sales returns.
 *
 * Single implementation used by POST /api/sales (isReturn), POST /api/sales/exchange,
 * POST /api/sales/[id]/remove-lines and the integration tests. Everything runs inside the
 * caller's transaction:
 *
 *  1. the original sale row is locked FOR UPDATE, so concurrent returns of the same invoice
 *     serialise and each one sees the other's `sale_items.returned_quantity`;
 *  2. every return line is bound to an original sale line (`originalSaleItemId`, legacy
 *     fallback: first line of the same item with quantity left) and capped at
 *     quantity - returned_quantity;
 *  3. the price is forced to what the customer actually paid for that line (unit price minus
 *     the line discount and its share of the sale discount) and the line's tax is reversed
 *     proportionally — client prices and client refund amounts are never trusted;
 *  4. stock comes back through the ledger (applyStockChange, idempotency key
 *     `return:<returnSaleId>:<returnLineId>`), serials are verified against the original sale
 *     and made sellable again;
 *  5. the refund is bounded: never more than the computed return value, and cash/card refunds
 *     never more than what the sale was paid with by that method minus earlier refunds.
 *
 * Manual returns (no invoice) need a reason, use catalogue prices and are flagged
 * `return_reason = 'no_receipt'`.
 *
 * Batches (D1): sale lines record the batches they drew from (sale_item_batches); a return puts
 * the quantity back into those batches, last allocation first (restoreSaleLineBatches), and the
 * return line records where it went.
 *
 * Restock mode (D1, tenants.settings.returns.restockMode): 'stock' (default) puts returned goods
 * back into the sale's warehouse; 'quarantine' moves them into the tenant's quarantine warehouse
 * (code QUARANTINE, ledger referenceType 'return_quarantine', batches with status 'quarantine'),
 * leaving sellable stock unchanged. serialReturnStatus ('available' | 'defective') sets the status
 * of serials coming back. Both default from the tenant settings when the caller does not pass them.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  sales, saleItems, items, payments, refunds, customers, customerCreditTransactions,
  loyaltyTransactions, itemSerialNumbers,
} from '@/lib/db/schema'
import { applyStockChanges, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { allocateSerials, transferSerials } from '@/lib/inventory/serial-numbers'
import type { DbTx } from '@/lib/inventory/db-types'
import { roundCurrency } from '@/lib/utils/currency'
import { postSaleToGL } from '@/lib/accounting/auto-post'
import { restoreSaleLineBatches, getSaleLineBatches, type RestoredBatch, type SaleLineBatchInfo } from '@/lib/inventory/batches'
import { getOrCreateQuarantineWarehouse } from '@/lib/inventory/quarantine'
import { getTenantSalesSettings, type RestockMode } from './return-settings'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'

export type SaleRow = typeof sales.$inferSelect
export type SaleItemRow = typeof saleItems.$inferSelect
/** 'original' = split the refund across the original sale's own payment methods */
export type RefundMethod = 'cash' | 'card' | 'credit' | 'original'
export type ReturnStatus = 'none' | 'partial' | 'full'

/** Business-rule failure with an HTTP status; routes map it with `saleFlowErrorResponse`. */
export class SaleFlowError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'SaleFlowError'
  }
}

const EPS = 0.005
const round3 = (n: number) => Math.round(n * 1000) / 1000
const num = (v: string | number | null | undefined) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '0')
  return Number.isFinite(n) ? n : 0
}

// ==================== PRICING ====================

export interface SalePricing {
  /** prices on this sale already include tax (total = subtotal - discount) */
  taxInclusive: boolean
  /** fraction of every line's net amount removed by the sale-level discount */
  discountRatio: number
  /** per original line: net (after line + sale discount) and tax, for the full line quantity */
  lines: Map<string, { net: number; tax: number; qty: number }>
}

/**
 * Work out what the customer paid per original line. Tax: the line's own tax_amount when the
 * lines add up to the sale's tax, otherwise the sale tax spread by line net value.
 */
export function computeSalePricing(sale: Pick<SaleRow, 'subtotal' | 'discountAmount' | 'taxAmount' | 'total'>, lines: SaleItemRow[]): SalePricing {
  const positive = lines.filter((l) => num(l.quantity) > 0)
  const sumLines = positive.reduce((s, l) => s + num(l.total), 0)
  const subtotal = num(sale.subtotal) > 0 ? num(sale.subtotal) : sumLines
  const discount = Math.max(0, num(sale.discountAmount))
  const saleTax = Math.max(0, num(sale.taxAmount))
  const total = num(sale.total)
  const discountRatio = subtotal > 0 ? Math.min(1, Math.max(0, discount / subtotal)) : 0
  const exclusiveGap = Math.abs(subtotal - discount + saleTax - total)
  const inclusiveGap = Math.abs(subtotal - discount - total)
  const taxInclusive = saleTax > 0 && inclusiveGap + EPS < exclusiveGap

  const lineTaxSum = positive.reduce((s, l) => s + Math.max(0, num(l.taxAmount)), 0)
  const useLineTax = Math.abs(lineTaxSum - saleTax) <= 0.05
  const nets = positive.map((l) => num(l.total) * (1 - discountRatio))
  const netSum = nets.reduce((s, n) => s + n, 0)

  const map = new Map<string, { net: number; tax: number; qty: number }>()
  positive.forEach((l, i) => {
    const net = nets[i]
    const tax = useLineTax ? Math.max(0, num(l.taxAmount)) : (netSum > 0 ? saleTax * (net / netSum) : 0)
    map.set(l.id, { net, tax, qty: num(l.quantity) })
  })
  return { taxInclusive, discountRatio, lines: map }
}

/** Refund value of `qty` units of an original line: { net, tax, gross } (gross = what is paid back). */
export function lineRefundValue(pricing: SalePricing, lineId: string, qty: number) {
  const line = pricing.lines.get(lineId)
  if (!line || !(line.qty > 0)) return { net: 0, tax: 0, gross: 0 }
  const f = qty / line.qty
  const net = line.net * f
  const tax = line.tax * f
  return { net, tax, gross: pricing.taxInclusive ? net : net + tax }
}

export function returnStatusOf(lines: Array<Pick<SaleItemRow, 'quantity' | 'returnedQuantity'>>): ReturnStatus {
  const positive = lines.filter((l) => num(l.quantity) > 0)
  if (positive.length === 0) return 'none'
  const any = positive.some((l) => num(l.returnedQuantity) > 0)
  if (!any) return 'none'
  return positive.every((l) => num(l.returnedQuantity) + 0.0005 >= num(l.quantity)) ? 'full' : 'partial'
}

// ==================== RETURN ====================

export interface ReturnContext {
  tenantId: string
  userId: string
}

export interface ReturnLineInput {
  /** The original sale line (required for new clients). */
  originalSaleItemId?: string | null
  /** Legacy fallback when originalSaleItemId is missing; also the item for manual returns. */
  itemId?: string | null
  /** Quantity to return (sign ignored). */
  quantity: number
  serialNumberIds?: string[] | null
  name?: string | null
}

export interface CreateReturnInput {
  /** Original sale (null/undefined → manual return without receipt). */
  originalSaleId?: string | null
  lines: ReturnLineInput[]
  refundMethod: RefundMethod
  /** Client's expectation; rejected when above the computed value. */
  clientRefundAmount?: number | null
  customerId?: string | null
  warehouseId?: string | null
  posOpeningEntryId?: string | null
  costCenterId?: string | null
  clientSaleId?: string | null
  offlineRef?: string | null
  reason?: string | null
  notes?: string | null
  /**
   * Exchange only: part of the refund applied to the new sale instead of being paid out.
   * The return still records the full value; only `refund - offset` leaves the till.
   */
  offsetAmount?: number
  /** Status for serials coming back (default: tenant setting, else 'available'). */
  serialReturnStatus?: 'available' | 'defective'
  /** Where returned goods go (default: tenant setting, else 'stock'). */
  restockMode?: RestockMode
}

export interface CreatedReturnLine {
  id: string
  originalSaleItemId: string | null
  itemId: string | null
  itemName: string
  quantity: number
  unitPrice: number
  net: number
  tax: number
  gross: number
  serialNumberIds: string[]
  /** Batches the returned quantity went back into (D1). */
  batches: RestoredBatch[]
}

export interface CreateReturnResult {
  returnSale: SaleRow
  originalSale: SaleRow | null
  lines: CreatedReturnLine[]
  /** Total value of the returned goods incl. tax (positive). */
  refundTotal: number
  refundNet: number
  refundTax: number
  /** Amount actually paid back to the customer (refundTotal - offset). */
  refundPaidOut: number
  offsetAmount: number
  /** Payment method used for the exchange offset rows. */
  offsetMethod: 'cash' | 'card'
  refundMethod: RefundMethod
  /** Per-method payout when refunding to the original payment methods */
  refundSplits: Array<{ method: string; amount: number }>
  /** Return status of the original sale after this return. */
  returnStatus: ReturnStatus
  stockChanges: Array<{ result: StockChangeResult; input: StockChangeInput }>
  affectedItemIds: string[]
  warehouseId: string
  /** Warehouse that received the returned stock (quarantine warehouse in quarantine mode). */
  stockWarehouseId: string
  restockMode: RestockMode
  customerId: string | null
}

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

interface PlannedLine {
  original: SaleItemRow | null
  itemId: string | null
  itemName: string
  qty: number
  net: number
  tax: number
  gross: number
  costPrice: number
  trackStock: boolean
  trackSerials: boolean
  serialIds: string[]
}

/**
 * Create a return (RTN-) inside `tx`. Throws SaleFlowError for business-rule violations.
 */
export async function createReturnInTx(tx: DbTx, ctx: ReturnContext, input: CreateReturnInput): Promise<CreateReturnResult> {
  const { tenantId, userId } = ctx
  if (!input.lines.length) throw new SaleFlowError(400, 'EMPTY_RETURN', 'Select at least one item to return')
  for (const l of input.lines) {
    const q = Math.abs(num(l.quantity))
    if (!(q > 0)) throw new SaleFlowError(400, 'INVALID_QUANTITY', 'Return quantity must be greater than zero')
  }

  let original: SaleRow | null = null
  let originalLines: SaleItemRow[] = []
  let pricing: SalePricing | null = null

  if (input.originalSaleId) {
    // 1. lock the original sale: all return writers for this invoice serialise here
    const [locked] = await tx.select().from(sales).where(eq(sales.id, input.originalSaleId)).for('update')
    if (!locked || locked.tenantId !== tenantId) throw new SaleFlowError(404, 'SALE_NOT_FOUND', 'Original sale not found')
    if (locked.status === 'void') throw new SaleFlowError(400, 'SALE_VOID', 'Cannot process return against a voided sale')
    if (locked.isReturn) throw new SaleFlowError(400, 'SALE_IS_RETURN', 'Cannot return a return document')
    original = locked
    originalLines = await tx.select().from(saleItems).where(eq(saleItems.saleId, locked.id)).for('update')
    pricing = computeSalePricing(locked, originalLines)
  } else if (!input.reason || !input.reason.trim()) {
    throw new SaleFlowError(400, 'REASON_REQUIRED', 'A reason is required for a return without a receipt')
  }

  // Items referenced by the return
  const itemIdSet = new Set<string>()
  for (const l of input.lines) if (l.itemId) itemIdSet.add(l.itemId)
  for (const l of originalLines) if (l.itemId) itemIdSet.add(l.itemId)
  const itemRows = itemIdSet.size > 0
    ? await tx.select().from(items).where(inArray(items.id, [...itemIdSet]))
    : []
  const itemById = new Map(itemRows.map((i) => [i.id, i]))

  const planned: PlannedLine[] = []

  if (original && pricing) {
    // 2. bind lines to original sale lines, cumulative within this request
    const used = new Map<string, number>()
    const remainingOf = (line: SaleItemRow) =>
      round3(num(line.quantity) - num(line.returnedQuantity) - (used.get(line.id) || 0))

    // serials already returned against this sale
    const priorReturnLines = rows<{ original_sale_item_id: string | null; item_id: string | null; serial_number_ids: string[] | null }>(
      await tx.execute(sql`
        SELECT ri.original_sale_item_id, ri.item_id, ri.serial_number_ids
        FROM sale_items ri JOIN sales r ON r.id = ri.sale_id
        WHERE r.return_against = ${original.id} AND r.is_return = true AND r.status <> 'void'
      `),
    )
    const returnedSerials = new Set<string>()
    for (const r of priorReturnLines) for (const s of r.serial_number_ids || []) returnedSerials.add(s)

    for (const l of input.lines) {
      const qty = round3(Math.abs(num(l.quantity)))
      let line: SaleItemRow | undefined
      if (l.originalSaleItemId) {
        line = originalLines.find((ol) => ol.id === l.originalSaleItemId)
        if (!line) throw new SaleFlowError(400, 'LINE_NOT_IN_SALE', 'Returned line does not belong to the original sale')
      } else {
        const candidates = originalLines.filter((ol) =>
          num(ol.quantity) > 0 && ((l.itemId && ol.itemId === l.itemId) || (!l.itemId && l.name && ol.itemName === l.name)))
        if (candidates.length === 0) {
          throw new SaleFlowError(400, 'ITEM_NOT_IN_SALE', `Item "${l.name || l.itemId || ''}" was not in the original sale`)
        }
        line = candidates.find((c) => remainingOf(c) > 0) || candidates[0]
      }
      if (!(num(line.quantity) > 0)) throw new SaleFlowError(400, 'LINE_NOT_RETURNABLE', `"${line.itemName}" cannot be returned`)
      const item = line.itemId ? itemById.get(line.itemId) : undefined
      if (item?.isGiftCard) {
        throw new SaleFlowError(400, 'GIFT_CARD_NOT_RETURNABLE', `Gift card item "${line.itemName}" cannot be returned`)
      }
      const remaining = remainingOf(line)
      if (qty > remaining + 0.0005) {
        if (remaining <= 0) throw new SaleFlowError(400, 'ALREADY_RETURNED', `Item "${line.itemName}" has already been fully returned`)
        throw new SaleFlowError(400, 'QTY_EXCEEDS_REMAINING',
          `Cannot return ${qty} of "${line.itemName}". Only ${remaining} remaining (${round3(num(line.quantity) - remaining)} already returned)`,
          { originalSaleItemId: line.id, remaining })
      }
      used.set(line.id, round3((used.get(line.id) || 0) + qty))

      // serials: must have been sold on this line and not returned yet
      const lineSerials = ((line.serialNumberIds as string[] | null) || [])
      const available = lineSerials.filter((s) => !returnedSerials.has(s))
      let serialIds: string[] = []
      if (l.serialNumberIds && l.serialNumberIds.length > 0) {
        const bad = l.serialNumberIds.filter((s) => !available.includes(s))
        if (bad.length > 0) {
          throw new SaleFlowError(400, 'SERIAL_NOT_IN_SALE', `Serial number(s) were not sold on this invoice line or were already returned`, { serialNumberIds: bad })
        }
        serialIds = [...new Set(l.serialNumberIds)]
      } else if (lineSerials.length > 0) {
        if (!Number.isInteger(qty)) throw new SaleFlowError(400, 'SERIAL_QTY', `"${line.itemName}" is serial-tracked: return whole units`)
        serialIds = available.slice(0, qty)
      }
      if (lineSerials.length > 0 && serialIds.length !== qty) {
        throw new SaleFlowError(400, 'SERIAL_MISMATCH', `"${line.itemName}" requires ${qty} serial number(s), got ${serialIds.length}`)
      }
      for (const s of serialIds) returnedSerials.add(s)

      const v = lineRefundValue(pricing, line.id, qty)
      planned.push({
        original: line,
        itemId: line.itemId,
        itemName: line.itemName,
        qty,
        net: v.net,
        tax: v.tax,
        gross: v.gross,
        costPrice: item ? num(item.costPrice) : 0,
        trackStock: !!item?.trackStock,
        trackSerials: !!item?.trackSerialNumbers,
        serialIds,
      })
    }
  } else {
    // Manual return: catalogue prices, tax recomputed from templates
    const base: Array<{ item: typeof items.$inferSelect; qty: number; serialIds: string[] }> = []
    for (const l of input.lines) {
      if (!l.itemId) throw new SaleFlowError(400, 'ITEM_REQUIRED', 'Returns without a receipt must reference catalogue items')
      const item = itemById.get(l.itemId)
      if (!item) throw new SaleFlowError(400, 'ITEM_NOT_FOUND', 'Invalid item in return')
      if (item.isGiftCard) throw new SaleFlowError(400, 'GIFT_CARD_NOT_RETURNABLE', `Gift card item "${item.name}" cannot be returned`)
      base.push({ item, qty: round3(Math.abs(num(l.quantity))), serialIds: [...new Set(l.serialNumberIds || [])] })
    }
    const taxResult = await recalculateDocumentTax(tx, tenantId,
      base.map((b) => ({ itemId: b.item.id, lineTotal: roundCurrency(num(b.item.sellingPrice) * b.qty) })),
      { type: 'sales' })
    base.forEach((b, i) => {
      const lineTotal = roundCurrency(num(b.item.sellingPrice) * b.qty)
      const per = taxResult.perItemTax[i]
      const tax = per ? per.taxAmount : 0
      const gross = per ? per.totalAmount : lineTotal
      if (b.serialIds.length > 0 && b.serialIds.length !== b.qty) {
        throw new SaleFlowError(400, 'SERIAL_MISMATCH', `"${b.item.name}" requires ${b.qty} serial number(s), got ${b.serialIds.length}`)
      }
      planned.push({
        original: null,
        itemId: b.item.id,
        itemName: b.item.name,
        qty: b.qty,
        net: lineTotal,
        tax,
        gross,
        costPrice: num(b.item.costPrice),
        trackStock: !!b.item.trackStock,
        trackSerials: !!b.item.trackSerialNumbers,
        serialIds: b.serialIds,
      })
    })
  }

  // 3. totals
  let refundNet = roundCurrency(planned.reduce((s, p) => s + roundCurrency(p.net), 0))
  let refundTax = roundCurrency(planned.reduce((s, p) => s + roundCurrency(p.tax), 0))
  let refundTotal = roundCurrency(planned.reduce((s, p) => s + p.gross, 0))

  if (original) {
    // never refund more than the sale is still worth; snap the last return to the exact remainder
    const [prior] = rows<{ total: string | null }>(await tx.execute(sql`
      SELECT COALESCE(SUM(ABS(total)), 0) AS total FROM sales
      WHERE return_against = ${original.id} AND is_return = true AND status <> 'void'
    `))
    const remainingValue = roundCurrency(Math.max(0, Math.abs(num(original.total)) - num(prior?.total)))
    const willBeFull = originalLines
      .filter((l) => num(l.quantity) > 0)
      .every((l) => {
        const extra = planned.filter((p) => p.original?.id === l.id).reduce((s, p) => s + p.qty, 0)
        return num(l.returnedQuantity) + extra + 0.0005 >= num(l.quantity)
      })
    if (refundTotal > remainingValue || (willBeFull && Math.abs(refundTotal - remainingValue) <= 1)) {
      const diff = roundCurrency(remainingValue - refundTotal)
      refundTotal = remainingValue
      if (pricing?.taxInclusive) refundNet = roundCurrency(refundNet + diff)
      else refundNet = roundCurrency(Math.max(0, refundTotal - refundTax))
      if (refundNet < 0) { refundNet = 0; refundTax = refundTotal }
    }
  }

  if (input.clientRefundAmount !== undefined && input.clientRefundAmount !== null
      && roundCurrency(input.clientRefundAmount) > refundTotal + 0.01) {
    throw new SaleFlowError(400, 'REFUND_EXCEEDS_COMPUTED',
      `Refund amount ${roundCurrency(input.clientRefundAmount).toFixed(2)} exceeds the value of the returned items (${refundTotal.toFixed(2)})`,
      { computedRefund: refundTotal })
  }

  const offsetAmount = roundCurrency(Math.min(Math.max(0, input.offsetAmount || 0), refundTotal))
  const refundPaidOut = roundCurrency(refundTotal - offsetAmount)
  const requestedRefundMethod = input.refundMethod
  /** Refund split across the original payment methods (refundMethod 'original') */
  let refundSplits: Array<{ method: string; amount: number }> = []
  /** method of the internal offset rows (exchange): the payout method, or cash when nothing is paid out */
  const offsetMethod: 'cash' | 'card' = refundPaidOut > 0 && requestedRefundMethod === 'card' ? 'card' : 'cash'
  const customerId = input.customerId || original?.customerId || null

  // 4. refund bounds
  if (refundPaidOut > 0 && requestedRefundMethod === 'original') {
    if (!original) throw new SaleFlowError(400, 'ORIGINAL_SALE_REQUIRED', 'Refund to original payment methods needs the original invoice')
    // Remaining refundable per method = paid by that method on the sale − earlier refunds by it.
    // Store credit used / gift cards are not paid back in cash; those go to store credit.
    const paidRows = rows<{ method: string; paid: string }>(await tx.execute(sql`
      SELECT method::text AS method, COALESCE(SUM(amount), 0) AS paid FROM payments
      WHERE sale_id = ${original.id} AND voided_at IS NULL AND amount > 0
        AND method::text NOT IN ('credit', 'gift_card', 'loyalty') AND COALESCE(reference, '') <> 'EXCHANGE'
      GROUP BY method::text
    `))
    const refundedRows = rows<{ method: string; refunded: string }>(await tx.execute(sql`
      SELECT method::text AS method, COALESCE(SUM(amount), 0) AS refunded FROM refunds
      WHERE original_sale_id = ${original.id} GROUP BY method::text
    `))
    const refundedBy = new Map(refundedRows.map((r) => [r.method, num(r.refunded)]))
    const caps = paidRows
      .map((r) => ({ method: r.method, cap: roundCurrency(Math.max(0, num(r.paid) - (refundedBy.get(r.method) || 0))) }))
      .filter((c) => c.cap > 0)
      .sort((a, b) => b.cap - a.cap)
    const capTotal = roundCurrency(caps.reduce((s, c) => s + c.cap, 0))
    if (capTotal + 0.01 < refundPaidOut) {
      throw new SaleFlowError(400, 'REFUND_METHOD_EXCEEDS_PAID',
        `Only ${capTotal.toFixed(2)} can still be refunded to the original payment methods. Refund the rest to store credit.`,
        { allowed: capTotal, method: 'original' })
    }
    // Proportional to what is still refundable on each method; rounding remainder on the largest
    let left = refundPaidOut
    refundSplits = caps.map((c, i) => {
      const share = i === caps.length - 1 ? left : roundCurrency(Math.min(c.cap, refundPaidOut * (c.cap / capTotal)))
      left = roundCurrency(left - share)
      return { method: c.method, amount: share }
    })
    if (left > 0.001) {
      for (const sp of refundSplits) {
        const cap = caps.find((c) => c.method === sp.method)!.cap
        const add = roundCurrency(Math.min(left, cap - sp.amount))
        if (add > 0) { sp.amount = roundCurrency(sp.amount + add); left = roundCurrency(left - add) }
      }
    }
    refundSplits = refundSplits.filter((s) => s.amount > 0)
  } else if (refundPaidOut > 0) {
    if (requestedRefundMethod === 'credit') {
      if (!customerId) throw new SaleFlowError(400, 'CUSTOMER_REQUIRED', 'Select a customer to refund to store credit')
    } else if (original) {
      const [paid] = rows<{ paid: string | null }>(await tx.execute(sql`
        SELECT COALESCE(SUM(amount), 0) AS paid FROM payments
        WHERE sale_id = ${original.id} AND method = ${requestedRefundMethod} AND voided_at IS NULL AND amount > 0
      `))
      const [refunded] = rows<{ refunded: string | null }>(await tx.execute(sql`
        SELECT COALESCE(SUM(amount), 0) AS refunded FROM refunds
        WHERE original_sale_id = ${original.id} AND method = ${requestedRefundMethod}
      `))
      const allowed = roundCurrency(Math.max(0, num(paid?.paid) - num(refunded?.refunded)))
      if (refundPaidOut > allowed + 0.01) {
        throw new SaleFlowError(400, 'REFUND_METHOD_EXCEEDS_PAID',
          `Only ${allowed.toFixed(2)} can be refunded by ${requestedRefundMethod} (paid by ${requestedRefundMethod} on the original sale, minus earlier refunds). Refund the rest to store credit or to the original payment methods.`,
          { allowed, method: requestedRefundMethod })
      }
    }
  }

  const warehouseId = input.warehouseId || original?.warehouseId || null
  if (!warehouseId) throw new SaleFlowError(400, 'WAREHOUSE_REQUIRED', 'No warehouse to return stock into')

  // D1: tenant return settings (callers may pass them explicitly)
  let restockMode = input.restockMode
  let serialStatus = input.serialReturnStatus
  if (!restockMode || !serialStatus) {
    const settings = await getTenantSalesSettings(tx, tenantId)
    restockMode = restockMode || settings.returns.restockMode
    serialStatus = serialStatus || settings.returns.serialReturnStatus
  }
  const quarantine = restockMode === 'quarantine'
  const stockWarehouseId = quarantine ? await getOrCreateQuarantineWarehouse(tx, tenantId) : warehouseId

  /** Method stored on the return document / single-method paths */
  const refundMethod: Exclude<RefundMethod, 'original'> =
    requestedRefundMethod === 'original'
      ? ((refundSplits[0]?.method as Exclude<RefundMethod, 'original'>) || 'cash')
      : requestedRefundMethod
  // 5. return document
  const invoiceNo = await nextDocumentNumber(tx, tenantId, 'return')
  const returnReason = original ? (input.reason?.trim() || null) : 'no_receipt'
  const returnNotes = original
    ? (input.notes || null)
    : [input.reason?.trim(), input.notes].filter(Boolean).join(' — ') || null
  const scaledBreakdown = scaleTaxBreakdown(original?.taxBreakdown, num(original?.taxAmount), refundTax)

  const [returnSale] = await tx.insert(sales).values({
    tenantId,
    clientSaleId: input.clientSaleId || null,
    offlineRef: input.offlineRef || null,
    createdBy: userId,
    customerId,
    vehicleId: original?.vehicleId || null,
    warehouseId,
    posOpeningEntryId: input.posOpeningEntryId || null,
    customerName: original?.customerName || null,
    vehiclePlate: original?.vehiclePlate || null,
    vehicleDescription: original?.vehicleDescription || null,
    invoiceNo,
    subtotal: String(-refundNet),
    discountAmount: '0',
    taxAmount: String(-refundTax),
    taxBreakdown: scaledBreakdown,
    total: String(-refundTotal),
    paidAmount: '0',
    paymentMethod: refundMethod,
    status: 'completed',
    isReturn: true,
    returnAgainst: original?.id || null,
    returnReason,
    returnNotes,
    costCenterId: input.costCenterId || original?.costCenterId || null,
  }).returning()

  // 6. lines + returned_quantity
  const createdLines: CreatedReturnLine[] = []
  for (const p of planned) {
    const unitPrice = p.qty > 0 ? roundCurrency(p.net / p.qty) : 0
    const [row] = await tx.insert(saleItems).values({
      tenantId,
      saleId: returnSale.id,
      itemId: p.itemId,
      itemName: p.itemName,
      quantity: String(-p.qty),
      unitPrice: String(unitPrice),
      discount: '0',
      taxRate: p.original ? String(p.original.taxRate ?? '0') : '0',
      taxAmount: String(-roundCurrency(p.tax)),
      taxTemplateId: p.original?.taxTemplateId || null,
      total: String(-roundCurrency(p.net)),
      serialNumberIds: p.serialIds.length ? p.serialIds : null,
      originalSaleItemId: p.original?.id || null,
    }).returning({ id: saleItems.id })
    if (p.original) {
      await tx.update(saleItems)
        .set({ returnedQuantity: sql`${saleItems.returnedQuantity} + ${p.qty.toFixed(3)}::numeric` })
        .where(eq(saleItems.id, p.original.id))
    }
    createdLines.push({
      id: row.id,
      originalSaleItemId: p.original?.id || null,
      itemId: p.itemId,
      itemName: p.itemName,
      quantity: p.qty,
      unitPrice,
      net: roundCurrency(p.net),
      tax: roundCurrency(p.tax),
      gross: roundCurrency(p.gross),
      serialNumberIds: p.serialIds,
      batches: [],
    })
  }

  // 7. stock back through the ledger (sorted lock order)
  const stockInputs: StockChangeInput[] = []
  planned.forEach((p, i) => {
    if (!p.itemId || !p.trackStock) return
    stockInputs.push({
      tenantId,
      warehouseId: stockWarehouseId,
      itemId: p.itemId,
      mode: 'delta',
      qty: p.qty,
      type: 'in',
      referenceType: quarantine ? 'return_quarantine' : 'return',
      referenceId: returnSale.id,
      notes: `Return ${invoiceNo}${original ? ` against ${original.invoiceNo}` : ' (no receipt)'}${quarantine ? ' → quarantine' : ''}`,
      userId,
      source: 'pos',
      costCenterId: input.costCenterId || original?.costCenterId || null,
      idempotencyKey: `return:${returnSale.id}:${createdLines[i].id}`,
    })
  })
  const stockResults = stockInputs.length ? await applyStockChanges(tx, stockInputs) : []

  // 7b. batches: back into the batches the original line drew from (LIFO of allocation)
  for (let i = 0; i < planned.length; i++) {
    const p = planned[i]
    if (!p.original) continue
    const r = await restoreSaleLineBatches(tx, {
      tenantId,
      saleItemId: p.original.id,
      qty: p.qty,
      toWarehouseId: stockWarehouseId,
      quarantine,
      returnSaleItemId: createdLines[i].id,
    })
    createdLines[i].batches = r.restored
  }

  // 8. serials back on the shelf (status per tenant setting)
  for (const p of planned) {
    if (p.serialIds.length === 0) continue
    const current = await tx.select().from(itemSerialNumbers).where(inArray(itemSerialNumbers.id, p.serialIds))
    if (current.length !== p.serialIds.length) throw new SaleFlowError(400, 'SERIAL_NOT_FOUND', 'Serial number(s) not found')
    const wrong = current.filter((s) => s.itemId !== p.itemId || s.status !== 'sold')
    if (wrong.length > 0) {
      throw new SaleFlowError(400, 'SERIAL_NOT_SOLD',
        `Serial number(s) ${wrong.map((s) => s.serialNumber).join(', ')} are not recorded as sold for this item`)
    }
    await allocateSerials(tx, {
      tenantId,
      serialNumberIds: p.serialIds,
      newStatus: serialStatus || 'available',
      referenceType: 'return',
      referenceId: returnSale.id,
      changedBy: userId,
      notes: `Returned on ${invoiceNo}`,
    })
    const elsewhere = current.filter((s) => s.warehouseId !== stockWarehouseId).map((s) => s.id)
    if (elsewhere.length > 0) {
      await transferSerials(tx, {
        tenantId, serialNumberIds: elsewhere, toWarehouseId: stockWarehouseId,
        referenceType: 'return', referenceId: returnSale.id, changedBy: userId,
      })
    }
  }

  // 9. money
  if (offsetAmount > 0) {
    await tx.insert(payments).values({
      tenantId, saleId: returnSale.id, amount: String(-offsetAmount), method: offsetMethod,
      reference: 'EXCHANGE', receivedBy: userId,
    })
  }
  if (refundPaidOut > 0 && refundSplits.length > 0) {
    // Refund to the original payment methods: one payout row + refund record per method
    for (const sp of refundSplits) {
      await tx.insert(payments).values({
        tenantId, saleId: returnSale.id, amount: String(-sp.amount), method: sp.method as typeof payments.$inferInsert.method, receivedBy: userId,
      })
      await tx.insert(refunds).values({
        tenantId,
        saleId: returnSale.id,
        originalSaleId: original?.id || null,
        amount: String(sp.amount),
        method: sp.method as typeof refunds.$inferInsert.method,
        processedBy: userId,
        reason: `Return ${invoiceNo}${original ? ` against ${original.invoiceNo}` : ''} (original payment methods)${input.reason ? `: ${input.reason}` : ''}`,
      })
    }
  } else if (refundPaidOut > 0) {
    if (refundMethod === 'credit' && customerId) {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId)).for('update')
      if (!customer) throw new SaleFlowError(400, 'CUSTOMER_NOT_FOUND', 'Customer not found')
      const newBalance = roundCurrency(num(customer.balance) + refundPaidOut)
      await tx.insert(customerCreditTransactions).values({
        tenantId, customerId, type: 'refund', amount: String(refundPaidOut), balanceAfter: String(newBalance),
        referenceType: 'return', referenceId: returnSale.id, notes: `Refund from ${invoiceNo}`, createdBy: userId,
      })
      await tx.update(customers).set({ balance: String(newBalance), updatedAt: new Date() }).where(eq(customers.id, customerId))
    } else {
      await tx.insert(payments).values({
        tenantId, saleId: returnSale.id, amount: String(-refundPaidOut), method: refundMethod, receivedBy: userId,
      })
    }
    await tx.insert(refunds).values({
      tenantId,
      saleId: returnSale.id,
      originalSaleId: original?.id || null,
      amount: String(refundPaidOut),
      method: refundMethod,
      processedBy: userId,
      reason: `Return ${invoiceNo}${original ? ` against ${original.invoiceNo}` : ' (no receipt)'}${input.reason ? `: ${input.reason}` : ''}`,
    })
  }

  // 10. loyalty reversal proportional to the returned value
  if (original && customerId) {
    const earned = await tx.select().from(loyaltyTransactions)
      .where(and(eq(loyaltyTransactions.saleId, original.id), eq(loyaltyTransactions.type, 'earn')))
    if (earned.length > 0) {
      const totalEarned = earned.reduce((s, t) => s + t.points, 0)
      const origTotal = Math.abs(num(original.total))
      const proportion = origTotal > 0 ? refundTotal / origTotal : 0
      const pointsToReverse = Math.min(totalEarned, Math.floor(totalEarned * proportion))
      if (pointsToReverse > 0) {
        const [cust] = await tx.select().from(customers).where(eq(customers.id, customerId)).for('update')
        if (cust) {
          const newPoints = Math.max(0, (cust.loyaltyPoints || 0) - pointsToReverse)
          await tx.insert(loyaltyTransactions).values({
            tenantId, customerId, type: 'reversal', points: -pointsToReverse, balanceAfter: newPoints,
            saleId: returnSale.id, notes: `Reversed ${pointsToReverse} points due to return ${invoiceNo}`,
          })
          await tx.update(customers).set({ loyaltyPoints: newPoints, updatedAt: new Date() }).where(eq(customers.id, customerId))
        }
      }
    }
  }

  // 11. GL (no-op when auto-posting is off)
  const cogs = roundCurrency(planned.reduce((s, p) => s + roundCurrency(p.costPrice * p.qty), 0))
  await postSaleToGL(tx, tenantId, {
    saleId: returnSale.id,
    invoiceNumber: invoiceNo,
    saleDate: new Date().toISOString().split('T')[0],
    subtotal: refundNet,
    tax: refundTax,
    discount: 0,
    total: refundTotal,
    amountPaid: 0,
    creditAmount: 0,
    costOfGoodsSold: cogs,
    paymentMethod: refundMethod,
    refundMethod: offsetAmount > 0 ? offsetMethod : refundMethod,
    paymentSplits: refundSplits.length > 0 ? refundSplits : undefined,
    customerId,
    isReturn: true,
    costCenterId: input.costCenterId || original?.costCenterId || null,
    taxBreakdown: (scaledBreakdown || undefined) as TaxBreakdownItem[] | undefined,
  })

  // 12. original sale status from returned_quantity
  let returnStatus: ReturnStatus = 'none'
  if (original) {
    const after = await tx.select({ quantity: saleItems.quantity, returnedQuantity: saleItems.returnedQuantity })
      .from(saleItems).where(eq(saleItems.saleId, original.id))
    returnStatus = returnStatusOf(after)
  }

  return {
    returnSale,
    originalSale: original,
    lines: createdLines,
    refundTotal,
    refundNet,
    refundTax,
    refundPaidOut,
    offsetAmount,
    offsetMethod,
    refundMethod,
    refundSplits,
    returnStatus,
    stockChanges: stockResults.map((result, i) => ({ result, input: stockInputs[i] })),
    affectedItemIds: [...new Set(planned.map((p) => p.itemId).filter((x): x is string => !!x))],
    warehouseId,
    stockWarehouseId,
    restockMode: restockMode || 'stock',
    customerId,
  }
}

function scaleTaxBreakdown(breakdown: unknown, originalTax: number, refundTax: number): TaxBreakdownItem[] | null {
  if (!Array.isArray(breakdown) || breakdown.length === 0 || !(originalTax > 0) || !(refundTax > 0)) return null
  const f = refundTax / originalTax
  const scaled = (breakdown as TaxBreakdownItem[]).map((b) => ({ ...b, amount: roundCurrency(num(b.amount) * f) }))
  // push rounding drift onto the largest component so the breakdown adds up to refundTax
  const sum = roundCurrency(scaled.reduce((s, b) => s + b.amount, 0))
  const drift = roundCurrency(refundTax - sum)
  if (drift !== 0 && scaled.length > 0) {
    const idx = scaled.reduce((m, b, i) => (b.amount > scaled[m].amount ? i : m), 0)
    scaled[idx] = { ...scaled[idx], amount: roundCurrency(scaled[idx].amount + drift) }
  }
  return scaled
}

// ==================== LOOKUP ====================

export type LookupMatch = 'invoice' | 'offline_ref' | 'return'

export interface LookupLine extends SaleItemRow {
  remainingQuantity: number
  /** What one unit refunds (incl. tax, after discounts). */
  refundUnitAmount: number
  isGiftCard: boolean
  /** Serials sold on this line that have not been returned yet. */
  remainingSerialNumberIds: string[]
  /** Batch allocations of this line (D1). */
  batches: SaleLineBatchInfo[]
}

export interface SaleLookupResult {
  matchedBy: LookupMatch
  /** When matched by a return number: that return document. */
  matchedReturn: { id: string; invoiceNo: string } | null
  sale: SaleRow & {
    items: LookupLine[]
    returnStatus: ReturnStatus
    linkedReturns: Array<{ id: string; invoiceNo: string; total: string; createdAt: Date }>
    paidByMethod: Record<string, number>
    refundedByMethod: Record<string, number>
    refundableTotal: number
  }
}

/** Exact lookup by invoice number, offline receipt reference, or return number (→ its original). */
export async function lookupSaleByCode(tx: DbTx, code: string): Promise<SaleLookupResult | null> {
  const c = code.trim()
  if (!c) return null
  const upper = c.toUpperCase()

  let sale: SaleRow | undefined
  let matchedBy: LookupMatch = 'invoice'
  let matchedReturn: { id: string; invoiceNo: string } | null = null

  const byNo = await tx.select().from(sales)
    .where(sql`upper(${sales.invoiceNo}) = ${upper}`)
    .orderBy(sql`${sales.createdAt} DESC`).limit(5)
  const ret = byNo.find((s) => s.isReturn)
  const inv = byNo.find((s) => !s.isReturn)
  if (inv) {
    sale = inv
  } else if (ret) {
    matchedBy = 'return'
    matchedReturn = { id: ret.id, invoiceNo: ret.invoiceNo }
    if (ret.returnAgainst) {
      const [orig] = await tx.select().from(sales).where(eq(sales.id, ret.returnAgainst)).limit(1)
      sale = orig
    }
    if (!sale) return null
  } else {
    let [off] = await tx.select().from(sales).where(sql`upper(${sales.offlineRef}) = ${upper}`).limit(1)
    // D2: the printed number of a sale re-numbered after an OFFLINE_REF_CONFLICT (flags.offlineRefAlias).
    if (!off && upper.startsWith('OFF-')) {
      ;[off] = await tx.select().from(sales).where(sql`upper(${sales.flags}->>'offlineRefAlias') = ${upper}`).limit(1)
    }
    if (!off) return null
    matchedBy = 'offline_ref'
    if (off.isReturn && off.returnAgainst) {
      matchedReturn = { id: off.id, invoiceNo: off.invoiceNo }
      const [orig] = await tx.select().from(sales).where(eq(sales.id, off.returnAgainst)).limit(1)
      if (!orig) return null
      sale = orig
    } else {
      sale = off
    }
  }

  return buildLookup(tx, sale, matchedBy, matchedReturn)
}

export async function buildLookup(tx: DbTx, sale: SaleRow, matchedBy: LookupMatch, matchedReturn: { id: string; invoiceNo: string } | null): Promise<SaleLookupResult> {
  const lines = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id))
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => !!x))]
  const giftIds = new Set(itemIds.length
    ? (await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, itemIds), eq(items.isGiftCard, true)))).map((r) => r.id)
    : [])
  const pricing = computeSalePricing(sale, lines)
  const linked = await tx.select({ id: sales.id, invoiceNo: sales.invoiceNo, total: sales.total, createdAt: sales.createdAt })
    .from(sales)
    .where(and(eq(sales.returnAgainst, sale.id), eq(sales.isReturn, true), sql`${sales.status} <> 'void'`))
  const pays = await tx.select({ method: payments.method, amount: payments.amount }).from(payments)
    .where(and(eq(payments.saleId, sale.id), sql`${payments.voidedAt} IS NULL`, sql`${payments.amount} > 0`))
  const refs = await tx.select({ method: refunds.method, amount: refunds.amount }).from(refunds)
    .where(eq(refunds.originalSaleId, sale.id))
  const paidByMethod: Record<string, number> = {}
  for (const p of pays) paidByMethod[p.method] = roundCurrency((paidByMethod[p.method] || 0) + num(p.amount))
  const refundedByMethod: Record<string, number> = {}
  for (const r of refs) refundedByMethod[r.method] = roundCurrency((refundedByMethod[r.method] || 0) + num(r.amount))
  const returnedValue = linked.reduce((s, r) => s + Math.abs(num(r.total)), 0)
  const returnedSerials = new Set<string>()
  if (linked.length > 0) {
    const retLines = await tx.select({ serialNumberIds: saleItems.serialNumberIds }).from(saleItems)
      .where(inArray(saleItems.saleId, linked.map((r) => r.id)))
    for (const r of retLines) for (const sid of (r.serialNumberIds as string[] | null) || []) returnedSerials.add(sid)
  }

  const batchesByLine = await getSaleLineBatches(tx, lines.map((l) => l.id))
  const outLines: LookupLine[] = lines.map((l) => {
    const qty = num(l.quantity)
    const remaining = qty > 0 ? round3(Math.max(0, qty - num(l.returnedQuantity))) : 0
    const unit = qty > 0 ? roundCurrency(lineRefundValue(pricing, l.id, 1).gross) : 0
    return {
      ...l,
      remainingQuantity: remaining,
      refundUnitAmount: unit,
      isGiftCard: !!(l.itemId && giftIds.has(l.itemId)),
      remainingSerialNumberIds: ((l.serialNumberIds as string[] | null) || []).filter((sid) => !returnedSerials.has(sid)),
      batches: batchesByLine.get(l.id) || [],
    }
  })

  return {
    matchedBy,
    matchedReturn,
    sale: {
      ...sale,
      items: outLines,
      returnStatus: returnStatusOf(lines),
      linkedReturns: linked,
      paidByMethod,
      refundedByMethod,
      refundableTotal: roundCurrency(Math.max(0, Math.abs(num(sale.total)) - returnedValue)),
    },
  }
}
