import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { stockMovements, items, warehouses, users } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { stockMovementsListSchema } from '@/lib/validation/schemas/stock'

// GET stock movements for the tenant (paginated)
export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, stockMovementsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, type, warehouseId, referenceType, startDate, endDate } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageInventory')
      if (permError) return { error: permError }

      // Build where conditions - RLS handles tenant filtering
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(items.name, `%${escaped}%`),
            ilike(items.sku, `%${escaped}%`),
            ilike(items.barcode, `%${escaped}%`),
            ilike(items.oemPartNumber, `%${escaped}%`)
          )!
        )
      }

      if (type) {
        conditions.push(eq(stockMovements.type, type))
      }

      if (warehouseId) {
        conditions.push(eq(stockMovements.warehouseId, warehouseId))
      }

      if (referenceType) {
        conditions.push(eq(stockMovements.referenceType, referenceType))
      }

      if (startDate) {
        conditions.push(sql`${stockMovements.createdAt} >= ${startDate}::timestamp`)
      }

      if (endDate) {
        // Add 1 day to include the full end date
        conditions.push(sql`${stockMovements.createdAt} < (${endDate}::timestamp + interval '1 day')`)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(stockMovements)
        .leftJoin(items, eq(stockMovements.itemId, items.id))
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results with joins
      const data = await db
        .select({
          id: stockMovements.id,
          type: stockMovements.type,
          quantity: stockMovements.quantity,
          referenceType: stockMovements.referenceType,
          referenceId: stockMovements.referenceId,
          notes: stockMovements.notes,
          createdAt: stockMovements.createdAt,
          itemId: stockMovements.itemId,
          itemName: items.name,
          itemSku: items.sku,
          itemBarcode: items.barcode,
          itemOemPartNumber: items.oemPartNumber,
          warehouseId: stockMovements.warehouseId,
          warehouseName: warehouses.name,
          createdBy: stockMovements.createdBy,
          createdByName: users.fullName,
        })
        .from(stockMovements)
        .leftJoin(items, eq(stockMovements.itemId, items.id))
        .leftJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
        .leftJoin(users, eq(stockMovements.createdBy, users.id))
        .where(whereClause)
        .orderBy(desc(stockMovements.createdAt))
        .limit(pageSize)
        .offset(offset)

      return { data, pagination: { page, pageSize, total, totalPages } }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    return NextResponse.json({ data: result.data, pagination: result.pagination })
  } catch (error) {
    logError('api/stock-movements', error)
    return NextResponse.json(
      { error: 'Failed to fetch stock movements' },
      { status: 500 }
    )
  }
}
