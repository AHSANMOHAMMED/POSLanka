import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseRequisitions, purchaseRequisitionItems, suppliers, warehouses } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addRequisitionItemSchema, updateRequisitionItemsSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const data = await db.select({
      id: purchaseRequisitionItems.id,
      itemId: purchaseRequisitionItems.itemId,
      itemName: purchaseRequisitionItems.itemName,
      quantity: purchaseRequisitionItems.quantity,
      orderedQuantity: purchaseRequisitionItems.orderedQuantity,
      estimatedUnitPrice: purchaseRequisitionItems.estimatedUnitPrice,
      estimatedTotal: purchaseRequisitionItems.estimatedTotal,
      preferredSupplierId: purchaseRequisitionItems.preferredSupplierId,
      preferredSupplierName: suppliers.name,
      warehouseId: purchaseRequisitionItems.warehouseId,
      warehouseName: warehouses.name,
      notes: purchaseRequisitionItems.notes,
    })
      .from(purchaseRequisitionItems)
      .leftJoin(suppliers, eq(purchaseRequisitionItems.preferredSupplierId, suppliers.id))
      .leftJoin(warehouses, eq(purchaseRequisitionItems.warehouseId, warehouses.id))
      .where(eq(purchaseRequisitionItems.requisitionId, id))

    return data
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(result)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, addRequisitionItemSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'createRequisitions')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const [requisition] = await tx.select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .for('update')

    if (!requisition) return { error: NextResponse.json({ error: 'Requisition not found' }, { status: 404 }) }
    if (requisition.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Can only add items to draft requisitions' }, { status: 400 }) }
    }

    const estimatedTotal = (body.quantity || 0) * (body.estimatedUnitPrice || 0)

    const [item] = await tx.insert(purchaseRequisitionItems).values({
      tenantId: session.user.tenantId,
      requisitionId: id,
      itemId: body.itemId || null,
      itemName: body.itemName,
      quantity: body.quantity.toString(),
      estimatedUnitPrice: (body.estimatedUnitPrice || 0).toFixed(2),
      estimatedTotal: estimatedTotal.toFixed(2),
      preferredSupplierId: body.preferredSupplierId || null,
      warehouseId: body.warehouseId || null,
      notes: body.notes || null,
    }).returning()

    // Recalculate total
    const [totalResult] = await tx
      .select({ total: sql<string>`COALESCE(SUM(estimated_total), 0)` })
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.requisitionId, id))

    await tx.update(purchaseRequisitions)
      .set({ estimatedTotal: totalResult.total, updatedAt: new Date() })
      .where(eq(purchaseRequisitions.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase-requisition', 'updated', id)
    return { data: item }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data, { status: 201 })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updateRequisitionItemsSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'createRequisitions')
    if (permError) return { error: permError }

    const [requisition] = await tx.select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .for('update')

    if (!requisition) return { error: NextResponse.json({ error: 'Requisition not found' }, { status: 404 }) }
    if (requisition.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Can only update items on draft requisitions' }, { status: 400 }) }
    }

    for (const update of body) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = {}
      if (update.quantity !== undefined) updates.quantity = update.quantity.toString()
      if (update.estimatedUnitPrice !== undefined) updates.estimatedUnitPrice = update.estimatedUnitPrice.toFixed(2)
      if (update.preferredSupplierId !== undefined) updates.preferredSupplierId = update.preferredSupplierId
      if (update.warehouseId !== undefined) updates.warehouseId = update.warehouseId
      if (update.notes !== undefined) updates.notes = update.notes

      if (update.quantity !== undefined || update.estimatedUnitPrice !== undefined) {
        const [current] = await tx.select()
          .from(purchaseRequisitionItems)
          .where(eq(purchaseRequisitionItems.id, update.id))

        if (current) {
          const qty = update.quantity !== undefined ? update.quantity : parseFloat(current.quantity)
          const price = update.estimatedUnitPrice !== undefined ? update.estimatedUnitPrice : parseFloat(current.estimatedUnitPrice)
          updates.estimatedTotal = (qty * price).toFixed(2)
        }
      }

      if (Object.keys(updates).length > 0) {
        await tx.update(purchaseRequisitionItems)
          .set(updates)
          .where(eq(purchaseRequisitionItems.id, update.id))
      }
    }

    // Recalculate total
    const [totalResult] = await tx
      .select({ total: sql<string>`COALESCE(SUM(estimated_total), 0)` })
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.requisitionId, id))

    await tx.update(purchaseRequisitions)
      .set({ estimatedTotal: totalResult.total, updatedAt: new Date() })
      .where(eq(purchaseRequisitions.id, id))

    logAndBroadcast(session.user.tenantId, 'purchase-requisition', 'updated', id)
    return { success: true }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json({ success: true })
}
