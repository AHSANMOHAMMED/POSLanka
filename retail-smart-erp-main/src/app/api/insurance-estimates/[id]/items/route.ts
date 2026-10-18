import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, TenantDb } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateItems, workOrders, workOrderParts, items, heldSales, warehouseStock, stockTransfers, stockTransferItems } from '@/lib/db/schema'
import { eq, and, sql, max } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addEstimateItemSchema, updateEstimateItemSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Helper function to get available stock for a specific warehouse
async function getAvailableStock(db: TenantDb, itemId: string, warehouseId: string | null, excludeEstimateId?: string): Promise<number> {
  const item = await db.query.items.findFirst({
    where: eq(items.id, itemId),
  })

  if (!item) return 0

  let totalReserved = 0

  // 1. Reserved from draft work orders in the SAME warehouse
  const workOrderReservedWhere = warehouseId
    ? and(
        eq(workOrderParts.itemId, itemId),
        eq(workOrders.status, 'draft'),
        eq(workOrders.warehouseId, warehouseId)
      )
    : and(
        eq(workOrderParts.itemId, itemId),
        eq(workOrders.status, 'draft')
      )

  const reservedFromWorkOrders = await db
    .select({
      reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
    })
    .from(workOrderParts)
    .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
    .where(workOrderReservedWhere)
  totalReserved += parseFloat(reservedFromWorkOrders[0]?.reservedQty || '0')

  // 2. Reserved from non-expired held sales in the SAME warehouse
  const heldSalesWhere = warehouseId
    ? and(
        eq(heldSales.warehouseId, warehouseId),
        sql`${heldSales.expiresAt} > NOW()`
      )
    : sql`${heldSales.expiresAt} > NOW()`

  const heldSalesData = await db.query.heldSales.findMany({
    where: heldSalesWhere,
  })
  for (const held of heldSalesData) {
    const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
    if (Array.isArray(cartItems)) {
      for (const cartItem of cartItems) {
        if (cartItem.itemId === itemId) {
          totalReserved += cartItem.quantity || 0
        }
      }
    }
  }

  // 3. Reserved from estimates with holdStock enabled
  const estimatesReservedWhere = warehouseId
    ? and(
        eq(insuranceEstimateItems.itemId, itemId),
        eq(insuranceEstimates.holdStock, true),
        eq(insuranceEstimates.warehouseId, warehouseId),
        sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
        sql`${insuranceEstimateItems.itemId} IS NOT NULL`,
        excludeEstimateId ? sql`${insuranceEstimates.id} != ${excludeEstimateId}` : sql`1=1`
      )
    : and(
        eq(insuranceEstimateItems.itemId, itemId),
        eq(insuranceEstimates.holdStock, true),
        sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
        sql`${insuranceEstimateItems.itemId} IS NOT NULL`,
        excludeEstimateId ? sql`${insuranceEstimates.id} != ${excludeEstimateId}` : sql`1=1`
      )

  const reservedFromEstimates = await db
    .select({
      reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
    })
    .from(insuranceEstimateItems)
    .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
    .where(estimatesReservedWhere)
  totalReserved += parseFloat(reservedFromEstimates[0]?.reservedQty || '0')

  // 4. Reserved from outbound stock transfers
  if (warehouseId) {
    const reservedFromTransfers = await db
      .select({
        reservedQty: sql<string>`COALESCE(SUM(CAST(${stockTransferItems.quantity} AS DECIMAL)), 0)`,
      })
      .from(stockTransferItems)
      .innerJoin(stockTransfers, eq(stockTransferItems.transferId, stockTransfers.id))
      .where(
        and(
          eq(stockTransferItems.itemId, itemId),
          eq(stockTransfers.fromWarehouseId, warehouseId),
          sql`${stockTransfers.status} IN ('approved', 'in_transit')`
        )
      )
    totalReserved += parseFloat(reservedFromTransfers[0]?.reservedQty || '0')
  }

  // Get stock from specific warehouse
  let current = 0
  if (warehouseId) {
    const [stockData] = await db
      .select({
        totalStock: sql<string>`COALESCE(${warehouseStock.currentStock}, '0')`,
      })
      .from(warehouseStock)
      .where(
        and(
          eq(warehouseStock.warehouseId, warehouseId),
          eq(warehouseStock.itemId, itemId)
        )
      )
    current = parseFloat(stockData?.totalStock || '0')
  } else {
    const [stockData] = await db
      .select({
        totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
      })
      .from(warehouseStock)
      .where(eq(warehouseStock.itemId, itemId))
    current = parseFloat(stockData?.totalStock || '0')
  }

  return Math.max(0, current - totalReserved)
}

// Helper function to recalculate estimate totals using tax template system
async function recalculateEstimateTotals(db: TenantDb, estimateId: string, tenantId: string) {
  // Fetch all items for this estimate
  const allItems = await db.query.insuranceEstimateItems.findMany({
    where: eq(insuranceEstimateItems.estimateId, estimateId),
  })

  // Build line items for original amounts (all items)
  const originalLineItems = allItems.map(item => ({
    itemId: item.itemId,
    lineTotal: parseFloat(item.originalAmount),
  }))

  // Build line items for approved amounts (only approved/price_adjusted items)
  const approvedLineItems = allItems
    .filter(item => ['approved', 'price_adjusted'].includes(item.status))
    .map(item => ({
      itemId: item.itemId,
      lineTotal: parseFloat(item.approvedAmount || item.originalAmount),
    }))

  // Calculate tax using templates for both original and approved amounts
  const originalTax = await recalculateDocumentTax(db, tenantId, originalLineItems, { type: 'sales' })
  const approvedTax = await recalculateDocumentTax(db, tenantId, approvedLineItems, { type: 'sales' })

  await db.update(insuranceEstimates)
    .set({
      originalSubtotal: String(originalTax.subtotal),
      originalTaxAmount: String(originalTax.totalTax),
      originalTotal: String(originalTax.total),
      taxBreakdown: originalTax.taxBreakdown,
      approvedSubtotal: String(approvedTax.subtotal),
      approvedTaxAmount: String(approvedTax.totalTax),
      approvedTotal: String(approvedTax.total),
      updatedAt: new Date(),
    })
    .where(eq(insuranceEstimates.id, estimateId))
}

// POST add item to estimate
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data

  const parsed = await validateBody(request, addEstimateItemSchema)
  if (!parsed.success) return parsed.response
  const { itemType, serviceTypeId, description, hours, rate, itemId, partName, quantity, unitPrice, expectedUpdatedAt } = parsed.data as {
    itemType: string; serviceTypeId?: string; description?: string; hours?: string; rate?: string
    itemId?: string; partName?: string; quantity?: string; unitPrice?: string; expectedUpdatedAt?: string
  }

  // Pre-validate amounts
  let amount: number
  if (itemType === 'service') {
    if (!hours || !rate) {
      return NextResponse.json({ error: 'Hours and rate are required for services' }, { status: 400 })
    }
    const parsedHours = parseFloat(hours)
    const parsedRate = parseFloat(rate)
    if (isNaN(parsedHours) || parsedHours <= 0) {
      return NextResponse.json({ error: 'Hours must be a positive number' }, { status: 400 })
    }
    if (isNaN(parsedRate) || parsedRate < 0) {
      return NextResponse.json({ error: 'Rate must be a non-negative number' }, { status: 400 })
    }
    amount = roundCurrency(parsedHours * parsedRate)
  } else {
    if (!quantity || !unitPrice) {
      return NextResponse.json({ error: 'Quantity and unit price are required for parts' }, { status: 400 })
    }
    const parsedQuantity = parseFloat(quantity)
    const parsedUnitPrice = parseFloat(unitPrice)
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 })
    }
    if (isNaN(parsedUnitPrice) || parsedUnitPrice < 0) {
      return NextResponse.json({ error: 'Unit price must be a non-negative number' }, { status: 400 })
    }
    amount = roundCurrency(parsedQuantity * parsedUnitPrice)
  }

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const estimate = await db.query.insuranceEstimates.findFirst({
      where: eq(insuranceEstimates.id, estimateId),
    })

    if (!estimate) {
      return { error: NextResponse.json({ error: 'Estimate not found' }, { status: 404 }) }
    }

    if (!['draft', 'rejected', 'partially_approved'].includes(estimate.status)) {
      return { error: NextResponse.json({ error: 'Cannot modify estimate in current status' }, { status: 400 }) }
    }

    // Issue #56: Optimistic locking - check parent estimate hasn't been modified
    if (expectedUpdatedAt) {
      const clientTime = new Date(expectedUpdatedAt).getTime()
      const serverTime = estimate.updatedAt ? new Date(estimate.updatedAt).getTime() : 0
      if (serverTime > clientTime) {
        return { error: NextResponse.json({ error: 'This estimate was modified by another user. Please refresh and try again.', code: 'CONFLICT' }, { status: 409 }) }
      }
    }

    const [maxSortResult] = await db
      .select({ maxSort: max(insuranceEstimateItems.sortOrder) })
      .from(insuranceEstimateItems)
      .where(eq(insuranceEstimateItems.estimateId, estimateId))

    const nextSortOrder = (maxSortResult?.maxSort || 0) + 1

    // Check stock for parts
    let stockWarning: string | undefined
    if (itemType === 'part' && itemId) {
      const item = await db.query.items.findFirst({
        where: eq(items.id, itemId),
      })
      if (item && item.trackStock) {
        const parsedQty = parseFloat(quantity!)
        // Issue #53: Always exclude current estimate's reservations to avoid double-counting
        const availableStock = await getAvailableStock(db, itemId, estimate.warehouseId, estimateId)
        if (parsedQty > availableStock) {
          if (estimate.holdStock) {
            return { error: NextResponse.json({
              error: `Insufficient stock for ${item.name}. Available: ${availableStock.toFixed(0)}`,
              code: 'INSUFFICIENT_STOCK'
            }, { status: 400 }) }
          }
          stockWarning = `${item.name}: need ${parsedQty}, available ${availableStock}`
        }
      }
    }

    const [newItem] = await db.insert(insuranceEstimateItems).values({
      tenantId: session.user.tenantId,
      estimateId,
      itemType: itemType as 'service' | 'part',
      serviceTypeId: serviceTypeId || null,
      description: description || null,
      hours: hours ? String(hours) : null,
      rate: rate ? String(rate) : null,
      itemId: itemId || null,
      partName: partName || null,
      quantity: quantity ? String(quantity) : null,
      unitPrice: unitPrice ? String(unitPrice) : null,
      originalAmount: String(amount),
      status: 'pending',
      sortOrder: nextSortOrder,
    }).returning()

    await recalculateEstimateTotals(db, estimateId, session.user.tenantId)

    const [updatedEstimate] = await db
      .select({ updatedAt: insuranceEstimates.updatedAt })
      .from(insuranceEstimates)
      .where(eq(insuranceEstimates.id, estimateId))

    // Broadcast only (no activity log - parent save logs all changes)
    logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId, { userId: session.user.id })

    const responseData = { ...newItem, estimateUpdatedAt: updatedEstimate?.updatedAt }
    if (stockWarning) {
      return { data: { ...responseData, stockWarning } }
    }
    return { data: responseData }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// PUT update item in estimate
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data

  const parsed = await validateBody(request, updateEstimateItemSchema)
  if (!parsed.success) return parsed.response
  const { itemId: estimateItemId, description, hours, rate, partName, quantity, unitPrice, status, approvedAmount, rejectionReason, assessorNotes, expectedUpdatedAt } = parsed.data as {
    itemId: string; description?: string; hours?: string; rate?: string; partName?: string
    quantity?: string; unitPrice?: string; status?: string; approvedAmount?: string
    rejectionReason?: string; assessorNotes?: string; expectedUpdatedAt?: string
  }

  // Pre-validate numeric fields
  if (hours !== undefined && hours !== null && hours !== '') {
    const parsedHours = parseFloat(hours)
    if (isNaN(parsedHours) || parsedHours <= 0) {
      return NextResponse.json({ error: 'Hours must be a positive number' }, { status: 400 })
    }
  }
  if (rate !== undefined && rate !== null && rate !== '') {
    const parsedRate = parseFloat(rate)
    if (isNaN(parsedRate) || parsedRate < 0) {
      return NextResponse.json({ error: 'Rate must be a non-negative number' }, { status: 400 })
    }
  }
  if (quantity !== undefined && quantity !== null && quantity !== '') {
    const parsedQuantity = parseFloat(quantity)
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 })
    }
  }
  if (unitPrice !== undefined && unitPrice !== null && unitPrice !== '') {
    const parsedUnitPrice = parseFloat(unitPrice)
    if (isNaN(parsedUnitPrice) || parsedUnitPrice < 0) {
      return NextResponse.json({ error: 'Unit price must be a non-negative number' }, { status: 400 })
    }
  }

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return { error: permError }

    const estimate = await db.query.insuranceEstimates.findFirst({
      where: eq(insuranceEstimates.id, estimateId),
    })

    if (!estimate) {
      return { error: NextResponse.json({ error: 'Estimate not found' }, { status: 404 }) }
    }

    // Issue #56: Optimistic locking - check parent estimate hasn't been modified
    if (expectedUpdatedAt) {
      const clientTime = new Date(expectedUpdatedAt).getTime()
      const serverTime = estimate.updatedAt ? new Date(estimate.updatedAt).getTime() : 0
      if (serverTime > clientTime) {
        return { error: NextResponse.json({ error: 'This estimate was modified by another user. Please refresh and try again.', code: 'CONFLICT' }, { status: 409 }) }
      }
    }

    const currentItem = await db.query.insuranceEstimateItems.findFirst({
      where: and(
        eq(insuranceEstimateItems.id, estimateItemId),
        eq(insuranceEstimateItems.estimateId, estimateId)
      ),
    })

    if (!currentItem) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    // Prevent editing converted items
    if (currentItem.convertedToWorkOrderId) {
      const linkedWorkOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, currentItem.convertedToWorkOrderId),
      })
      if (linkedWorkOrder && linkedWorkOrder.status !== 'cancelled') {
        return { error: NextResponse.json({
          error: 'Cannot edit item converted to active work order',
          code: 'CONVERTED_ITEM'
        }, { status: 400 }) }
      }
    }

    const updateData: Record<string, unknown> = {}

    if (['draft', 'rejected', 'partially_approved'].includes(estimate.status)) {
      if (description !== undefined) updateData.description = description || null
      if (hours !== undefined) updateData.hours = hours ? String(hours) : null
      if (rate !== undefined) updateData.rate = rate ? String(rate) : null
      if (partName !== undefined) updateData.partName = partName || null

      // Stock validation for quantity changes
      if (quantity !== undefined && currentItem.itemType === 'part' && currentItem.itemId && estimate.holdStock) {
        const partItem = await db.query.items.findFirst({
          where: eq(items.id, currentItem.itemId),
        })
        if (partItem && partItem.trackStock) {
          const newQty = parseFloat(quantity)
          const currentQty = parseFloat(currentItem.quantity || '0')
          // Issue #53: Exclude current estimate's reservations to avoid double-counting
        const availableStock = await getAvailableStock(db, currentItem.itemId, estimate.warehouseId, estimateId)
          const adjustedAvailable = availableStock + currentQty
          if (newQty > adjustedAvailable) {
            return { error: NextResponse.json({
              error: `Insufficient stock. Available: ${adjustedAvailable.toFixed(0)}`,
              code: 'INSUFFICIENT_STOCK'
            }, { status: 400 }) }
          }
        }
      }

      if (quantity !== undefined) updateData.quantity = quantity ? String(quantity) : null
      if (unitPrice !== undefined) updateData.unitPrice = unitPrice ? String(unitPrice) : null

      // Recalculate amounts
      if (currentItem.itemType === 'service' && (hours !== undefined || rate !== undefined)) {
        const newHours = hours !== undefined ? parseFloat(hours) : parseFloat(currentItem.hours || '0')
        const newRate = rate !== undefined ? parseFloat(rate) : parseFloat(currentItem.rate || '0')
        updateData.originalAmount = String(newHours * newRate)
      }
      if (currentItem.itemType === 'part' && (quantity !== undefined || unitPrice !== undefined)) {
        const newQuantity = quantity !== undefined ? parseFloat(quantity) : parseFloat(currentItem.quantity || '0')
        const newUnitPrice = unitPrice !== undefined ? parseFloat(unitPrice) : parseFloat(currentItem.unitPrice || '0')
        updateData.originalAmount = String(newQuantity * newUnitPrice)
      }
    }

    // Approval fields
    const canUpdateApprovalFields = estimate.status === 'under_review' ||
      (['approved', 'partially_approved', 'rejected'].includes(estimate.status) &&
        ['pending', 'requires_reinspection', 'price_adjusted'].includes(currentItem.status))

    if (canUpdateApprovalFields) {
      if (status !== undefined) {
        const validStatuses = ['pending', 'approved', 'price_adjusted', 'rejected', 'requires_reinspection']
        if (!validStatuses.includes(status)) {
          return { error: NextResponse.json({ error: 'Invalid item status' }, { status: 400 }) }
        }
        updateData.status = status
        if (['approved', 'price_adjusted'].includes(status) && approvedAmount === undefined && !currentItem.approvedAmount) {
          updateData.approvedAmount = currentItem.originalAmount
        }
      }
      if (approvedAmount !== undefined) updateData.approvedAmount = approvedAmount ? String(approvedAmount) : null
      if (rejectionReason !== undefined) updateData.rejectionReason = rejectionReason || null
      if (assessorNotes !== undefined) updateData.assessorNotes = assessorNotes || null
    } else if (status !== undefined || approvedAmount !== undefined) {
      return { error: NextResponse.json({ error: 'Cannot update approval fields in current status' }, { status: 400 }) }
    }

    if (Object.keys(updateData).length === 0) {
      return { error: NextResponse.json({ error: 'No valid fields to update' }, { status: 400 }) }
    }

    const [updated] = await db.update(insuranceEstimateItems)
      .set(updateData)
      .where(and(
        eq(insuranceEstimateItems.id, estimateItemId),
        eq(insuranceEstimateItems.estimateId, estimateId)
      ))
      .returning()

    if (!updated) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    await recalculateEstimateTotals(db, estimateId, session.user.tenantId)

    const [updatedEstimate] = await db
      .select({ updatedAt: insuranceEstimates.updatedAt })
      .from(insuranceEstimates)
      .where(eq(insuranceEstimates.id, estimateId))

    // Broadcast only (no activity log - parent save logs all changes)
    logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId, { userId: session.user.id })

    return { data: { ...updated, estimateUpdatedAt: updatedEstimate?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// DELETE remove item from estimate
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data
  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('itemId')

  if (!itemId) {
    return NextResponse.json({ error: 'Item ID is required' }, { status: 400 })
  }

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return { error: permError }

    const estimate = await db.query.insuranceEstimates.findFirst({
      where: eq(insuranceEstimates.id, estimateId),
    })

    if (!estimate) {
      return { error: NextResponse.json({ error: 'Estimate not found' }, { status: 404 }) }
    }

    if (!['draft', 'rejected', 'partially_approved'].includes(estimate.status)) {
      return { error: NextResponse.json({ error: 'Cannot modify estimate in current status' }, { status: 400 }) }
    }

    const itemToDelete = await db.query.insuranceEstimateItems.findFirst({
      where: and(
        eq(insuranceEstimateItems.id, itemId),
        eq(insuranceEstimateItems.estimateId, estimateId)
      ),
    })

    if (!itemToDelete) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    // Issue #57: Ensure at least 1 item remains after deletion
    const [{ count: itemCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(insuranceEstimateItems)
      .where(eq(insuranceEstimateItems.estimateId, estimateId))
    if (Number(itemCount) <= 1) {
      return { error: NextResponse.json({ error: 'Cannot delete the last item. Estimates must have at least one item.' }, { status: 400 }) }
    }

    if (itemToDelete.convertedToWorkOrderId) {
      const linkedWorkOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, itemToDelete.convertedToWorkOrderId),
      })
      if (linkedWorkOrder && linkedWorkOrder.status !== 'cancelled') {
        return { error: NextResponse.json({
          error: 'Cannot delete item converted to active work order',
          code: 'CONVERTED_ITEM'
        }, { status: 400 }) }
      }
    }

    const [deleted] = await db.delete(insuranceEstimateItems)
      .where(and(
        eq(insuranceEstimateItems.id, itemId),
        eq(insuranceEstimateItems.estimateId, estimateId)
      ))
      .returning()

    if (!deleted) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    await recalculateEstimateTotals(db, estimateId, session.user.tenantId)

    const [updatedEstimate] = await db
      .select({ updatedAt: insuranceEstimates.updatedAt })
      .from(insuranceEstimates)
      .where(eq(insuranceEstimates.id, estimateId))

    // Broadcast only (no activity log - parent save logs all changes)
    logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId, { userId: session.user.id })

    return { data: { success: true, estimateUpdatedAt: updatedEstimate?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
