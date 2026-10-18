import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantTables } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateRestaurantTableSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single restaurant table
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

    return await withTenant(session.user.tenantId, async (db) => {
      const table = await db.query.restaurantTables.findFirst({
        where: eq(restaurantTables.id, id),
      })

      if (!table) {
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }

      return NextResponse.json(table)
    })
  } catch (error) {
    logError('api/restaurant-tables/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch restaurant table' }, { status: 500 })
  }
}

// PUT update restaurant table
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageTables')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateRestaurantTableSchema)
    if (!parsed.success) return parsed.response
    const { name, area, capacity, status, positionX, positionY, width, height, shape, rotation } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify table exists
      const existing = await db.query.restaurantTables.findFirst({
        where: eq(restaurantTables.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }

      // Check for duplicate name (if name is being changed)
      if (name && name !== existing.name) {
        const duplicate = await db.query.restaurantTables.findFirst({
          where: and(
            eq(restaurantTables.name, name),
            eq(restaurantTables.isActive, true),
            ne(restaurantTables.id, id)
          ),
        })

        if (duplicate) {
          return NextResponse.json({ error: 'A table with this name already exists' }, { status: 400 })
        }
      }

      // Build update data
      const updateData: Record<string, unknown> = {}

      if (name !== undefined) updateData.name = name
      if (area !== undefined) updateData.area = area || null
      if (capacity !== undefined) updateData.capacity = capacity
      if (status !== undefined) updateData.status = status
      if (positionX !== undefined) updateData.positionX = positionX
      if (positionY !== undefined) updateData.positionY = positionY
      if (width !== undefined) updateData.width = width
      if (height !== undefined) updateData.height = height
      if (shape !== undefined) updateData.shape = shape
      if (rotation !== undefined) updateData.rotation = rotation

      const [updated] = await db.update(restaurantTables)
        .set(updateData)
        .where(eq(restaurantTables.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'table', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/restaurant-tables/[id]', error)
    return NextResponse.json({ error: 'Failed to update restaurant table' }, { status: 500 })
  }
}

// DELETE restaurant table (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageTables')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify table exists
      const existing = await db.query.restaurantTables.findFirst({
        where: eq(restaurantTables.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }

      // Soft delete
      await db.update(restaurantTables)
        .set({ isActive: false })
        .where(eq(restaurantTables.id, id))

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'table', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/restaurant-tables/[id]', error)
    return NextResponse.json({ error: 'Failed to delete restaurant table' }, { status: 500 })
  }
}
