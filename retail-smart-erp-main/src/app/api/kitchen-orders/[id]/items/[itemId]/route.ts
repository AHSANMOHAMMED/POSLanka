import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { kitchenOrders, kitchenOrderItems, restaurantOrderItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateKitchenOrderItemSchema } from '@/lib/validation/schemas/restaurant'
import { z } from 'zod'

// Helper function to update kitchen order status based on item statuses
async function updateKitchenOrderStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  kitchenOrderId: string
) {
  // Get all kitchen order items
  const items = await db.query.kitchenOrderItems.findMany({
    where: eq(kitchenOrderItems.kitchenOrderId, kitchenOrderId),
  })

  if (items.length === 0) {
    return
  }

  // Check item statuses
  const allServed = items.every(
    (item: { status: string }) => item.status === 'served'
  )
  const allReady = items.every(
    (item: { status: string }) => item.status === 'ready' || item.status === 'served'
  )
  const allCancelled = items.every(
    (item: { status: string }) => item.status === 'cancelled'
  )
  const anyPreparing = items.some(
    (item: { status: string }) => item.status === 'preparing'
  )
  const anyReady = items.some(
    (item: { status: string }) => item.status === 'ready'
  )

  let newStatus: 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled' = 'pending'

  if (allCancelled) {
    newStatus = 'cancelled'
  } else if (allServed) {
    newStatus = 'served'
  } else if (allReady) {
    newStatus = 'ready'
  } else if (anyPreparing || anyReady) {
    newStatus = 'preparing'
  }

  await db.update(kitchenOrders)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(kitchenOrders.id, kitchenOrderId))

  return newStatus
}

// PUT update individual kitchen order item status
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
    const { id: kitchenOrderId, itemId } = paramsParsed.data
    const parsed = await validateBody(request, updateKitchenOrderItemSchema)
    if (!parsed.success) return parsed.response
    const { status } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      return await db.transaction(async (tx) => {
        // Verify kitchen order exists
        const kitchenOrder = await tx.query.kitchenOrders.findFirst({
          where: eq(kitchenOrders.id, kitchenOrderId),
        })

        if (!kitchenOrder) {
          throw new Error('KITCHEN_ORDER_NOT_FOUND')
        }

        // Lock and get the item
        const [currentItem] = await tx
          .select()
          .from(kitchenOrderItems)
          .where(and(
            eq(kitchenOrderItems.id, itemId),
            eq(kitchenOrderItems.kitchenOrderId, kitchenOrderId)
          ))
          .for('update')

        if (!currentItem) {
          throw new Error('ITEM_NOT_FOUND')
        }

        // Validate status transitions - cancelled and served are terminal states
        const validItemTransitions: Record<string, string[]> = {
          pending: ['preparing', 'cancelled'],
          preparing: ['ready', 'cancelled'],
          ready: ['served', 'cancelled'],
          served: [],   // Terminal state
          cancelled: [], // Terminal state
        }

        const allowedTransitions = validItemTransitions[currentItem.status] || []
        if (!allowedTransitions.includes(status)) {
          throw new Error(`INVALID_TRANSITION:Cannot change item status from '${currentItem.status}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`)
        }

        // Update kitchen order item status
        const [updatedItem] = await tx.update(kitchenOrderItems)
          .set({ status: status as 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled' })
          .where(and(
            eq(kitchenOrderItems.id, itemId),
            eq(kitchenOrderItems.kitchenOrderId, kitchenOrderId)
          ))
          .returning()

        // Also update the corresponding restaurant order item status
        await tx.update(restaurantOrderItems)
          .set({ status })
          .where(eq(restaurantOrderItems.id, currentItem.restaurantOrderItemId))

        // Update kitchen order overall status based on all items
        const newKitchenOrderStatus = await updateKitchenOrderStatus(tx, kitchenOrderId)

        // Broadcast changes - important for kitchen display real-time updates
        logAndBroadcast(session.user.tenantId, 'kitchen-order', 'updated', kitchenOrderId)
        logAndBroadcast(session.user.tenantId, 'restaurant-order', 'updated', kitchenOrder.restaurantOrderId)

        return NextResponse.json({
          item: updatedItem,
          kitchenOrderStatus: newKitchenOrderStatus
        })
      })
    })
  } catch (error) {
    logError('api/kitchen-orders/[id]/items/[itemId]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'KITCHEN_ORDER_NOT_FOUND') {
      return NextResponse.json({ error: 'Kitchen order not found' }, { status: 404 })
    }
    if (message === 'ITEM_NOT_FOUND') {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }
    if (message.startsWith('INVALID_TRANSITION:')) {
      return NextResponse.json({ error: message.replace('INVALID_TRANSITION:', '') }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update kitchen order item' }, { status: 500 })
  }
}
