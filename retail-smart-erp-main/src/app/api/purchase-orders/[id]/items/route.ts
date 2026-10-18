import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, TenantDb } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseOrders, purchaseOrderItems, items as itemsTable } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addPurchaseItemSchema, updatePurchaseOrderItemSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Recalculate and update purchase order totals (dual mode: template or manual flat tax)
async function recalculateTotals(db: TenantDb, tenantId: string, purchaseOrderId: string) {
  const items = await db
    .select({
      itemId: purchaseOrderItems.itemId,
      quantity: purchaseOrderItems.quantity,
      unitPrice: purchaseOrderItems.unitPrice,
      tax: purchaseOrderItems.tax,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId))

  // Try template-based tax calculation
  const lineItems = items.map(item => ({
    itemId: item.itemId,
    lineTotal: parseCurrency(item.quantity) * parseCurrency(item.unitPrice),
  }))
  const taxResult = await recalculateDocumentTax(db, tenantId, lineItems, { type: 'purchase' })

  if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
    // Template configured — use computed values
    await db.update(purchaseOrders)
      .set({
        subtotal: taxResult.subtotal.toString(),
        taxAmount: taxResult.totalTax.toString(),
        taxBreakdown: taxResult.taxBreakdown,
        total: taxResult.total.toString(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, purchaseOrderId))
  } else {
    // No template — use manual flat tax from items
    let subtotal = 0
    let taxAmount = 0
    items.forEach(item => {
      subtotal += parseCurrency(item.quantity) * parseCurrency(item.unitPrice)
      taxAmount += parseCurrency(item.tax)
    })
    subtotal = roundCurrency(subtotal)
    taxAmount = roundCurrency(taxAmount)
    const total = roundCurrency(subtotal + taxAmount)

    await db.update(purchaseOrders)
      .set({
        subtotal: subtotal.toString(),
        taxAmount: taxAmount.toString(),
        taxBreakdown: null,
        total: total.toString(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, purchaseOrderId))
  }
}

// GET items for a purchase order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [order] = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    if (!order) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    const items = await db
      .select({
        id: purchaseOrderItems.id,
        itemId: purchaseOrderItems.itemId,
        itemName: purchaseOrderItems.itemName,
        itemSku: itemsTable.sku,
        itemBarcode: itemsTable.barcode,
        itemOemPartNumber: itemsTable.oemPartNumber,
        itemPluCode: itemsTable.pluCode,
        quantity: purchaseOrderItems.quantity,
        receivedQuantity: purchaseOrderItems.receivedQuantity,
        unitPrice: purchaseOrderItems.unitPrice,
        tax: purchaseOrderItems.tax,
        total: purchaseOrderItems.total,
      })
      .from(purchaseOrderItems)
      .leftJoin(itemsTable, eq(purchaseOrderItems.itemId, itemsTable.id))
      .where(eq(purchaseOrderItems.purchaseOrderId, id))

    return { data: items }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// POST add item to purchase order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, addPurchaseItemSchema)
  if (!parsed.success) return parsed.response
  const { itemId, itemName, quantity, unitPrice, tax } = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    if (!order) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    if (order.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Items can only be added to draft orders' }, { status: 400 }) }
    }

    const itemTax = Math.max(0, tax || 0)
    const itemTotal = roundCurrency(quantity * unitPrice + itemTax)

    // Check for existing item with same itemId/name and price
    let existingItem: (typeof purchaseOrderItems.$inferSelect)[] = []
    if (itemId) {
      existingItem = await db
        .select()
        .from(purchaseOrderItems)
        .where(and(
          eq(purchaseOrderItems.purchaseOrderId, id),
          eq(purchaseOrderItems.itemId, itemId),
          eq(purchaseOrderItems.unitPrice, unitPrice.toString())
        ))
        .limit(1)
    } else {
      existingItem = await db
        .select()
        .from(purchaseOrderItems)
        .where(and(
          eq(purchaseOrderItems.purchaseOrderId, id),
          isNull(purchaseOrderItems.itemId),
          eq(purchaseOrderItems.itemName, itemName),
          eq(purchaseOrderItems.unitPrice, unitPrice.toString())
        ))
        .limit(1)
    }

    if (existingItem.length > 0) {
      const newQuantity = roundCurrency(parseCurrency(existingItem[0].quantity) + quantity)
      const newTax = roundCurrency(parseCurrency(existingItem[0].tax) + itemTax)
      const newTotal = roundCurrency(newQuantity * unitPrice + newTax)

      await db.update(purchaseOrderItems)
        .set({
          quantity: newQuantity.toString(),
          tax: newTax.toString(),
          total: newTotal.toString(),
        })
        .where(eq(purchaseOrderItems.id, existingItem[0].id))
    } else {
      await db.insert(purchaseOrderItems).values({
        tenantId: session.user.tenantId,
        purchaseOrderId: id,
        itemId: itemId || null,
        itemName,
        quantity: quantity.toString(),
        unitPrice: unitPrice.toString(),
        tax: itemTax.toString(),
        total: itemTotal.toString(),
      })
    }

    await recalculateTotals(db, session.user.tenantId, id)

    const [updatedOrder] = await db
      .select({ updatedAt: purchaseOrders.updatedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', id, { userId: session.user.id })

    return { data: { success: true, orderUpdatedAt: updatedOrder?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// PUT update item in purchase order
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updatePurchaseOrderItemSchema)
  if (!parsed.success) return parsed.response
  const { itemId: poItemId, quantity, unitPrice, tax } = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    if (!order) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    if (order.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Items can only be modified on draft orders' }, { status: 400 }) }
    }

    if (!poItemId) {
      return { error: NextResponse.json({ error: 'Item ID is required' }, { status: 400 }) }
    }

    const currentItem = await db.query.purchaseOrderItems.findFirst({
      where: and(
        eq(purchaseOrderItems.id, poItemId),
        eq(purchaseOrderItems.purchaseOrderId, id)
      ),
    })

    if (!currentItem) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    const newQty = quantity !== undefined ? quantity : parseCurrency(currentItem.quantity)
    const newPrice = unitPrice !== undefined ? unitPrice : parseCurrency(currentItem.unitPrice)
    const newTax = tax !== undefined ? Math.max(0, tax) : parseCurrency(currentItem.tax)
    const newTotal = roundCurrency(newQty * newPrice + newTax)

    await db.update(purchaseOrderItems)
      .set({
        quantity: newQty.toString(),
        unitPrice: newPrice.toString(),
        tax: newTax.toString(),
        total: newTotal.toString(),
      })
      .where(eq(purchaseOrderItems.id, poItemId))

    await recalculateTotals(db, session.user.tenantId, id)

    const [updatedOrder] = await db
      .select({ updatedAt: purchaseOrders.updatedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', id, { userId: session.user.id })

    return { data: { success: true, orderUpdatedAt: updatedOrder?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// DELETE remove item from purchase order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('itemId')

  if (!itemId) {
    return NextResponse.json({ error: 'Item ID is required' }, { status: 400 })
  }

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    if (!order) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    if (order.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Items can only be removed from draft orders' }, { status: 400 }) }
    }

    const [deleted] = await db.delete(purchaseOrderItems)
      .where(and(
        eq(purchaseOrderItems.id, itemId),
        eq(purchaseOrderItems.purchaseOrderId, id)
      ))
      .returning()

    if (!deleted) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    await recalculateTotals(db, session.user.tenantId, id)

    const [updatedOrder] = await db
      .select({ updatedAt: purchaseOrders.updatedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', id, { userId: session.user.id })

    return { data: { success: true, orderUpdatedAt: updatedOrder?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
