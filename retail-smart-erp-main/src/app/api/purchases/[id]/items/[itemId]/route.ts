import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { purchases, purchaseItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePurchaseItemSchema } from '@/lib/validation/schemas/purchases'
import { z } from 'zod'

// PUT update item in purchase
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'managePurchases')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), itemId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id, itemId } = paramsParsed.data
    const parsed = await validateBody(request, updatePurchaseItemSchema)
    if (!parsed.success) return parsed.response
    const { quantity, unitPrice, tax } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify purchase exists and is editable (RLS scopes to tenant)
      const [purchase] = await db
        .select()
        .from(purchases)
        .where(eq(purchases.id, id))

      if (!purchase) {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
      }

      if (purchase.status !== 'draft') {
        return NextResponse.json({ error: 'Items can only be edited on draft purchases' }, { status: 400 })
      }

      // Verify item exists
      const [existingItem] = await db
        .select()
        .from(purchaseItems)
        .where(and(
          eq(purchaseItems.id, itemId),
          eq(purchaseItems.purchaseId, id)
        ))

      if (!existingItem) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Build update data
      const updateData: Record<string, string> = {}

      if (quantity !== undefined) {
        if (quantity <= 0) {
          return NextResponse.json({ error: 'Quantity must be greater than 0' }, { status: 400 })
        }
        updateData.quantity = quantity.toString()
      }

      if (unitPrice !== undefined) {
        if (unitPrice < 0) {
          return NextResponse.json({ error: 'Unit price cannot be negative' }, { status: 400 })
        }
        updateData.unitPrice = unitPrice.toString()
      }

      if (tax !== undefined) {
        updateData.tax = tax.toString()
      }

      // Calculate new total
      const newQuantity = quantity !== undefined ? quantity : parseFloat(existingItem.quantity)
      const newUnitPrice = unitPrice !== undefined ? unitPrice : parseFloat(existingItem.unitPrice)
      const newTax = tax !== undefined ? tax : parseFloat(existingItem.tax)
      updateData.total = roundCurrency(newQuantity * newUnitPrice + newTax).toString()

      const [updated] = await db.update(purchaseItems)
        .set(updateData)
        .where(eq(purchaseItems.id, itemId))
        .returning()

      // Recalculate totals
      const items = await db
        .select({
          total: purchaseItems.total,
          tax: purchaseItems.tax,
        })
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, id))

      let subtotal = 0
      let taxAmount = 0

      // Fix #10: Round purchase totals properly
      items.forEach(item => {
        const itemTotal = parseFloat(item.total) - parseFloat(item.tax)
        subtotal += itemTotal
        taxAmount += parseFloat(item.tax)
      })
      subtotal = Math.round(subtotal * 100) / 100
      taxAmount = Math.round(taxAmount * 100) / 100
      const purchaseTotal = Math.round((subtotal + taxAmount) * 100) / 100

      await db.update(purchases)
        .set({
          subtotal: subtotal.toString(),
          taxAmount: taxAmount.toString(),
          total: purchaseTotal.toString(),
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, id))

      // Get the updated purchase's updatedAt to prevent client conflicts
      const [updatedPurchase] = await db
        .select({ updatedAt: purchases.updatedAt })
        .from(purchases)
        .where(eq(purchases.id, id))

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'purchase', 'updated', id, { userId: session.user.id })

      return NextResponse.json({ ...updated, purchaseUpdatedAt: updatedPurchase?.updatedAt })
    })
  } catch (error) {
    logError('api/purchases/[id]/items/[itemId]', error)
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
}

// DELETE remove item from purchase
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'managePurchases')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), itemId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id, itemId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify purchase exists and is editable (RLS scopes to tenant)
      const [purchase] = await db
        .select()
        .from(purchases)
        .where(eq(purchases.id, id))

      if (!purchase) {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
      }

      if (purchase.status !== 'draft') {
        return NextResponse.json({ error: 'Items can only be removed from draft purchases' }, { status: 400 })
      }

      // Delete item
      const [deleted] = await db.delete(purchaseItems)
        .where(and(
          eq(purchaseItems.id, itemId),
          eq(purchaseItems.purchaseId, id)
        ))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Recalculate totals
      const items = await db
        .select({
          total: purchaseItems.total,
          tax: purchaseItems.tax,
        })
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, id))

      let subtotal = 0
      let taxAmount = 0

      // Fix #10: Round purchase totals properly
      items.forEach(item => {
        const itemTotal = parseFloat(item.total) - parseFloat(item.tax)
        subtotal += itemTotal
        taxAmount += parseFloat(item.tax)
      })
      subtotal = Math.round(subtotal * 100) / 100
      taxAmount = Math.round(taxAmount * 100) / 100
      const purchaseTotal = Math.round((subtotal + taxAmount) * 100) / 100

      await db.update(purchases)
        .set({
          subtotal: subtotal.toString(),
          taxAmount: taxAmount.toString(),
          total: purchaseTotal.toString(),
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, id))

      // Get the updated purchase's updatedAt to prevent client conflicts
      const [updatedPurchase] = await db
        .select({ updatedAt: purchases.updatedAt })
        .from(purchases)
        .where(eq(purchases.id, id))

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'purchase', 'updated', id, { userId: session.user.id })

      return NextResponse.json({ success: true, purchaseUpdatedAt: updatedPurchase?.updatedAt })
    })
  } catch (error) {
    logError('api/purchases/[id]/items/[itemId]', error)
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
