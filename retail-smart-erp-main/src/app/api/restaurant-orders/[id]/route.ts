import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantOrders, restaurantOrderItems, kitchenOrders, kitchenOrderItems, restaurantTables, sales, saleItems, payments, recipes, warehouseStock, warehouses, items as itemsTable } from '@/lib/db/schema'
import type { SaleFlags } from '@/lib/db/schema'
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { triggerNotification } from '@/lib/notifications/auto-trigger'
import { logError } from '@/lib/ai/error-logger'
import { roundCurrency } from '@/lib/utils/currency'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateRestaurantOrderSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { applyStockChanges, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { withSavepoint, type DbTx } from '@/lib/inventory/db-types'
import { SAFE_USER } from '@/lib/db/safe-columns'
import { allocateBatchesFEFO, allocateSaleLineBatches } from '@/lib/inventory/batches'
import { getTenantSalesSettings } from '@/lib/sales/return-settings'

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
          createdByUser: SAFE_USER,
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
      const ingredientChanges: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
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
              // Sale invoice number from the per-tenant sequence (shared with POS sales)
              const invoiceNo = await nextDocumentNumber(tx, session.user.tenantId, 'invoice')

              // E1: the sale's warehouse (default active warehouse, never the quarantine location)
              // so stock-tracked lines leave stock and returns / voids put it (and its batches) back.
              const [saleWarehouse] = await tx.select({ id: warehouses.id })
                .from(warehouses)
                .where(and(eq(warehouses.isActive, true), sql`upper(${warehouses.code}) <> 'QUARANTINE'`))
                .orderBy(desc(warehouses.isDefault))
                .limit(1)
              const saleWarehouseId = saleWarehouse?.id || null

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
                warehouseId: saleWarehouseId,
              }).returning()
              const sale = (saleResult as typeof sales.$inferSelect[])[0]

              const lineItemIds = [...new Set(orderItems.map(oi => oi.itemId).filter((x): x is string => !!x))]
              const lineItemRows = lineItemIds.length > 0
                ? await tx.select({ id: itemsTable.id, name: itemsTable.name, trackStock: itemsTable.trackStock, trackBatches: itemsTable.trackBatches })
                    .from(itemsTable).where(inArray(itemsTable.id, lineItemIds))
                : []
              const lineItemById = new Map(lineItemRows.map(r => [r.id, r]))
              const saleStockInputs: StockChangeInput[] = []
              const saleStockQty: number[] = []
              const saleBatchLines: Array<{ saleItemId: string; itemId: string; name: string; qty: number }> = []

              // Create sale items with per-item template tax
              for (let i = 0; i < orderItems.length; i++) {
                const orderItem = orderItems[i]
                const perItem = taxCalcResult.perItemTax[i]
                const itemLineTotal = roundCurrency(parseFloat(orderItem.unitPrice) * orderItem.quantity)
                const itemTaxAmount = perItem ? perItem.taxAmount : 0
                const itemTaxRate = itemLineTotal > 0 ? roundCurrency((itemTaxAmount / itemLineTotal) * 100) : 0

                const [saleLine] = await tx.insert(saleItems).values({
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
                }).returning({ id: saleItems.id })

                // E1: stock-tracked lines leave stock like a POS sale. The food / drink was served:
                // a shortfall is recorded in sale.flags, never blocks completing the order.
                const lineItem = orderItem.itemId ? lineItemById.get(orderItem.itemId) : undefined
                if (lineItem?.trackStock && saleWarehouseId && orderItem.quantity > 0) {
                  saleStockInputs.push({
                    tenantId: session.user.tenantId,
                    warehouseId: saleWarehouseId,
                    itemId: lineItem.id,
                    mode: 'delta',
                    qty: -orderItem.quantity,
                    type: 'out',
                    referenceType: 'sale',
                    referenceId: sale.id,
                    notes: `Restaurant order ${currentOrder.orderNo} (${invoiceNo})`,
                    userId,
                    source: 'restaurant',
                    idempotencyKey: `sale:${sale.id}:${saleLine.id}`,
                    allowNegative: true,
                  })
                  saleStockQty.push(orderItem.quantity)
                  if (lineItem.trackBatches) {
                    saleBatchLines.push({ saleItemId: saleLine.id, itemId: lineItem.id, name: orderItem.itemName || lineItem.name, qty: orderItem.quantity })
                  }
                }
              }

              if (saleStockInputs.length > 0 && saleWarehouseId) {
                const flags: SaleFlags = {}
                const results = await applyStockChanges(tx, saleStockInputs)
                results.forEach((r, i) => {
                  ingredientChanges.push({ result: r, input: saleStockInputs[i] })
                  if (r.before < saleStockQty[i]) {
                    (flags.stockShortfall ||= []).push({ itemId: saleStockInputs[i].itemId, name: r.itemName, quantity: saleStockQty[i], available: r.before })
                  }
                })
                // Batches after the stock rows are locked: FEFO, allocate what exists
                if (saleBatchLines.length > 0) {
                  const settings = await getTenantSalesSettings(tx, session.user.tenantId)
                  for (const b of saleBatchLines) {
                    const alloc = await allocateSaleLineBatches(tx, {
                      tenantId: session.user.tenantId,
                      warehouseId: saleWarehouseId,
                      itemId: b.itemId,
                      qty: b.qty,
                      saleItemId: b.saleItemId,
                      allowExpired: settings.batches.allowExpiredSale,
                      allowShortfall: true,
                      itemName: b.name,
                    })
                    if (alloc.shortfall > 0) {
                      (flags.batchShortfall ||= []).push({ itemId: b.itemId, name: b.name, quantity: b.qty, allocated: alloc.allocated })
                    }
                  }
                }
                if (flags.stockShortfall || flags.batchShortfall) {
                  await tx.update(sales).set({ flags }).where(eq(sales.id, sale.id))
                }
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

            // Deduct recipe ingredient stock for completed order. Runs in a
            // savepoint so a stock failure never aborts the order completion.
            try {
              // Resolve the warehouse: the POS sale's warehouse, else the default one.
              let orderWarehouseId: string | null = null
              const linkedSaleId = (updateData.saleId as string | undefined) || providedSaleId
              if (linkedSaleId) {
                const [linked] = await tx.select({ warehouseId: sales.warehouseId })
                  .from(sales).where(eq(sales.id, linkedSaleId))
                orderWarehouseId = linked?.warehouseId || null
              }
              if (!orderWarehouseId) {
                const [def] = await tx.select({ id: warehouses.id })
                  .from(warehouses)
                  .where(eq(warehouses.isActive, true))
                  .orderBy(desc(warehouses.isDefault))
                  .limit(1)
                orderWarehouseId = def?.id || null
              }

              // Aggregate per ingredient so each ledger row has a stable key.
              const deductions = new Map<string, { qty: number; recipes: Set<string> }>()
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
                  if (!Number.isFinite(deductQty) || deductQty <= 0) continue
                  const entry = deductions.get(ingredient.ingredientItemId) || { qty: 0, recipes: new Set<string>() }
                  entry.qty += deductQty
                  entry.recipes.add(recipe.name)
                  deductions.set(ingredient.ingredientItemId, entry)
                }
              }

              if (deductions.size > 0) {
                const inputs: StockChangeInput[] = []
                for (const [ingredientId, d] of deductions) {
                  let warehouseId = orderWarehouseId
                  if (!warehouseId) {
                    const [anyStock] = await tx.select({ warehouseId: warehouseStock.warehouseId })
                      .from(warehouseStock)
                      .where(eq(warehouseStock.itemId, ingredientId))
                      .limit(1)
                    warehouseId = anyStock?.warehouseId || null
                  }
                  if (!warehouseId) continue
                  inputs.push({
                    tenantId: session.user.tenantId,
                    warehouseId,
                    itemId: ingredientId,
                    mode: 'delta',
                    qty: -Math.round(d.qty * 1000) / 1000,
                    type: 'out',
                    referenceType: 'restaurant_order',
                    referenceId: id,
                    notes: `Auto-deducted for order ${currentOrder.orderNo} (recipe: ${[...d.recipes].join(', ')})`,
                    userId,
                    source: 'restaurant',
                    idempotencyKey: `restaurant-order:${id}:${ingredientId}`,
                    // Consumption must never block completing the order; a negative
                    // balance surfaces the discrepancy instead of hiding it.
                    allowNegative: true,
                  })
                }
                const ingredientRows = inputs.length > 0
                  ? await tx.select({ id: itemsTable.id, name: itemsTable.name, trackBatches: itemsTable.trackBatches })
                      .from(itemsTable).where(inArray(itemsTable.id, inputs.map(x => x.itemId)))
                  : []
                const batchIngredients = new Map(ingredientRows.filter(r => r.trackBatches).map(r => [r.id, r.name]))
                const { results, shortfalls } = await withSavepoint(tx as unknown as DbTx, async (sp) => {
                  const res = await applyStockChanges(sp, inputs)
                  // E1: batch-tracked ingredients draw FEFO from item_batches. Consumption may
                  // run negative, so allocate what exists and record the shortfall.
                  const missing: Array<{ itemId: string; name?: string; quantity: number; allocated: number }> = []
                  if (batchIngredients.size > 0) {
                    const settings = await getTenantSalesSettings(sp, session.user.tenantId)
                    for (const input of inputs) {
                      const name = batchIngredients.get(input.itemId)
                      if (name === undefined) continue
                      const need = Math.abs(input.qty)
                      const alloc = await allocateBatchesFEFO(sp, {
                        tenantId: session.user.tenantId,
                        warehouseId: input.warehouseId,
                        itemId: input.itemId,
                        qty: need,
                        allowExpired: settings.batches.allowExpiredSale,
                        allowShortfall: true,
                        itemName: name,
                      })
                      if (alloc.shortfall > 0) missing.push({ itemId: input.itemId, name, quantity: need, allocated: alloc.allocated })
                    }
                  }
                  return { results: res, shortfalls: missing }
                })
                results.forEach((r, i) => {
                  ingredientChanges.push({ result: r, input: inputs[i] })
                  logAndBroadcast(session.user.tenantId, 'item', 'updated', inputs[i].itemId, { userId })
                })
                // Completion always has a sale (auto-created above or the POS sale): flag it there
                if (shortfalls.length > 0 && linkedSaleId) {
                  await tx.update(sales)
                    .set({ flags: sql`${sales.flags} || ${JSON.stringify({ ingredientBatchShortfall: shortfalls })}::jsonb` })
                    .where(eq(sales.id, linkedSaleId))
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

      notifyStockDecreased(ingredientChanges)

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
