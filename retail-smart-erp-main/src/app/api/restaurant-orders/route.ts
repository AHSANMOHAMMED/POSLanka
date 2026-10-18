import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantOrders, kitchenOrders, restaurantTables, customers } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike, gte, lte } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { restaurantOrdersListSchema, createRestaurantOrderSchema } from '@/lib/validation/schemas/restaurant'

// GET all restaurant orders for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, restaurantOrdersListSchema)
    if (!parsed.success) return parsed.response
    const { status, tableId, orderType, createdBy, deliveryStatus, startDate, endDate, search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions
      const conditions = []

      if (status && status !== 'all') {
        conditions.push(eq(restaurantOrders.status, status))
      }

      if (tableId) {
        conditions.push(eq(restaurantOrders.tableId, tableId))
      }

      if (orderType) {
        conditions.push(eq(restaurantOrders.orderType, orderType))
      }

      if (startDate) {
        conditions.push(gte(restaurantOrders.createdAt, new Date(startDate)))
      }

      if (endDate) {
        // Add 1 day to include the end date
        const end = new Date(endDate)
        end.setDate(end.getDate() + 1)
        conditions.push(lte(restaurantOrders.createdAt, end))
      }

      if (createdBy) {
        conditions.push(eq(restaurantOrders.createdBy, createdBy))
      }

      if (deliveryStatus) {
        conditions.push(eq(restaurantOrders.deliveryStatus, deliveryStatus))
      }

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(restaurantOrders.orderNo, `%${escaped}%`)
          )
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(restaurantOrders)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.restaurantOrders.findMany({
        where: whereClause,
        with: {
          table: true,
          customer: true,
          createdByUser: true,
          items: true,
          kitchenOrder: {
            with: {
              items: true,
            },
          },
        },
        orderBy: [desc(restaurantOrders.createdAt)],
        limit,
        offset,
      })

      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/restaurant-orders', error)
    return NextResponse.json({ error: 'Failed to fetch restaurant orders' }, { status: 500 })
  }
}

// POST create new restaurant order
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)

    const parsed = await validateBody(request, createRestaurantOrderSchema)
    if (!parsed.success) return parsed.response
    const { tableId, customerId, orderType, customerCount,
      deliveryAddress, deliveryPhone, deliveryNotes, deliveryFee } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Validate table exists and is available (for dine_in)
      if (tableId) {
        const table = await db.query.restaurantTables.findFirst({
          where: eq(restaurantTables.id, tableId),
        })

        if (!table) {
          return NextResponse.json({ error: 'Table not found' }, { status: 404 })
        }

        if (orderType === 'dine_in' && table.status !== 'available' && table.status !== 'reserved') {
          return NextResponse.json({ error: 'Table is not available' }, { status: 400 })
        }
      }

      // Validate customer if provided
      if (customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
        }
      }

      // Create order with atomic order number generation
      const result = await db.transaction(async (tx) => {
        // Advisory lock to prevent duplicate order numbers under concurrency
        await tx.execute(sql`SELECT pg_advisory_xact_lock(4)`)

        // Generate order number atomically
        const [maxResult] = await tx
          .select({ maxNo: sql<string>`MAX(${restaurantOrders.orderNo})` })
          .from(restaurantOrders)

        const lastOrderNo = maxResult?.maxNo
        const nextNumber = lastOrderNo ? parseInt(lastOrderNo.replace(/\D/g, '')) + 1 : 1
        const orderNo = `RO-${String(nextNumber).padStart(6, '0')}`

        // Create the restaurant order
        const orderResult = await tx.insert(restaurantOrders).values({
          tenantId: session.user.tenantId,
          orderNo,
          tableId: tableId || null,
          customerId: customerId || null,
          orderType: orderType as 'dine_in' | 'takeaway' | 'delivery',
          status: 'open',
          customerCount: customerCount || 1,
          subtotal: '0',
          taxAmount: '0',
          tipAmount: '0',
          total: '0',
          // Delivery fields
          ...(orderType === 'delivery' && {
            deliveryAddress: deliveryAddress || null,
            deliveryPhone: deliveryPhone || null,
            deliveryNotes: deliveryNotes || null,
            deliveryFee: deliveryFee ? String(deliveryFee) : '0',
            deliveryStatus: 'pending' as const,
          }),
          createdBy: userId,
        }).returning()
        const newOrder = (orderResult as typeof restaurantOrders.$inferSelect[])[0]

        // Create associated kitchen order
        const kitchenResult = await tx.insert(kitchenOrders).values({
          tenantId: session.user.tenantId,
          restaurantOrderId: newOrder.id,
          status: 'pending',
        }).returning()
        const newKitchenOrder = (kitchenResult as typeof kitchenOrders.$inferSelect[])[0]

        // Set table status to 'occupied' for dine_in orders
        if (orderType === 'dine_in' && tableId) {
          await tx.update(restaurantTables)
            .set({
              status: 'occupied',
            })
            .where(eq(restaurantTables.id, tableId))

          // Broadcast table update
          logAndBroadcast(session.user.tenantId, 'table', 'updated', tableId)
        }

        return { order: newOrder, kitchenOrder: newKitchenOrder }
      })

      // Broadcast the changes
      logAndBroadcast(session.user.tenantId, 'restaurant-order', 'created', result.order.id)
      logAndBroadcast(session.user.tenantId, 'kitchen-order', 'created', result.kitchenOrder.id)

      return NextResponse.json(result.order)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/restaurant-orders', error)
    return NextResponse.json({ error: 'Failed to create restaurant order' }, { status: 500 })
  }
}
