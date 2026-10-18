import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { warehouses, warehouseStock, userWarehouses, posProfiles, stockTransfers, workOrders, posOpeningEntries } from '@/lib/db/schema'
import { eq, and, ne, ilike, or, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateWarehouseSchema } from '@/lib/validation/schemas/stock'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single warehouse with summary
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
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const warehouse = await db.query.warehouses.findFirst({
        where: eq(warehouses.id, id),
      })

      if (!warehouse) {
        return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
      }

      // Get stock count for this warehouse (RLS scopes the query)
      const [{ stockCount }] = await db
        .select({ stockCount: sql<number>`count(*)` })
        .from(warehouseStock)
        .where(eq(warehouseStock.warehouseId, id))

      // Get user count for this warehouse (RLS scopes the query)
      const [{ userCount }] = await db
        .select({ userCount: sql<number>`count(*)` })
        .from(userWarehouses)
        .where(and(
          eq(userWarehouses.warehouseId, id),
          eq(userWarehouses.isActive, true)
        ))

      return NextResponse.json({
        ...warehouse,
        _summary: {
          stockItems: Number(stockCount),
          assignedUsers: Number(userCount),
        }
      })
    })
  } catch (error) {
    logError('api/warehouses/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch warehouse' }, { status: 500 })
  }
}

// PUT update warehouse
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateWarehouseSchema)
    if (!parsed.success) return parsed.response
    const { name, code, address, phone, email, isDefault, isActive, expectedUpdatedAt } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify warehouse exists (RLS scopes the query)
      const existing = await db.query.warehouses.findFirst({
        where: eq(warehouses.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
      }

      // Check for concurrent modification
      if (expectedUpdatedAt) {
        const clientTime = new Date(expectedUpdatedAt).getTime()
        const serverTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0
        if (serverTime > clientTime) {
          return NextResponse.json({
            error: 'This warehouse was modified by another user. Please refresh and try again.',
            code: 'CONFLICT'
          }, { status: 409 })
        }
      }

      // Check for duplicate warehouse code (excluding current) - RLS scopes
      const existingCode = await db.query.warehouses.findFirst({
        where: and(
          ilike(warehouses.code, code.trim()),
          ne(warehouses.id, id)
        ),
      })
      if (existingCode) {
        return NextResponse.json({ error: 'A warehouse with this code already exists' }, { status: 400 })
      }

      // If setting as default, check if it can be unset as default
      if (isDefault === false && existing.isDefault) {
        // Don't allow unsetting the only default warehouse (RLS scopes)
        const defaultCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(warehouses)
          .where(eq(warehouses.isDefault, true))

        if (Number(defaultCount[0].count) === 1) {
          return NextResponse.json({
            error: 'Cannot unset the default warehouse. Set another warehouse as default first.'
          }, { status: 400 })
        }
      }

      // If this warehouse is being set as default, unset the current default (RLS scopes)
      if (isDefault === true && !existing.isDefault) {
        await db.update(warehouses)
          .set({ isDefault: false })
          .where(eq(warehouses.isDefault, true))
      }

      // If deactivating, check if warehouse is in use (RLS scopes)
      if (isActive === false && existing.isActive) {
        // Check for pending transfers
        const pendingTransfers = await db.query.stockTransfers.findFirst({
          where: and(
            or(
              eq(stockTransfers.fromWarehouseId, id),
              eq(stockTransfers.toWarehouseId, id)
            ),
            sql`status NOT IN ('completed', 'cancelled')`
          ),
        })

        if (pendingTransfers) {
          return NextResponse.json({
            error: 'Cannot deactivate warehouse with pending stock transfers'
          }, { status: 400 })
        }

        // Issue #69: Check for open work orders using this warehouse
        const openWorkOrders = await db.query.workOrders.findFirst({
          where: and(
            eq(workOrders.warehouseId, id),
            sql`${workOrders.status} NOT IN ('completed', 'invoiced', 'cancelled')`
          ),
        })
        if (openWorkOrders) {
          return NextResponse.json({
            error: 'Cannot deactivate warehouse with open work orders'
          }, { status: 400 })
        }

        // Issue #69: Check for open POS sessions using this warehouse
        const openPOS = await db.query.posOpeningEntries.findFirst({
          where: and(
            eq(posOpeningEntries.warehouseId, id),
            eq(posOpeningEntries.status, 'open')
          ),
        })
        if (openPOS) {
          return NextResponse.json({
            error: 'Cannot deactivate warehouse with open POS sessions'
          }, { status: 400 })
        }
      }

      const [updated] = await db.update(warehouses)
        .set({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          address,
          phone,
          email,
          isDefault: isDefault ?? existing.isDefault,
          isActive: isActive ?? existing.isActive,
          updatedAt: new Date(),
        })
        .where(eq(warehouses.id, id))
        .returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'warehouse', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/warehouses/[id]', error)
    return NextResponse.json({ error: 'Failed to update warehouse' }, { status: 500 })
  }
}

// DELETE warehouse
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify warehouse exists (RLS scopes the query)
      const existing = await db.query.warehouses.findFirst({
        where: eq(warehouses.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
      }

      // Cannot delete default warehouse
      if (existing.isDefault) {
        return NextResponse.json({
          error: 'Cannot delete the default warehouse. Set another warehouse as default first.'
        }, { status: 400 })
      }

      // Check for stock in warehouse (RLS scopes the query)
      const hasStock = await db.query.warehouseStock.findFirst({
        where: and(
          eq(warehouseStock.warehouseId, id),
          sql`current_stock > 0`
        ),
      })

      if (hasStock) {
        return NextResponse.json({
          error: 'Cannot delete warehouse with stock. Transfer or adjust stock first.'
        }, { status: 400 })
      }

      // Check for pending transfers (RLS scopes the query)
      const pendingTransfers = await db.query.stockTransfers.findFirst({
        where: and(
          or(
            eq(stockTransfers.fromWarehouseId, id),
            eq(stockTransfers.toWarehouseId, id)
          ),
          sql`status NOT IN ('completed', 'cancelled')`
        ),
      })

      if (pendingTransfers) {
        return NextResponse.json({
          error: 'Cannot delete warehouse with pending stock transfers'
        }, { status: 400 })
      }

      // Delete related records first (in order) - RLS scopes all queries
      // 1. Delete POS profiles
      await db.delete(posProfiles).where(eq(posProfiles.warehouseId, id))

      // 2. Delete user-warehouse assignments
      await db.delete(userWarehouses).where(eq(userWarehouses.warehouseId, id))

      // 3. Delete empty warehouse stock records
      await db.delete(warehouseStock).where(eq(warehouseStock.warehouseId, id))

      // 4. Delete the warehouse
      const [deleted] = await db.delete(warehouses)
        .where(eq(warehouses.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'warehouse', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/warehouses/[id]', error)
    return NextResponse.json({ error: 'Failed to delete warehouse' }, { status: 500 })
  }
}
