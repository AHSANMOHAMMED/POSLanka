import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { workOrders, workOrderParts, sales, saleItems, stockMovements, heldSales, insuranceEstimates, insuranceEstimateItems, warehouseStock, payments, customers, customerCreditTransactions, appointments, itemSerialNumbers } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { auditWorkOrderInvoiceIntegrity } from '@/lib/audit/realtime-hooks'
import { roundCurrency } from '@/lib/utils/currency'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'
import { allocateSerials } from '@/lib/inventory/serial-numbers'
import { logError } from '@/lib/ai/error-logger'
import { postSaleToGL, postWorkOrderInvoiceWipToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createWorkOrderInvoiceSchema } from '@/lib/validation/schemas/work-orders'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST convert work order to invoice
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // W8: Check permission
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    // Pre-validate accounting config before starting transaction
    const acctError = await requireAccountingConfig(null, session.user.tenantId, 'work_order_invoice')
    if (acctError) return acctError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId } = paramsParsed.data
    const parsed = await validateBody(request, createWorkOrderInvoiceSchema)
    if (!parsed.success) return parsed.response
    const { expectedUpdatedAt, paymentMethod, paidAmount, creditAmount, reference, addOverpaymentToCredit } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get work order with services and parts (RLS scopes to tenant)
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
        with: {
          services: {
            with: {
              serviceType: true,
            },
          },
          parts: {
            with: {
              item: true,
            },
          },
        },
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      // W2: Optimistic locking - check if work order was modified since client fetched it
      if (expectedUpdatedAt) {
        const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
        const serverUpdatedAt = workOrder.updatedAt ? new Date(workOrder.updatedAt).getTime() : 0
        if (serverUpdatedAt > clientUpdatedAt) {
          return NextResponse.json({
            error: 'Work order was modified by another user. Please refresh and try again.',
            code: 'CONFLICT'
          }, { status: 409 })
        }
      }

      // Allow invoicing from any active status (draft, confirmed, in_progress, completed)
      const invoiceableStatuses = ['draft', 'confirmed', 'in_progress', 'completed']
      if (!invoiceableStatuses.includes(workOrder.status)) {
        return NextResponse.json({ error: `Work order cannot be invoiced in '${workOrder.status}' status` }, { status: 400 })
      }

      // Check if already invoiced
      if (workOrder.saleId) {
        return NextResponse.json({ error: 'Work order already invoiced' }, { status: 400 })
      }

      // Validate that there are services or parts
      if (workOrder.services.length === 0 && workOrder.parts.length === 0) {
        return NextResponse.json({ error: 'Work order must have at least one service or part' }, { status: 400 })
      }

      // Issue 8: Verify stock using available stock (currentStock - reservations from OTHER sources)
      // Calculate reserved stock from other work orders, held sales, and estimates (RLS scopes)
      // Check reservations from other non-invoiced/non-cancelled work orders
      const workOrderReservedWhere = workOrder.warehouseId
        ? and(
            sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`,
            eq(workOrders.warehouseId, workOrder.warehouseId),
            sql`${workOrders.id} != ${workOrderId}`
          )
        : and(
            sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`,
            sql`${workOrders.id} != ${workOrderId}`
          )

      const reservedFromOtherWorkOrders = await db
        .select({
          itemId: workOrderParts.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
        })
        .from(workOrderParts)
        .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
        .where(workOrderReservedWhere)
        .groupBy(workOrderParts.itemId)

      // Only count non-expired held sales for stock reservation
      const heldSalesWhere = workOrder.warehouseId
        ? and(
            eq(heldSales.warehouseId, workOrder.warehouseId),
            sql`${heldSales.expiresAt} > NOW()`
          )
        : sql`${heldSales.expiresAt} > NOW()`

      const heldSalesData = await db.query.heldSales.findMany({
        where: heldSalesWhere,
      })

      const estimatesReservedWhere = workOrder.warehouseId
        ? and(
            eq(insuranceEstimates.holdStock, true),
            eq(insuranceEstimates.warehouseId, workOrder.warehouseId),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimateItems.itemId} IS NOT NULL`
          )
        : and(
            eq(insuranceEstimates.holdStock, true),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimateItems.itemId} IS NOT NULL`
          )

      const reservedFromEstimates = await db
        .select({
          itemId: insuranceEstimateItems.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
        })
        .from(insuranceEstimateItems)
        .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
        .where(estimatesReservedWhere)
        .groupBy(insuranceEstimateItems.itemId)

      // Build reservation map
      const reservedMap = new Map<string, number>()
      for (const r of reservedFromOtherWorkOrders) {
        reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
      }
      for (const held of heldSalesData) {
        const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
        if (Array.isArray(cartItems)) {
          for (const item of cartItems) {
            if (item.itemId) {
              reservedMap.set(item.itemId, (reservedMap.get(item.itemId) || 0) + (item.quantity || 0))
            }
          }
        }
      }
      for (const r of reservedFromEstimates) {
        if (r.itemId) {
          reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
        }
      }

      // C2: Verify stock for all parts before invoicing using available stock (RLS scopes)
      const partItemIds = workOrder.parts.filter(p => p.item?.trackStock && p.itemId).map(p => p.itemId as string)
      const stockMap = new Map<string, number>()
      if (partItemIds.length > 0) {
        if (workOrder.warehouseId) {
          // Get stock from specific warehouse
          const stockData = await db
            .select({
              itemId: warehouseStock.itemId,
              totalStock: sql<string>`COALESCE(${warehouseStock.currentStock}, '0')`,
            })
            .from(warehouseStock)
            .where(
              and(
                eq(warehouseStock.warehouseId, workOrder.warehouseId),
                sql`${warehouseStock.itemId} IN (${sql.join(partItemIds.map(id => sql`${id}`), sql`, `)})`
              )
            )

          for (const s of stockData) {
            stockMap.set(s.itemId, parseFloat(s.totalStock))
          }
        } else {
          // No warehouse assigned - aggregate stock across all warehouses (fallback)
          const stockData = await db
            .select({
              itemId: warehouseStock.itemId,
              totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
            })
            .from(warehouseStock)
            .where(sql`${warehouseStock.itemId} IN (${sql.join(partItemIds.map(id => sql`${id}`), sql`, `)})`)
            .groupBy(warehouseStock.itemId)

          for (const s of stockData) {
            stockMap.set(s.itemId, parseFloat(s.totalStock))
          }
        }
      }

      const insufficientStockParts: string[] = []
      for (const part of workOrder.parts) {
        const item = part.item
        if (item && item.trackStock) {
          const requiredQty = parseFloat(part.quantity)
          const reserved = reservedMap.get(item.id) || 0
          const currentStock = stockMap.get(item.id) || 0
          const availableStock = currentStock - reserved
          if (availableStock < requiredQty) {
            insufficientStockParts.push(`${item.name} (need: ${requiredQty}, available: ${availableStock.toFixed(2)})`)
          }
        }
      }

      if (insufficientStockParts.length > 0) {
        return NextResponse.json({
          error: `Insufficient stock for parts: ${insufficientStockParts.join(', ')}`,
          insufficientStockParts,
        }, { status: 400 })
      }

      // Create sale and items in transaction
      const result = await db.transaction(async (tx) => {
        // Lock work order row to prevent double invoicing race condition
        const [lockedWO] = await tx
          .select({ saleId: workOrders.saleId, status: workOrders.status })
          .from(workOrders)
          .where(eq(workOrders.id, workOrderId))
          .for('update')

        if (lockedWO?.saleId) {
          throw new Error('ALREADY_INVOICED')
        }

        if (lockedWO && !['draft', 'confirmed', 'in_progress', 'completed'].includes(lockedWO.status)) {
          throw new Error('INVALID_STATUS')
        }

        // Generate invoice number atomically inside transaction with advisory lock
        await tx.execute(sql`SELECT pg_advisory_xact_lock(1)`)
        const [maxResult] = await tx
          .select({ maxNo: sql<string>`MAX(${sales.invoiceNo})` })
          .from(sales)
          .where(sql`${sales.invoiceNo} LIKE 'INV-%'`)

        const lastInvoiceNo = maxResult?.maxNo
        const nextNumber = lastInvoiceNo ? parseInt(lastInvoiceNo.replace(/\D/g, '')) + 1 : 1
        const invoiceNo = `INV-${String(nextNumber).padStart(6, '0')}`

        // Calculate payment amounts
        const totalAmount = parseFloat(workOrder.total)
        const cashCardAmount = roundCurrency(paidAmount || 0)
        const creditUsed = roundCurrency(creditAmount || 0)
        const totalPaid = roundCurrency(cashCardAmount + creditUsed)
        const saleStatus = totalPaid >= totalAmount ? 'completed' : totalPaid > 0 ? 'partial' : 'pending'

        const saleResult = await tx.insert(sales).values({
          tenantId: session.user.tenantId,
          invoiceNo,
          workOrderId,
          customerId: workOrder.customerId,
          warehouseId: workOrder.warehouseId,
          costCenterId: workOrder.costCenterId || null,
          subtotal: workOrder.subtotal,
          discountAmount: '0',
          taxAmount: workOrder.taxAmount,
          total: workOrder.total,
          paidAmount: String(totalPaid),
          paymentMethod: (paymentMethod || 'cash') as typeof sales.$inferInsert['paymentMethod'],
          status: saleStatus,
          createdBy: userId,
        }).returning()
        const newSale = (saleResult as typeof sales.$inferSelect[])[0]

        // Create sale items from services (labor)
        for (const service of workOrder.services) {
          const serviceName = service.serviceType?.name || service.description || 'Labor'
          await tx.insert(saleItems).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            itemId: null, // Services don't have item IDs
            itemName: `Labor: ${serviceName}`,
            quantity: service.hours,
            unitPrice: service.rate,
            discount: '0',
            tax: '0',
            total: service.amount,
          })
        }

        // Create sale items from parts and update stock
        // Use row-level locking to prevent race conditions in multi-user scenarios
        for (const part of workOrder.parts) {
          const item = part.item
          if (!item) continue

          // Auto-pick serial numbers for serial-tracked items
          let pickedSerialIds: string[] | null = null
          if (item.trackSerialNumbers && workOrder.warehouseId) {
            const requiredQty = Math.ceil(parseFloat(part.quantity))
            const availableSerials = await tx.select()
              .from(itemSerialNumbers)
              .where(and(
                eq(itemSerialNumbers.itemId, part.itemId),
                eq(itemSerialNumbers.warehouseId, workOrder.warehouseId),
                eq(itemSerialNumbers.status, 'available'),
              ))
              .limit(requiredQty)

            if (availableSerials.length > 0) {
              pickedSerialIds = availableSerials.map(s => s.id)
              await allocateSerials(tx, {
                tenantId: session.user.tenantId,
                serialNumberIds: pickedSerialIds,
                newStatus: 'sold',
                referenceType: 'work_order',
                referenceId: workOrderId,
                changedBy: userId,
              })
            }
          }

          // Create sale item
          await tx.insert(saleItems).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            itemId: part.itemId,
            itemName: item.name,
            quantity: part.quantity,
            unitPrice: part.unitPrice,
            discount: '0',
            tax: '0',
            total: part.total,
            serialNumberIds: pickedSerialIds,
          })

          // Update warehouse stock (safe now because row is locked)
          if (item.trackStock && workOrder.warehouseId) {
            const requiredQty = parseFloat(part.quantity)

            // Lock and verify stock inside transaction to prevent race conditions
            const [lockedStock] = await tx
              .select()
              .from(warehouseStock)
              .where(and(
                eq(warehouseStock.itemId, part.itemId),
                eq(warehouseStock.warehouseId, workOrder.warehouseId)
              ))
              .for('update')

            const currentStock = lockedStock ? parseFloat(lockedStock.currentStock) : 0

            // Issue 4: Prevent negative stock - final check with row lock
            if (currentStock < requiredQty) {
              throw new Error(`INSUFFICIENT_STOCK:${item.name} (need: ${requiredQty}, have: ${currentStock})`)
            }

            if (lockedStock) {
              await tx.update(warehouseStock)
                .set({
                  currentStock: sql`${warehouseStock.currentStock} - ${part.quantity}`,
                  updatedAt: new Date(),
                })
                .where(eq(warehouseStock.id, lockedStock.id))
            }

            // Create stock movement
            await tx.insert(stockMovements).values({
              tenantId: session.user.tenantId,
              warehouseId: workOrder.warehouseId,
              itemId: part.itemId,
              type: 'out',
              quantity: part.quantity,
              referenceType: 'work_order',
              referenceId: workOrderId,
              notes: `Work Order ${workOrder.orderNo}`,
              createdBy: userId,
            })
          }
        }

        // Record payment if amount > 0
        if (cashCardAmount > 0) {
          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            amount: String(cashCardAmount),
            method: (paymentMethod || 'cash') as typeof payments.$inferInsert['method'],
            reference: reference || null,
            receivedBy: userId,
          })
        }

        // Handle customer credit payment
        if (creditUsed > 0 && workOrder.customerId) {
          const [customer] = await tx
            .select()
            .from(customers)
            .where(eq(customers.id, workOrder.customerId))
            .for('update')

          if (!customer) {
            throw new Error('CUSTOMER_NOT_FOUND')
          }

          const currentBalance = parseFloat(customer.balance || '0')
          if (currentBalance < creditUsed) {
            throw new Error('INSUFFICIENT_CREDIT')
          }

          const newBalance = roundCurrency(currentBalance - creditUsed)
          await tx.update(customers)
            .set({ balance: String(newBalance), updatedAt: new Date() })
            .where(eq(customers.id, workOrder.customerId))

          await tx.insert(customerCreditTransactions).values({
            tenantId: session.user.tenantId,
            customerId: workOrder.customerId,
            amount: String(-creditUsed),
            balanceAfter: String(newBalance),
            type: 'use',
            notes: `Payment for invoice ${invoiceNo}`,
            referenceType: 'sale',
            referenceId: newSale.id,
            createdBy: userId,
          })

          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            amount: String(creditUsed),
            method: 'credit',
            reference: `Credit payment`,
            receivedBy: userId,
          })
        }

        // Handle overpayment to credit
        if (addOverpaymentToCredit && cashCardAmount > 0 && workOrder.customerId) {
          const overpayment = roundCurrency(totalPaid - totalAmount)
          if (overpayment > 0) {
            const [customer] = await tx
              .select()
              .from(customers)
              .where(eq(customers.id, workOrder.customerId))
              .for('update')

            if (customer) {
              const currentBalance = parseFloat(customer.balance || '0')
              const newBalance = roundCurrency(currentBalance + overpayment)
              await tx.update(customers)
                .set({ balance: String(newBalance), updatedAt: new Date() })
                .where(eq(customers.id, workOrder.customerId))

              await tx.insert(customerCreditTransactions).values({
                tenantId: session.user.tenantId,
                customerId: workOrder.customerId,
                amount: String(overpayment),
                balanceAfter: String(newBalance),
                type: 'overpayment',
                notes: `Overpayment from invoice ${invoiceNo}`,
                referenceType: 'sale',
                referenceId: newSale.id,
                createdBy: userId,
              })
            }
          }
        }

        // Update work order status and link to sale
        await tx.update(workOrders)
          .set({
            status: 'invoiced',
            saleId: newSale.id,
            updatedAt: new Date(),
          })
          .where(eq(workOrders.id, workOrderId))

        // Mark linked appointment as completed (if any)
        await tx.update(appointments)
          .set({
            status: 'completed',
            updatedAt: new Date(),
          })
          .where(eq(appointments.workOrderId, workOrderId))

        // Post sale to GL — INSIDE the transaction so GL and sale are atomic.
        // If GL fails, the entire transaction (sale, stock, payments) rolls back.
        {
          // Calculate COGS from parts with cost prices
          let totalCOGS = 0
          for (const part of workOrder.parts) {
            if (part.item?.costPrice) {
              totalCOGS += roundCurrency(parseFloat(part.quantity) * parseFloat(part.item.costPrice))
            }
          }

          await postSaleToGL(tx, session.user.tenantId, {
            saleId: newSale.id,
            invoiceNumber: newSale.invoiceNo,
            saleDate: new Date().toISOString().split('T')[0],
            subtotal: parseFloat(workOrder.subtotal || '0'),
            tax: parseFloat(workOrder.taxAmount || '0'),
            discount: 0,
            total: totalAmount,
            amountPaid: cashCardAmount,
            creditAmount: creditUsed,
            costOfGoodsSold: roundCurrency(totalCOGS),
            paymentMethod: paymentMethod || 'cash',
            customerId: workOrder.customerId || null,
            costCenterId: workOrder.costCenterId || null,
            taxBreakdown: (workOrder.taxBreakdown as TaxBreakdownItem[]) || undefined,
          })

          // Transfer WIP to COGS (if WIP tracking was used)
          await postWorkOrderInvoiceWipToGL(tx, session.user.tenantId, {
            workOrderId,
            workOrderNo: workOrder.orderNo,
            totalPartsCost: roundCurrency(totalCOGS),
            totalLaborCost: 0, // Labor doesn't have WIP tracking currently
            costCenterId: workOrder.costCenterId || null,
          })
        }

        return newSale
      })

      // Broadcast changes to connected clients
      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)
      logAndBroadcast(session.user.tenantId, 'sale', 'created', result.id)
      logAndBroadcast(session.user.tenantId, 'appointment', 'updated', 'bulk')

      // Integrity audit (fire-and-forget)
      auditWorkOrderInvoiceIntegrity(workOrderId, session.user.tenantId)

      return NextResponse.json(result)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/work-orders/[id]/invoice', error)

    // Handle insufficient stock error from inside transaction
    if (message.startsWith('INSUFFICIENT_STOCK:')) {
      return NextResponse.json({
        error: `Insufficient stock: ${message.replace('INSUFFICIENT_STOCK:', '')}`,
      }, { status: 400 })
    }

    if (message === 'ALREADY_INVOICED') {
      return NextResponse.json({ error: 'Work order already invoiced' }, { status: 400 })
    }

    if (message === 'INSUFFICIENT_CREDIT') {
      return NextResponse.json({ error: 'Insufficient customer credit balance' }, { status: 400 })
    }

    if (message === 'CUSTOMER_NOT_FOUND') {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Work order cannot be invoiced in its current status' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }
}
