import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { itemBatches, warehouses, suppliers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateItemBatchSchema } from '@/lib/validation/schemas/items'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - Single batch detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [batch] = await db.select({
      id: itemBatches.id,
      itemId: itemBatches.itemId,
      batchNumber: itemBatches.batchNumber,
      warehouseId: itemBatches.warehouseId,
      warehouseName: warehouses.name,
      manufacturingDate: itemBatches.manufacturingDate,
      expiryDate: itemBatches.expiryDate,
      initialQuantity: itemBatches.initialQuantity,
      currentQuantity: itemBatches.currentQuantity,
      supplierBatchNumber: itemBatches.supplierBatchNumber,
      supplierId: itemBatches.supplierId,
      supplierName: suppliers.name,
      purchaseReceiptId: itemBatches.purchaseReceiptId,
      status: itemBatches.status,
      notes: itemBatches.notes,
      createdAt: itemBatches.createdAt,
      updatedAt: itemBatches.updatedAt,
    })
      .from(itemBatches)
      .leftJoin(warehouses, eq(itemBatches.warehouseId, warehouses.id))
      .leftJoin(suppliers, eq(itemBatches.supplierId, suppliers.id))
      .where(eq(itemBatches.id, id))

    if (!batch) return { notFound: true }
    return { data: batch }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('notFound' in result) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  return NextResponse.json(result.data)
}

// PUT - Update batch
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updateItemBatchSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageItems')
    if (permError) return { error: permError }

    const [existing] = await tx.select()
      .from(itemBatches)
      .where(eq(itemBatches.id, id))

    if (!existing) return { error: NextResponse.json({ error: 'Batch not found' }, { status: 404 }) }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updatedAt: new Date() }

    if (body.status) updates.status = body.status
    if (body.notes !== undefined) updates.notes = body.notes
    if (body.expiryDate !== undefined) updates.expiryDate = body.expiryDate

    const [updated] = await tx.update(itemBatches)
      .set(updates)
      .where(eq(itemBatches.id, id))
      .returning()

    logAndBroadcast(session.user.tenantId, 'item-batch', 'updated', id)
    return { data: updated }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
