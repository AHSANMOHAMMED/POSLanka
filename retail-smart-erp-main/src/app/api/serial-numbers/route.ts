import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { itemSerialNumbers, items, warehouses } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { serialNumbersListSchema } from '@/lib/validation/schemas/items'

// GET - List serial numbers with pagination
export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, serialNumbersListSchema)
    if (!parsed.success) return parsed.response
    const { search, itemId, warehouseId, status, page, pageSize } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageInventory')
      if (permError) return { error: permError }

      const conditions = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(or(
          ilike(itemSerialNumbers.serialNumber, `%${escaped}%`),
          ilike(items.name, `%${escaped}%`)
        ))
      }
      if (itemId) conditions.push(eq(itemSerialNumbers.itemId, itemId))
      if (warehouseId) conditions.push(eq(itemSerialNumbers.warehouseId, warehouseId))
      if (status) conditions.push(eq(itemSerialNumbers.status, status))

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count: total }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(itemSerialNumbers)
        .leftJoin(items, eq(itemSerialNumbers.itemId, items.id))
        .where(whereClause)

      const data = await db
        .select({
          id: itemSerialNumbers.id,
          itemId: itemSerialNumbers.itemId,
          itemName: items.name,
          serialNumber: itemSerialNumbers.serialNumber,
          status: itemSerialNumbers.status,
          warehouseId: itemSerialNumbers.warehouseId,
          warehouseName: warehouses.name,
          warrantyStartDate: itemSerialNumbers.warrantyStartDate,
          warrantyEndDate: itemSerialNumbers.warrantyEndDate,
          createdAt: itemSerialNumbers.createdAt,
        })
        .from(itemSerialNumbers)
        .leftJoin(items, eq(itemSerialNumbers.itemId, items.id))
        .leftJoin(warehouses, eq(itemSerialNumbers.warehouseId, warehouses.id))
        .where(whereClause)
        .orderBy(desc(itemSerialNumbers.createdAt))
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
    logError('api/serial-numbers', error)
    return NextResponse.json({ error: 'Failed to fetch serial numbers' }, { status: 500 })
  }
}
