import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { sales, saleItems, stockMovements, payments, customers, customerCreditTransactions, warehouseStock, loyaltyTransactions, salesOrders, salesOrderItems, itemSerialNumbers } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { allocateSerials } from '@/lib/inventory/serial-numbers'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { postVoidToGL } from '@/lib/accounting/auto-post'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { voidSaleSchema } from '@/lib/validation/schemas/sales'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single sale
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

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const sale = await db.query.sales.findFirst({
        where: eq(sales.id, id),
        with: {
          customer: true,
          user: true,
          items: {
            with: {
              item: true,
            },
          },
          payments: true,
        },
      })

      if (!sale) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      // Filter payment data to only include safe fields
      const filteredPayments = (sale.payments || []).map(p => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        receivedBy: p.receivedBy,
        createdAt: p.createdAt,
        voidedAt: p.voidedAt,
      }))

      return NextResponse.json({ ...sale, payments: filteredPayments })
    })
  } catch (error) {
    logError('api/sales/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch sale' }, { status: 500 })
  }
}

// Issue 19: PUT to void a sale directly
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission to void sales
    const permError = requirePermission(session, 'voidSales')
    if (permError) return permError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, voidSaleSchema)
    if (!parsed.success) return parsed.response
    const { voidReason } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Use transaction for atomic operations
      const result = await db.transaction(async (tx) => {
        // Lock and get current sale (RLS scopes the query)
        const [sale] = await tx
          .select()
          .from(sales)
          .where(eq(sales.id, id))
          .for('update')

        if (!sale) {
          throw new Error('NOT_FOUND')
        }

        // Can't void an already voided sale
        if (sale.status === 'void') {
          throw new Error('ALREADY_VOIDED')
        }

        // Can't void return sales - they need to be handled differently
        if (sale.isReturn) {
          throw new Error('CANNOT_VOID_RETURN')
        }

        // Get sale items to restore stock (RLS scopes the query)
        const saleItemsList = await tx.query.saleItems.findMany({
          where: eq(saleItems.saleId, id),
          with: {
            item: true,
          },
        })

        // Issue #2: Check for existing returns against this sale to avoid double-restoring stock
        const existingReturns = await tx.query.sales.findMany({
          where: and(
            eq(sales.returnAgainst, id),
            eq(sales.isReturn, true),
            sql`${sales.status} != 'void'`
          ),
          with: {
            items: true,
          },
        })

        // Build map of already-returned quantities per itemId
        const returnedQtyMap = new Map<string, number>()
        for (const returnSale of existingReturns) {
          for (const returnItem of returnSale.items) {
            if (returnItem.itemId) {
              const prev = returnedQtyMap.get(returnItem.itemId) || 0
              returnedQtyMap.set(returnItem.itemId, prev + Math.abs(parseFloat(returnItem.quantity)))
            }
          }
        }

        // Restore stock for each item (minus already-returned quantities)
        for (const saleItem of saleItemsList) {
          const item = Array.isArray(saleItem.item) ? saleItem.item[0] : saleItem.item
          if (item?.trackStock && sale.warehouseId) {
            const originalQty = parseFloat(saleItem.quantity)
            const alreadyReturned = returnedQtyMap.get(saleItem.itemId!) || 0
            // Only restore the quantity that hasn't already been returned
            const qty = Math.max(0, originalQty - alreadyReturned)

            if (qty <= 0) continue // Fully returned, skip stock restoration

            // Lock and get warehouse stock (RLS scopes the query)
            const [existingStock] = await tx
              .select()
              .from(warehouseStock)
              .where(and(
                eq(warehouseStock.itemId, saleItem.itemId!),
                eq(warehouseStock.warehouseId, sale.warehouseId)
              ))
              .for('update')

            if (existingStock) {
              // Update existing warehouse stock
              await tx.update(warehouseStock)
                .set({
                  currentStock: sql`${warehouseStock.currentStock} + ${qty}`,
                  updatedAt: new Date(),
                })
                .where(eq(warehouseStock.id, existingStock.id))
            } else {
              // Create warehouse stock record
              await tx.insert(warehouseStock).values({
                tenantId: session.user.tenantId,
                warehouseId: sale.warehouseId,
                itemId: saleItem.itemId!,
                currentStock: String(qty),
                minStock: '0',
              })
            }

            // Create stock movement record
            await tx.insert(stockMovements).values({
              tenantId: session.user.tenantId,
              warehouseId: sale.warehouseId,
              itemId: saleItem.itemId!,
              type: 'in',
              quantity: String(qty),
              referenceType: 'sale_void',
              referenceId: id,
              notes: `Stock restored from voided sale ${sale.invoiceNo}`,
              createdBy: userId,
            })
          }

          // Restore serial numbers to 'available' status
          const serialIds = saleItem.serialNumberIds as string[] | null
          if (serialIds?.length) {
            await allocateSerials(tx, {
              tenantId: session.user.tenantId,
              serialNumberIds: serialIds,
              newStatus: 'available',
              referenceType: 'sale_void',
              referenceId: id,
              changedBy: userId,
              notes: `Serials restored from voided sale ${sale.invoiceNo}`,
            })
          }
        }

        // Reverse customer credit transactions if any
        if (sale.customerId) {
          const creditTransactions = await tx.query.customerCreditTransactions.findMany({
            where: and(
              eq(customerCreditTransactions.referenceType, 'sale'),
              eq(customerCreditTransactions.referenceId, id)
            ),
          })

          if (creditTransactions.length > 0) {
            // Lock customer for update
            const [customer] = await tx
              .select()
              .from(customers)
              .where(eq(customers.id, sale.customerId))
              .for('update')

            if (customer) {
              const originalBalance = parseFloat(customer.balance || '0')
              let newBalance = originalBalance

              for (const trans of creditTransactions) {
                const amount = parseFloat(trans.amount)
                if (trans.type === 'use') {
                  // Credit was used for payment - restore it
                  newBalance = roundCurrency(newBalance + Math.abs(amount))
                } else if (trans.type === 'overpayment') {
                  // Overpayment was added to credit - deduct it back
                  newBalance = roundCurrency(newBalance - Math.abs(amount))
                }
              }

              // Prevent negative balance
              newBalance = Math.max(0, newBalance)

              // Update customer balance
              await tx.update(customers)
                .set({
                  balance: newBalance.toFixed(2),
                  updatedAt: new Date(),
                })
                .where(eq(customers.id, sale.customerId))

              // Create reversal credit transaction record
              const balanceChange = roundCurrency(newBalance - originalBalance)
              if (balanceChange !== 0) {
                await tx.insert(customerCreditTransactions).values({
                  tenantId: session.user.tenantId,
                  customerId: sale.customerId,
                  type: 'adjustment',
                  amount: balanceChange.toFixed(2),
                  balanceAfter: newBalance.toFixed(2),
                  referenceType: 'sale_void',
                  referenceId: id,
                  notes: `Credit adjusted from voided sale ${sale.invoiceNo}`,
                  createdBy: userId,
                })
              }
            }
          }
        }

        // Reverse loyalty points earned/redeemed from this sale
        if (sale.customerId) {
          const loyaltyTxns = await tx.query.loyaltyTransactions.findMany({
            where: and(
              eq(loyaltyTransactions.saleId, id),
              eq(loyaltyTransactions.customerId, sale.customerId)
            ),
          })

          if (loyaltyTxns.length > 0) {
            // Lock customer for update
            const [customer] = await tx
              .select()
              .from(customers)
              .where(eq(customers.id, sale.customerId))
              .for('update')

            if (customer) {
              let currentPoints = customer.loyaltyPoints || 0

              for (const txn of loyaltyTxns) {
                if (txn.type === 'earn') {
                  // Points were earned - deduct them
                  currentPoints = Math.max(0, currentPoints - txn.points)
                } else if (txn.type === 'redeem') {
                  // Points were redeemed (negative value) - restore them
                  currentPoints += Math.abs(txn.points)
                }
              }

              // Create reversal loyalty transaction
              const netPointChange = currentPoints - (customer.loyaltyPoints || 0)
              if (netPointChange !== 0) {
                await tx.insert(loyaltyTransactions).values({
                  tenantId: session.user.tenantId,
                  customerId: sale.customerId,
                  type: 'adjustment',
                  points: netPointChange,
                  balanceAfter: currentPoints,
                  saleId: id,
                  notes: `Loyalty points reversed from voided sale ${sale.invoiceNo}`,
                })
              }

              await tx.update(customers)
                .set({
                  loyaltyPoints: currentPoints,
                  updatedAt: new Date(),
                })
                .where(eq(customers.id, sale.customerId))
            }
          }
        }

        // RC-12: Void all associated payments with full audit trail
        await tx.update(payments)
          .set({
            voidedAt: new Date(),
            voidedBy: userId,
            voidReason: voidReason || 'Parent sale voided',
          })
          .where(eq(payments.saleId, id))

        // Restore SO state when voiding an SO-linked invoice
        let restoredSalesOrderId: string | null = null
        if (sale.salesOrderId) {
          // Lock the sales order
          const [linkedOrder] = await tx
            .select()
            .from(salesOrders)
            .where(eq(salesOrders.id, sale.salesOrderId))
            .for('update')

          if (linkedOrder) {
            // Get SO items for matching
            const soItems = await tx
              .select()
              .from(salesOrderItems)
              .where(eq(salesOrderItems.salesOrderId, sale.salesOrderId))

            // For each voided sale item, decrement fulfilledQuantity and re-reserve stock
            for (const saleItem of saleItemsList) {
              if (!saleItem.itemId) continue

              const originalQty = parseFloat(saleItem.quantity)
              const alreadyReturned = returnedQtyMap.get(saleItem.itemId) || 0
              const restoreQty = Math.max(0, originalQty - alreadyReturned)

              if (restoreQty <= 0) continue

              // Find matching SO item by itemId
              const soItem = soItems.find(si => si.itemId === saleItem.itemId)
              if (soItem) {
                const currentFulfilled = parseFloat(soItem.fulfilledQuantity || '0')
                const rawNewFulfilled = currentFulfilled - restoreQty
                if (rawNewFulfilled < 0) {
                  console.warn(`Data inconsistency: fulfilledQuantity would go negative for SO item ${soItem.id} (current: ${currentFulfilled}, restore: ${restoreQty}). Clamping to 0.`)
                }
                const newFulfilled = Math.max(0, rawNewFulfilled)
                await tx.update(salesOrderItems)
                  .set({ fulfilledQuantity: newFulfilled.toString() })
                  .where(eq(salesOrderItems.id, soItem.id))
              }

              // Re-reserve stock on warehouseStock (cap to currentStock to prevent over-reservation)
              if (sale.warehouseId) {
                const [stock] = await tx
                  .select()
                  .from(warehouseStock)
                  .where(and(
                    eq(warehouseStock.itemId, saleItem.itemId),
                    eq(warehouseStock.warehouseId, sale.warehouseId)
                  ))
                  .for('update')

                if (stock) {
                  await tx.update(warehouseStock)
                    .set({
                      reservedStock: sql`LEAST(${warehouseStock.reservedStock} + ${restoreQty}, ${warehouseStock.currentStock})`,
                      updatedAt: new Date(),
                    })
                    .where(eq(warehouseStock.id, stock.id))
                }
              }
            }

            // Recalculate SO status based on updated fulfilled quantities
            const updatedSoItems = await tx
              .select()
              .from(salesOrderItems)
              .where(eq(salesOrderItems.salesOrderId, sale.salesOrderId))

            const allZero = updatedSoItems.every(item =>
              parseCurrency(item.fulfilledQuantity || '0') === 0
            )
            const allFulfilled = updatedSoItems.every(item =>
              parseCurrency(item.fulfilledQuantity || '0') >= parseCurrency(item.quantity)
            )

            let newStatus: 'confirmed' | 'partially_fulfilled' | 'fulfilled'
            if (allZero) {
              newStatus = 'confirmed'
            } else if (allFulfilled) {
              newStatus = 'fulfilled'
            } else {
              newStatus = 'partially_fulfilled'
            }

            await tx.update(salesOrders)
              .set({ status: newStatus, updatedAt: new Date() })
              .where(eq(salesOrders.id, sale.salesOrderId))

            restoredSalesOrderId = sale.salesOrderId
          }
        }

        // Reverse GL entries for all voucher types associated with this sale
        await postVoidToGL(tx, session.user.tenantId, 'sale', id)
        await postVoidToGL(tx, session.user.tenantId, 'gift_card_sale', id)
        await postVoidToGL(tx, session.user.tenantId, 'payment', id)
        await postVoidToGL(tx, session.user.tenantId, 'credit_payment', id)
        // If this sale was from a work order invoice, also reverse WIP-to-COGS entries
        if (sale.workOrderId) {
          await postVoidToGL(tx, session.user.tenantId, 'work_order_invoice', sale.workOrderId)
        }

        // Void the sale
        const [voidedSale] = await tx.update(sales)
          .set({
            status: 'void',
            voidReason: voidReason || 'Sale voided',
            voidedAt: new Date(),
          })
          .where(eq(sales.id, id))
          .returning()

        // WS-2/WS-3: Return affected itemIds and warehouseId for specific broadcasts
        const affectedItemIds = [...new Set(saleItemsList.map(i => i.itemId).filter(Boolean))] as string[]
        return { voidedSale, affectedItemIds, warehouseId: sale.warehouseId, restoredSalesOrderId }
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'sale', 'updated', id, {
        userId,
        activityAction: 'cancel',
        entityName: result.voidedSale.invoiceNo,
        description: `Voided sale ${result.voidedSale.invoiceNo}${voidReason ? `: ${voidReason}` : ''}`,
      })
      // WS-3: Broadcast specific item stock updates (not 'all')
      for (const itemId of result.affectedItemIds) {
        logAndBroadcast(session.user.tenantId, 'item', 'updated', itemId)
      }
      // WS-2: Broadcast warehouse-stock updates
      if (result.warehouseId) {
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', result.warehouseId)
      }
      // Broadcast SO update if we restored its state
      if (result.restoredSalesOrderId) {
        logAndBroadcast(session.user.tenantId, 'sales-order', 'updated', result.restoredSalesOrderId)
      }

      return NextResponse.json(result.voidedSale)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/sales/[id]', error)

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }
    if (message === 'ALREADY_VOIDED') {
      return NextResponse.json({ error: 'This sale has already been voided' }, { status: 400 })
    }
    if (message === 'CANNOT_VOID_RETURN') {
      return NextResponse.json({ error: 'Return transactions cannot be voided directly' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to void sale' }, { status: 500 })
  }
}
