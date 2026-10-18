import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { salesOrders, salesOrderItems, warehouses, users, items as itemsTable, warehouseStock, sales } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSalesOrderSchema } from '@/lib/validation/schemas/sales'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Valid status transitions
const validTransitions: Record<string, string[]> = {
  'draft': ['confirmed', 'cancelled'],
  'confirmed': ['partially_fulfilled', 'fulfilled', 'cancelled'],
  'partially_fulfilled': ['fulfilled', 'cancelled'],
  'fulfilled': [],
  'cancelled': [],
}

// GET single sales order with items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    // Get sales order with joins (RLS filters by tenant)
    const [order] = await db
      .select({
        id: salesOrders.id,
        orderNo: salesOrders.orderNo,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        vehicleId: salesOrders.vehicleId,
        vehiclePlate: salesOrders.vehiclePlate,
        vehicleDescription: salesOrders.vehicleDescription,
        warehouseId: salesOrders.warehouseId,
        warehouseName: warehouses.name,
        expectedDeliveryDate: salesOrders.expectedDeliveryDate,
        deliveryAddress: salesOrders.deliveryAddress,
        subtotal: salesOrders.subtotal,
        discountAmount: salesOrders.discountAmount,
        discountType: salesOrders.discountType,
        taxAmount: salesOrders.taxAmount,
        total: salesOrders.total,
        status: salesOrders.status,
        notes: salesOrders.notes,
        createdBy: salesOrders.createdBy,
        createdByName: users.fullName,
        confirmedBy: salesOrders.confirmedBy,
        confirmedAt: salesOrders.confirmedAt,
        cancellationReason: salesOrders.cancellationReason,
        cancelledAt: salesOrders.cancelledAt,
        createdAt: salesOrders.createdAt,
        updatedAt: salesOrders.updatedAt,
      })
      .from(salesOrders)
      .leftJoin(warehouses, eq(salesOrders.warehouseId, warehouses.id))
      .leftJoin(users, eq(salesOrders.createdBy, users.id))
      .where(eq(salesOrders.id, id))

    if (!order) {
      return { error: NextResponse.json({ error: 'Sales order not found' }, { status: 404 }) }
    }

    // Get items
    const items = await db
      .select({
        id: salesOrderItems.id,
        itemId: salesOrderItems.itemId,
        itemName: salesOrderItems.itemName,
        itemSku: itemsTable.sku,
        itemBarcode: itemsTable.barcode,
        itemOemPartNumber: itemsTable.oemPartNumber,
        itemPluCode: itemsTable.pluCode,
        quantity: salesOrderItems.quantity,
        fulfilledQuantity: salesOrderItems.fulfilledQuantity,
        unitPrice: salesOrderItems.unitPrice,
        discount: salesOrderItems.discount,
        discountType: salesOrderItems.discountType,
        tax: salesOrderItems.tax,
        taxAmount: salesOrderItems.taxAmount,
        taxRate: salesOrderItems.taxRate,
        total: salesOrderItems.total,
      })
      .from(salesOrderItems)
      .leftJoin(itemsTable, eq(salesOrderItems.itemId, itemsTable.id))
      .where(eq(salesOrderItems.salesOrderId, id))

    // Get linked invoices (sales with salesOrderId)
    const linkedInvoices = await db
      .select({
        id: sales.id,
        invoiceNo: sales.invoiceNo,
        total: sales.total,
        status: sales.status,
        createdAt: sales.createdAt,
        voidReason: sales.voidReason,
      })
      .from(sales)
      .where(eq(sales.salesOrderId, id))

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

// PUT update sales order
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updateSalesOrderSchema)
  if (!parsed.success) return parsed.response

  const {
    customerId,
    customerName,
    vehicleId,
    vehiclePlate,
    vehicleDescription,
    warehouseId,
    expectedDeliveryDate,
    deliveryAddress,
    notes,
    status,
    cancellationReason,
    expectedUpdatedAt,
    items,
    changesSummary,
  } = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageSales')
    if (permError) return { error: permError }

    // Get current order with lock (RLS filters by tenant)
    const [currentOrder] = await tx
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, id))
      .for('update')

    if (!currentOrder) {
      return { error: NextResponse.json({ error: 'Sales order not found' }, { status: 404 }) }
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

      // Validate items exist before confirming
      if (status === 'confirmed' && currentOrder.status === 'draft') {
        const itemCount = await tx
          .select({ count: sql<number>`count(*)` })
          .from(salesOrderItems)
          .where(eq(salesOrderItems.salesOrderId, id))

        if (Number(itemCount[0].count) === 0) {
          return { error: NextResponse.json({
            error: 'Cannot confirm a sales order with no items. Please add at least one item.'
          }, { status: 400 }) }
        }
      }

      // Validate cancellation reason
      if (status === 'cancelled' && !cancellationReason) {
        return { error: NextResponse.json({
          error: 'Cancellation reason is required'
        }, { status: 400 }) }
      }
    }

    // Fields can only be changed on draft orders
    if (currentOrder.status !== 'draft') {
      if (warehouseId !== undefined || customerId !== undefined || vehicleId !== undefined) {
        // Allow these changes only in draft
        if (status === undefined || status === currentOrder.status) {
          return { error: NextResponse.json({ error: 'Order details can only be changed on draft orders' }, { status: 400 }) }
        }
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (currentOrder.status === 'draft') {
      if (customerId !== undefined) updateData.customerId = customerId || null
      if (customerName !== undefined) updateData.customerName = customerName || null
      if (vehicleId !== undefined) updateData.vehicleId = vehicleId || null
      if (vehiclePlate !== undefined) updateData.vehiclePlate = vehiclePlate || null
      if (vehicleDescription !== undefined) updateData.vehicleDescription = vehicleDescription || null
      if (warehouseId !== undefined) updateData.warehouseId = warehouseId
      if (expectedDeliveryDate !== undefined) updateData.expectedDeliveryDate = expectedDeliveryDate || null
      if (deliveryAddress !== undefined) updateData.deliveryAddress = deliveryAddress || null
    }

    if (notes !== undefined) updateData.notes = notes || null

    // Handle status transitions
    if (status !== undefined && status !== currentOrder.status) {
      updateData.status = status

      if (status === 'confirmed') {
        updateData.confirmedBy = session.user.id
        updateData.confirmedAt = new Date()

        // Reserve stock for confirmed items
        const orderItems = await tx
          .select()
          .from(salesOrderItems)
          .where(eq(salesOrderItems.salesOrderId, id))

        for (const item of orderItems) {
          if (!item.itemId) continue

          // Check if item tracks stock
          const [itemRecord] = await tx
            .select({ trackStock: itemsTable.trackStock })
            .from(itemsTable)
            .where(eq(itemsTable.id, item.itemId))

          if (!itemRecord?.trackStock) continue

          const qty = parseFloat(item.quantity)

          // Lock warehouse stock row
          const [stock] = await tx
            .select()
            .from(warehouseStock)
            .where(and(
              eq(warehouseStock.warehouseId, currentOrder.warehouseId),
              eq(warehouseStock.itemId, item.itemId)
            ))
            .for('update')

          if (stock) {
            const available = parseFloat(stock.currentStock) - parseFloat(stock.reservedStock)
            if (available < qty) {
              return { error: NextResponse.json({
                error: `Insufficient stock for ${item.itemName}. Available: ${available}, Required: ${qty}`
              }, { status: 400 }) }
            }

            await tx.update(warehouseStock)
              .set({
                reservedStock: sql`${warehouseStock.reservedStock} + ${qty}`,
                updatedAt: new Date(),
              })
              .where(eq(warehouseStock.id, stock.id))
          } else {
            return { error: NextResponse.json({
              error: `No stock found for ${item.itemName} in selected warehouse`
            }, { status: 400 }) }
          }
        }

        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', 'bulk')
      }

      if (status === 'cancelled') {
        updateData.cancellationReason = cancellationReason || null
        updateData.cancelledAt = new Date()

        // Release reserved stock (only unfulfilled portion)
        if (currentOrder.status === 'confirmed' || currentOrder.status === 'partially_fulfilled') {
          const orderItems = await tx
            .select()
            .from(salesOrderItems)
            .where(eq(salesOrderItems.salesOrderId, id))

          for (const item of orderItems) {
            if (!item.itemId) continue

            const [itemRecord] = await tx
              .select({ trackStock: itemsTable.trackStock })
              .from(itemsTable)
              .where(eq(itemsTable.id, item.itemId))

            if (!itemRecord?.trackStock) continue

            const unfulfilledQty = parseFloat(item.quantity) - parseFloat(item.fulfilledQuantity)
            if (unfulfilledQty <= 0) continue

            await tx.update(warehouseStock)
              .set({
                reservedStock: sql`GREATEST(${warehouseStock.reservedStock} - ${unfulfilledQty}, 0)`,
                updatedAt: new Date(),
              })
              .where(and(
                eq(warehouseStock.warehouseId, currentOrder.warehouseId),
                eq(warehouseStock.itemId, item.itemId)
              ))
          }

          logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', 'bulk')
        }
      }
    }

    // Handle item updates (only in draft status)
    if (items !== undefined && currentOrder.status === 'draft') {
      // Delete existing items
      await tx.delete(salesOrderItems)
        .where(eq(salesOrderItems.salesOrderId, id))

      if (items.length > 0) {
        let subtotal = 0
        let totalDiscount = 0
        let totalTax = 0

        const orderItems = items.map((item) => {
          const itemSubtotal = item.quantity * item.unitPrice
          const itemDiscount = Math.max(0, item.discount || 0)
          const itemTaxAmount = Math.max(0, item.taxAmount || item.tax || 0)
          subtotal += itemSubtotal
          totalDiscount += itemDiscount
          totalTax += itemTaxAmount
          const itemTotal = itemSubtotal - itemDiscount + itemTaxAmount

          return {
            tenantId: session.user.tenantId,
            salesOrderId: id,
            itemId: item.itemId || null,
            itemName: item.itemName,
            quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(),
            discount: itemDiscount.toString(),
            discountType: item.discountType || null,
            tax: (item.tax || 0).toString(),
            taxAmount: itemTaxAmount.toString(),
            taxRate: (item.taxRate || 0).toString(),
            total: (Math.round(itemTotal * 100) / 100).toString(),
          }
        })

        await tx.insert(salesOrderItems).values(orderItems)

        subtotal = Math.round(subtotal * 100) / 100
        totalDiscount = Math.round(totalDiscount * 100) / 100
        totalTax = Math.round(totalTax * 100) / 100

        updateData.subtotal = subtotal.toString()
        updateData.discountAmount = totalDiscount.toString()
        updateData.taxAmount = totalTax.toString()
        updateData.total = (Math.round((subtotal - totalDiscount + totalTax) * 100) / 100).toString()
      } else {
        updateData.subtotal = '0'
        updateData.discountAmount = '0'
        updateData.taxAmount = '0'
        updateData.total = '0'
      }
    }

    const [updated] = await tx.update(salesOrders)
      .set(updateData)
      .where(eq(salesOrders.id, id))
      .returning()

    if (!updated) {
      return { error: NextResponse.json({ error: 'Sales order not found' }, { status: 404 }) }
    }

    // Build change description for activity log
    const changes: string[] = []
    if (status !== undefined && status !== currentOrder.status) {
      changes.push(`status → ${status}`)
    }
    if (customerId !== undefined && customerId !== currentOrder.customerId) {
      changes.push('customer changed')
    }
    if (warehouseId !== undefined && warehouseId !== currentOrder.warehouseId) {
      changes.push('warehouse changed')
    }
    if (expectedDeliveryDate !== undefined && expectedDeliveryDate !== currentOrder.expectedDeliveryDate) {
      changes.push('delivery date changed')
    }
    if (deliveryAddress !== undefined && deliveryAddress !== currentOrder.deliveryAddress) {
      changes.push('delivery address updated')
    }
    if (notes !== undefined && notes !== currentOrder.notes) {
      changes.push('notes updated')
    }
    if (changesSummary) {
      changes.push(changesSummary)
    }

    const entityName = updated.orderNo || id
    const description = changes.length > 0
      ? `${entityName}: ${changes.join('; ')}`
      : `Saved ${entityName}`

    logAndBroadcast(session.user.tenantId, 'sales-order', 'updated', id, {
      userId: session.user.id,
      entityName,
      activityAction: status === 'cancelled' ? 'cancel' : 'update',
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

// DELETE sales order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageSales')
    if (permError) return { error: permError }

    // Get current order (RLS filters by tenant)
    const [currentOrder] = await tx
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, id))

    if (!currentOrder) {
      return { error: NextResponse.json({ error: 'Sales order not found' }, { status: 404 }) }
    }

    // Can only delete draft orders
    if (currentOrder.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Only draft orders can be deleted. Cancel the order instead.' }, { status: 400 }) }
    }

    // Delete items first
    await tx.delete(salesOrderItems)
      .where(eq(salesOrderItems.salesOrderId, id))

    // Delete order
    await tx.delete(salesOrders)
      .where(eq(salesOrders.id, id))

    logAndBroadcast(session.user.tenantId, 'sales-order', 'deleted', id)

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
