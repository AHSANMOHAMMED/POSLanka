import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { purchaseRequisitions, purchaseRequisitionItems, users, costCenters, suppliers, warehouses, items as itemsTable } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePurchaseRequisitionSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [requisition] = await db.select({
      id: purchaseRequisitions.id,
      requisitionNo: purchaseRequisitions.requisitionNo,
      status: purchaseRequisitions.status,
      requestedBy: purchaseRequisitions.requestedBy,
      requestedByName: users.fullName,
      department: purchaseRequisitions.department,
      costCenterId: purchaseRequisitions.costCenterId,
      costCenterName: costCenters.name,
      requiredByDate: purchaseRequisitions.requiredByDate,
      purpose: purchaseRequisitions.purpose,
      notes: purchaseRequisitions.notes,
      estimatedTotal: purchaseRequisitions.estimatedTotal,
      approvedBy: purchaseRequisitions.approvedBy,
      approvedAt: purchaseRequisitions.approvedAt,
      approvalNotes: purchaseRequisitions.approvalNotes,
      rejectedBy: purchaseRequisitions.rejectedBy,
      rejectedAt: purchaseRequisitions.rejectedAt,
      rejectionReason: purchaseRequisitions.rejectionReason,
      cancellationReason: purchaseRequisitions.cancellationReason,
      cancelledAt: purchaseRequisitions.cancelledAt,
      createdAt: purchaseRequisitions.createdAt,
      updatedAt: purchaseRequisitions.updatedAt,
    })
      .from(purchaseRequisitions)
      .leftJoin(users, eq(purchaseRequisitions.requestedBy, users.id))
      .leftJoin(costCenters, eq(purchaseRequisitions.costCenterId, costCenters.id))
      .where(eq(purchaseRequisitions.id, id))

    if (!requisition) return { notFound: true }

    const reqItems = await db.select({
      id: purchaseRequisitionItems.id,
      itemId: purchaseRequisitionItems.itemId,
      itemName: purchaseRequisitionItems.itemName,
      itemSku: itemsTable.sku,
      itemBarcode: itemsTable.barcode,
      itemOemPartNumber: itemsTable.oemPartNumber,
      itemPluCode: itemsTable.pluCode,
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
      .leftJoin(itemsTable, eq(purchaseRequisitionItems.itemId, itemsTable.id))
      .leftJoin(suppliers, eq(purchaseRequisitionItems.preferredSupplierId, suppliers.id))
      .leftJoin(warehouses, eq(purchaseRequisitionItems.warehouseId, warehouses.id))
      .where(eq(purchaseRequisitionItems.requisitionId, id))

    return { data: { ...requisition, items: reqItems } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('notFound' in result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(result.data)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updatePurchaseRequisitionSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'createRequisitions')
    if (permError) return { error: permError }

    const [existing] = await tx.select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .for('update')

    if (!existing) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
    if (existing.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Only draft requisitions can be edited' }, { status: 400 }) }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updatedAt: new Date() }
    if (body.department !== undefined) updates.department = body.department
    if (body.costCenterId !== undefined) updates.costCenterId = body.costCenterId
    if (body.requiredByDate !== undefined) updates.requiredByDate = body.requiredByDate
    if (body.purpose !== undefined) updates.purpose = body.purpose
    if (body.notes !== undefined) updates.notes = body.notes

    const [updated] = await tx.update(purchaseRequisitions)
      .set(updates)
      .where(eq(purchaseRequisitions.id, id))
      .returning()

    logAndBroadcast(session.user.tenantId, 'purchase-requisition', 'updated', id)
    return { data: updated }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'createRequisitions')
    if (permError) return { error: permError }

    const [existing] = await tx.select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))

    if (!existing) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
    if (existing.status !== 'draft') {
      return { error: NextResponse.json({ error: 'Only draft requisitions can be deleted' }, { status: 400 }) }
    }

    await tx.delete(purchaseRequisitions).where(eq(purchaseRequisitions.id, id))
    logAndBroadcast(session.user.tenantId, 'purchase-requisition', 'deleted', id)
    return { success: true }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json({ success: true })
}
