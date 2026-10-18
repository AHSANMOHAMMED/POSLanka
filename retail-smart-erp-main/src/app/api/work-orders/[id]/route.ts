import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { workOrders, workOrderParts, appointments, insuranceEstimateItems, insuranceEstimates, stockMovements, vehicleInspections, sales, payments, customers, vehicles, customerCreditTransactions, warehouseStock, workOrderAssignmentHistory, users, heldSales, stockTransfers, stockTransferItems } from '@/lib/db/schema'
import { eq, and, sql, desc, inArray } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { deleteWorkOrderInspectionFiles, deleteFilesByDocument } from '@/lib/utils/file-cleanup'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { triggerNotification } from '@/lib/notifications/auto-trigger'
import { logError } from '@/lib/ai/error-logger'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { postVoidToGL } from '@/lib/accounting/auto-post'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateWorkOrderSchema } from '@/lib/validation/schemas/work-orders'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Issue #24: Expanded workflow with intermediate states
const validStatusTransitions: Record<string, string[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'], // Goes to invoiced via invoice endpoint only
  completed: ['cancelled'],
  invoiced: ['cancelled'], // Can cancel invoiced work orders (will void sale and payments)
  cancelled: [], // Terminal state
}

// GET single work order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (tenantDb) => {
      const workOrder = await tenantDb.query.workOrders.findFirst({
        where: eq(workOrders.id, id),
        with: {
          customer: true,
          vehicle: {
            with: {
              vehicleType: true,
            },
          },
          warehouse: true,
          assignedUser: true,
          createdByUser: true,
          services: {
            with: {
              serviceType: true,
              technician: true,
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

      // Enrich parts with availableStock (computed from warehouseStock + reservations)
      const stockItemIds = workOrder.parts
        .filter(p => p.item?.trackStock && p.itemId)
        .map(p => p.itemId as string)

      if (stockItemIds.length === 0) {
        return NextResponse.json(workOrder)
      }

      const warehouseId = workOrder.warehouseId

      // 1. Get warehouse stock (batch)
      const currentStockMap = new Map<string, number>()
      if (warehouseId) {
        const stockData = await tenantDb
          .select({
            itemId: warehouseStock.itemId,
            currentStock: warehouseStock.currentStock,
            reservedStock: warehouseStock.reservedStock,
          })
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.warehouseId, warehouseId),
            inArray(warehouseStock.itemId, stockItemIds)
          ))
        for (const s of stockData) {
          currentStockMap.set(s.itemId, parseFloat(s.currentStock))
        }
      } else {
        const stockData = await tenantDb
          .select({
            itemId: warehouseStock.itemId,
            totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
          })
          .from(warehouseStock)
          .where(inArray(warehouseStock.itemId, stockItemIds))
          .groupBy(warehouseStock.itemId)
        for (const s of stockData) {
          currentStockMap.set(s.itemId, parseFloat(s.totalStock))
        }
      }

      // 2. Reservations from other work orders (excluding this one)
      const reservedMap = new Map<string, number>()
      const woReservedWhere = warehouseId
        ? and(
            inArray(workOrderParts.itemId, stockItemIds),
            sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`,
            eq(workOrders.warehouseId, warehouseId),
            sql`${workOrders.id} != ${id}`
          )
        : and(
            inArray(workOrderParts.itemId, stockItemIds),
            sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`,
            sql`${workOrders.id} != ${id}`
          )
      const woReserved = await tenantDb
        .select({
          itemId: workOrderParts.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
        })
        .from(workOrderParts)
        .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
        .where(woReservedWhere)
        .groupBy(workOrderParts.itemId)
      for (const r of woReserved) {
        reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
      }

      // 3. Reservations from held sales
      const heldSalesWhere = warehouseId
        ? and(eq(heldSales.warehouseId, warehouseId), sql`${heldSales.expiresAt} > NOW()`)
        : sql`${heldSales.expiresAt} > NOW()`
      const heldSalesData = await tenantDb.query.heldSales.findMany({ where: heldSalesWhere })
      for (const held of heldSalesData) {
        const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
        if (Array.isArray(cartItems)) {
          for (const ci of cartItems) {
            if (ci.itemId && stockItemIds.includes(ci.itemId)) {
              reservedMap.set(ci.itemId, (reservedMap.get(ci.itemId) || 0) + (ci.quantity || 0))
            }
          }
        }
      }

      // 4. Reservations from estimates with holdStock
      const estReservedWhere = warehouseId
        ? and(
            inArray(insuranceEstimateItems.itemId, stockItemIds),
            eq(insuranceEstimates.holdStock, true),
            eq(insuranceEstimates.warehouseId, warehouseId),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimateItems.itemId} IS NOT NULL`
          )
        : and(
            inArray(insuranceEstimateItems.itemId, stockItemIds),
            eq(insuranceEstimates.holdStock, true),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimateItems.itemId} IS NOT NULL`
          )
      const estReserved = await tenantDb
        .select({
          itemId: insuranceEstimateItems.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
        })
        .from(insuranceEstimateItems)
        .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
        .where(estReservedWhere)
        .groupBy(insuranceEstimateItems.itemId)
      for (const r of estReserved) {
        if (r.itemId) {
          reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
        }
      }

      // 5. Reservations from outbound stock transfers
      if (warehouseId) {
        const transferReserved = await tenantDb
          .select({
            itemId: stockTransferItems.itemId,
            reservedQty: sql<string>`COALESCE(SUM(CAST(${stockTransferItems.quantity} AS DECIMAL)), 0)`,
          })
          .from(stockTransferItems)
          .innerJoin(stockTransfers, eq(stockTransferItems.transferId, stockTransfers.id))
          .where(and(
            inArray(stockTransferItems.itemId, stockItemIds),
            eq(stockTransfers.fromWarehouseId, warehouseId),
            sql`${stockTransfers.status} IN ('approved', 'in_transit')`
          ))
          .groupBy(stockTransferItems.itemId)
        for (const r of transferReserved) {
          reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
        }
      }

      // Attach availableStock to each part's item
      const enrichedParts = workOrder.parts.map(p => ({
        ...p,
        item: p.item ? {
          ...p.item,
          availableStock: String(Math.max(0,
            (currentStockMap.get(p.itemId) ?? 0) - (reservedMap.get(p.itemId) ?? 0)
          )),
          currentStock: String(currentStockMap.get(p.itemId) ?? 0),
        } : p.item,
      }))

      return NextResponse.json({ ...workOrder, parts: enrichedParts })
    })
  } catch (error) {
    logError('api/work-orders/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch work order' }, { status: 500 })
  }
}

// PUT update work order
export async function PUT(
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

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateWorkOrderSchema)
    if (!parsed.success) return parsed.response
    const { customerId, vehicleId, status, priority, odometerIn, customerComplaint, diagnosis, assignedTo, warehouseId, costCenterId, cancellationReason, expectedUpdatedAt, estimateAction, appointmentAction, assignmentReason, changesSummary } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (tenantDb) => {
      // Use transaction with FOR UPDATE to prevent TOCTOU race condition
      const result = await tenantDb.transaction(async (tx) => {
        // Lock and get current work order to validate status transition (RLS scopes the query)
        const [currentWorkOrder] = await tx
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, id))
          .for('update')

      if (!currentWorkOrder) {
        throw new Error('NOT_FOUND')
      }

      // Optimistic locking - check if record was modified since client fetched it
      if (expectedUpdatedAt) {
        const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
        const serverUpdatedAt = currentWorkOrder.updatedAt ? new Date(currentWorkOrder.updatedAt).getTime() : 0
        if (serverUpdatedAt > clientUpdatedAt) {
          throw new Error('CONFLICT')
        }
      }

      // W5: Validate status transitions
      if (status && status !== currentWorkOrder.status) {
        const allowedTransitions = validStatusTransitions[currentWorkOrder.status] || []
        if (!allowedTransitions.includes(status)) {
          throw new Error(`INVALID_TRANSITION:Cannot change status from '${currentWorkOrder.status}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`)
        }
      }

      // Validate warehouse change
      if (warehouseId !== undefined && warehouseId !== currentWorkOrder.warehouseId) {
        // Only allow warehouse change when in draft status
        if (currentWorkOrder.status !== 'draft') {
          throw new Error('WAREHOUSE_CHANGE_NOT_ALLOWED:Cannot change warehouse after work order is confirmed')
        }
        // Check if parts exist - cannot change warehouse if parts have been added
        const existingParts = await tx.query.workOrderParts.findMany({
          where: eq(workOrderParts.workOrderId, id),
          columns: { id: true },
          limit: 1,
        })
        if (existingParts.length > 0) {
          throw new Error('WAREHOUSE_CHANGE_NOT_ALLOWED:Cannot change warehouse after parts have been added')
        }
      }

      // Update customer/vehicle snapshots when IDs change
      let customerNameSnapshot: string | null | undefined = undefined
      if (customerId !== undefined) {
        if (customerId) {
          const cust = await tx.query.customers.findFirst({ where: eq(customers.id, customerId) })
          customerNameSnapshot = cust?.name || null
        } else {
          customerNameSnapshot = null
        }
      }
      let vehiclePlateSnapshot: string | null | undefined = undefined
      let vehicleDescSnapshot: string | null | undefined = undefined
      if (vehicleId !== undefined) {
        if (vehicleId) {
          const veh = await tx.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) })
          vehiclePlateSnapshot = veh?.licensePlate || null
          vehicleDescSnapshot = veh ? [veh.year, veh.make, veh.model].filter(Boolean).join(' ') : null
        } else {
          vehiclePlateSnapshot = null
          vehicleDescSnapshot = null
        }
      }

      // Build update data
      const updateData: Record<string, unknown> = {
        customerId: customerId !== undefined ? (customerId || null) : undefined,
        vehicleId: vehicleId !== undefined ? (vehicleId || null) : undefined,
        warehouseId: warehouseId !== undefined ? (warehouseId || null) : undefined,
        customerName: customerNameSnapshot,
        vehiclePlate: vehiclePlateSnapshot,
        vehicleDescription: vehicleDescSnapshot,
        status: status || undefined,
        priority: priority || undefined,
        odometerIn: odometerIn !== undefined ? (odometerIn ?? null) : undefined,
        customerComplaint: customerComplaint !== undefined ? (customerComplaint || null) : undefined,
        diagnosis: diagnosis !== undefined ? (diagnosis || null) : undefined,
        assignedTo: assignedTo !== undefined ? (assignedTo || null) : undefined,
        costCenterId: costCenterId !== undefined ? (costCenterId || null) : undefined,
        updatedAt: new Date(),
      }

      // Add cancellation data if status is cancelled
      if (status === 'cancelled') {
        updateData.cancellationReason = cancellationReason || null
        updateData.cancelledAt = new Date()
      }

      const [updated] = await tx.update(workOrders)
        .set(updateData)
        .where(and(
          eq(workOrders.id, id),
          eq(workOrders.tenantId, session.user.tenantId)
        ))
        .returning()

      // Track assignment history when assignedTo changes
      if (assignedTo !== undefined) {
        const oldAssignedTo = currentWorkOrder.assignedTo || null
        const newAssignedTo = assignedTo || null

        // Only track if the value actually changed
        if (oldAssignedTo !== newAssignedTo) {
          // Look up user names for the assignees
          let previousAssignedToName: string | null = null
          let assignedToName: string | null = null

          if (oldAssignedTo) {
            const [prevUser] = await tx
              .select({ fullName: users.fullName })
              .from(users)
              .where(eq(users.id, oldAssignedTo))
            previousAssignedToName = prevUser?.fullName || null
          }

          if (newAssignedTo) {
            const [newUser] = await tx
              .select({ fullName: users.fullName })
              .from(users)
              .where(eq(users.id, newAssignedTo))
            assignedToName = newUser?.fullName || null
          }

          // Get the name of the user making the change
          const [changingUser] = await tx
            .select({ fullName: users.fullName })
            .from(users)
            .where(eq(users.id, userId))
          const changedByName = changingUser?.fullName || session.user.name || 'Unknown'

          await tx.insert(workOrderAssignmentHistory).values({
            tenantId: session.user.tenantId,
            workOrderId: id,
            assignedTo: newAssignedTo,
            previousAssignedTo: oldAssignedTo,
            assignedToName,
            previousAssignedToName,
            changedBy: userId,
            changedByName,
            reason: assignmentReason || null,
          })
        }
      }

      // Track modified linked entities for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let linkedAppointmentsList: any[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let linkedEstimate: any = null

      // When work order is cancelled, clear links from appointments and estimate items
      // This allows users to re-convert from the same appointment/estimate
      if (status === 'cancelled') {
        // If cancelling an invoiced work order, void the sale and reverse credit transactions
        if (currentWorkOrder.status === 'invoiced') {
          // Find the associated sale
          const sale = await tx.query.sales.findFirst({
            where: and(
              eq(sales.workOrderId, id),
              eq(sales.tenantId, session.user.tenantId)
            ),
          })

          if (sale) {
            // Reverse GL entries for the sale (all voucher types)
            await postVoidToGL(tx, session.user.tenantId, 'sale', sale.id)
            await postVoidToGL(tx, session.user.tenantId, 'gift_card_sale', sale.id)
            await postVoidToGL(tx, session.user.tenantId, 'payment', sale.id)
            await postVoidToGL(tx, session.user.tenantId, 'credit_payment', sale.id)

            // Void the sale
            await tx.update(sales)
              .set({
                status: 'void',
                voidReason: cancellationReason || 'Work order cancelled',
                voidedAt: new Date(),
              })
              .where(eq(sales.id, sale.id))

            // Issue 12: Void all associated payments
            await tx.update(payments)
              .set({ voidedAt: new Date() })
              .where(eq(payments.saleId, sale.id))

            // Reverse customer credit transactions if any
            if (sale.customerId) {
              // Find all credit transactions for this sale (linked via sale reference, not work_order)
              const creditTransactions = await tx.query.customerCreditTransactions.findMany({
                where: and(
                  eq(customerCreditTransactions.referenceType, 'sale'),
                  eq(customerCreditTransactions.referenceId, sale.id),
                  eq(customerCreditTransactions.tenantId, session.user.tenantId)
                ),
                orderBy: [desc(customerCreditTransactions.createdAt)],
              })

              // Get current customer balance with row lock
              const [customer] = await tx
                .select()
                .from(customers)
                .where(eq(customers.id, sale.customerId))
                .for('update')

              if (customer && creditTransactions.length > 0) {
                let newBalance = parseFloat(customer.balance || '0')
                const originalBalance = newBalance

                for (const trans of creditTransactions) {
                  const amount = parseFloat(trans.amount)
                  if (trans.type === 'use') {
                    // Credit was used for payment - restore it
                    newBalance += Math.abs(amount)
                  } else if (trans.type === 'overpayment') {
                    // Overpayment was added to credit - deduct it back
                    newBalance -= Math.abs(amount)
                  }
                }

                // Issue 11: Prevent negative balance (customer may have used the credit elsewhere)
                newBalance = Math.max(0, newBalance)

                // Calculate actual balance change (accounting for any clamping)
                const balanceChange = newBalance - originalBalance

                // Only update if there's an actual change
                if (balanceChange !== 0) {
                  // Update customer balance
                  await tx.update(customers)
                    .set({
                      balance: newBalance.toFixed(2),
                      updatedAt: new Date(),
                    })
                    .where(eq(customers.id, sale.customerId))

                  // Create reversal credit transaction record
                  await tx.insert(customerCreditTransactions).values({
                    tenantId: session.user.tenantId,
                    customerId: sale.customerId,
                    type: 'adjustment',
                    amount: balanceChange.toFixed(2),
                    balanceAfter: newBalance.toFixed(2),
                    referenceType: 'work_order_cancelled',
                    referenceId: id,
                    notes: `Credit reversed from cancelled Work Order ${currentWorkOrder.orderNo}`,
                    createdBy: userId,
                  })
                }
              }
            }
          }
        }

        // W3: Restore stock for parts ONLY when cancelling an INVOICED work order
        // Draft work orders only reserve stock (not deducted from currentStock)
        // Stock is only deducted when invoiced, so we only restore when cancelling invoiced orders
        if (currentWorkOrder.status === 'invoiced') {
          const parts = await tx.query.workOrderParts.findMany({
            where: eq(workOrderParts.workOrderId, id),
            with: {
              item: true,
            },
          })

          for (const part of parts) {
            const item = Array.isArray(part.item) ? part.item[0] : part.item
            if (item?.trackStock && currentWorkOrder.warehouseId) {
              // Lock and get warehouse stock
              const [existingStock] = await tx
                .select()
                .from(warehouseStock)
                .where(and(
                  eq(warehouseStock.itemId, part.itemId),
                  eq(warehouseStock.warehouseId, currentWorkOrder.warehouseId),
                  eq(warehouseStock.tenantId, session.user.tenantId)
                ))
                .for('update')

              if (existingStock) {
                // Restore stock
                await tx.update(warehouseStock)
                  .set({
                    currentStock: sql`${warehouseStock.currentStock} + ${part.quantity}`,
                    updatedAt: new Date(),
                  })
                  .where(eq(warehouseStock.id, existingStock.id))
              } else {
                // Create warehouse stock record
                await tx.insert(warehouseStock).values({
                  tenantId: session.user.tenantId,
                  warehouseId: currentWorkOrder.warehouseId,
                  itemId: part.itemId,
                  currentStock: part.quantity,
                  minStock: '0',
                })
              }

              // Create stock movement record for traceability
              await tx.insert(stockMovements).values({
                tenantId: session.user.tenantId,
                warehouseId: currentWorkOrder.warehouseId,
                itemId: part.itemId,
                type: 'in',
                quantity: part.quantity,
                referenceType: 'work_order_cancelled',
                referenceId: id,
                notes: `Stock restored from cancelled Work Order ${currentWorkOrder.orderNo}`,
                createdBy: userId,
              })
            }
          }
        }

        // Reverse WIP GL entries (work_order_part and work_order_invoice vouchers)
        try {
          await reverseGLEntries(tx, session.user.tenantId, 'work_order_part', id)
          await reverseGLEntries(tx, session.user.tenantId, 'work_order_invoice', id)
        } catch {
          // No GL entries to reverse is fine — WIP may not have been posted
        }

        // Handle linked appointments based on user's choice
        linkedAppointmentsList = await tx.query.appointments.findMany({
          where: eq(appointments.workOrderId, id),
        })

        for (const linkedAppt of linkedAppointmentsList) {
          if (appointmentAction === 'cancel') {
            // Cancel the linked appointment too
            await tx.update(appointments)
              .set({
                status: 'cancelled',
                cancellationReason: `Linked work order ${currentWorkOrder.orderNo} was cancelled`,
                cancelledAt: new Date(),
                workOrderId: null,
                updatedAt: new Date(),
              })
              .where(eq(appointments.id, linkedAppt.id))
          } else if (appointmentAction === 'revert') {
            // Revert appointment - determine appropriate status based on current status
            // If 'arrived' (customer showed up but work cancelled), set to 'confirmed'
            // Otherwise keep current status (scheduled/confirmed stay as is)
            const revertedStatus = linkedAppt.status === 'arrived' ? 'confirmed' : linkedAppt.status
            await tx.update(appointments)
              .set({
                status: revertedStatus,
                workOrderId: null,
                updatedAt: new Date(),
              })
              .where(eq(appointments.id, linkedAppt.id))
          } else {
            // Default: just clear the link (keep appointment status as is)
            await tx.update(appointments)
              .set({
                workOrderId: null,
                updatedAt: new Date(),
              })
              .where(eq(appointments.id, linkedAppt.id))
          }
        }

        // Handle linked insurance estimate based on user's choice
        linkedEstimate = await tx.query.insuranceEstimates.findFirst({
          where: eq(insuranceEstimates.workOrderId, id),
        })

        if (linkedEstimate) {
          if (estimateAction === 'cancel') {
            // Cancel the linked estimate too
            await tx.update(insuranceEstimates)
              .set({
                status: 'cancelled',
                cancellationReason: `Linked work order ${currentWorkOrder.orderNo} was cancelled`,
                cancelledAt: new Date(),
                workOrderId: null,
                updatedAt: new Date(),
              })
              .where(eq(insuranceEstimates.id, linkedEstimate.id))
          } else if (estimateAction === 'revert') {
            // Issue 9: Determine correct status based on item statuses
            // If any items are rejected, revert to 'partially_approved', otherwise 'approved'
            const estimateItems = await tx.query.insuranceEstimateItems.findMany({
              where: eq(insuranceEstimateItems.estimateId, linkedEstimate.id),
            })

            const hasRejectedItems = estimateItems.some(item => item.status === 'rejected')
            const revertStatus = hasRejectedItems ? 'partially_approved' : 'approved'

            // Revert estimate back to appropriate status (allow re-conversion)
            await tx.update(insuranceEstimates)
              .set({
                status: revertStatus,
                workOrderId: null,
                updatedAt: new Date(),
              })
              .where(eq(insuranceEstimates.id, linkedEstimate.id))
          } else {
            // Default: clear the link and update status appropriately
            // Since item conversion tracking will be cleared, update status to reflect items are available
            const estimateItems = await tx.query.insuranceEstimateItems.findMany({
              where: eq(insuranceEstimateItems.estimateId, linkedEstimate.id),
            })
            const hasRejectedItems = estimateItems.some(item => item.status === 'rejected')
            const updatedStatus = hasRejectedItems ? 'partially_approved' : 'approved'

            await tx.update(insuranceEstimates)
              .set({
                status: updatedStatus,
                workOrderId: null,
                updatedAt: new Date(),
              })
              .where(eq(insuranceEstimates.id, linkedEstimate.id))
          }

          // Clear convertedToWorkOrderId from estimate items
          await tx.update(insuranceEstimateItems)
            .set({ convertedToWorkOrderId: null })
            .where(eq(insuranceEstimateItems.convertedToWorkOrderId, id))
        }
      }

        return {
          workOrder: updated,
          previousWorkOrder: currentWorkOrder,
          modifiedAppointmentIds: linkedAppointmentsList?.map(a => a.id) || [],
          modifiedEstimateId: linkedEstimate?.id || null,
        }
      })

      // Build change description for activity log
      const prev = result.previousWorkOrder
      const changes: string[] = []
      if (status !== undefined && status !== prev.status) {
        changes.push(`status → ${status}`)
      }
      if (customerId !== undefined && customerId !== prev.customerId) {
        changes.push('customer changed')
      }
      if (vehicleId !== undefined && vehicleId !== prev.vehicleId) {
        changes.push('vehicle changed')
      }
      if (warehouseId !== undefined && warehouseId !== prev.warehouseId) {
        changes.push('warehouse changed')
      }
      if (costCenterId !== undefined && costCenterId !== prev.costCenterId) {
        changes.push('cost center changed')
      }
      if (priority !== undefined && priority !== prev.priority) {
        changes.push(`priority → ${priority}`)
      }
      if (odometerIn !== undefined && odometerIn !== prev.odometerIn) {
        changes.push('odometer updated')
      }
      if (customerComplaint !== undefined && customerComplaint !== prev.customerComplaint) {
        changes.push('customer complaint updated')
      }
      if (diagnosis !== undefined && diagnosis !== prev.diagnosis) {
        changes.push('diagnosis updated')
      }
      if (changesSummary) {
        changes.push(changesSummary)
      }

      const entityName = result.workOrder.orderNo || id
      const description = changes.length > 0
        ? `${entityName}: ${changes.join('; ')}`
        : `Saved ${entityName}`

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', id, {
        userId,
        entityName,
        activityAction: status === 'cancelled' ? 'cancel' : 'update',
        description,
      })

      // Broadcast changes to linked appointments and estimates
      if (result.modifiedAppointmentIds.length > 0) {
        for (const appointmentId of result.modifiedAppointmentIds) {
          logAndBroadcast(session.user.tenantId, 'appointment', 'updated', appointmentId)
        }
      }
      if (result.modifiedEstimateId) {
        logAndBroadcast(session.user.tenantId, 'estimate', 'updated', result.modifiedEstimateId)
      }

      // Fire-and-forget notification triggers for status changes
      if (status === 'completed') {
        triggerNotification(session.user.tenantId, 'work_order_completed', {
          tenantId: session.user.tenantId,
          customerId: result.workOrder.customerId,
          workOrderId: id,
          vehicleId: result.workOrder.vehicleId,
        }).catch(() => {})
      }
      if (status === 'invoiced') {
        triggerNotification(session.user.tenantId, 'work_order_invoiced', {
          tenantId: session.user.tenantId,
          customerId: result.workOrder.customerId,
          workOrderId: id,
          vehicleId: result.workOrder.vehicleId,
        }).catch(() => {})
      }

      return NextResponse.json(result.workOrder)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/work-orders/[id]', error)

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This work order was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (message.startsWith('INVALID_TRANSITION:')) {
      return NextResponse.json({ error: message.replace('INVALID_TRANSITION:', '') }, { status: 400 })
    }
    if (message.startsWith('WAREHOUSE_CHANGE_NOT_ALLOWED:')) {
      return NextResponse.json({ error: message.replace('WAREHOUSE_CHANGE_NOT_ALLOWED:', '') }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update work order' }, { status: 500 })
  }
}

// DELETE work order
export async function DELETE(
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

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (tenantDb) => {
      // Fetch inspections with their photos before deletion (for file cleanup) - RLS scopes
      const inspectionsToCleanup = await tenantDb.query.vehicleInspections.findMany({
        where: eq(vehicleInspections.workOrderId, id),
        columns: { id: true },
        with: {
          photos: {
            columns: { photoUrl: true },
          },
        },
      })

      // Use transaction with FOR UPDATE to prevent TOCTOU race condition
      await tenantDb.transaction(async (tx) => {
        // Lock and get work order to validate status (RLS scopes the query)
        const [workOrder] = await tx
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, id))
          .for('update')

        if (!workOrder) {
          throw new Error('NOT_FOUND')
        }

        if (workOrder.status !== 'draft') {
          throw new Error('NOT_DRAFT')
        }

        // Issue 5: Clear workOrderId from linked appointments before deletion
        await tx.update(appointments)
          .set({ workOrderId: null, updatedAt: new Date() })
          .where(eq(appointments.workOrderId, id))

        // Also clear from linked estimates
        await tx.update(insuranceEstimates)
          .set({ workOrderId: null, updatedAt: new Date() })
          .where(eq(insuranceEstimates.workOrderId, id))

        // Clear convertedToWorkOrderId from estimate items
        await tx.update(insuranceEstimateItems)
          .set({ convertedToWorkOrderId: null })
          .where(eq(insuranceEstimateItems.convertedToWorkOrderId, id))

        await tx.delete(workOrders)
          .where(eq(workOrders.id, id))
      })

      // Clean up inspection photo files after successful DB deletion
      // Note: Files may not exist in ephemeral storage environments (e.g., after redeploy)
      if (inspectionsToCleanup.length > 0) {
        await deleteWorkOrderInspectionFiles(inspectionsToCleanup)
      }

      // Clean up any files attached via files table (photos, documents, etc.)
      deleteFilesByDocument(session.user.tenantId, 'work-order', id, session.user.tenantSlug).catch(() => {})

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'work-order', 'deleted', id)
      logAndBroadcast(session.user.tenantId, 'appointment', 'updated', 'bulk')
      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', 'bulk')

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/work-orders/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
    }
    if (message === 'NOT_DRAFT') {
      return NextResponse.json({ error: 'Only draft work orders can be deleted' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to delete work order' }, { status: 500 })
  }
}
