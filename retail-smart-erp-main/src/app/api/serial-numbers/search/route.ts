import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { itemSerialNumbers, items, warehouses } from '@/lib/db/schema'
import { eq, and, sql, ilike, desc } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { serialNumberSearchSchema } from '@/lib/validation/schemas/items'

// GET - Cross-item search by serial number
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError

    const parsed = validateSearchParams(request, serialNumberSearchSchema)
    if (!parsed.success) return parsed.response
    const { search, status, page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = [
        ilike(itemSerialNumbers.serialNumber, `%${escapeLikePattern(search)}%`),
      ]

      if (status) {
        conditions.push(
          eq(itemSerialNumbers.status, status)
        )
      }

      const whereClause = and(...conditions)

      // Get total count
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(itemSerialNumbers)
        .where(whereClause)

      const limit = Math.min(pageSize, 100)
      const offset = (page - 1) * pageSize

      // Query with item and warehouse joins
      const data = await db
        .select({
          id: itemSerialNumbers.id,
          serialNumber: itemSerialNumbers.serialNumber,
          status: itemSerialNumbers.status,
          itemId: itemSerialNumbers.itemId,
          itemName: items.name,
          itemSku: items.sku,
          warehouseId: itemSerialNumbers.warehouseId,
          warehouseName: warehouses.name,
          warrantyStartDate: itemSerialNumbers.warrantyStartDate,
          warrantyEndDate: itemSerialNumbers.warrantyEndDate,
          createdAt: itemSerialNumbers.createdAt,
          updatedAt: itemSerialNumbers.updatedAt,
        })
        .from(itemSerialNumbers)
        .leftJoin(items, eq(itemSerialNumbers.itemId, items.id))
        .leftJoin(warehouses, eq(itemSerialNumbers.warehouseId, warehouses.id))
        .where(whereClause)
        .orderBy(desc(itemSerialNumbers.createdAt))
        .limit(limit)
        .offset(offset)

      return NextResponse.json({
        data,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/serial-numbers/search', error)
    return NextResponse.json(
      { error: 'Failed to search serial numbers' },
      { status: 500 }
    )
  }
}
