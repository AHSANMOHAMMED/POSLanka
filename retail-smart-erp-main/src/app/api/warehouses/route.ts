import { NextRequest, NextResponse } from 'next/server'
import { notInRecycleBin } from '@/lib/recycle-bin'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { warehouses, userWarehouses } from '@/lib/db/schema'
import { getBranchScope, branchFilter } from '@/lib/auth/branch-access'
import { eq, and, ilike, sql, or, inArray } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
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
      // Warehouses moved to the recycle bin are hidden (deactivated ones still show)
      const conditions = [notInRecycleBin('warehouse', warehouses.id)]

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

      // K4: a branch-restricted user only ever sees their own branches (every dropdown in web and
      // the app reads this list); the owner and unassigned staff see every branch.
      const scope = await getBranchScope(session, db)
      const scoped = branchFilter(scope, warehouses.id)
      if (scoped) conditions.push(scoped)

      // userOnly: just the branches assigned to this user (none assigned = empty list; the
      // callers fall back to the full list themselves)
      if (userOnly) {
        const assignments = await db.select({ warehouseId: userWarehouses.warehouseId })
          .from(userWarehouses)
          .where(and(
            eq(userWarehouses.userId, session.user.id),
            eq(userWarehouses.isActive, true)
          ))
        conditions.push(assignments.length > 0 ? inArray(warehouses.id, assignments.map(a => a.warehouseId)) : sql`false`)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Return all warehouses (for dropdowns)
      if (all) {
        const result = await db.query.warehouses.findMany({
          where: whereClause,
          orderBy: (warehouses, { desc, asc }) => [desc(warehouses.isDefault), asc(warehouses.name)],
          limit: 1000,
        })
        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(warehouses)
        .where(whereClause)

      const total = Number(count)

      // Get paginated results
      const result = await db.query.warehouses.findMany({
        where: whereClause,
        orderBy: (warehouses, { desc, asc }) => [desc(warehouses.isDefault), asc(warehouses.name)],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })

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
      // K4: a branch-restricted user (even with settings rights) cannot add branches
      if (await getBranchScope(session, db)) {
        return NextResponse.json({
          error: 'Only the owner, or staff who work with every branch, can add a branch.',
          code: 'BRANCH_ACCESS_DENIED',
        }, { status: 403 })
      }

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
      // K4: staff assigned to every branch are unrestricted — the branch list changed
      invalidatePermissionCache(session!.user.tenantId)

      return NextResponse.json(newWarehouse)
    })
  } catch (error) {
    logError('api/warehouses', error)
    return NextResponse.json({ error: 'Failed to create warehouse' }, { status: 500 })
  }
}
