import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { kitchenOrders, kitchenOrderItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateKitchenOrderSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single kitchen order
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
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const kitchenOrder = await db.query.kitchenOrders.findFirst({
        where: eq(kitchenOrders.id, id),
        with: {
          restaurantOrder: {
            with: {
              table: true,
              customer: true,
            },
          },
          items: {
            with: {
              restaurantOrderItem: true,
            },
          },
        },
      })

      if (!kitchenOrder) {
        return NextResponse.json({ error: 'Kitchen order not found' }, { status: 404 })
      }

      // Transform the result
      const restaurantOrder = Array.isArray(kitchenOrder.restaurantOrder) ? kitchenOrder.restaurantOrder[0] : kitchenOrder.restaurantOrder
      const table = restaurantOrder ? (Array.isArray(restaurantOrder.table) ? restaurantOrder.table[0] : restaurantOrder.table) : null
      const customer = restaurantOrder ? (Array.isArray(restaurantOrder.customer) ? restaurantOrder.customer[0] : restaurantOrder.customer) : null
      const transformedResult = {
        id: kitchenOrder.id,
        status: kitchenOrder.status,
        createdAt: kitchenOrder.createdAt,
        updatedAt: kitchenOrder.updatedAt,
        restaurantOrderId: kitchenOrder.restaurantOrderId,
        orderNo: restaurantOrder?.orderNo || 'Unknown',
        orderType: restaurantOrder?.orderType || 'dine_in',
        tableName: table?.name || null,
        tableArea: table?.area || null,
        customerName: customer?.name || null,
        items: (Array.isArray(kitchenOrder.items) ? kitchenOrder.items : []).map(kitchenItem => {
          const orderItem = Array.isArray(kitchenItem.restaurantOrderItem) ? kitchenItem.restaurantOrderItem[0] : kitchenItem.restaurantOrderItem
          return {
            id: kitchenItem.id,
            status: kitchenItem.status,
            restaurantOrderItemId: kitchenItem.restaurantOrderItemId,
            itemName: orderItem?.itemName || 'Unknown',
            quantity: orderItem?.quantity || 0,
            modifiers: orderItem?.modifiers || [],
            notes: orderItem?.notes || null,
          }
        }),
      }

      return NextResponse.json(transformedResult)
    })
  } catch (error) {
    logError('api/kitchen-orders/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch kitchen order' }, { status: 500 })
  }
}

// PUT update kitchen order status
export async function PUT(
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

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateKitchenOrderSchema)
    if (!parsed.success) return parsed.response
    const { status } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      return await db.transaction(async (tx) => {
        // Lock and get current kitchen order
        const [currentKitchenOrder] = await tx
          .select()
          .from(kitchenOrders)
          .where(eq(kitchenOrders.id, id))
          .for('update')

        if (!currentKitchenOrder) {
          throw new Error('NOT_FOUND')
        }

        // Validate status transitions - cancelled is a terminal state
        const validStatusTransitions: Record<string, string[]> = {
          pending: ['preparing', 'cancelled'],
          preparing: ['ready', 'cancelled'],
          ready: ['served', 'cancelled'],
          served: [],   // Terminal state
          cancelled: [], // Terminal state
        }

        const allowedTransitions = validStatusTransitions[currentKitchenOrder.status] || []
        if (!allowedTransitions.includes(status)) {
          throw new Error(`INVALID_TRANSITION:Cannot change status from '${currentKitchenOrder.status}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`)
        }

        // Update kitchen order status
        const [updated] = await tx.update(kitchenOrders)
          .set({
            status: status as 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled',
            updatedAt: new Date(),
          })
          .where(eq(kitchenOrders.id, id))
          .returning()

        // If setting status to ready, served, or cancelled, update all items to match
        if (status === 'ready' || status === 'served' || status === 'cancelled') {
          await tx.update(kitchenOrderItems)
            .set({ status: status as 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled' })
            .where(eq(kitchenOrderItems.kitchenOrderId, id))
        }

        // Broadcast changes
        logAndBroadcast(session.user.tenantId, 'kitchen-order', 'updated', id)
        logAndBroadcast(session.user.tenantId, 'restaurant-order', 'updated', currentKitchenOrder.restaurantOrderId)

        return NextResponse.json(updated)
      })
    })
  } catch (error) {
    logError('api/kitchen-orders/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Kitchen order not found' }, { status: 404 })
    }
    if (message.startsWith('INVALID_TRANSITION:')) {
      return NextResponse.json({ error: message.replace('INVALID_TRANSITION:', '') }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update kitchen order' }, { status: 500 })
  }
}
