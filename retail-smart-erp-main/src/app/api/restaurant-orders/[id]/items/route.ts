import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantOrders, restaurantOrderItems, kitchenOrders, kitchenOrderItems, items } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateOrderTotals } from '@/lib/restaurant/order-totals'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addRestaurantOrderItemSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET all items for a restaurant order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: orderId } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify order exists
      const order = await db.query.restaurantOrders.findFirst({
        where: eq(restaurantOrders.id, orderId),
      })

      if (!order) {
        return NextResponse.json({ error: 'Restaurant order not found' }, { status: 404 })
      }

      const orderItems = await db.query.restaurantOrderItems.findMany({
        where: eq(restaurantOrderItems.orderId, orderId),
        with: {
          item: true,
        },
      })

      return NextResponse.json(orderItems)
    })
  } catch (error) {
    logError('api/restaurant-orders/[id]/items', error)
    return NextResponse.json({ error: 'Failed to fetch order items' }, { status: 500 })
  }
}


// POST add item to restaurant order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: orderId } = paramsParsed.data
    const parsed = await validateBody(request, addRestaurantOrderItemSchema)
    if (!parsed.success) return parsed.response
    const { itemId, itemName, quantity, unitPrice, modifiers, notes } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      return await db.transaction(async (tx) => {
        // Verify order exists and is open
        const [order] = await tx
          .select()
          .from(restaurantOrders)
          .where(eq(restaurantOrders.id, orderId))
          .for('update')

        if (!order) {
          throw new Error('NOT_FOUND')
        }

        if (order.status !== 'open') {
          throw new Error('ORDER_NOT_OPEN')
        }

        // Validate item exists if itemId provided
        if (itemId) {
          const item = await tx.query.items.findFirst({
            where: eq(items.id, itemId),
          })
          if (!item) {
            throw new Error('ITEM_NOT_FOUND')
          }
        }

        // Get the kitchen order for this restaurant order
        const kitchenOrder = await tx.query.kitchenOrders.findFirst({
          where: eq(kitchenOrders.restaurantOrderId, orderId),
        })

        if (!kitchenOrder) {
          throw new Error('KITCHEN_ORDER_NOT_FOUND')
        }

        // Create the restaurant order item
        const [newItem] = await tx.insert(restaurantOrderItems).values({
          tenantId: session.user.tenantId,
          orderId,
          itemId: itemId || null,
          itemName,
          quantity,
          unitPrice: String(unitPrice),
          modifiers: modifiers || [],
          notes: notes || null,
          status: 'pending',
        }).returning()

        // Create the kitchen order item linked to this restaurant order item
        const [newKitchenItem] = await tx.insert(kitchenOrderItems).values({
          tenantId: session.user.tenantId,
          kitchenOrderId: kitchenOrder.id,
          restaurantOrderItemId: newItem.id,
          status: 'pending',
        }).returning()

        // Reset kitchen order status to pending if it was ready/served
        if (kitchenOrder.status === 'ready' || kitchenOrder.status === 'served') {
          await tx.update(kitchenOrders)
            .set({
              status: 'pending',
              updatedAt: new Date(),
            })
            .where(eq(kitchenOrders.id, kitchenOrder.id))
        }

        // Recalculate order totals
        await recalculateOrderTotals(tx, orderId, session.user.tenantId)

        // Broadcast changes
        logAndBroadcast(session.user.tenantId, 'restaurant-order', 'updated', orderId)
        logAndBroadcast(session.user.tenantId, 'kitchen-order', 'updated', kitchenOrder.id)

        return NextResponse.json({
          item: newItem,
          kitchenItem: newKitchenItem
        })
      })
    })
  } catch (error) {
    logError('api/restaurant-orders/[id]/items', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Restaurant order not found' }, { status: 404 })
    }
    if (message === 'ORDER_NOT_OPEN') {
      return NextResponse.json({ error: 'Can only add items to open orders' }, { status: 400 })
    }
    if (message === 'ITEM_NOT_FOUND') {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }
    if (message === 'KITCHEN_ORDER_NOT_FOUND') {
      return NextResponse.json({ error: 'Kitchen order not found for this order' }, { status: 500 })
    }

    return NextResponse.json({ error: 'Failed to add item to order' }, { status: 500 })
  }
}
