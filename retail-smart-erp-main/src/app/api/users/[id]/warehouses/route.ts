import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { users, userWarehouses, warehouses, posProfileUsers } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateUserWarehousesSchema } from '@/lib/validation/schemas/users'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET user's warehouse assignments
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: userId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify user exists (RLS scopes to tenant)
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      })

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      // Get user's warehouse assignments (RLS scopes)
      const assignments = await db.query.userWarehouses.findMany({
        where: eq(userWarehouses.userId, userId),
        with: {
          warehouse: true,
        },
      })

      // Get user's POS profile assignments (via posProfileUsers)
      const posProfileAssignments = await db.query.posProfileUsers.findMany({
        where: eq(posProfileUsers.userId, userId),
        with: {
          posProfile: {
            with: {
              warehouse: true,
            },
          },
        },
      })

      return NextResponse.json({
        assignments,
        posProfileAssignments,
      })
    })
  } catch (error) {
    logError('api/users/[id]/warehouses', error)
    return NextResponse.json({ error: 'Failed to fetch user warehouse assignments' }, { status: 500 })
  }
}

// PUT update user's warehouse assignments
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageUsers')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: userId } = paramsParsed.data
    const parsed = await validateBody(request, updateUserWarehousesSchema)
    if (!parsed.success) return parsed.response
    const { warehouseIds } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify user exists (RLS scopes to tenant)
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      })

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      // Verify all warehouses exist (RLS scopes to tenant)
      if (warehouseIds.length > 0) {
        const validWarehouses = await db.query.warehouses.findMany({
          where: inArray(warehouses.id, warehouseIds),
        })

        if (validWarehouses.length !== warehouseIds.length) {
          return NextResponse.json({ error: 'One or more warehouses not found' }, { status: 400 })
        }
      }

      // Get current assignments (RLS scopes)
      const currentAssignments = await db.query.userWarehouses.findMany({
        where: eq(userWarehouses.userId, userId),
      })

      const currentWarehouseIds = currentAssignments.map(a => a.warehouseId)

      // Determine which to add and which to remove
      const toAdd = warehouseIds.filter((id: string) => !currentWarehouseIds.includes(id))
      const toRemove = currentWarehouseIds.filter(id => !warehouseIds.includes(id))

      // Remove old assignments
      if (toRemove.length > 0) {
        await db.delete(userWarehouses)
          .where(and(
            eq(userWarehouses.userId, userId),
            inArray(userWarehouses.warehouseId, toRemove)
          ))
      }

      // Add new assignments
      for (const warehouseId of toAdd) {
        await db.insert(userWarehouses).values({
          tenantId: session!.user.tenantId,
          userId,
          warehouseId,
          isActive: true,
        })
      }

      // Get updated assignments
      const updatedAssignments = await db.query.userWarehouses.findMany({
        where: eq(userWarehouses.userId, userId),
        with: {
          warehouse: true,
        },
      })

      logAndBroadcast(session!.user.tenantId, 'user', 'updated', userId)

      return NextResponse.json({
        assignments: updatedAssignments,
        added: toAdd.length,
        removed: toRemove.length,
      })
    })
  } catch (error) {
    logError('api/users/[id]/warehouses', error)
    return NextResponse.json({ error: 'Failed to update user warehouse assignments' }, { status: 500 })
  }
}
