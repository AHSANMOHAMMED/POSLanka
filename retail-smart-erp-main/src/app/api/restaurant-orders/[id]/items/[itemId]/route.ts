import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantOrders, restaurantOrderItems, kitchenOrders, kitchenOrderItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { recalculateOrderTotals } from '@/lib/restaurant/order-totals'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateRestaurantOrderItemSchema } from '@/lib/validation/schemas/restaurant'
import { z } from 'zod'
import { assertRecordBranch } from '@/lib/auth/branch-access'


// Helper function to check and update kitchen order status
async function updateKitchenOrderStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  kitchenOrderId: string
) {
  // Get all kitchen order items
  const kitchenItems = await db.query.kitchenOrderItems.findMany({
    where: eq(kitchenOrderItems.kitchenOrderId, kitchenOrderId),
  })

  if (kitchenItems.length === 0) {
    return
  }
  // Cancelled lines do not hold the ticket back; a ticket whose lines are all cancelled is cancelled
  const live = kitchenItems.filter((item: { status: string }) => item.status !== 'cancelled')
  if (live.length === 0) {
    await db.update(kitchenOrders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(kitchenOrders.id, kitchenOrderId))
    return
  }

  // Check if all items are ready
  const allReady = live.every(
    (item: { status: string }) => item.status === 'ready' || item.status === 'served'
  )

  // Check if all items are served
  const allServed = live.every(
    (item: { status: string }) => item.status === 'served'
  )

  // Check if any item is being prepared
  const anyPreparing = live.some(
    (item: { status: string }) => item.status === 'preparing'
  )

  let newStatus: 'pending' | 'preparing' | 'ready' | 'served' = 'pending'

  if (allServed) {
    newStatus = 'served'
  } else if (allReady) {
    newStatus = 'ready'
  } else if (anyPreparing) {
    newStatus = 'preparing'
  }

  await db.update(kitchenOrders)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(kitchenOrders.id, kitchenOrderId))
}

// PUT update restaurant order item
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), itemId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: orderId, itemId } = paramsParsed.data
    const parsed = await validateBody(request, updateRestaurantOrderItemSchema)
    if (!parsed.success) return parsed.response
    const { quantity, modifiers, notes, status } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // K4: an order of another branch is refused
      const branchDenied = await assertRecordBranch(session, db, restaurantOrders, orderId)
      if (branchDenied) return branchDenied

      return await db.transaction(async (tx) => {
        // Verify order exists
        const order = await tx.query.restaurantOrders.findFirst({
          where: eq(restaurantOrders.id, orderId),
        })

        if (!order) {
          throw new Error('ORDER_NOT_FOUND')
        }

        // Get the item
        const [currentItem] = await tx
          .select()
          .from(restaurantOrderItems)
          .where(and(
            eq(restaurantOrderItems.id, itemId),
            eq(restaurantOrderItems.orderId, orderId)
          ))
          .for('update')

        if (!currentItem) {
          throw new Error('ITEM_NOT_FOUND')
        }

        // Build update data
        const updateData: Record<string, unknown> = {}

        // Handle quantity update (only if order is open)
        if (quantity !== undefined) {
          if (order.status !== 'open') {
            throw new Error('CANNOT_UPDATE_QUANTITY_CLOSED_ORDER')
          }
          updateData.quantity = quantity
        }

        // Handle modifiers update (only if order is open)
        if (modifiers !== undefined) {
          if (order.status !== 'open') {
            throw new Error('CANNOT_UPDATE_MODIFIERS_CLOSED_ORDER')
          }
          updateData.modifiers = modifiers
        }

        // Handle notes update
        if (notes !== undefined) {
          updateData.notes = notes || null
        }

        // Handle status update. A completed / cancelled order is settled: its lines can no
        // longer change (cancelling a line would silently change a bill that was already paid).
        if (status !== undefined) {
          if (order.status === 'completed' || order.status === 'cancelled') {
            throw new Error('ORDER_SETTLED')
          }
          if (currentItem.status === 'cancelled' && status !== 'cancelled') {
            throw new Error('ITEM_CANCELLED')
          }
          updateData.status = status
        }

        // Update the item
        const [updated] = await tx.update(restaurantOrderItems)
          .set(updateData)
          .where(and(
            eq(restaurantOrderItems.id, itemId),
            eq(restaurantOrderItems.orderId, orderId)
          ))
          .returning()

        // If status was updated, also update the kitchen order item status
        if (status !== undefined) {
          // Find the corresponding kitchen order item
          const kitchenOrder = await tx.query.kitchenOrders.findFirst({
            where: eq(kitchenOrders.restaurantOrderId, orderId),
          })

          if (kitchenOrder) {
            await tx.update(kitchenOrderItems)
              .set({ status: status as 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled' })
              .where(eq(kitchenOrderItems.restaurantOrderItemId, itemId))

            // Update kitchen order overall status
            await updateKitchenOrderStatus(tx, kitchenOrder.id)

            // Broadcast kitchen order update
            logAndBroadcast(session.user.tenantId, 'kitchen-order', 'updated', kitchenOrder.id)
          }
        }

        // Recalculate order totals if quantity changed or a line was cancelled / restored
        if (quantity !== undefined || (status !== undefined && (status === 'cancelled') !== (currentItem.status === 'cancelled'))) {
          await recalculateOrderTotals(tx, orderId, session.user.tenantId)
        }

        // Broadcast restaurant order update
        logAndBroadcast(session.user.tenantId, 'restaurant-order', 'updated', orderId)

        return NextResponse.json(updated)
      })
    })
  } catch (error) {
    logError('api/restaurant-orders/[id]/items/[itemId]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'ORDER_NOT_FOUND') {
      return NextResponse.json({ error: 'Restaurant order not found' }, { status: 404 })
    }
    if (message === 'ITEM_NOT_FOUND') {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }
    if (message === 'CANNOT_UPDATE_QUANTITY_CLOSED_ORDER') {
      return NextResponse.json({ error: 'Cannot update quantity on closed orders' }, { status: 400 })
    }
    if (message === 'CANNOT_UPDATE_MODIFIERS_CLOSED_ORDER') {
      return NextResponse.json({ error: 'Cannot update modifiers on closed orders' }, { status: 400 })
    }
    if (message === 'INVALID_QUANTITY') {
      return NextResponse.json({ error: 'Quantity must be a positive integer' }, { status: 400 })
    }
    if (message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    if (message === 'ORDER_SETTLED') {
      return NextResponse.json({ error: 'Cannot change items of a completed or cancelled order' }, { status: 400 })
    }
    if (message === 'ITEM_CANCELLED') {
      return NextResponse.json({ error: 'This item was cancelled. Add it again instead.' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update order item' }, { status: 500 })
  }
}

// DELETE remove item from restaurant order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), itemId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: orderId, itemId } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // K4: an order of another branch is refused
      const branchDenied = await assertRecordBranch(session, db, restaurantOrders, orderId)
      if (branchDenied) return branchDenied

      return await db.transaction(async (tx) => {
        // Verify order exists and is open
        const order = await tx.query.restaurantOrders.findFirst({
          where: eq(restaurantOrders.id, orderId),
        })

        if (!order) {
          throw new Error('ORDER_NOT_FOUND')
        }

        if (order.status !== 'open') {
          throw new Error('ORDER_NOT_OPEN')
        }

        // Get the item
        const [currentItem] = await tx
          .select()
          .from(restaurantOrderItems)
          .where(and(
            eq(restaurantOrderItems.id, itemId),
            eq(restaurantOrderItems.orderId, orderId)
          ))
          .for('update')

        if (!currentItem) {
          throw new Error('ITEM_NOT_FOUND')
        }

        // Only allow deletion if item is still pending (not sent to kitchen)
        if (currentItem.status !== 'pending') {
          throw new Error('ITEM_ALREADY_SENT_TO_KITCHEN')
        }

        // Get the kitchen order
        const kitchenOrder = await tx.query.kitchenOrders.findFirst({
          where: eq(kitchenOrders.restaurantOrderId, orderId),
        })

        // Delete kitchen order item first (if exists)
        if (kitchenOrder) {
          await tx.delete(kitchenOrderItems)
            .where(eq(kitchenOrderItems.restaurantOrderItemId, itemId))
        }

        // Delete the restaurant order item
        await tx.delete(restaurantOrderItems)
          .where(and(
            eq(restaurantOrderItems.id, itemId),
            eq(restaurantOrderItems.orderId, orderId)
          ))

        // Recalculate order totals
        await recalculateOrderTotals(tx, orderId, session.user.tenantId)

        // Broadcast changes
        logAndBroadcast(session.user.tenantId, 'restaurant-order', 'updated', orderId)
        if (kitchenOrder) {
          logAndBroadcast(session.user.tenantId, 'kitchen-order', 'updated', kitchenOrder.id)
        }

        return NextResponse.json({ success: true })
      })
    })
  } catch (error) {
    logError('api/restaurant-orders/[id]/items/[itemId]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'ORDER_NOT_FOUND') {
      return NextResponse.json({ error: 'Restaurant order not found' }, { status: 404 })
    }
    if (message === 'ORDER_NOT_OPEN') {
      return NextResponse.json({ error: 'Can only remove items from open orders' }, { status: 400 })
    }
    if (message === 'ITEM_NOT_FOUND') {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }
    if (message === 'ITEM_ALREADY_SENT_TO_KITCHEN') {
      return NextResponse.json({
        error: 'Cannot remove item that has been sent to the kitchen. Change status to cancelled instead.'
      }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to remove item from order' }, { status: 500 })
  }
}
