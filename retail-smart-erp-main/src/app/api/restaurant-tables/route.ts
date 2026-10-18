import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantTables } from '@/lib/db/schema'
import { eq, asc, sql, and, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { restaurantTablesListSchema, createRestaurantTableSchema } from '@/lib/validation/schemas/restaurant'

// GET all restaurant tables for the tenant
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, restaurantTablesListSchema)
    if (!parsed.success) return parsed.response
    const { status, area, search, all, page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions
      const conditions = [eq(restaurantTables.isActive, true)]

      if (status) {
        conditions.push(eq(restaurantTables.status, status))
      }

      if (area) {
        conditions.push(eq(restaurantTables.area, area))
      }

      if (search) {
        const escaped = escapeLikePattern(search)
        const searchCondition = or(
          ilike(restaurantTables.name, `%${escaped}%`),
          ilike(restaurantTables.area, `%${escaped}%`)
        )
        if (searchCondition) {
          conditions.push(searchCondition)
        }
      }

      const whereClause = and(...conditions)

      // Get total count
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(restaurantTables)
        .where(whereClause)

      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.restaurantTables.findMany({
        where: whereClause,
        orderBy: [asc(restaurantTables.area), asc(restaurantTables.name)],
        limit,
        offset,
      })

      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/restaurant-tables', error)
    return NextResponse.json({ error: 'Failed to fetch restaurant tables' }, { status: 500 })
  }
}

// POST create new restaurant table
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageTables')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createRestaurantTableSchema)
    if (!parsed.success) return parsed.response
    const { name, area, capacity, positionX, positionY, width, height, shape, rotation } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Check for duplicate name
      const existing = await db.query.restaurantTables.findFirst({
        where: and(
          eq(restaurantTables.name, name),
          eq(restaurantTables.isActive, true)
        ),
      })

      if (existing) {
        return NextResponse.json({ error: 'A table with this name already exists' }, { status: 400 })
      }

      const [newTable] = await db.insert(restaurantTables).values({
        tenantId: session.user.tenantId,
        name,
        area: area || null,
        capacity: capacity || 4,
        status: 'available',
        positionX: positionX || null,
        positionY: positionY || null,
        width: width || null,
        height: height || null,
        shape: shape || 'rectangle',
        rotation: rotation || 0,
        isActive: true,
      }).returning()

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'table', 'created', newTable.id)

      return NextResponse.json(newTable)
    })
  } catch (error) {
    logError('api/restaurant-tables', error)
    return NextResponse.json({ error: 'Failed to create restaurant table' }, { status: 500 })
  }
}
