import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseRequisitions, purchaseRequisitionItems, purchaseOrders, purchaseOrderItems, suppliers, warehouses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { convertRequisitionToPOSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { nextDocNo } from '@/lib/documents/numbering'
import { assertBranchAccess, assertRecordBranch } from '@/lib/auth/branch-access'

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
    // K4: a requisition of another branch is refused
    const recordDenied = await assertRecordBranch(session, tx, purchaseRequisitions, id)
    if (recordDenied) return { error: recordDenied }
    // K4: a branch-restricted user works with their own branches only
    const branchDenied = await assertBranchAccess(session, body.warehouseId, tx)
    if (branchDenied) return { error: branchDenied }

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

    // Validate warehouse (RLS-scoped: a warehouse of another tenant is not found)
    const [warehouse] = await tx.select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.id, body.warehouseId))

    if (!warehouse) return { error: NextResponse.json({ error: 'Warehouse not found' }, { status: 404 }) }

    // Get items to convert
    const reqItems = await tx.select()
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.requisitionId, id))

    // Filter to only unordered/partially ordered items
    const itemsToConvert = reqItems.filter(item => {
      if (body.itemIds?.length) {
        if (!body.itemIds.includes(item.id)) return false
      }
      const remaining = Math.round((parseFloat(item.quantity) - parseFloat(item.orderedQuantity)) * 1000) / 1000
      return remaining > 0
    })

    if (itemsToConvert.length === 0) {
      return { error: NextResponse.json({ error: 'No items available to convert (all already ordered)' }, { status: 400 }) }
    }

    // Create PO
    const orderNo = await nextDocNo(tx, session.user.tenantId, 'purchase_order')
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
      const remaining = Math.round((parseFloat(item.quantity) - parseFloat(item.orderedQuantity)) * 1000) / 1000
      const unitPrice = parseFloat(item.estimatedUnitPrice)
      const itemTotal = Math.round(remaining * unitPrice * 100) / 100
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
      const remaining = Math.round((parseFloat(item.quantity) - parseFloat(item.orderedQuantity)) * 1000) / 1000
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
