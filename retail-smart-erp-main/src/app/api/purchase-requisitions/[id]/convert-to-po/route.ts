import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseRequisitions, purchaseRequisitionItems, purchaseOrders, purchaseOrderItems, suppliers } from '@/lib/db/schema'
import { eq, ilike, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { convertRequisitionToPOSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

async function generateOrderNo(tx: TenantDb): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `PO-${dateStr}-`

  const existing = await tx
    .select({ orderNo: purchaseOrders.orderNo })
    .from(purchaseOrders)
    .where(ilike(purchaseOrders.orderNo, `${prefix}%`))
    .orderBy(desc(purchaseOrders.orderNo))
    .limit(1)
    .for('update')

  let nextNum = 1
  if (existing.length > 0) {
    const lastNum = parseInt(existing[0].orderNo.split('-').pop() || '0', 10)
    nextNum = lastNum + 1
  }

  return `${prefix}${nextNum.toString().padStart(3, '0')}`
}

// POST - Convert approved requisition to purchase order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, convertRequisitionToPOSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const [requisition] = await tx.select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .for('update')

    if (!requisition) return { error: NextResponse.json({ error: 'Requisition not found' }, { status: 404 }) }
    if (requisition.status !== 'approved' && requisition.status !== 'partially_ordered') {
      return { error: NextResponse.json({ error: 'Only approved or partially ordered requisitions can be converted' }, { status: 400 }) }
    }

    // Validate supplier
    const [supplier] = await tx.select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, body.supplierId))

    if (!supplier) return { error: NextResponse.json({ error: 'Supplier not found' }, { status: 404 }) }

    // Get items to convert
    const reqItems = await tx.select()
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.requisitionId, id))

    // Filter to only unordered/partially ordered items
    const itemsToConvert = reqItems.filter(item => {
      if (body.itemIds?.length) {
        if (!body.itemIds.includes(item.id)) return false
      }
      const remaining = parseFloat(item.quantity) - parseFloat(item.orderedQuantity)
      return remaining > 0
    })

    if (itemsToConvert.length === 0) {
      return { error: NextResponse.json({ error: 'No items available to convert (all already ordered)' }, { status: 400 }) }
    }

    // Create PO
    const orderNo = await generateOrderNo(tx)
    let subtotal = 0

    const [newOrder] = await tx.insert(purchaseOrders).values({
      tenantId: session.user.tenantId,
      orderNo,
      supplierId: body.supplierId,
      warehouseId: body.warehouseId,
      expectedDeliveryDate: body.expectedDeliveryDate || null,
      notes: body.notes || `Created from requisition ${requisition.requisitionNo}`,
      status: 'draft',
      createdBy: session.user.id,
    }).returning()

    // Create PO items from requisition items
    const poItems = itemsToConvert.map(item => {
      const remaining = parseFloat(item.quantity) - parseFloat(item.orderedQuantity)
      const unitPrice = parseFloat(item.estimatedUnitPrice)
      const itemTotal = remaining * unitPrice
      subtotal += itemTotal

      return {
        tenantId: session.user.tenantId,
        purchaseOrderId: newOrder.id,
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: remaining.toString(),
        unitPrice: unitPrice.toString(),
        tax: '0',
        total: itemTotal.toFixed(2),
      }
    })

    await tx.insert(purchaseOrderItems).values(poItems)

    // Update PO totals
    await tx.update(purchaseOrders)
      .set({
        subtotal: subtotal.toFixed(2),
        total: subtotal.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, newOrder.id))

    // Update ordered quantities on requisition items
    for (const item of itemsToConvert) {
      const remaining = parseFloat(item.quantity) - parseFloat(item.orderedQuantity)
      await tx.update(purchaseRequisitionItems)
        .set({
          orderedQuantity: (parseFloat(item.orderedQuantity) + remaining).toFixed(3),
        })
        .where(eq(purchaseRequisitionItems.id, item.id))
    }

    // Check if all items are fully ordered
    const updatedItems = await tx.select()
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.requisitionId, id))

    const allOrdered = updatedItems.every(
      item => parseFloat(item.orderedQuantity) >= parseFloat(item.quantity)
    )

    await tx.update(purchaseRequisitions)
      .set({
        status: allOrdered ? 'ordered' : 'partially_ordered',
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequisitions.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase-requisition', 'updated', id)
    logAndBroadcast(session.user.tenantId, 'purchase-order', 'created', newOrder.id)

    return { data: { purchaseOrderId: newOrder.id, orderNo: newOrder.orderNo } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data, { status: 201 })
}
