import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { itemBatches, items, warehouses, suppliers } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, sql, lte } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { itemBatchesListSchema } from '@/lib/validation/schemas/items'

// GET - List item batches with pagination
export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, itemBatchesListSchema)
    if (!parsed.success) return parsed.response
    const { search, itemId, warehouseId, status, expiringBefore, page, pageSize } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageInventory')
      if (permError) return { error: permError }

      const conditions = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(or(
          ilike(itemBatches.batchNumber, `%${escaped}%`),
          ilike(itemBatches.supplierBatchNumber, `%${escaped}%`),
          ilike(items.name, `%${escaped}%`)
        ))
      }
      if (itemId) conditions.push(eq(itemBatches.itemId, itemId))
      if (warehouseId) conditions.push(eq(itemBatches.warehouseId, warehouseId))
      if (status) conditions.push(eq(itemBatches.status, status))
      if (expiringBefore) conditions.push(lte(itemBatches.expiryDate, expiringBefore))

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count: total }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(itemBatches)
        .leftJoin(items, eq(itemBatches.itemId, items.id))
        .where(whereClause)

      const data = await db
        .select({
          id: itemBatches.id,
          itemId: itemBatches.itemId,
          itemName: items.name,
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
          createdAt: itemBatches.createdAt,
        })
        .from(itemBatches)
        .leftJoin(items, eq(itemBatches.itemId, items.id))
        .leftJoin(warehouses, eq(itemBatches.warehouseId, warehouses.id))
        .leftJoin(suppliers, eq(itemBatches.supplierId, suppliers.id))
        .where(whereClause)
        .orderBy(desc(itemBatches.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      return {
        data,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
      }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/item-batches', error)
    return NextResponse.json({ error: 'Failed to fetch item batches' }, { status: 500 })
  }
}
