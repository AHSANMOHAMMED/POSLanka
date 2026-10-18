import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantTables, tableGroups, tableGroupMembers } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateTableGroupSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single table group detail with member tables
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
      const group = await db.query.tableGroups.findFirst({
        where: eq(tableGroups.id, id),
        with: {
          members: {
            with: {
              table: true,
            },
          },
          server: {
            columns: {
              id: true,
              fullName: true,
              role: true,
            },
          },
        },
      })

      if (!group) {
        return NextResponse.json({ error: 'Table group not found' }, { status: 404 })
      }

      return NextResponse.json(group)
    })
  } catch (error) {
    logError('api/restaurant-tables/merge/[id]', error)
    return NextResponse.json(
      { error: 'Failed to fetch table group' },
      { status: 500 }
    )
  }
}

// PUT update a table group (name, server, notes)
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
    const parsed = await validateBody(request, updateTableGroupSchema)
    if (!parsed.success) return parsed.response
    const { name, serverId, notes } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify group exists and is active
      const existing = await db.query.tableGroups.findFirst({
        where: and(eq(tableGroups.id, id), eq(tableGroups.status, 'active')),
      })

      if (!existing) {
        return NextResponse.json(
          { error: 'Table group not found or already disbanded' },
          { status: 404 }
        )
      }

      // Build update data
      const updateData: Record<string, unknown> = {}
      if (name !== undefined) updateData.name = name
      if (serverId !== undefined) updateData.serverId = serverId || null
      if (notes !== undefined) updateData.notes = notes || null

      const [updated] = await db
        .update(tableGroups)
        .set(updateData)
        .where(eq(tableGroups.id, id))
        .returning()

      // If server was changed, update all member tables too
      if (serverId !== undefined) {
        const members = await db.query.tableGroupMembers.findMany({
          where: eq(tableGroupMembers.tableGroupId, id),
        })

        const tableIds = members.map((m) => m.tableId)
        if (tableIds.length > 0) {
          await db
            .update(restaurantTables)
            .set({ serverId: serverId || null, updatedAt: new Date() })
            .where(inArray(restaurantTables.id, tableIds))
        }
      }

      // Broadcast changes
      logAndBroadcast(session.user.tenantId, 'table-group', 'updated', id)
      logAndBroadcast(session.user.tenantId, 'table', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/restaurant-tables/merge/[id]', error)
    return NextResponse.json(
      { error: 'Failed to update table group' },
      { status: 500 }
    )
  }
}

// DELETE disband/split a table group
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
      // Verify group exists and is active
      const existing = await db.query.tableGroups.findFirst({
        where: and(eq(tableGroups.id, id), eq(tableGroups.status, 'active')),
        with: {
          members: true,
        },
      })

      if (!existing) {
        return NextResponse.json(
          { error: 'Table group not found or already disbanded' },
          { status: 404 }
        )
      }

      // Clear tableGroupId on all member tables
      const tableIds = existing.members.map((m) => m.tableId)
      if (tableIds.length > 0) {
        await db
          .update(restaurantTables)
          .set({ tableGroupId: null, updatedAt: new Date() })
          .where(inArray(restaurantTables.id, tableIds))
      }

      // Set group status to disbanded
      await db
        .update(tableGroups)
        .set({
          status: 'disbanded',
          disbandedAt: new Date(),
        })
        .where(eq(tableGroups.id, id))

      // Broadcast changes
      logAndBroadcast(session.user.tenantId, 'table-group', 'deleted', id)
      logAndBroadcast(session.user.tenantId, 'table', 'updated', tableIds[0] || id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/restaurant-tables/merge/[id]', error)
    return NextResponse.json(
      { error: 'Failed to disband table group' },
      { status: 500 }
    )
  }
}
