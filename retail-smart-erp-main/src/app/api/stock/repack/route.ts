import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { items, warehouses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { validateBody } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { z } from 'zod'

const bulkBreakdownSchema = z.object({
  warehouseId: z.string().uuid(),
  sourceItemId: z.string().uuid(),
  sourceQty: z.coerce.number().positive('Source quantity must be greater than zero'),
  targetItemId: z.string().uuid(),
  targetQty: z.coerce.number().positive('Target quantity must be greater than zero'),
  notes: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, bulkBreakdownSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  if (body.sourceItemId === body.targetItemId) {
    return NextResponse.json({ error: 'Source and target items cannot be the same' }, { status: 400 })
  }

  try {

    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'manageInventory')
      if (permError) return { error: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { error: quotaError }

      const tenantId = session.user.tenantId
      const userId = session.user.id

      const [warehouse] = await tx
        .select({ id: warehouses.id, name: warehouses.name })
        .from(warehouses)
        .where(eq(warehouses.id, body.warehouseId))
        .limit(1)

      if (!warehouse) {
        return { error: NextResponse.json({ error: 'Warehouse not found' }, { status: 404 }) }
      }

      const [sourceItem] = await tx.select().from(items).where(eq(items.id, body.sourceItemId)).limit(1)
      const [targetItem] = await tx.select().from(items).where(eq(items.id, body.targetItemId)).limit(1)

      if (!sourceItem) return { error: NextResponse.json({ error: 'Source item not found' }, { status: 404 }) }
      if (!targetItem) return { error: NextResponse.json({ error: 'Target item not found' }, { status: 404 }) }

      // 1. Deduct bulk source stock
      const deductChange = await applyStockChange(tx, {
        tenantId,
        warehouseId: body.warehouseId,
        itemId: body.sourceItemId,
        mode: 'delta',
        qty: -body.sourceQty,
        type: 'adjustment',
        referenceType: 'bulk_repack_out',
        notes: body.notes || `Repacked into ${body.targetQty} × ${targetItem.name}`,
        userId,
        source: 'manual',
        reasonCode: 'conversion',
      })

      // 2. Add smaller/individual target stock
      const addChange = await applyStockChange(tx, {
        tenantId,
        warehouseId: body.warehouseId,
        itemId: body.targetItemId,
        mode: 'delta',
        qty: body.targetQty,
        type: 'adjustment',
        referenceType: 'bulk_repack_in',
        notes: body.notes || `Repacked from ${body.sourceQty} × ${sourceItem.name}`,
        userId,
        source: 'manual',
        reasonCode: 'conversion',
      })

      return {
        tenantId,
        data: {
          success: true,
          warehouse: warehouse.name,
          source: {
            name: sourceItem.name,
            deducted: body.sourceQty,
            stockAfter: deductChange.after,
          },
          target: {
            name: targetItem.name,
            added: body.targetQty,
            stockAfter: addChange.after,
          },
        },
        broadcastIds: [deductChange.warehouseStockId, addChange.warehouseStockId],
      }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result && result.error) return result.error

    logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', body.sourceItemId, { entityName: result.data.source.name })
    logAndBroadcast(result.tenantId, 'warehouse-stock', 'updated', body.targetItemId, { entityName: result.data.target.name })

    return NextResponse.json(result.data)
  } catch (error) {
    logError('api/stock/repack', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Repack operation failed' }, { status: 500 })
  }
}

