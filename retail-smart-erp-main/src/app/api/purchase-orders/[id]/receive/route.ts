import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseOrders, purchaseOrderItems, warehouseStock, stockMovements, purchaseReceipts, purchaseReceiptItems } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { receivePurchaseOrderSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

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

  const result = await withAuthTenantTransaction(async (session, tx) => {
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
        receivedQuantity: purchaseOrderItems.receivedQuantity,
      })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, id))

    if (orderItems.length === 0) {
      return { error: NextResponse.json({ error: 'Purchase order has no items' }, { status: 400 }) }
    }

    // Build a map of order items for quick lookup
    const orderItemMap = new Map(orderItems.map(item => [item.id, item]))

    // Validate receive items against PO items
    for (const receiveItem of receiveItems) {
      const poItem = orderItemMap.get(receiveItem.itemId)
      if (!poItem) {
        return { error: NextResponse.json({
          error: `Item ${receiveItem.itemId} not found in purchase order`
        }, { status: 400 }) }
      }

      const orderedQty = parseFloat(poItem.quantity)
      const previouslyReceived = parseFloat(poItem.receivedQuantity || '0')
      const maxReceivable = orderedQty - previouslyReceived

      // Check that received quantity doesn't exceed remaining receivable
      if (receiveItem.receivedQuantity > maxReceivable) {
        return { error: NextResponse.json({
          error: `Cannot receive ${receiveItem.receivedQuantity} for "${poItem.itemName}". Maximum receivable: ${maxReceivable.toFixed(3)} (ordered: ${orderedQty.toFixed(3)}, already received: ${previouslyReceived.toFixed(3)})`
        }, { status: 400 }) }
      }
    }

    // Track which items were updated and their new totals
    const updatedItems: { poItem: typeof orderItems[0]; newCumulativeReceived: number; receivedQty: number }[] = []

    // Process each receive item
    for (const receiveItem of receiveItems) {
      if (receiveItem.receivedQuantity <= 0) continue // Skip items with 0 quantity

      const poItem = orderItemMap.get(receiveItem.itemId)!
      const previouslyReceived = parseFloat(poItem.receivedQuantity || '0')
      const newCumulativeReceived = previouslyReceived + receiveItem.receivedQuantity

      // Update purchaseOrderItems.receivedQuantity (cumulative)
      await tx.update(purchaseOrderItems)
        .set({ receivedQuantity: newCumulativeReceived.toString() })
        .where(eq(purchaseOrderItems.id, receiveItem.itemId))

      updatedItems.push({
        poItem,
        newCumulativeReceived,
        receivedQty: receiveItem.receivedQuantity
      })

      // Update stock if requested and item has a linked inventory item
      if (updateStock && poItem.itemId && order.warehouseId) {
        // Lock existing stock record or prepare to insert
        const [existingStock] = await tx
          .select()
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.warehouseId, order.warehouseId),
            eq(warehouseStock.itemId, poItem.itemId)
          ))
          .for('update')

        if (existingStock) {
          // Update existing stock with SQL addition to prevent race conditions
          await tx.update(warehouseStock)
            .set({
              currentStock: sql`${warehouseStock.currentStock} + ${receiveItem.receivedQuantity}`,
              updatedAt: new Date(),
            })
            .where(eq(warehouseStock.id, existingStock.id))
        } else {
          // Create new stock record
          await tx.insert(warehouseStock).values({
            tenantId: session.user.tenantId,
            warehouseId: order.warehouseId,
            itemId: poItem.itemId,
            currentStock: receiveItem.receivedQuantity.toString(),
            minStock: '0',
          })
        }

        // Create stock movement record
        await tx.insert(stockMovements).values({
          tenantId: session.user.tenantId,
          warehouseId: order.warehouseId,
          itemId: poItem.itemId,
          type: 'in',
          quantity: receiveItem.receivedQuantity.toString(),
          referenceType: 'purchase_order_receive',
          referenceId: id,
          notes: receiveItem.notes || notes || `Partial receive for PO ${order.orderNo}`,
          createdBy: session.user.id,
        })
      }
    }

    // Create Purchase Receipt (GRN) record
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')

    // Generate receipt number: GRN-YYYYMMDD-###
    const existingReceipts = await tx
      .select({ receiptNo: purchaseReceipts.receiptNo })
      .from(purchaseReceipts)
      .where(and(
        eq(purchaseReceipts.tenantId, session.user.tenantId),
        sql`${purchaseReceipts.receiptNo} LIKE ${'GRN-' + dateStr + '-%'}`
      ))

    const nextSeq = existingReceipts.length + 1
    const receiptNo = `GRN-${dateStr}-${String(nextSeq).padStart(3, '0')}`

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
      })
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

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
