import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { itemBatches, warehouses, suppliers } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation'
import { itemBatchesForItemListSchema, createItemBatchForItemSchema } from '@/lib/validation/schemas/items'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - List batches for an item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const parsedParams = validateSearchParams(request, itemBatchesForItemListSchema)
  if (!parsedParams.success) return parsedParams.response
  const { status, warehouseId } = parsedParams.data

  const result = await withAuthTenant(async (session, db) => {
    const conditions = [eq(itemBatches.itemId, id)]

    if (status) conditions.push(eq(itemBatches.status, status))
    if (warehouseId) conditions.push(eq(itemBatches.warehouseId, warehouseId))

    const data = await db.select({
      id: itemBatches.id,
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
      status: itemBatches.status,
      notes: itemBatches.notes,
      createdAt: itemBatches.createdAt,
    })
      .from(itemBatches)
      .leftJoin(warehouses, eq(itemBatches.warehouseId, warehouses.id))
      .leftJoin(suppliers, eq(itemBatches.supplierId, suppliers.id))
      .where(and(...conditions))
      .orderBy(desc(itemBatches.createdAt))

    return data
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(result)
}

// POST - Create a new batch
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, createItemBatchForItemSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageItems')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    const [batch] = await tx.insert(itemBatches).values({
      tenantId: session.user.tenantId,
      itemId: id,
      batchNumber: body.batchNumber,
      warehouseId: body.warehouseId || null,
      manufacturingDate: body.manufacturingDate || null,
      expiryDate: body.expiryDate || null,
      initialQuantity: body.initialQuantity.toString(),
      currentQuantity: body.initialQuantity.toString(),
      supplierBatchNumber: body.supplierBatchNumber || null,
      supplierId: body.supplierId || null,
      notes: body.notes || null,
    }).returning()

    logAndBroadcast(session.user.tenantId, 'item-batch', 'created', batch.id)
    return { data: batch }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data, { status: 201 })
}
