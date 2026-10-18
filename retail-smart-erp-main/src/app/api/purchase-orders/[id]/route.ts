import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { purchaseOrders, purchaseOrderItems, purchases, suppliers, warehouses, users, items as itemsTable } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePurchaseOrderSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Valid status transitions
// Note: 'partially_received' and 'fully_received' are set by the /receive endpoint, not direct status changes
const validTransitions: Record<string, string[]> = {
  'draft': ['submitted', 'cancelled'],
  'submitted': ['confirmed', 'cancelled'],  // Issue #45: Removed draft (no submitted→draft)
  'confirmed': ['invoice_created', 'cancelled'],  // Can also go to partially_received/fully_received via /receive endpoint
  'partially_received': ['invoice_created', 'cancelled'],  // Can receive more or create invoice
  'fully_received': ['invoice_created', 'cancelled'],  // All received, can create invoice
  'invoice_created': ['cancelled'],  // Issue #41: Allow cancellation from invoice_created
  'cancelled': [],
}

// GET single purchase order with items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    // Get purchase order with joins (RLS filters by tenant)
    const [order] = await db
      .select({
        id: purchaseOrders.id,
        orderNo: purchaseOrders.orderNo,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        warehouseId: purchaseOrders.warehouseId,
        warehouseName: warehouses.name,
        expectedDeliveryDate: purchaseOrders.expectedDeliveryDate,
        subtotal: purchaseOrders.subtotal,
        taxAmount: purchaseOrders.taxAmount,
        total: purchaseOrders.total,
        status: purchaseOrders.status,
        notes: purchaseOrders.notes,
        createdBy: purchaseOrders.createdBy,
        createdByName: users.fullName,
        approvedBy: purchaseOrders.approvedBy,
        approvedAt: purchaseOrders.approvedAt,
        cancellationReason: purchaseOrders.cancellationReason,
        cancelledAt: purchaseOrders.cancelledAt,
        tags: purchaseOrders.tags,
        createdAt: purchaseOrders.createdAt,
        updatedAt: purchaseOrders.updatedAt,
      })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(warehouses, eq(purchaseOrders.warehouseId, warehouses.id))
      .leftJoin(users, eq(purchaseOrders.createdBy, users.id))
      .where(eq(purchaseOrders.id, id))

    if (!order) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    // Get items
    const items = await db
      .select({
        id: purchaseOrderItems.id,
        itemId: purchaseOrderItems.itemId,
        itemName: purchaseOrderItems.itemName,
        itemSku: itemsTable.sku,
        itemBarcode: itemsTable.barcode,
        itemOemPartNumber: itemsTable.oemPartNumber,
        itemPluCode: itemsTable.pluCode,
        quantity: purchaseOrderItems.quantity,
        receivedQuantity: purchaseOrderItems.receivedQuantity,
        unitPrice: purchaseOrderItems.unitPrice,
        tax: purchaseOrderItems.tax,
        total: purchaseOrderItems.total,
      })
      .from(purchaseOrderItems)
      .leftJoin(itemsTable, eq(purchaseOrderItems.itemId, itemsTable.id))
      .where(eq(purchaseOrderItems.purchaseOrderId, id))

    // Get linked purchase invoices
    const linkedInvoices = await db
      .select({
        id: purchases.id,
        purchaseNo: purchases.purchaseNo,
        status: purchases.status,
        total: purchases.total,
      })
      .from(purchases)
      .where(eq(purchases.purchaseOrderId, id))

    return { data: { ...order, items, linkedInvoices } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// PUT update purchase order
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updatePurchaseOrderSchema)
  if (!parsed.success) return parsed.response
  const {
    supplierId,
    warehouseId,
    expectedDeliveryDate,
    notes,
    tags,
    status,
    cancellationReason,
    expectedUpdatedAt,
    changesSummary
  } = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Lock and get current order to prevent race conditions (RLS filters by tenant)
    const [currentOrder] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .for('update')

    if (!currentOrder) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    // Optimistic locking check
    if (expectedUpdatedAt) {
      const clientTime = new Date(expectedUpdatedAt).getTime()
      const serverTime = currentOrder.updatedAt ? new Date(currentOrder.updatedAt).getTime() : 0
      if (serverTime > clientTime) {
        return { error: NextResponse.json({
          error: 'This record was modified by another user. Please refresh and try again.',
          code: 'CONFLICT'
        }, { status: 409 }) }
      }
    }

    // Validate status transitions
    if (status !== undefined && status !== currentOrder.status) {
      const allowedTransitions = validTransitions[currentOrder.status] || []
      if (!allowedTransitions.includes(status)) {
        return { error: NextResponse.json({
          error: `Cannot change status from "${currentOrder.status}" to "${status}". Allowed: ${allowedTransitions.join(', ') || 'none'}`
        }, { status: 400 }) }
      }

      // Validate empty items on submission
      if (status === 'submitted' && currentOrder.status === 'draft') {
        const itemCount = await tx
          .select({ count: sql<number>`count(*)` })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.purchaseOrderId, id))

        if (Number(itemCount[0].count) === 0) {
          return { error: NextResponse.json({
            error: 'Cannot submit a purchase order with no items. Please add at least one item.'
          }, { status: 400 }) }
        }
      }
    }

    // Supplier can only be changed on draft orders
    if (currentOrder.status !== 'draft' && supplierId !== undefined) {
      return { error: NextResponse.json({ error: 'Supplier can only be changed on draft orders' }, { status: 400 }) }
    }

    // Warehouse can be changed only on draft or submitted orders
    const lockedStatuses = ['confirmed', 'partially_received', 'fully_received', 'invoice_created', 'cancelled']
    if (lockedStatuses.includes(currentOrder.status) && warehouseId !== undefined) {
      return { error: NextResponse.json({ error: 'Warehouse cannot be changed after order is confirmed' }, { status: 400 }) }
    }

    // Build update data
    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (supplierId !== undefined) updateData.supplierId = supplierId
    if (warehouseId !== undefined) updateData.warehouseId = warehouseId
    if (expectedDeliveryDate !== undefined) updateData.expectedDeliveryDate = expectedDeliveryDate || null
    if (notes !== undefined) updateData.notes = notes || null
    if (tags !== undefined) updateData.tags = tags.length > 0 ? JSON.stringify(tags) : null

    if (status !== undefined) {
      updateData.status = status

      if (status === 'confirmed' && currentOrder.status === 'submitted') {
        updateData.approvedBy = session.user.id
        updateData.approvedAt = new Date()
      }

      if (status === 'cancelled') {
        updateData.cancellationReason = cancellationReason || null
        updateData.cancelledAt = new Date()
      }
    }

    const [updated] = await tx.update(purchaseOrders)
      .set(updateData)
      .where(eq(purchaseOrders.id, id))
      .returning()

    if (!updated) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    // Build change description
    const changes: string[] = []
    if (status !== undefined && status !== currentOrder.status) {
      changes.push(`status → ${status}`)
    }
    if (supplierId !== undefined && supplierId !== currentOrder.supplierId) {
      changes.push('supplier changed')
    }
    if (warehouseId !== undefined && warehouseId !== currentOrder.warehouseId) {
      changes.push('warehouse changed')
    }
    if (expectedDeliveryDate !== undefined && expectedDeliveryDate !== currentOrder.expectedDeliveryDate) {
      changes.push('delivery date changed')
    }
    if (notes !== undefined && notes !== currentOrder.notes) {
      changes.push('notes updated')
    }
    if (tags !== undefined) {
      changes.push('tags updated')
    }
    if (changesSummary) {
      changes.push(changesSummary)
    }

    const description = changes.length > 0
      ? `${updated.orderNo}: ${changes.join(', ')}`
      : `Saved ${updated.orderNo}`

    logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', id, {
      userId: session.user.id,
      entityName: updated.orderNo,
      activityAction: status !== undefined && status !== currentOrder.status && status === 'cancelled' ? 'cancel' : 'update',
      description,
    })

    return { data: updated }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// DELETE purchase order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Get current order (RLS filters by tenant)
    const [currentOrder] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    if (!currentOrder) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    // Can only delete draft orders
    if (currentOrder.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Only draft orders can be deleted. Cancel the order instead.' }, { status: 400 }) }
    }

    // Delete items first
    await tx.delete(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, id))

    // Delete order
    await tx.delete(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase-order', 'deleted', id)

    return { data: { success: true } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
