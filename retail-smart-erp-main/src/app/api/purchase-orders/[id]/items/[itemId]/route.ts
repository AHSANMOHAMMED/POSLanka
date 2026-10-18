import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, TenantDb } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseOrders, purchaseOrderItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePurchaseOrderItemSchema } from '@/lib/validation/schemas/purchases'
import { z } from 'zod'

// Recalculate and update purchase order totals
async function recalculateTotals(db: TenantDb, purchaseOrderId: string) {
  const items = await db
    .select({
      total: purchaseOrderItems.total,
      tax: purchaseOrderItems.tax,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId))

  let subtotal = 0
  let taxAmount = 0

  items.forEach(item => {
    const itemTotal = parseCurrency(item.total) - parseCurrency(item.tax)
    subtotal += itemTotal
    taxAmount += parseCurrency(item.tax)
  })

  subtotal = roundCurrency(subtotal)
  taxAmount = roundCurrency(taxAmount)
  const total = roundCurrency(subtotal + taxAmount)

  await db.update(purchaseOrders)
    .set({
      subtotal: subtotal.toString(),
      taxAmount: taxAmount.toString(),
      total: total.toString(),
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, purchaseOrderId))
}

// PUT update item in purchase order
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), itemId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id, itemId } = paramsParsed.data

  const parsed = await validateBody(request, updatePurchaseOrderItemSchema)
  if (!parsed.success) return parsed.response
  const { quantity, unitPrice, tax } = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Verify purchase order exists and is editable (RLS filters by tenant)
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    if (!order) {
      return { error: NextResponse.json({ error: 'Purchase order not found' }, { status: 404 }) }
    }

    if (order.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Items can only be edited on draft orders' }, { status: 400 }) }
    }

    // Verify item exists
    const [existingItem] = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.id, itemId))

    if (!existingItem || existingItem.purchaseOrderId !== id) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    // Build update data
    const updateData: Record<string, string> = {}

    if (quantity !== undefined) {
      if (quantity <= 0) {
        return { error: NextResponse.json({ error: 'Quantity must be greater than 0' }, { status: 400 }) }
      }
      updateData.quantity = quantity.toString()
    }

    if (unitPrice !== undefined) {
      if (unitPrice < 0) {
        return { error: NextResponse.json({ error: 'Unit price cannot be negative' }, { status: 400 }) }
      }
      updateData.unitPrice = unitPrice.toString()
    }

    if (tax !== undefined) {
      updateData.tax = tax.toString()
    }

    // Calculate new total
    const newQuantity = quantity !== undefined ? quantity : parseCurrency(existingItem.quantity)
    const newUnitPrice = unitPrice !== undefined ? unitPrice : parseCurrency(existingItem.unitPrice)
    const newTax = tax !== undefined ? tax : parseCurrency(existingItem.tax)
    updateData.total = roundCurrency(newQuantity * newUnitPrice + newTax).toString()

    const [updated] = await db.update(purchaseOrderItems)
      .set(updateData)
      .where(eq(purchaseOrderItems.id, itemId))
      .returning()

    await recalculateTotals(db, id)

    const [updatedOrder] = await db
      .select({ updatedAt: purchaseOrders.updatedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase-order', 'updated', id, { userId: session.user.id })

    return { data: { ...updated, orderUpdatedAt: updatedOrder?.updatedAt } }
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
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), itemId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id, itemId } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Verify purchase order exists and is editable (RLS filters by tenant)
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

    // Delete item
    const [deleted] = await db.delete(purchaseOrderItems)
      .where(and(
        eq(purchaseOrderItems.id, itemId),
        eq(purchaseOrderItems.purchaseOrderId, id)
      ))
      .returning()

    if (!deleted) {
      return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
    }

    await recalculateTotals(db, id)

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
