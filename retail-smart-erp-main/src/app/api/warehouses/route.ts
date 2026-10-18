import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { warehouses, userWarehouses } from '@/lib/db/schema'
import { eq, and, ilike, sql, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { warehousesListSchema, createWarehouseSchema } from '@/lib/validation/schemas/stock'

// GET all warehouses for the tenant (with pagination support)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, warehousesListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, all, userOnly, activeOnly } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(warehouses.name, `%${escaped}%`),
            ilike(warehouses.code, `%${escaped}%`)
          )!
        )
      }

      if (activeOnly) {
        conditions.push(eq(warehouses.isActive, true))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // If userOnly, get user's assigned warehouse IDs first
      let userWarehouseIds: string[] = []
      if (userOnly) {
        const assignments = await db.select({ warehouseId: userWarehouses.warehouseId })
          .from(userWarehouses)
          .where(and(
            eq(userWarehouses.userId, session.user.id),
            eq(userWarehouses.isActive, true)
          ))
        userWarehouseIds = assignments.map(a => a.warehouseId)
      }

      // Return all warehouses (for dropdowns)
      if (all) {
        let result = await db.query.warehouses.findMany({
          where: whereClause,
          orderBy: (warehouses, { desc, asc }) => [desc(warehouses.isDefault), asc(warehouses.name)],
          limit: 1000,
        })

        // Filter by user's warehouses if requested
        if (userOnly) {
          if (userWarehouseIds.length > 0) {
            result = result.filter(w => userWarehouseIds.includes(w.id))
          } else {
            // No warehouse assignments = return empty array (not all warehouses)
            result = []
          }
        }

        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(warehouses)
        .where(whereClause)

      let total = Number(count)

      // Get paginated results
      let result = await db.query.warehouses.findMany({
        where: whereClause,
        orderBy: (warehouses, { desc, asc }) => [desc(warehouses.isDefault), asc(warehouses.name)],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })

      // Filter by user's warehouses if requested
      if (userOnly) {
        if (userWarehouseIds.length > 0) {
          result = result.filter(w => userWarehouseIds.includes(w.id))
          total = result.length
        } else {
          // No warehouse assignments = return empty array (not all warehouses)
          result = []
          total = 0
        }
      }

      const totalPages = Math.ceil(total / pageSize)

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/warehouses', error)
    return NextResponse.json({ error: 'Failed to fetch warehouses' }, { status: 500 })
  }
}

// POST create new warehouse
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createWarehouseSchema)
    if (!parsed.success) return parsed.response
    const { name, code, address, phone, email, isDefault } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate warehouse code within tenant (RLS scopes the query)
      const existingWarehouse = await db.query.warehouses.findFirst({
        where: ilike(warehouses.code, code),
      })
      if (existingWarehouse) {
        return NextResponse.json({ error: 'A warehouse with this code already exists' }, { status: 400 })
      }

      // If this warehouse is being set as default, unset the current default
      if (isDefault) {
        await db.update(warehouses)
          .set({ isDefault: false })
          .where(eq(warehouses.isDefault, true))
      }

      const [newWarehouse] = await db.insert(warehouses).values({
        tenantId: session!.user.tenantId,
        name,
        code: code.toUpperCase(),
        address,
        phone,
        email,
        isDefault: isDefault || false,
        isActive: true,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'warehouse', 'created', newWarehouse.id)

      return NextResponse.json(newWarehouse)
    })
  } catch (error) {
    logError('api/warehouses', error)
    return NextResponse.json({ error: 'Failed to create warehouse' }, { status: 500 })
  }
}
