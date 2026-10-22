import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseOrders, purchaseOrderItems, purchases, purchaseItems } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { applyStockChange, type StockChangeInput } from '@/lib/inventory/apply-stock-change'
import { applyPurchaseCost, stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { logError } from '@/lib/ai/error-logger'
import { roundCurrency } from '@/lib/utils/currency'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { postPurchaseToGL } from '@/lib/accounting/auto-post'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createPurchaseInvoiceSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { nextDocNo } from '@/lib/documents/numbering'
import { adjustSupplierBalance } from '@/lib/purchasing/supplier-balance'
import { receiveIntoBatch } from '@/lib/purchasing/batch-receipt'
import { findDuplicateSupplierInvoice, duplicateSupplierInvoiceResponse } from '@/lib/purchasing/supplier-invoice'
import { unbilledGrnStock } from '@/lib/purchasing/grn-coverage'
import { planGrnClearing } from '@/lib/purchasing/srbnb'
import { evaluateThreeWayMatch, matchBlockedMessage } from '@/lib/purchasing/three-way-match'

// POST create invoice from purchase order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, createPurchaseInvoiceSchema)
  if (!parsed.success) return parsed.response
  const { supplierInvoiceNo, supplierBillDate, paymentTerm, notes, costCenterId, updateStock, receivedQuantities, itemBatches = {} } = parsed.data

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  let result
  try {
    result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }

      // Get purchase order with lock to prevent double invoicing (RLS filters by tenant)
      const [order] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, id))
        .for('update')

      if (!order) {
        return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
      }

      // Allow invoice creation from confirmed, partially_received, or fully_received statuses
      const allowedForInvoice = ['confirmed', 'partially_received', 'fully_received']
      if (!allowedForInvoice.includes(order.status)) {
        return { error: NextResponse.json({
          error: `Only confirmed or received orders can be converted to invoices. Current status: ${order.status}`
        }, { status: 400 }) }
      }

      // Issue #43: Check if non-cancelled invoice already exists for this PO
      const [existingInvoice] = await tx
        .select({ id: purchases.id, purchaseNo: purchases.purchaseNo, status: purchases.status })
        .from(purchases)
        .where(and(
          eq(purchases.purchaseOrderId, id),
          sql`${purchases.status} != 'cancelled'`
        ))

      if (existingInvoice) {
        return { error: NextResponse.json({
          error: `Invoice ${existingInvoice.purchaseNo} already exists for this purchase order`,
          existingInvoiceId: existingInvoice.id
        }, { status: 400 }) }
      }

      // Check if stock was already updated during receiving (prevent double stock update)
      if (updateStock) {
        // A receive movement counts unless its receipt was cancelled (reversal keyed
        // 'po-receive-cancel:<movementId>').
        const existingStockMovement = await tx.execute(sql`
          SELECT m.id FROM stock_movements m
          WHERE m.tenant_id = ${session.user.tenantId}
            AND m.reference_type = 'purchase_order_receive'
            AND m.reference_id = ${id}
            AND NOT EXISTS (
              SELECT 1 FROM stock_movements r
              WHERE r.tenant_id = m.tenant_id AND r.idempotency_key = 'po-receive-cancel:' || m.id::text
            )
          LIMIT 1
        `)

        if (((existingStockMovement as unknown as { rows?: unknown[] }).rows || []).length > 0) {
          return { error: NextResponse.json({
            error: 'Stock was already updated during receiving. Cannot update stock again during invoice creation.',
            code: 'STOCK_ALREADY_UPDATED'
          }, { status: 400 }) }
        }
      }

      // The same supplier bill must not be posted twice
      const duplicate = await findDuplicateSupplierInvoice(tx, {
        tenantId: session.user.tenantId,
        supplierId: order.supplierId,
        supplierInvoiceNo,
        lock: true,
      })
      if (duplicate) return { error: duplicateSupplierInvoiceResponse(supplierInvoiceNo!, duplicate) }

      // Get PO items
      const orderItems = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, id))

      if (orderItems.length === 0) {
        return { error: NextResponse.json({ error: 'Purchase order has no items' }, { status: 400 }) }
      }

      // Generate purchase number with lock
      const purchaseNo = await nextDocNo(tx, session.user.tenantId, 'purchase_invoice')

      // Issue #37: Validate received quantities before processing
      if (receivedQuantities) {
        for (const item of orderItems) {
          const receivedQty = receivedQuantities[item.id] !== undefined
            ? parseFloat(receivedQuantities[item.id])
            : 0
          if (receivedQty < 0) {
            return { error: NextResponse.json({ error: `Received quantity cannot be negative for ${item.itemName}` }, { status: 400 }) }
          }
          const orderedQty = parseFloat(item.quantity)
          const previouslyReceived = parseFloat(item.receivedQuantity || '0')
          const maxReceivable = orderedQty - previouslyReceived
          if (receivedQty > maxReceivable) {
            return { error: NextResponse.json({ error: `Received quantity (${receivedQty}) exceeds remaining receivable quantity (${maxReceivable}) for ${item.itemName}` }, { status: 400 }) }
          }
        }
      }

      // Calculate totals, optionally using received quantities
      let subtotal = 0
      let taxAmount = 0
      const invoiceItems = orderItems.map(item => {
        const receivedQty = receivedQuantities?.[item.id] !== undefined
          ? parseFloat(receivedQuantities[item.id])
          : parseFloat(item.receivedQuantity || '0')

        const unitPrice = parseFloat(item.unitPrice)
        const orderedQty = parseFloat(item.quantity)
        const itemTax = roundCurrency(orderedQty > 0 ? parseFloat(item.tax) * (receivedQty / orderedQty) : 0)
        const lineSubtotal = roundCurrency(receivedQty * unitPrice)
        const itemTotal = roundCurrency(lineSubtotal + itemTax)

        subtotal += lineSubtotal
        taxAmount += itemTax

        return {
          tenantId: session.user.tenantId,
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: receivedQty.toString(),
          unitPrice: item.unitPrice,
          tax: itemTax.toString(),
          total: itemTotal.toString(),
          purchaseOrderItemId: item.id,
          // D1: what this line adds to purchase_order_items.received_quantity (reversed exactly on cancel/delete)
          poReceivedQty: (receivedQuantities?.[item.id] !== undefined ? receivedQty : 0).toString(),
        }
      }).filter(item => parseFloat(item.quantity) > 0)

      if (invoiceItems.length === 0) {
        return { error: NextResponse.json({ error: 'No items to receive (all quantities are 0)' }, { status: 400 }) }
      }

      subtotal = roundCurrency(subtotal)
      taxAmount = roundCurrency(taxAmount)
      let total = roundCurrency(subtotal + taxAmount)

      // Dual mode: try template-based tax recalculation
      const lineItems = invoiceItems.map(item => ({
        itemId: item.itemId,
        lineTotal: parseFloat(item.quantity) * parseFloat(item.unitPrice),
      }))
      const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'purchase' })
      let invoiceTaxBreakdown: typeof taxResult.taxBreakdown | null = null

      if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
        // Template configured — override with computed values
        subtotal = taxResult.subtotal
        taxAmount = taxResult.totalTax
        total = taxResult.total
        invoiceTaxBreakdown = taxResult.taxBreakdown
      }

      // H3: 3-way match (prices come from the PO; quantities vs received / ordered)
      const match = await evaluateThreeWayMatch(tx, {
        tenantId: session.user.tenantId,
        purchaseOrderId: id,
        lines: invoiceItems.map(item => ({ itemId: item.itemId, itemName: item.itemName, quantity: parseFloat(item.quantity), unitPrice: parseFloat(item.unitPrice) })),
      })
      if (match.status === 'mismatch' && match.action === 'block') {
        throw new Error(matchBlockedMessage(match))
      }
      // Goods already put into stock by this PO's GRNs and not yet billed (read before the new
      // invoice exists, so it does not count as billed). Without updateStock the invoice bills them.
      const grnRemaining = !updateStock ? await unbilledGrnStock(tx, session.user.tenantId, id) : new Map<string, number>()

      // Create purchase invoice
      const [newPurchase] = await tx.insert(purchases).values({
        tenantId: session.user.tenantId,
        purchaseNo,
        purchaseOrderId: id,
        supplierId: order.supplierId,
        warehouseId: order.warehouseId,
        supplierInvoiceNo: supplierInvoiceNo || null,
        supplierBillDate: supplierBillDate || null,
        paymentTerm: paymentTerm || 'credit',
        subtotal: subtotal.toString(),
        taxAmount: taxAmount.toString(),
        taxBreakdown: invoiceTaxBreakdown,
        total: total.toString(),
        paidAmount: '0',
        status: 'pending',
        costCenterId: costCenterId || null,
        notes: notes || null,
        createdBy: session.user.id,
        matchStatus: match.status,
        matchDetails: match,
        matchedAt: new Date(),
      }).returning()

      // Add invoice items
      const purchaseItemsData = invoiceItems.map(item => ({
        ...item,
        purchaseId: newPurchase.id,
      }))
      const insertedLines = await tx.insert(purchaseItems).values(purchaseItemsData).returning({ id: purchaseItems.id })

      // H3: lines billed against GL-posted GRN stock clear Stock Received But Not Billed
      let grnClearing: { srbnbAmount: number; priceVariance: number; cogsAdjustment: number } | undefined
      if (grnRemaining.size > 0) {
        const remaining = new Map(grnRemaining)
        const lines = invoiceItems.map((item) => {
          const qty = parseFloat(item.quantity)
          const fromGrn = item.itemId ? Math.min(qty, Math.max(0, remaining.get(item.itemId) || 0)) : 0
          if (item.itemId && fromGrn > 0) remaining.set(item.itemId, Math.round(((remaining.get(item.itemId) || 0) - fromGrn) * 1000) / 1000)
          return { itemId: item.itemId, qty, unitPrice: parseFloat(item.unitPrice), fromGrn }
        })
        const linesValue = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0)
        const plan = await planGrnClearing(tx, {
          tenantId: session.user.tenantId,
          purchaseOrderId: id,
          excludePurchaseId: newPurchase.id,
          grnRemaining,
          lines,
          netFactor: linesValue > 0 ? (total - taxAmount) / linesValue : 1,
          purchaseId: newPurchase.id,
          purchaseNo,
          supplierId: order.supplierId,
          userId: session.user.id,
        })
        for (let i = 0; i < insertedLines.length; i++) {
          const l = plan.lines[i]
          if (l && l.srbnbQty > 0) {
            await tx.update(purchaseItems)
              .set({ srbnbQty: l.srbnbQty.toString(), srbnbAmount: l.srbnbAmount.toFixed(2) })
              .where(eq(purchaseItems.id, insertedLines[i].id))
          }
        }
        if (plan.srbnbAmount !== 0) grnClearing = plan
      }

      // Update supplier balance (with the audit row the supplier statement is built from)
      if (total > 0) {
        await adjustSupplierBalance(tx, {
          tenantId: session.user.tenantId,
          supplierId: order.supplierId,
          delta: total,
          type: 'purchase',
          referenceType: 'purchase',
          referenceId: newPurchase.id,
          notes: `Purchase ${purchaseNo} created from PO ${order.orderNo}`,
          userId: session.user.id,
        })
      }

      // Post purchase GL entries (Dr Stock/Inventory, Dr Tax, Cr Accounts Payable)
      await postPurchaseToGL(tx, session.user.tenantId, {
        purchaseId: newPurchase.id,
        invoiceNumber: purchaseNo,
        purchaseDate: new Date().toISOString().split('T')[0],
        subtotal,
        tax: taxAmount,
        taxBreakdown: invoiceTaxBreakdown || undefined,
        discount: 0,
        total,
        amountPaid: 0,
        supplierId: order.supplierId || null,
        costCenterId: costCenterId || null,
        grnClearing,
      })

      // Update stock if requested (single stock writer, signed ledger rows). D1: the incoming
      // quantity also updates the weighted-average cost (applyPurchaseCost reads the total stock
      // BEFORE this line's receipt, so cost and stock are applied line by line in item order).
      if (updateStock && order.warehouseId) {
        const stockInputs: Array<StockChangeInput & { unitPrice: number; poLineId: string }> = []
        invoiceItems.forEach((item, idx) => {
          if (!item.itemId) return
          stockInputs.push({
            poLineId: item.purchaseOrderItemId,
            unitPrice: parseFloat(item.unitPrice),
            tenantId: session.user.tenantId,
            warehouseId: order.warehouseId,
            itemId: item.itemId,
            mode: 'delta',
            qty: parseFloat(item.quantity),
            type: 'in',
            referenceType: 'purchase',
            referenceId: newPurchase.id,
            notes: `Purchase Invoice ${purchaseNo} (from PO ${order.orderNo})`,
            userId: session.user.id,
            source: 'purchase',
            costCenterId: costCenterId || null,
            idempotencyKey: `purchase-in:${newPurchase.id}:${item.purchaseOrderItemId || idx}`,
          })
        })
        stockInputs.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
        for (const { unitPrice, poLineId, ...input } of stockInputs) {
          await applyPurchaseCost(tx, {
            tenantId: session.user.tenantId,
            itemId: input.itemId,
            supplierId: order.supplierId,
            unitPrice,
            qty: input.qty,
            referenceId: newPurchase.id,
            referenceNo: purchaseNo,
            userId: session.user.id,
            notes: `Purchase invoice ${purchaseNo} (from PO ${order.orderNo})`,
          })
          await applyStockChange(tx, input)
          const b = itemBatches[poLineId] || {}
          await receiveIntoBatch(tx, {
            tenantId: session.user.tenantId, itemId: input.itemId, warehouseId: order.warehouseId, qty: input.qty,
            batchNumber: b.batchNumber, expiryDate: b.expiryDate, manufacturingDate: b.manufacturingDate,
            defaultBatchNumber: purchaseNo, supplierId: order.supplierId,
            docType: 'purchase', docId: newPurchase.id, lineId: poLineId,
          })
        }
      }

      // Issue #38: Update received quantities cumulatively on PO items
      for (const item of orderItems) {
        const receivedQty = receivedQuantities?.[item.id] !== undefined
          ? parseFloat(receivedQuantities[item.id])
          : 0

        if (receivedQty <= 0) continue

        const previouslyReceived = parseFloat(item.receivedQuantity || '0')
        const newCumulative = previouslyReceived + receivedQty

        await tx.update(purchaseOrderItems)
          .set({ receivedQuantity: newCumulative.toString() })
          .where(eq(purchaseOrderItems.id, item.id))
      }

      // Update PO status
      await tx.update(purchaseOrders)
        .set({ status: 'invoice_created', updatedAt: new Date() })
        .where(eq(purchaseOrders.id, id))

      // Broadcast changes
      logAndBroadcast(session.user.tenantId, 'purchase', 'created', newPurchase.id)
      logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', id)
      logAndBroadcast(session.user.tenantId, 'supplier', 'updated', order.supplierId)
      if (updateStock) {
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', 'bulk')
      }

      return {
        data: {
          purchase: newPurchase,
          message: `Invoice ${newPurchase.purchaseNo} created successfully`,
        }
      }
    })
  } catch (err) {
    const apiError = stockErrorResponse(err)
    if (apiError) return apiError
    logError('api/purchase-orders/[id]/create-invoice', err)
    return NextResponse.json({ error: 'Failed to create invoice from purchase order' }, { status: 500 })
  }

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
