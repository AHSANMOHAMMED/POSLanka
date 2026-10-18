import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantOrders, restaurantOrderItems, kitchenOrders, kitchenOrderItems, restaurantTables, sales, saleItems, payments, recipes, warehouseStock, stockMovements } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { triggerNotification } from '@/lib/notifications/auto-trigger'
import { logError } from '@/lib/ai/error-logger'
import { roundCurrency } from '@/lib/utils/currency'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateRestaurantOrderSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Status workflow: open -> closed -> completed OR cancelled
const validStatusTransitions: Record<string, string[]> = {
  open: ['closed', 'cancelled'],
  closed: ['completed', 'cancelled'],
  completed: [], // Terminal state
  cancelled: [], // Terminal state
}

// GET single restaurant order
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
      const order = await db.query.restaurantOrders.findFirst({
        where: eq(restaurantOrders.id, id),
        with: {
          table: true,
          customer: true,
          createdByUser: true,
          items: {
            with: {
              item: true,
            },
          },
          kitchenOrder: {
            with: {
              items: {
                with: {
                  restaurantOrderItem: true,
                },
              },
            },
          },
          sale: {
            with: {
              items: true,
              payments: true,
            },
          },
        },
      })

      if (!order) {
        return NextResponse.json({ error: 'Restaurant order not found' }, { status: 404 })
      }

      return NextResponse.json(order)
    })
  } catch (error) {
    logError('api/restaurant-orders/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch restaurant order' }, { status: 500 })
  }
}

// PUT update restaurant order
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

    const userId = await resolveUserIdRequired(session)
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateRestaurantOrderSchema)
    if (!parsed.success) return parsed.response
    const { status, tipAmount, cancellationReason, expectedUpdatedAt,
      deliveryStatus, deliveryAddress, deliveryPhone, deliveryNotes,
      driverName, driverPhone, estimatedDeliveryTime, deliveryFee,
      skipSaleCreation, saleId: providedSaleId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        // Lock and get current order
        const [currentOrder] = await tx
          .select()
          .from(restaurantOrders)
          .where(eq(restaurantOrders.id, id))
          .for('update')

        if (!currentOrder) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking check
        if (expectedUpdatedAt) {
          const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
          const serverUpdatedAt = currentOrder.updatedAt ? new Date(currentOrder.updatedAt).getTime() : 0
          if (serverUpdatedAt > clientUpdatedAt) {
            throw new Error('CONFLICT')
          }
        }

        // Build update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        // Handle tip amount update
        if (tipAmount !== undefined) {
          updateData.tipAmount = String(tipAmount)
          // Recalculate total
          const subtotal = parseFloat(currentOrder.subtotal)
          const taxAmount = parseFloat(currentOrder.taxAmount)
          updateData.total = String(subtotal + taxAmount + tipAmount)
        }

        // Handle delivery fields
        if (deliveryAddress !== undefined) updateData.deliveryAddress = deliveryAddress
        if (deliveryPhone !== undefined) updateData.deliveryPhone = deliveryPhone
        if (deliveryNotes !== undefined) updateData.deliveryNotes = deliveryNotes
        if (driverName !== undefined) updateData.driverName = driverName
        if (driverPhone !== undefined) updateData.driverPhone = driverPhone
        if (estimatedDeliveryTime !== undefined) updateData.estimatedDeliveryTime = estimatedDeliveryTime ? new Date(estimatedDeliveryTime) : null
        if (deliveryFee !== undefined) updateData.deliveryFee = String(deliveryFee)
        if (deliveryStatus !== undefined) {
          updateData.deliveryStatus = deliveryStatus
          if (deliveryStatus === 'delivered') {
            updateData.actualDeliveryTime = new Date()
          }
        }

        // Handle status change
        if (status && status !== currentOrder.status) {
          const allowedTransitions = validStatusTransitions[currentOrder.status] || []
          if (!allowedTransitions.includes(status)) {
            throw new Error(`INVALID_TRANSITION:Cannot change status from '${currentOrder.status}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`)
          }

          updateData.status = status

          // When status = cancelled
          if (status === 'cancelled') {
            if (!cancellationReason) {
              throw new Error('CANCELLATION_REASON_REQUIRED')
            }
            updateData.cancellationReason = cancellationReason
            updateData.cancelledAt = new Date()

            // Set table back to available if it's a dine_in order
            if (currentOrder.tableId && currentOrder.orderType === 'dine_in') {
              await tx.update(restaurantTables)
                .set({ status: 'available' })
                .where(eq(restaurantTables.id, currentOrder.tableId))

              logAndBroadcast(session.user.tenantId, 'table', 'updated', currentOrder.tableId)
            }

            // Update kitchen order status to cancelled
            await tx.update(kitchenOrders)
              .set({
                status: 'cancelled',
                updatedAt: new Date(),
              })
              .where(eq(kitchenOrders.restaurantOrderId, id))
          }

          // When status = completed: create sale record and set table to available
          if (status === 'completed') {
            // Get all order items
            const orderItems = await tx.query.restaurantOrderItems.findMany({
              where: eq(restaurantOrderItems.orderId, id),
            })

            if (orderItems.length === 0) {
              throw new Error('CANNOT_COMPLETE_EMPTY_ORDER')
            }

            // Use tax template system for consistent tax across the order lifecycle
            const lineItems = orderItems.map(item => ({
              itemId: item.itemId,
              lineTotal: roundCurrency(parseFloat(item.unitPrice) * item.quantity),
            }))
            const taxCalcResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'sales' })
            const subtotal = taxCalcResult.subtotal
            const taxAmount = taxCalcResult.totalTax
            const saleTaxBreakdown = taxCalcResult.taxBreakdown
            const tipAmt = roundCurrency(parseFloat(currentOrder.tipAmount || '0'))
            const total = roundCurrency(taxCalcResult.total + tipAmt)

            // When skipSaleCreation is true (POS-driven flow), skip sale/payment creation
            // The POS page creates the sale via /api/sales and passes the saleId here
            if (skipSaleCreation && providedSaleId) {
              updateData.saleId = providedSaleId
              updateData.subtotal = String(subtotal)
              updateData.taxAmount = String(taxAmount)
              updateData.total = String(total)
            } else {
              // Default flow: auto-create sale record (standalone restaurant orders page)
              // Generate sale invoice number with advisory lock to prevent duplicates
              await tx.execute(sql`SELECT pg_advisory_xact_lock(1)`)
              const [maxSaleResult] = await tx
                .select({ maxNo: sql<string>`MAX(${sales.invoiceNo})` })
                .from(sales)
                .where(sql`${sales.invoiceNo} LIKE 'INV-%'`)

              const lastSaleNo = maxSaleResult?.maxNo
              const nextSaleNumber = lastSaleNo ? parseInt(lastSaleNo.replace(/\D/g, '')) + 1 : 1
              const invoiceNo = `INV-${String(nextSaleNumber).padStart(6, '0')}`

              // Create sale record with tax template data
              const saleResult = await tx.insert(sales).values({
                tenantId: session.user.tenantId,
                invoiceNo,
                customerId: currentOrder.customerId,
                customerName: null,
                subtotal: String(subtotal),
                discountAmount: '0',
                taxAmount: String(taxAmount),
                taxBreakdown: saleTaxBreakdown,
                total: String(total),
                paidAmount: String(total),
                paymentMethod: 'cash',
                status: 'completed',
                createdBy: userId,
                restaurantOrderId: id,
              }).returning()
              const sale = (saleResult as typeof sales.$inferSelect[])[0]

              // Create sale items with per-item template tax
              for (let i = 0; i < orderItems.length; i++) {
                const orderItem = orderItems[i]
                const perItem = taxCalcResult.perItemTax[i]
                const itemLineTotal = roundCurrency(parseFloat(orderItem.unitPrice) * orderItem.quantity)
                const itemTaxAmount = perItem ? perItem.taxAmount : 0
                const itemTaxRate = itemLineTotal > 0 ? roundCurrency((itemTaxAmount / itemLineTotal) * 100) : 0

                await tx.insert(saleItems).values({
                  tenantId: session.user.tenantId,
                  saleId: sale.id,
                  itemId: orderItem.itemId,
                  itemName: orderItem.itemName,
                  quantity: String(orderItem.quantity),
                  unitPrice: String(orderItem.unitPrice),
                  discount: '0',
                  taxRate: String(itemTaxRate),
                  taxAmount: String(itemTaxAmount),
                  taxBreakdown: perItem?.taxBreakdown || null,
                  total: String(itemLineTotal),
                })
              }

              // Create payment record
              await tx.insert(payments).values({
                tenantId: session.user.tenantId,
                saleId: sale.id,
                amount: String(total),
                method: 'cash',
                receivedBy: userId,
              })

              // Update order with sale reference and final totals
              updateData.saleId = sale.id
              updateData.subtotal = String(subtotal)
              updateData.taxAmount = String(taxAmount)
              updateData.total = String(total)

              // Broadcast sale creation
              logAndBroadcast(session.user.tenantId, 'sale', 'created', sale.id)
            }

            // Set table back to available
            if (currentOrder.tableId && currentOrder.orderType === 'dine_in') {
              await tx.update(restaurantTables)
                .set({ status: 'available' })
                .where(eq(restaurantTables.id, currentOrder.tableId))

              logAndBroadcast(session.user.tenantId, 'table', 'updated', currentOrder.tableId)
            }

            // Deduct recipe ingredient stock for completed order
            try {
              for (const orderItem of orderItems) {
                if (!orderItem.itemId) continue

                const recipe = await tx.query.recipes.findFirst({
                  where: and(
                    eq(recipes.itemId, orderItem.itemId),
                    eq(recipes.isActive, true)
                  ),
                  with: { ingredients: true },
                })

                if (!recipe || !recipe.ingredients || recipe.ingredients.length === 0) continue

                for (const ingredient of recipe.ingredients) {
                  const deductQty = parseFloat(String(ingredient.quantity)) * orderItem.quantity

                  // Find warehouse stock record for this ingredient with FOR UPDATE lock
                  const [stockRecord] = await tx
                    .select()
                    .from(warehouseStock)
                    .where(eq(warehouseStock.itemId, ingredient.ingredientItemId))
                    .for('update')

                  if (stockRecord) {
                    const newStock = Math.max(0, parseFloat(String(stockRecord.currentStock)) - deductQty)
                    await tx.update(warehouseStock)
                      .set({ currentStock: String(newStock), updatedAt: new Date() })
                      .where(eq(warehouseStock.id, stockRecord.id))

                    // Create stock movement record
                    await tx.insert(stockMovements).values({
                      tenantId: session.user.tenantId,
                      warehouseId: stockRecord.warehouseId,
                      itemId: ingredient.ingredientItemId,
                      type: 'out',
                      quantity: String(deductQty),
                      referenceType: 'restaurant_order',
                      referenceId: id,
                      notes: `Auto-deducted for order ${currentOrder.orderNo} (recipe: ${recipe.name})`,
                      createdBy: userId,
                    })

                    logAndBroadcast(session.user.tenantId, 'item', 'updated', ingredient.ingredientItemId)
                  }
                }
              }
            } catch (stockError) {
              logError('api/restaurant-orders/[id]', stockError)
              // Don't fail the order completion if stock deduction fails
            }
          }
        }

        // Update the order
        const [updated] = await tx.update(restaurantOrders)
          .set(updateData)
          .where(eq(restaurantOrders.id, id))
          .returning()

        return updated
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'restaurant-order', 'updated', id)

      // Fire-and-forget notification triggers for delivery status changes
      if (deliveryStatus === 'dispatched') {
        triggerNotification(session.user.tenantId, 'delivery_dispatched', {
          tenantId: session.user.tenantId,
          customerId: result.customerId,
        }).catch(() => {})
      }
      if (deliveryStatus === 'delivered') {
        triggerNotification(session.user.tenantId, 'delivery_delivered', {
          tenantId: session.user.tenantId,
          customerId: result.customerId,
        }).catch(() => {})
      }

      return NextResponse.json(result)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/restaurant-orders/[id]', error)

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Restaurant order not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This order was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (message.startsWith('INVALID_TRANSITION:')) {
      return NextResponse.json({ error: message.replace('INVALID_TRANSITION:', '') }, { status: 400 })
    }
    if (message === 'INVALID_TIP') {
      return NextResponse.json({ error: 'Tip amount must be a non-negative number' }, { status: 400 })
    }
    if (message === 'CANCELLATION_REASON_REQUIRED') {
      return NextResponse.json({ error: 'Cancellation reason is required' }, { status: 400 })
    }
    if (message === 'CANNOT_COMPLETE_EMPTY_ORDER') {
      return NextResponse.json({ error: 'Cannot complete an order with no items' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update restaurant order' }, { status: 500 })
  }
}

// DELETE restaurant order
export async function DELETE(
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

    return await withTenant(session.user.tenantId, async (db) => {
      await db.transaction(async (tx) => {
        // Lock and get current order
        const [currentOrder] = await tx
          .select()
          .from(restaurantOrders)
          .where(eq(restaurantOrders.id, id))
          .for('update')

        if (!currentOrder) {
          throw new Error('NOT_FOUND')
        }

        // Only allow deletion if status is 'open' and no items
        if (currentOrder.status !== 'open') {
          throw new Error('CANNOT_DELETE_NON_OPEN')
        }

        // Check if there are any items
        const items = await tx.query.restaurantOrderItems.findMany({
          where: eq(restaurantOrderItems.orderId, id),
          limit: 1,
        })

        if (items.length > 0) {
          throw new Error('CANNOT_DELETE_WITH_ITEMS')
        }

        // Delete kitchen order first (cascade)
        const kitchenOrder = await tx.query.kitchenOrders.findFirst({
          where: eq(kitchenOrders.restaurantOrderId, id),
        })

        if (kitchenOrder) {
          // Delete kitchen order items first
          await tx.delete(kitchenOrderItems)
            .where(eq(kitchenOrderItems.kitchenOrderId, kitchenOrder.id))

          // Delete kitchen order
          await tx.delete(kitchenOrders)
            .where(eq(kitchenOrders.id, kitchenOrder.id))
        }

        // Set table back to available if needed
        if (currentOrder.tableId && currentOrder.orderType === 'dine_in') {
          await tx.update(restaurantTables)
            .set({ status: 'available' })
            .where(eq(restaurantTables.id, currentOrder.tableId))

          logAndBroadcast(session.user.tenantId, 'table', 'updated', currentOrder.tableId)
        }

        // Delete the order
        await tx.delete(restaurantOrders)
          .where(eq(restaurantOrders.id, id))
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'restaurant-order', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/restaurant-orders/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Restaurant order not found' }, { status: 404 })
    }
    if (message === 'CANNOT_DELETE_NON_OPEN') {
      return NextResponse.json({ error: 'Only open orders can be deleted' }, { status: 400 })
    }
    if (message === 'CANNOT_DELETE_WITH_ITEMS') {
      return NextResponse.json({ error: 'Cannot delete order that has items' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to delete restaurant order' }, { status: 500 })
  }
}
