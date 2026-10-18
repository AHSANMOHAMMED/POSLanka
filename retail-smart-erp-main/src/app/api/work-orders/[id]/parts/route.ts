import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { workOrderParts, workOrders, items, heldSales, insuranceEstimates, insuranceEstimateItems, warehouseStock, stockTransfers, stockTransferItems } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { calculateItemTax, aggregateTaxBreakdown } from '@/lib/utils/tax-template'
import { resolveTaxTemplatesForItems, getDefaultTaxTemplate, getEffectiveTaxTemplate } from '@/lib/utils/tax-template-resolver'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addWorkOrderPartSchema, updateWorkOrderPartSchema } from '@/lib/validation/schemas/work-orders'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Helper function to get available stock for a specific warehouse
async function getAvailableStock(db: TenantDb, itemId: string, tenantId: string, warehouseId: string | null, excludeWorkOrderId?: string) {
  const item = await db.query.items.findFirst({
    where: eq(items.id, itemId),
  })

  if (!item) return 0

  let totalReserved = 0

  // 1. Reserved from non-invoiced/non-cancelled work orders in the SAME warehouse (excluding current work order if updating)
  const workOrderReservedWhere = warehouseId
    ? and(
        eq(workOrderParts.itemId, itemId),
        sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`,
        eq(workOrders.warehouseId, warehouseId),
        excludeWorkOrderId ? sql`${workOrders.id} != ${excludeWorkOrderId}` : sql`1=1`
      )
    : and(
        eq(workOrderParts.itemId, itemId),
        sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress', 'completed')`,
        excludeWorkOrderId ? sql`${workOrders.id} != ${excludeWorkOrderId}` : sql`1=1`
      )

  const reservedFromWorkOrders = await db
    .select({
      reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
    })
    .from(workOrderParts)
    .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
    .where(workOrderReservedWhere)
  totalReserved += parseFloat(reservedFromWorkOrders[0]?.reservedQty || '0')

  // 2. Reserved from non-expired held sales in the SAME warehouse (JSONB cart items)
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

  // 3. Reserved from estimates with holdStock enabled in the SAME warehouse
  const estimatesReservedWhere = warehouseId
    ? and(
        eq(insuranceEstimateItems.itemId, itemId),
        eq(insuranceEstimates.holdStock, true),
        eq(insuranceEstimates.warehouseId, warehouseId),
        sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
        sql`${insuranceEstimateItems.itemId} IS NOT NULL`
      )
    : and(
        eq(insuranceEstimateItems.itemId, itemId),
        eq(insuranceEstimates.holdStock, true),
        sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
        sql`${insuranceEstimateItems.itemId} IS NOT NULL`
      )

  const reservedFromEstimates = await db
    .select({
      reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
    })
    .from(insuranceEstimateItems)
    .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
    .where(estimatesReservedWhere)
  totalReserved += parseFloat(reservedFromEstimates[0]?.reservedQty || '0')

  // 4. Reserved from outbound stock transfers (approved/in_transit) from this warehouse
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

  // Get stock from specific warehouse (or aggregated if no warehouse specified)
  // Use FOR UPDATE lock when inside a transaction to prevent concurrent over-reservation
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
      .for('update')
    current = parseFloat(stockData?.totalStock || '0')
  } else {
    // Aggregate across all warehouses (fallback for work orders without warehouse)
    const [stockData] = await db
      .select({
        totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
      })
      .from(warehouseStock)
      .where(eq(warehouseStock.itemId, itemId))
      .for('update')
    current = parseFloat(stockData?.totalStock || '0')
  }

  return Math.max(0, current - totalReserved)
}

// Helper function to recalculate work order totals (optimized - single query)
async function recalculateWorkOrderTotals(db: TenantDb, workOrderId: string, tenantId: string) {
  // Get line-level data for per-item tax calculation
  const parts = await db.query.workOrderParts.findMany({
    where: eq(workOrderParts.workOrderId, workOrderId),
    columns: { itemId: true, total: true },
  })

  const [servicesResult] = await db
    .select({
      servicesTotal: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL)), 0)`,
    })
    .from(sql`work_order_services`)
    .where(sql`work_order_id = ${workOrderId} AND tenant_id = ${tenantId}`)

  const servicesTotal = parseFloat(servicesResult?.servicesTotal || '0')
  const partsTotal = roundCurrency(parts.reduce((s, p) => s + parseFloat(p.total), 0))
  const subtotal = roundCurrency(servicesTotal + partsTotal)

  // Per-item tax calculation using tax templates
  const defaultTemplate = await getDefaultTaxTemplate(db, tenantId)
  const partItemIds = parts.map(p => p.itemId).filter(Boolean)
  const itemTemplateMap = partItemIds.length > 0
    ? await resolveTaxTemplatesForItems(db, partItemIds)
    : new Map()

  const allBreakdowns = []
  let totalTax = 0

  // Tax on parts (per-item template)
  for (const part of parts) {
    const lineTotal = parseFloat(part.total)
    if (lineTotal <= 0) continue
    const template = getEffectiveTaxTemplate(itemTemplateMap, part.itemId, defaultTemplate)
    const taxResult = calculateItemTax(lineTotal, template)
    totalTax += taxResult.totalTax
    if (taxResult.breakdown.length > 0) allBreakdowns.push(taxResult.breakdown)
  }

  // Tax on services (default template only — services have no itemId)
  if (servicesTotal > 0) {
    const taxResult = calculateItemTax(servicesTotal, defaultTemplate)
    totalTax += taxResult.totalTax
    if (taxResult.breakdown.length > 0) allBreakdowns.push(taxResult.breakdown)
  }

  totalTax = roundCurrency(totalTax)
  const taxBreakdown = allBreakdowns.length > 0 ? aggregateTaxBreakdown(allBreakdowns) : null

  // Determine total: inclusive tax is already in subtotal, only add exclusive
  const exclusiveTax = roundCurrency(
    (taxBreakdown || []).filter(b => !b.includedInPrice).reduce((s, b) => s + b.amount, 0)
  )
  const total = roundCurrency(subtotal + exclusiveTax)

  await db.update(workOrders)
    .set({
      subtotal: String(subtotal),
      taxAmount: String(totalTax),
      taxBreakdown: taxBreakdown,
      total: String(total),
      updatedAt: new Date(),
    })
    .where(eq(workOrders.id, workOrderId))
}

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

    // Check stock if tracked
    if (item.trackStock && workOrder.warehouseId) {
      const availableStock = await getAvailableStock(db, itemId, session.user.tenantId, workOrder.warehouseId, workOrderId)
      if (parsedQuantity > availableStock) {
        return { error: NextResponse.json({
          error: `Insufficient stock. Available: ${availableStock.toFixed(0)}`
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

    // Check stock for increased quantity
    const currentQty = parseFloat(currentPart.quantity)
    if (parsedQuantity > currentQty && currentPart.itemId) {
      const additionalNeeded = parsedQuantity - currentQty
      const availableStock = await getAvailableStock(db, currentPart.itemId, session.user.tenantId, workOrder.warehouseId, workOrderId)
      if (additionalNeeded > availableStock) {
        return { error: NextResponse.json({
          error: `Insufficient stock. Available: ${availableStock.toFixed(0)}`
        }, { status: 400 }) }
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
