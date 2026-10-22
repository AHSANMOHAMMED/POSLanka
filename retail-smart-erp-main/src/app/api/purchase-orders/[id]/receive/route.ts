import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseOrders, purchaseOrderItems, purchaseReceipts, purchaseReceiptItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { applyPurchaseCost, stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { receivePurchaseOrderSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { nextDocNo } from '@/lib/documents/numbering'
import { receiveIntoBatch } from '@/lib/purchasing/batch-receipt'
import { postGoodsReceiptToGL } from '@/lib/accounting/auto-post'
import { grnPostedValue } from '@/lib/purchasing/srbnb'
import { tenantToday } from '@/lib/accounting/gl'

// POST receive items for a purchase order (partial receiving)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, receivePurchaseOrderSchema)
  if (!parsed.success) return parsed.response
  const { items: receiveItems, notes, updateStock = false, supplierInvoiceNo, supplierBillDate } = parsed.data

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  let result
  try {
    result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }

      // Get purchase order with lock (RLS filters by tenant)
      const [order] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, id))
        .for('update')

      if (!order) {
        return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
      }

      // Validate PO status - must be 'confirmed' or 'partially_received'
      const allowedStatuses = ['confirmed', 'partially_received']
      if (!allowedStatuses.includes(order.status)) {
        return { error: NextResponse.json({
          error: `Cannot receive items for purchase order with status "${order.status}". Allowed statuses: ${allowedStatuses.join(', ')}`
        }, { status: 400 }) }
      }

      // Get all PO items
      const orderItems = await tx
        .select({
          id: purchaseOrderItems.id,
          itemId: purchaseOrderItems.itemId,
          itemName: purchaseOrderItems.itemName,
          quantity: purchaseOrderItems.quantity,
          unitPrice: purchaseOrderItems.unitPrice,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
        })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, id))

      if (orderItems.length === 0) {
        return { error: NextResponse.json({ error: 'Purchase order has no items' }, { status: 400 }) }
      }

      // Build a map of order items for quick lookup
      const orderItemMap = new Map(orderItems.map(item => [item.id, item]))

      // Aggregate the request by PO line: the same line may appear several times in
      // one request and must be validated (and applied) cumulatively, once.
      const aggregated = new Map<string, { qty: number; notes?: string; parts: { qty: number; batchNumber?: string; expiryDate?: string; manufacturingDate?: string }[] }>()
      for (const receiveItem of receiveItems) {
        if (!orderItemMap.has(receiveItem.itemId)) {
          return { error: NextResponse.json({
            error: `Item ${receiveItem.itemId} not found in purchase order`
          }, { status: 400 }) }
        }
        const prev = aggregated.get(receiveItem.itemId)
        aggregated.set(receiveItem.itemId, {
          qty: Math.round(((prev?.qty || 0) + receiveItem.receivedQuantity) * 1000) / 1000,
          notes: prev?.notes || receiveItem.notes,
          // one part per request row: the same PO line may be received into several batches
          parts: [...(prev?.parts || []), {
            qty: receiveItem.receivedQuantity, batchNumber: receiveItem.batchNumber,
            expiryDate: receiveItem.expiryDate, manufacturingDate: receiveItem.manufacturingDate,
          }],
        })
      }

      for (const [lineId, agg] of aggregated) {
        const poItem = orderItemMap.get(lineId)!
        const orderedQty = parseFloat(poItem.quantity)
        const previouslyReceived = parseFloat(poItem.receivedQuantity || '0')
        const maxReceivable = Math.round((orderedQty - previouslyReceived) * 1000) / 1000

        // Check that the total received for this line doesn't exceed remaining receivable
        if (agg.qty > maxReceivable) {
          return { error: NextResponse.json({
            error: `Cannot receive ${agg.qty} for "${poItem.itemName}". Maximum receivable: ${maxReceivable.toFixed(3)} (ordered: ${orderedQty.toFixed(3)}, already received: ${previouslyReceived.toFixed(3)})`
          }, { status: 400 }) }
        }
      }

      if (![...aggregated.values()].some(a => a.qty > 0)) {
        return { error: NextResponse.json({ error: 'Nothing to receive: all quantities are 0' }, { status: 400 }) }
      }

      // Track which items were updated and their new totals
      const updatedItems: { poItem: typeof orderItems[0]; newCumulativeReceived: number; receivedQty: number; notes?: string; parts: { qty: number; batchNumber?: string; expiryDate?: string; manufacturingDate?: string }[] }[] = []

      for (const [lineId, agg] of aggregated) {
        if (agg.qty <= 0) continue // Skip lines with 0 quantity

        const poItem = orderItemMap.get(lineId)!
        const previouslyReceived = parseFloat(poItem.receivedQuantity || '0')
        const newCumulativeReceived = Math.round((previouslyReceived + agg.qty) * 1000) / 1000

        // Update purchaseOrderItems.receivedQuantity (cumulative, once per line)
        await tx.update(purchaseOrderItems)
          .set({ receivedQuantity: newCumulativeReceived.toString() })
          .where(eq(purchaseOrderItems.id, lineId))

        updatedItems.push({ poItem, newCumulativeReceived, receivedQty: agg.qty, notes: agg.notes, parts: agg.parts })
      }

      // Create Purchase Receipt (GRN) record: GRN-YYYYMMDD-### from the per-tenant daily sequence
      const today = new Date()
      const receiptNo = await nextDocNo(tx, session.user.tenantId, 'grn')

      const [receipt] = await tx.insert(purchaseReceipts).values({
        tenantId: session.user.tenantId,
        receiptNo,
        purchaseOrderId: id,
        warehouseId: order.warehouseId,
        supplierId: order.supplierId,
        receiptDate: today.toISOString().slice(0, 10),
        status: 'completed',
        supplierInvoiceNo: supplierInvoiceNo || null,
        supplierBillDate: supplierBillDate || null,
        notes: notes || null,
        receivedBy: session.user.id,
      }).returning()

      // Update stock (and weighted-average cost) if requested. Lines are applied in
      // itemId order so concurrent receipts lock item / stock rows consistently.
      if (updateStock && order.warehouseId) {
        const stockLines = updatedItems
          .filter(u => u.poItem.itemId)
          .sort((a, b) => (a.poItem.itemId! < b.poItem.itemId! ? -1 : a.poItem.itemId! > b.poItem.itemId! ? 1 : 0))
        for (const u of stockLines) {
          const itemId = u.poItem.itemId!
          await applyPurchaseCost(tx, {
            tenantId: session.user.tenantId,
            itemId,
            supplierId: order.supplierId,
            unitPrice: parseFloat(u.poItem.unitPrice || '0'),
            qty: u.receivedQty,
            referenceId: receipt.id,
            referenceNo: receipt.receiptNo,
            userId: session.user.id,
            notes: `Received on ${receipt.receiptNo} (PO ${order.orderNo})`,
          })
          await applyStockChange(tx, {
            tenantId: session.user.tenantId,
            warehouseId: order.warehouseId,
            itemId,
            mode: 'delta',
            qty: u.receivedQty,
            type: 'in',
            referenceType: 'purchase_order_receive',
            referenceId: id,
            notes: u.notes || notes || `Receipt ${receipt.receiptNo} for PO ${order.orderNo}`,
            userId: session.user.id,
            source: 'purchase',
            idempotencyKey: `po-receive:${receipt.id}:${u.poItem.id}`,
          })
          // batch-tracked items: into the given batch(es), else a batch named after the GRN
          for (const part of u.parts) {
            await receiveIntoBatch(tx, {
              tenantId: session.user.tenantId, itemId, warehouseId: order.warehouseId, qty: part.qty,
              batchNumber: part.batchNumber, expiryDate: part.expiryDate, manufacturingDate: part.manufacturingDate,
              defaultBatchNumber: receipt.receiptNo, supplierId: order.supplierId, purchaseReceiptId: receipt.id,
              docType: 'grn', docId: receipt.id, lineId: u.poItem.id,
            })
          }
        }
      }

      // Create receipt items
      for (const updated of updatedItems) {
        await tx.insert(purchaseReceiptItems).values({
          tenantId: session.user.tenantId,
          receiptId: receipt.id,
          purchaseOrderItemId: updated.poItem.id,
          itemId: updated.poItem.itemId || null,
          itemName: updated.poItem.itemName,
          quantityReceived: updated.receivedQty.toString(),
          quantityAccepted: updated.receivedQty.toString(),
          quantityRejected: '0',
          notes: updated.notes || null,
          unitCost: updated.poItem.unitPrice || '0',
        })
      }

      // H3: goods put into stock are on the ledger from now on: Dr Stock / Cr Stock Received But
      // Not Billed at PO price. The supplier invoice clears SRBNB later (src/lib/purchasing/srbnb.ts).
      // Not configured / auto-posting off → nothing posted, gl_posted stays false (the invoice then
      // posts the stock, as before).
      if (updateStock && order.warehouseId) {
        const stockItemIds = [...new Set(updatedItems.map(u => u.poItem.itemId).filter((x): x is string => !!x))]
        const value = await grnPostedValue(tx, receipt.id, stockItemIds)
        const posted = await postGoodsReceiptToGL(tx, session.user.tenantId, {
          receiptId: receipt.id,
          receiptNo: receipt.receiptNo,
          postingDate: await tenantToday(session.user.tenantId),
          value,
          supplierId: order.supplierId,
        })
        if (posted && posted.length > 0) {
          await tx.update(purchaseReceipts).set({ glPosted: true }).where(eq(purchaseReceipts.id, receipt.id))
        }
      }

      // Recalculate all item received quantities to determine new PO status
      const refreshedItems = await tx
        .select({
          quantity: purchaseOrderItems.quantity,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
        })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, id))

      let totalOrdered = 0
      let totalReceived = 0

      for (const item of refreshedItems) {
        totalOrdered += parseFloat(item.quantity)
        totalReceived += parseFloat(item.receivedQuantity || '0')
      }

      // Determine new status based on receiving progress
      type POStatus = 'draft' | 'confirmed' | 'submitted' | 'partially_received' | 'fully_received' | 'invoice_created' | 'cancelled'
      let newStatus: POStatus = order.status as POStatus

      if (totalReceived === 0) {
        // Nothing received yet, keep as confirmed
        newStatus = 'confirmed'
      } else if (totalReceived >= totalOrdered) {
        // All items fully received
        newStatus = 'fully_received'
      } else {
        // Some items partially received
        newStatus = 'partially_received'
      }

      // Update PO status if changed
      if (newStatus !== order.status) {
        await tx.update(purchaseOrders)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(purchaseOrders.id, id))
      } else {
        // Just update the timestamp
        await tx.update(purchaseOrders)
          .set({ updatedAt: new Date() })
          .where(eq(purchaseOrders.id, id))
      }

      // Broadcast changes
      logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', id)
      logAndBroadcast(session.user.tenantId, 'purchase-receipt', 'created', receipt.id)

      if (updateStock && order.warehouseId) {
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', order.warehouseId)

        // Broadcast changes for each affected item
        const affectedItemIds = new Set<string>()
        for (const updated of updatedItems) {
          if (updated.poItem.itemId) {
            affectedItemIds.add(updated.poItem.itemId)
          }
        }
        for (const itemId of affectedItemIds) {
          logAndBroadcast(session.user.tenantId, 'item', 'updated', itemId)
        }
      }

      return {
        data: {
          success: true,
          message: `Received ${updatedItems.length} item(s)`,
          status: newStatus,
          receiptNo: receipt.receiptNo,
          receiptId: receipt.id,
          receivedItems: updatedItems.map(u => ({
            itemId: u.poItem.id,
            itemName: u.poItem.itemName,
            receivedQuantity: u.receivedQty,
            cumulativeReceived: u.newCumulativeReceived,
            orderedQuantity: parseFloat(u.poItem.quantity),
          })),
          totals: {
            totalOrdered,
            totalReceived,
            percentComplete: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0,
          }
        }
      }
    })
  } catch (err) {
    const apiError = stockErrorResponse(err)
    if (apiError) return apiError
    logError('api/purchase-orders/[id]/receive', err)
    return NextResponse.json({ error: 'Failed to receive purchase order items' }, { status: 500 })
  }

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
