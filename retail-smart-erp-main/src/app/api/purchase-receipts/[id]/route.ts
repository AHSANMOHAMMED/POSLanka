import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseReceipts, purchaseReceiptItems, purchaseOrderItems, purchaseOrders, warehouseStock, stockMovements, users } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { deletePurchaseReceiptSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - Single purchase receipt detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [receipt] = await db
      .select({
        id: purchaseReceipts.id,
        receiptNo: purchaseReceipts.receiptNo,
        purchaseOrderId: purchaseReceipts.purchaseOrderId,
        warehouseId: purchaseReceipts.warehouseId,
        supplierId: purchaseReceipts.supplierId,
        receiptDate: purchaseReceipts.receiptDate,
        status: purchaseReceipts.status,
        supplierInvoiceNo: purchaseReceipts.supplierInvoiceNo,
        supplierBillDate: purchaseReceipts.supplierBillDate,
        notes: purchaseReceipts.notes,
        receivedBy: purchaseReceipts.receivedBy,
        receivedByName: users.fullName,
        cancellationReason: purchaseReceipts.cancellationReason,
        cancelledAt: purchaseReceipts.cancelledAt,
        createdAt: purchaseReceipts.createdAt,
        updatedAt: purchaseReceipts.updatedAt,
      })
      .from(purchaseReceipts)
      .leftJoin(users, eq(purchaseReceipts.receivedBy, users.id))
      .where(eq(purchaseReceipts.id, id))

    if (!receipt) return { notFound: true }

    const items = await db
      .select({
        id: purchaseReceiptItems.id,
        purchaseOrderItemId: purchaseReceiptItems.purchaseOrderItemId,
        itemId: purchaseReceiptItems.itemId,
        itemName: purchaseReceiptItems.itemName,
        quantityReceived: purchaseReceiptItems.quantityReceived,
        quantityAccepted: purchaseReceiptItems.quantityAccepted,
        quantityRejected: purchaseReceiptItems.quantityRejected,
        rejectionReason: purchaseReceiptItems.rejectionReason,
        notes: purchaseReceiptItems.notes,
      })
      .from(purchaseReceiptItems)
      .where(eq(purchaseReceiptItems.receiptId, id))

    return { data: { ...receipt, items } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('notFound' in result) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })

  return NextResponse.json(result.data)
}

// DELETE - Cancel a purchase receipt (reverses stock and receivedQuantity)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, deletePurchaseReceiptSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Lock the receipt
    const [receipt] = await tx
      .select()
      .from(purchaseReceipts)
      .where(eq(purchaseReceipts.id, id))
      .for('update')

    if (!receipt) {
      return { error: NextResponse.json({ error: 'Receipt not found' }, { status: 404 }) }
    }

    if (receipt.status === 'cancelled') {
      return { error: NextResponse.json({ error: 'Receipt is already cancelled' }, { status: 400 }) }
    }

    // Get receipt items
    const receiptItems = await tx
      .select()
      .from(purchaseReceiptItems)
      .where(eq(purchaseReceiptItems.receiptId, id))

    // Reverse receivedQuantity on PO items
    for (const item of receiptItems) {
      if (item.purchaseOrderItemId) {
        await tx.update(purchaseOrderItems)
          .set({
            receivedQuantity: sql`GREATEST(0, ${purchaseOrderItems.receivedQuantity}::numeric - ${parseFloat(item.quantityReceived)})`,
          })
          .where(eq(purchaseOrderItems.id, item.purchaseOrderItemId))
      }

      // Reverse stock if warehouse was set
      if (receipt.warehouseId && item.itemId) {
        const [existingStock] = await tx
          .select()
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.warehouseId, receipt.warehouseId),
            eq(warehouseStock.itemId, item.itemId)
          ))
          .for('update')

        if (existingStock) {
          await tx.update(warehouseStock)
            .set({
              currentStock: sql`GREATEST(0, ${warehouseStock.currentStock}::numeric - ${parseFloat(item.quantityAccepted)})`,
              updatedAt: new Date(),
            })
            .where(eq(warehouseStock.id, existingStock.id))
        }

        // Create reversal stock movement
        await tx.insert(stockMovements).values({
          tenantId: session.user.tenantId,
          warehouseId: receipt.warehouseId,
          itemId: item.itemId,
          type: 'out',
          quantity: item.quantityAccepted,
          referenceType: 'purchase_receipt_cancel',
          referenceId: id,
          notes: `Cancelled receipt ${receipt.receiptNo}`,
          createdBy: session.user.id,
        })
      }
    }

    // Update receipt status
    await tx.update(purchaseReceipts)
      .set({
        status: 'cancelled',
        cancellationReason: body.cancellationReason || null,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseReceipts.id, id))

    // Recalculate PO status if linked
    if (receipt.purchaseOrderId) {
      const poItems = await tx
        .select({
          quantity: purchaseOrderItems.quantity,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
        })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, receipt.purchaseOrderId))

      let totalOrdered = 0
      let totalReceived = 0
      for (const pi of poItems) {
        totalOrdered += parseFloat(pi.quantity)
        totalReceived += parseFloat(pi.receivedQuantity || '0')
      }

      type POStatus = 'draft' | 'confirmed' | 'submitted' | 'partially_received' | 'fully_received' | 'invoice_created' | 'cancelled'
      let newStatus: POStatus
      if (totalReceived === 0) {
        newStatus = 'confirmed'
      } else if (totalReceived >= totalOrdered) {
        newStatus = 'fully_received'
      } else {
        newStatus = 'partially_received'
      }

      await tx.update(purchaseOrders)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, receipt.purchaseOrderId))

      logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', receipt.purchaseOrderId)
    }

    // Broadcast changes
    logAndBroadcast(session.user.tenantId, 'purchase-receipt', 'updated', id)
    if (receipt.warehouseId) {
      logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', receipt.warehouseId)
    }

    return {
      data: { success: true, message: `Receipt ${receipt.receiptNo} cancelled` }
    }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error

  return NextResponse.json(result.data)
}
