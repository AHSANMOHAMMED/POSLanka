import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { kitchenOrders } from '@/lib/db/schema'
import { eq, and, desc, asc, or } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { kitchenOrdersListSchema } from '@/lib/validation/schemas/restaurant'

// GET kitchen orders for kitchen display
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const parsed = validateSearchParams(request, kitchenOrdersListSchema)
    if (!parsed.success) return parsed.response
    const { status, sortBy, sortOrder, activeOnly } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions
      const conditions = []

      if (status) {
        conditions.push(eq(kitchenOrders.status, status))
      }

      // Active orders: pending, preparing, or ready (not served or cancelled)
      if (activeOnly) {
        conditions.push(
          or(
            eq(kitchenOrders.status, 'pending'),
            eq(kitchenOrders.status, 'preparing'),
            eq(kitchenOrders.status, 'ready')
          )
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Build order by clause
      const orderByClause = sortBy === 'createdAt'
        ? (sortOrder === 'desc' ? desc(kitchenOrders.createdAt) : asc(kitchenOrders.createdAt))
        : (sortOrder === 'desc' ? desc(kitchenOrders.updatedAt) : asc(kitchenOrders.updatedAt))

      const result = await db.query.kitchenOrders.findMany({
        where: whereClause,
        with: {
          restaurantOrder: {
            with: {
              table: true,
            },
          },
          items: {
            with: {
              restaurantOrderItem: true,
            },
          },
        },
        orderBy: [orderByClause],
      })

      // Transform the result to include item details in a more accessible format
      const transformedResult = result.map(kitchenOrder => {
        const items = Array.isArray(kitchenOrder.items) ? kitchenOrder.items : []
        const itemsWithDetails = items.map(kitchenItem => {
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
        })

        const restaurantOrder = Array.isArray(kitchenOrder.restaurantOrder) ? kitchenOrder.restaurantOrder[0] : kitchenOrder.restaurantOrder
        const table = restaurantOrder ? (Array.isArray(restaurantOrder.table) ? restaurantOrder.table[0] : restaurantOrder.table) : null

        return {
          id: kitchenOrder.id,
          status: kitchenOrder.status,
          createdAt: kitchenOrder.createdAt,
          updatedAt: kitchenOrder.updatedAt,
          restaurantOrderId: kitchenOrder.restaurantOrderId,
          orderNo: restaurantOrder?.orderNo || 'Unknown',
          orderType: restaurantOrder?.orderType || 'dine_in',
          tableName: table?.name || null,
          tableArea: table?.area || null,
          items: itemsWithDetails,
          // Summary stats
          totalItems: itemsWithDetails.length,
          pendingItems: itemsWithDetails.filter(i => i.status === 'pending').length,
          preparingItems: itemsWithDetails.filter(i => i.status === 'preparing').length,
          readyItems: itemsWithDetails.filter(i => i.status === 'ready').length,
          servedItems: itemsWithDetails.filter(i => i.status === 'served').length,
        }
      })

      return NextResponse.json(transformedResult)
    })
  } catch (error) {
    logError('api/kitchen-orders', error)
    return NextResponse.json({ error: 'Failed to fetch kitchen orders' }, { status: 500 })
  }
}
