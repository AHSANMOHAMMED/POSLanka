import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { workOrderParts, workOrders, items } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { getAvailableStock, workOrderItemQty, recalculateWorkOrderTotals } from '@/lib/dealership/work-orders'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addWorkOrderPartSchema, updateWorkOrderPartSchema } from '@/lib/validation/schemas/work-orders'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { assertRecordBranch } from '@/lib/auth/branch-access'

// POST add part to work order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId } = paramsParsed.data

  const parsed = await validateBody(request, addWorkOrderPartSchema)
  if (!parsed.success) return parsed.response
  const { itemId, quantity: parsedQuantity, unitPrice } = parsed.data

  // Use transaction for stock locking
  const result = await withAuthTenantTransaction(async (session, db) => {
    // W8: Check permission
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return { error: permError }
    // K4: documents of another branch are off limits to branch-restricted staff
    const branchDenied = await assertRecordBranch(session, db, workOrders, workOrderId, { includeUnassigned: true })
    if (branchDenied) return { error: branchDenied }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    // Lock work order with FOR UPDATE to prevent concurrent part additions from producing incorrect totals
    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for('update')

    if (!workOrder) {
      return { error: NextResponse.json({ error: 'Work order not found' }, { status: 404 }) }
    }

    // Check if work order can be modified (checked after lock)
    if (['invoiced', 'cancelled'].includes(workOrder.status)) {
      return { error: NextResponse.json({ error: 'Cannot modify invoiced or cancelled work orders' }, { status: 400 }) }
    }

    // Get item details
    const item = await db.query.items.findFirst({
      where: eq(items.id, itemId),
    })

    if (!item) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    // Check stock if tracked. Availability excludes this work order's own reservations, so the
    // quantity this work order already holds for the item must be added to the request.
    if (item.trackStock && workOrder.warehouseId) {
      const availableStock = await getAvailableStock(db, itemId, workOrder.warehouseId, { excludeWorkOrderId: workOrderId, lock: true })
      const alreadyOnOrder = await workOrderItemQty(db, workOrderId, itemId)
      if (alreadyOnOrder + parsedQuantity > availableStock) {
        return { error: NextResponse.json({
          error: `Insufficient stock. Available: ${Math.max(0, availableStock - alreadyOnOrder).toFixed(0)}`
        }, { status: 400 }) }
      }
    }

    const price = unitPrice !== undefined ? parseFloat(String(unitPrice)) : parseFloat(item.sellingPrice)

    // Check for existing part with SAME itemId AND SAME price (combine quantities)
    const existingParts = await db
      .select()
      .from(workOrderParts)
      .where(
        and(
          eq(workOrderParts.workOrderId, workOrderId),
          eq(workOrderParts.itemId, itemId)
        )
      )

    // Find a part with matching price
    const matchingPart = existingParts.find(p =>
      Math.abs(parseFloat(p.unitPrice) - price) < 0.001
    )

    let resultPart
    if (matchingPart) {
      // Combine quantities (preserve existing discount)
      const newQty = parseFloat(matchingPart.quantity) + parsedQuantity
      const existingDiscount = parseFloat(matchingPart.discount || '0')
      const newTotal = roundCurrency(price * newQty - existingDiscount)

      const [updated] = await db.update(workOrderParts)
        .set({
          quantity: String(newQty),
          total: String(newTotal),
        })
        .where(eq(workOrderParts.id, matchingPart.id))
        .returning()

      resultPart = { ...updated, combined: true }
    } else {
      // Create new line
      const total = roundCurrency(price * parsedQuantity)
      const [part] = await db.insert(workOrderParts).values({
        tenantId: session.user.tenantId,
        workOrderId,
        itemId,
        quantity: String(parsedQuantity),
        unitPrice: String(price),
        total: String(total),
        coreCharge: item.coreCharge || null,
      }).returning()

      resultPart = part
    }

    // Recalculate work order totals
    await recalculateWorkOrderTotals(db, workOrderId, session.user.tenantId)

    // Get the updated work order's updatedAt
    const [updatedWorkOrder] = await db
      .select({ updatedAt: workOrders.updatedAt })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))

    // Broadcast work order update + stock change
    logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId, { userId: session.user.id })
    logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', '', { userId: session.user.id })

    return { data: { ...resultPart, workOrderUpdatedAt: updatedWorkOrder?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// PUT update part in work order
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId } = paramsParsed.data

  const parsed = await validateBody(request, updateWorkOrderPartSchema)
  if (!parsed.success) return parsed.response
  const { partId, quantity: parsedQuantity, unitPrice: parsedUnitPrice, expectedUpdatedAt } = parsed.data

  // Use transaction to ensure part update + total recalculation are atomic
  const result = await withAuthTenantTransaction(async (session, db) => {
    // W8: Check permission
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return { error: permError }
    // K4: documents of another branch are off limits to branch-restricted staff
    const branchDenied = await assertRecordBranch(session, db, workOrders, workOrderId, { includeUnassigned: true })
    if (branchDenied) return { error: branchDenied }

    // Lock work order with FOR UPDATE to prevent concurrent modifications from producing incorrect totals
    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for('update')

    if (!workOrder) {
      return { error: NextResponse.json({ error: 'Work order not found' }, { status: 404 }) }
    }

    // Optimistic locking (checked after lock)
    if (expectedUpdatedAt) {
      const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
      const serverUpdatedAt = workOrder.updatedAt ? new Date(workOrder.updatedAt).getTime() : 0
      if (serverUpdatedAt > clientUpdatedAt) {
        return { error: NextResponse.json({
          error: 'This work order was modified by another user. Please refresh and try again.',
          code: 'CONFLICT'
        }, { status: 409 }) }
      }
    }

    // Check if work order can be modified (checked after lock)
    if (['invoiced', 'cancelled'].includes(workOrder.status)) {
      return { error: NextResponse.json({ error: 'Cannot modify invoiced or cancelled work orders' }, { status: 400 }) }
    }

    // Get the current part
    const currentPart = await db.query.workOrderParts.findFirst({
      where: and(
        eq(workOrderParts.id, partId),
        eq(workOrderParts.workOrderId, workOrderId)
      ),
    })

    if (!currentPart) {
      return { error: NextResponse.json({ error: 'Part not found' }, { status: 404 }) }
    }

    // Check stock for increased quantity (tracked items only, same rule as adding a part).
    // Availability excludes this work order, so compare the order's new total for the item.
    const currentQty = parseFloat(currentPart.quantity)
    if (parsedQuantity > currentQty && currentPart.itemId) {
      const partItem = await db.query.items.findFirst({ where: eq(items.id, currentPart.itemId), columns: { trackStock: true } })
      if (partItem?.trackStock && workOrder.warehouseId) {
        const availableStock = await getAvailableStock(db, currentPart.itemId, workOrder.warehouseId, { excludeWorkOrderId: workOrderId, lock: true })
        const otherLines = await workOrderItemQty(db, workOrderId, currentPart.itemId, currentPart.id)
        if (otherLines + parsedQuantity > availableStock) {
          return { error: NextResponse.json({
            error: `Insufficient stock. Available: ${Math.max(0, availableStock - otherLines).toFixed(0)}`
          }, { status: 400 }) }
        }
      }
    }

    const existingDiscount = parseFloat(currentPart.discount || '0')
    const total = roundCurrency(parsedQuantity * parsedUnitPrice - existingDiscount)

    const [updated] = await db.update(workOrderParts)
      .set({
        quantity: String(parsedQuantity),
        unitPrice: String(parsedUnitPrice),
        total: String(total),
      })
      .where(and(
        eq(workOrderParts.id, partId),
        eq(workOrderParts.workOrderId, workOrderId),
      ))
      .returning()

    if (!updated) {
      return { error: NextResponse.json({ error: 'Part not found' }, { status: 404 }) }
    }

    // Recalculate work order totals (inside transaction with work order locked)
    await recalculateWorkOrderTotals(db, workOrderId, session.user.tenantId)

    // Get the updated work order's updatedAt
    const [updatedWorkOrder] = await db
      .select({ updatedAt: workOrders.updatedAt })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))

    // Broadcast work order update + stock change
    logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId, { userId: session.user.id })
    logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', '', { userId: session.user.id })

    return { data: { ...updated, workOrderUpdatedAt: updatedWorkOrder?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// DELETE remove part from work order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId } = paramsParsed.data
  const { searchParams } = new URL(request.url)
  const partId = searchParams.get('partId')

  if (!partId) {
    return NextResponse.json({ error: 'Part ID is required' }, { status: 400 })
  }

  // Use transaction to ensure part deletion + total recalculation are atomic
  const result = await withAuthTenantTransaction(async (session, db) => {
    // W8: Check permission
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return { error: permError }
    // K4: documents of another branch are off limits to branch-restricted staff
    const branchDenied = await assertRecordBranch(session, db, workOrders, workOrderId, { includeUnassigned: true })
    if (branchDenied) return { error: branchDenied }

    // Lock work order with FOR UPDATE to prevent concurrent modifications from producing incorrect totals
    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for('update')

    if (!workOrder) {
      return { error: NextResponse.json({ error: 'Work order not found' }, { status: 404 }) }
    }

    // Check if work order can be modified (checked after lock)
    if (['invoiced', 'cancelled'].includes(workOrder.status)) {
      return { error: NextResponse.json({ error: 'Cannot modify invoiced or cancelled work orders' }, { status: 400 }) }
    }

    const [deleted] = await db.delete(workOrderParts)
      .where(and(
        eq(workOrderParts.id, partId),
        eq(workOrderParts.workOrderId, workOrderId),
      ))
      .returning()

    if (!deleted) {
      return { error: NextResponse.json({ error: 'Part not found' }, { status: 404 }) }
    }

    // Recalculate work order totals (inside transaction with work order locked)
    await recalculateWorkOrderTotals(db, workOrderId, session.user.tenantId)

    // Get the updated work order's updatedAt
    const [updatedWorkOrder] = await db
      .select({ updatedAt: workOrders.updatedAt })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))

    // Broadcast work order update + stock change
    logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId, { userId: session.user.id })
    logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', '', { userId: session.user.id })

    return { data: { success: true, workOrderUpdatedAt: updatedWorkOrder?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
