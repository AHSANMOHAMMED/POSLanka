/**
 * W8 — exchange: return lines of an invoice and sell new items in ONE transaction.
 *
 * Documents: a return (RTN-, via createReturnInTx) and a new sale (INV-) whose `exchange_of`
 * points at the return. The refund is applied to the new sale as an internal offset
 * (payment rows tagged 'EXCHANGE' on both documents, same method, so the till nets out):
 *   new total > refund → the customer pays the difference (amountPaid / paymentSplits);
 *   new total < refund → the difference is refunded (cash/card, bounded like any refund).
 *
 * New-sale pricing follows POST /api/sales: unit prices / line discounts come from the cart,
 * tax is always recomputed server-side from the tax templates. Stock leaves through the ledger.
 * Held-sale / work-order reservations are not consulted here (stock must simply be on hand).
 * Batch-tracked new lines draw from item_batches (cashier's batch first, else FEFO) and record
 * sale_item_batches like a normal sale (D1).
 *
 * GL (D1): the new sale's receivable is settled per payment method — the applied refund offset
 * (offsetMethod) plus each collected split — so a card + cash difference posts to both accounts.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { sales, saleItems, items, payments, itemUoms } from '@/lib/db/schema'
import { applyStockChanges, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { validateSerialAvailability, allocateSerials } from '@/lib/inventory/serial-numbers'
import type { DbTx } from '@/lib/inventory/db-types'
import { roundCurrency } from '@/lib/utils/currency'
import { normalizeUnit, standardFactor } from '@/lib/units/conversions'
import { postSaleToGL } from '@/lib/accounting/auto-post'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'
import { createReturnInTx, SaleFlowError, type CreateReturnResult, type ReturnContext, type SaleRow } from './returns'
import { allocateSaleLineBatches, type BatchAllocation } from '@/lib/inventory/batches'
import { getTenantSalesSettings, type RestockMode } from './return-settings'
import { localDateString, saleLineWarranty, applySerialWarranty } from './warranty'

export interface ExchangeCartItem {
  itemId?: string | null
  name?: string | null
  quantity: number
  unitPrice: number
  discount?: number | null
  serialNumberIds?: string[] | null
  /** Batch picked by the cashier (D1); otherwise FEFO. */
  batchId?: string | null
  /** Batch number from a GS1 scan, resolved to a batch of the item. */
  batchNumber?: string | null
  /** H5: unit sold (item_uoms.uom); stock / batches / COGS move quantity × factor base units */
  uom?: string | null
}

export interface ExchangeInput {
  originalSaleId: string
  returnLines: Array<{ originalSaleItemId: string; quantity: number; serialNumberIds?: string[] | null }>
  newCartItems: ExchangeCartItem[]
  paymentMethod?: 'cash' | 'card' | 'bank_transfer' | 'credit' | 'gift_card' | 'cheque' | null
  paymentSplits?: Array<{ method: 'cash' | 'card' | 'bank_transfer' | 'credit' | 'gift_card' | 'cheque'; amount: number; reference?: string | null }> | null
  amountPaid?: number | null
  refundMethod?: 'cash' | 'card' | 'credit' | null
  warehouseId?: string | null
  posOpeningEntryId?: string | null
  costCenterId?: string | null
  customerId?: string | null
  clientSaleId?: string | null
  reason?: string | null
  notes?: string | null
  serialReturnStatus?: 'available' | 'defective'
  restockMode?: RestockMode
}

export interface ExchangeResult {
  returnResult: CreateReturnResult
  sale: SaleRow
  saleLines: Array<{ id: string; itemId: string; itemName: string; quantity: number; unitPrice: number; total: number; taxAmount: number; batches: BatchAllocation[] }>
  newTotal: number
  refundTotal: number
  /** newTotal - refundTotal: > 0 collected from the customer, < 0 paid back */
  difference: number
  collected: number
  refunded: number
  stockChanges: Array<{ result: StockChangeResult; input: StockChangeInput }>
  affectedItemIds: string[]
}

const COLLECT_METHODS = new Set(['cash', 'card', 'bank_transfer'])

export async function createExchangeInTx(tx: DbTx, ctx: ReturnContext, input: ExchangeInput): Promise<ExchangeResult> {
  const { tenantId, userId } = ctx
  const refundMethod = input.refundMethod || 'cash'
  if (refundMethod === 'credit') {
    throw new SaleFlowError(400, 'EXCHANGE_REFUND_METHOD', 'Exchange differences can be refunded by cash or card only')
  }
  const payMethod = input.paymentMethod || 'cash'
  if (!COLLECT_METHODS.has(payMethod) || (input.paymentSplits || []).some((s) => !COLLECT_METHODS.has(s.method))) {
    throw new SaleFlowError(400, 'EXCHANGE_PAYMENT_METHOD', 'Exchange differences can be paid by cash, card or bank transfer')
  }

  // ---- new cart: items + prices + server-side tax
  const ids = [...new Set(input.newCartItems.map((c) => c.itemId).filter((x): x is string => !!x))]
  if (input.newCartItems.some((c) => !c.itemId)) {
    throw new SaleFlowError(400, 'ITEM_REQUIRED', 'Every new item must be a catalogue item')
  }
  const itemRows = ids.length ? await tx.select().from(items).where(inArray(items.id, ids)) : []
  const itemById = new Map(itemRows.map((i) => [i.id, i]))
  // H5: unit conversions of the new lines
  const uomRows = ids.length && input.newCartItems.some((c) => c.uom)
    ? await tx.select({ itemId: itemUoms.itemId, uom: itemUoms.uom, factor: itemUoms.factor, sellingPrice: itemUoms.sellingPrice })
      .from(itemUoms).where(and(inArray(itemUoms.itemId, ids), eq(itemUoms.isActive, true)))
    : []
  const uomOf = new Map(uomRows.map((u) => [`${u.itemId}|${u.uom.toLowerCase()}`, u]))
  const cart = input.newCartItems.map((c) => {
    const item = c.itemId ? itemById.get(c.itemId) : undefined
    if (!item) throw new SaleFlowError(400, 'ITEM_NOT_FOUND', 'Invalid items in cart')
    if (item.isGiftCard) throw new SaleFlowError(400, 'GIFT_CARD_IN_EXCHANGE', 'Gift cards cannot be part of an exchange')
    const qty = Number(c.quantity)
    if (!(qty > 0)) throw new SaleFlowError(400, 'INVALID_QUANTITY', `Quantity must be greater than zero for "${item.name}"`)
    const unitPrice = roundCurrency(Number(c.unitPrice))
    if (!(unitPrice >= 0)) throw new SaleFlowError(400, 'NEGATIVE_PRICE', `Price cannot be negative for "${item.name}"`)
    const discount = roundCurrency(Number(c.discount || 0))
    if (discount < 0 || discount > roundCurrency(unitPrice * qty)) {
      throw new SaleFlowError(400, 'INVALID_DISCOUNT', `Discount exceeds item total for "${item.name}"`)
    }
    const serialIds = [...new Set(c.serialNumberIds || [])]
    if (item.trackSerialNumbers && serialIds.length > 0 && serialIds.length !== qty) {
      throw new SaleFlowError(400, 'SERIAL_MISMATCH', `"${item.name}" requires ${qty} serial number(s), but ${serialIds.length} provided`)
    }
    let uom: string | null = (c.uom || '').trim().toLowerCase() || null
    if (uom && uom === (item.unit || '').trim().toLowerCase()) uom = null
    const conv = uom ? uomOf.get(`${item.id}|${uom}`) : undefined
    // A standard unit of the same measure (g for a kg item) needs no item_uoms row
    const std = uom && !conv ? standardFactor(uom, item.unit || '') : null
    if (uom && !conv && std == null) throw new SaleFlowError(400, 'UOM_NOT_FOUND', `"${item.name}" has no "${uom}" unit`)
    if (std != null) uom = normalizeUnit(uom)
    const factor = conv ? Number(conv.factor) || 1 : std ?? 1
    if (factor !== 1 && item.trackSerialNumbers) {
      throw new SaleFlowError(400, 'SERIAL_UOM', `"${item.name}" is serial-tracked: sell it in its base unit`)
    }
    const listPrice = conv || std != null
      ? (conv?.sellingPrice != null ? Number(conv.sellingPrice) : roundCurrency(Number(item.sellingPrice) * factor))
      : Number(item.sellingPrice)
    return {
      item, name: c.name || item.name, qty, unitPrice, discount, total: roundCurrency(unitPrice * qty - discount), serialIds,
      batchId: c.batchId || null, batchNumber: c.batchNumber || null,
      uom, factor, baseQty: Math.round(qty * factor * 1000) / 1000, listPrice: roundCurrency(listPrice),
    }
  })
  const taxResult = await recalculateDocumentTax(tx, tenantId,
    cart.map((c) => ({ itemId: c.item.id, lineTotal: c.total })), { type: 'sales' })
  const newSubtotal = roundCurrency(cart.reduce((s, c) => s + c.total, 0))
  const newTax = roundCurrency(taxResult.totalTax)
  const newTotal = roundCurrency(newSubtotal + taxResult.exclusiveTax)

  const settings = await getTenantSalesSettings(tx, tenantId)

  // ---- 1. the return, with the new sale's value applied as offset
  const returnResult = await createReturnInTx(tx, ctx, {
    serialReturnStatus: input.serialReturnStatus || settings.returns.serialReturnStatus,
    restockMode: input.restockMode || settings.returns.restockMode,
    originalSaleId: input.originalSaleId,
    lines: input.returnLines.map((l) => ({ originalSaleItemId: l.originalSaleItemId, quantity: l.quantity, serialNumberIds: l.serialNumberIds || undefined })),
    refundMethod,
    customerId: input.customerId,
    warehouseId: input.warehouseId,
    posOpeningEntryId: input.posOpeningEntryId,
    costCenterId: input.costCenterId,
    reason: input.reason || 'exchange',
    notes: input.notes,
    offsetAmount: newTotal,
  })
  const refundTotal = returnResult.refundTotal
  const offset = returnResult.offsetAmount
  const difference = roundCurrency(newTotal - refundTotal)

  // ---- 2. payment for the difference
  let collected = 0
  const splits = (input.paymentSplits || []).filter((s) => s.amount > 0)
  if (difference > 0.005) {
    const tendered = splits.length ? roundCurrency(splits.reduce((s, x) => s + x.amount, 0)) : roundCurrency(Number(input.amountPaid || 0))
    if (tendered + 0.01 < difference) {
      throw new SaleFlowError(400, 'INSUFFICIENT_PAYMENT',
        `The new items cost ${difference.toFixed(2)} more than the refund; amount paid ${tendered.toFixed(2)} is not enough`,
        { difference })
    }
    collected = difference
  }

  // ---- 3. the new sale
  const warehouseId = returnResult.warehouseId
  const invoiceNo = await nextDocumentNumber(tx, tenantId, 'invoice')
  const collectMethod = splits.length ? splits[0].method : payMethod
  const [sale] = await tx.insert(sales).values({
    tenantId,
    clientSaleId: input.clientSaleId || null,
    createdBy: userId,
    customerId: returnResult.customerId,
    vehicleId: returnResult.originalSale?.vehicleId || null,
    warehouseId,
    posOpeningEntryId: input.posOpeningEntryId || null,
    customerName: returnResult.originalSale?.customerName || null,
    invoiceNo,
    subtotal: String(newSubtotal),
    discountAmount: '0',
    taxAmount: String(newTax),
    taxBreakdown: taxResult.taxBreakdown || null,
    total: String(newTotal),
    paidAmount: String(newTotal),
    paymentMethod: difference > 0.005 ? collectMethod : returnResult.offsetMethod,
    status: 'completed',
    isReturn: false,
    exchangeOf: returnResult.returnSale.id,
    costCenterId: input.costCenterId || returnResult.originalSale?.costCenterId || null,
    notes: `Exchange for ${returnResult.returnSale.invoiceNo}${returnResult.originalSale ? ` (invoice ${returnResult.originalSale.invoiceNo})` : ''}`,
  }).returning()

  await tx.update(sales)
    .set({ returnNotes: [returnResult.returnSale.returnNotes, `Exchanged → ${invoiceNo}`].filter(Boolean).join(' — ') })
    .where(eq(sales.id, returnResult.returnSale.id))

  const saleLines: ExchangeResult['saleLines'] = []
  const stockInputs: StockChangeInput[] = []
  const batchLines: Array<{ lineIndex: number; saleItemId: string; c: (typeof cart)[number] }> = []
  // 0179: new lines of an exchange carry their warranty like a POS sale (from today's local date)
  const saleDateLocal = localDateString(sale.createdAt ?? new Date())
  for (let i = 0; i < cart.length; i++) {
    const c = cart[i]
    const per = taxResult.perItemTax[i]
    const lineWarranty = c.qty > 0 ? saleLineWarranty(c.item, saleDateLocal) : { warrantyMonths: null, warrantyUntil: null }
    const [row] = await tx.insert(saleItems).values({
      tenantId,
      saleId: sale.id,
      itemId: c.item.id,
      itemName: c.name,
      quantity: String(c.qty),
      unitPrice: String(c.unitPrice),
      discount: String(c.discount),
      taxRate: String(per?.taxRate ?? 0),
      taxAmount: String(per?.taxAmount ?? 0),
      taxBreakdown: per?.taxBreakdown || null,
      total: String(c.total),
      serialNumberIds: c.serialIds.length ? c.serialIds : null,
      listPrice: String(c.listPrice),
      uom: c.uom,
      uomFactor: String(c.factor),
      warrantyMonths: lineWarranty.warrantyMonths,
      warrantyUntil: lineWarranty.warrantyUntil,
    }).returning({ id: saleItems.id })
    saleLines.push({ id: row.id, itemId: c.item.id, itemName: c.name, quantity: c.qty, unitPrice: c.unitPrice, total: c.total, taxAmount: per?.taxAmount ?? 0, batches: [] })
    if (c.item.trackBatches) batchLines.push({ lineIndex: saleLines.length - 1, saleItemId: row.id, c })

    if (c.item.trackSerialNumbers && c.serialIds.length) {
      await validateSerialAvailability(tx, c.serialIds, c.item.id, warehouseId)
      await allocateSerials(tx, {
        tenantId, serialNumberIds: c.serialIds, newStatus: 'sold',
        referenceType: 'sale', referenceId: sale.id, changedBy: userId,
      })
      await applySerialWarranty(tx, c.serialIds, saleDateLocal, lineWarranty.warrantyUntil)
    }
    if (c.item.trackStock) {
      stockInputs.push({
        tenantId, warehouseId, itemId: c.item.id, mode: 'delta', qty: -c.baseQty, type: 'out',
        referenceType: 'sale', referenceId: sale.id, userId, source: 'pos',
        notes: `Exchange sale ${invoiceNo}`,
        costCenterId: sale.costCenterId,
        idempotencyKey: `sale:${sale.id}:${row.id}`,
      })
    }
  }
  const stockResults = stockInputs.length ? await applyStockChanges(tx, stockInputs) : []

  // ---- 3b. batches for batch-tracked new lines (after the warehouse stock rows are locked)
  for (const b of batchLines) {
    const r = await allocateSaleLineBatches(tx, {
      tenantId, warehouseId, itemId: b.c.item.id, qty: b.c.baseQty, saleItemId: b.saleItemId,
      preferredBatchId: b.c.batchId, preferredBatchNumber: b.c.batchNumber,
      allowExpired: settings.batches.allowExpiredSale, itemName: b.c.name,
    })
    saleLines[b.lineIndex].batches = r.allocations
  }

  // ---- 4. payments on the new sale: the applied refund + what was collected
  if (offset > 0) {
    await tx.insert(payments).values({
      tenantId, saleId: sale.id, amount: String(offset), method: returnResult.offsetMethod,
      reference: `EXCHANGE ${returnResult.returnSale.invoiceNo}`, receivedBy: userId,
    })
  }
  // what settles the new sale, per method (GL posts one debit per method)
  const settlement: Array<{ method: string; amount: number }> = []
  if (offset > 0) settlement.push({ method: returnResult.offsetMethod, amount: offset })
  if (collected > 0) {
    if (splits.length) {
      let left = collected
      for (const s of splits) {
        const amt = roundCurrency(Math.min(s.amount, left))
        if (amt <= 0) break
        left = roundCurrency(left - amt)
        await tx.insert(payments).values({
          tenantId, saleId: sale.id, amount: String(amt), method: s.method, reference: s.reference || null, receivedBy: userId,
        })
        settlement.push({ method: s.method, amount: amt })
      }
    } else {
      await tx.insert(payments).values({
        tenantId, saleId: sale.id, amount: String(collected), method: payMethod, receivedBy: userId,
      })
      settlement.push({ method: payMethod, amount: collected })
    }
  }

  // ---- 5. GL for the new sale (the return posted its own)
  const cogs = roundCurrency(cart.reduce((s, c) => s + roundCurrency(Number(c.item.costPrice || 0) * c.baseQty), 0))
  await postSaleToGL(tx, tenantId, {
    saleId: sale.id,
    invoiceNumber: invoiceNo,
    saleDate: new Date().toISOString().split('T')[0],
    subtotal: newSubtotal,
    tax: newTax,
    discount: 0,
    total: newTotal,
    amountPaid: newTotal,
    creditAmount: 0,
    costOfGoodsSold: cogs,
    paymentMethod: difference > 0.005 ? collectMethod : returnResult.offsetMethod,
    paymentSplits: settlement,
    customerId: returnResult.customerId,
    isReturn: false,
    costCenterId: sale.costCenterId,
    taxBreakdown: (taxResult.taxBreakdown || undefined) as TaxBreakdownItem[] | undefined,
  })

  return {
    returnResult,
    sale,
    saleLines,
    newTotal,
    refundTotal,
    difference,
    collected,
    refunded: returnResult.refundPaidOut,
    stockChanges: [
      ...returnResult.stockChanges,
      ...stockResults.map((result, i) => ({ result, input: stockInputs[i] })),
    ],
    affectedItemIds: [...new Set([...returnResult.affectedItemIds, ...cart.map((c) => c.item.id)])],
  }
}
