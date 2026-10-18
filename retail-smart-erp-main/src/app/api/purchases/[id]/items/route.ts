import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, TenantDb } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchases, purchaseItems, items as itemsTable } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addPurchaseItemSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Recalculate and update purchase totals (dual mode: template or manual flat tax)
async function recalculateTotals(db: TenantDb, tenantId: string, purchaseId: string) {
  const items = await db
    .select({
      itemId: purchaseItems.itemId,
      quantity: purchaseItems.quantity,
      unitPrice: purchaseItems.unitPrice,
      tax: purchaseItems.tax,
    })
    .from(purchaseItems)
    .where(eq(purchaseItems.purchaseId, purchaseId))

  // Try template-based tax calculation
  const lineItems = items.map(item => ({
    itemId: item.itemId,
    lineTotal: parseFloat(item.quantity) * parseFloat(item.unitPrice),
  }))
  const taxResult = await recalculateDocumentTax(db, tenantId, lineItems, { type: 'purchase' })

  if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
    // Template configured — use computed values
    await db.update(purchases)
      .set({
        subtotal: taxResult.subtotal.toString(),
        taxAmount: taxResult.totalTax.toString(),
        taxBreakdown: taxResult.taxBreakdown,
        total: taxResult.total.toString(),
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, purchaseId))
  } else {
    // No template — use manual flat tax from items
    let subtotal = 0
    let taxAmount = 0
    items.forEach(item => {
      subtotal += parseFloat(item.quantity) * parseFloat(item.unitPrice)
      taxAmount += parseFloat(item.tax)
    })
    subtotal = Math.round(subtotal * 100) / 100
    taxAmount = Math.round(taxAmount * 100) / 100

    await db.update(purchases)
      .set({
        subtotal: subtotal.toString(),
        taxAmount: taxAmount.toString(),
        taxBreakdown: null,
        total: (Math.round((subtotal + taxAmount) * 100) / 100).toString(),
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, purchaseId))
  }
}

// GET items for a purchase
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    // Verify purchase exists (RLS filters by tenant)
    const [purchase] = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.id, id))

    if (!purchase) {
      return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
    }

    // Get items
    const items = await db
      .select({
        id: purchaseItems.id,
        itemId: purchaseItems.itemId,
        itemName: purchaseItems.itemName,
        itemSku: itemsTable.sku,
        itemBarcode: itemsTable.barcode,
        itemOemPartNumber: itemsTable.oemPartNumber,
        itemPluCode: itemsTable.pluCode,
        quantity: purchaseItems.quantity,
        unitPrice: purchaseItems.unitPrice,
        tax: purchaseItems.tax,
        total: purchaseItems.total,
      })
      .from(purchaseItems)
      .leftJoin(itemsTable, eq(purchaseItems.itemId, itemsTable.id))
      .where(eq(purchaseItems.purchaseId, id))

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

// POST add item to purchase
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

    // Verify purchase exists and is editable (RLS filters by tenant)
    const [purchase] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, id))

    if (!purchase) {
      return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
    }

    if (purchase.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Items can only be added to draft purchases' }, { status: 400 }) }
    }

    const itemTax = Math.max(0, tax || 0)
    const itemTotal = Math.round((quantity * unitPrice + itemTax) * 100) / 100

    // Check for existing item with same itemId/name and price
    let existingItem: (typeof purchaseItems.$inferSelect)[] = []
    if (itemId) {
      existingItem = await db
        .select()
        .from(purchaseItems)
        .where(and(
          eq(purchaseItems.purchaseId, id),
          eq(purchaseItems.itemId, itemId),
          eq(purchaseItems.unitPrice, unitPrice.toString())
        ))
        .limit(1)
    } else {
      existingItem = await db
        .select()
        .from(purchaseItems)
        .where(and(
          eq(purchaseItems.purchaseId, id),
          isNull(purchaseItems.itemId),
          eq(purchaseItems.itemName, itemName),
          eq(purchaseItems.unitPrice, unitPrice.toString())
        ))
        .limit(1)
    }

    if (existingItem.length > 0) {
      // Fix #19: Quantity uses 3 decimals (for fractional units like kg/litre), currency uses 2 decimals
      const newQuantity = Math.round((parseFloat(existingItem[0].quantity) + quantity) * 1000) / 1000
      const newTax = Math.round((parseFloat(existingItem[0].tax) + itemTax) * 100) / 100
      const newTotal = Math.round((newQuantity * unitPrice + newTax) * 100) / 100

      await db.update(purchaseItems)
        .set({
          quantity: newQuantity.toString(),
          tax: newTax.toString(),
          total: newTotal.toString(),
        })
        .where(eq(purchaseItems.id, existingItem[0].id))
    } else {
      await db.insert(purchaseItems).values({
        tenantId: session.user.tenantId,
        purchaseId: id,
        itemId: itemId || null,
        itemName,
        quantity: quantity.toString(),
        unitPrice: unitPrice.toString(),
        tax: itemTax.toString(),
        total: itemTotal.toString(),
      })
    }

    await recalculateTotals(db, session.user.tenantId, id)

    const [updatedPurchase] = await db
      .select({ updatedAt: purchases.updatedAt })
      .from(purchases)
      .where(eq(purchases.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase', 'updated', id, { userId: session.user.id })

    return { data: { success: true, purchaseUpdatedAt: updatedPurchase?.updatedAt } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
