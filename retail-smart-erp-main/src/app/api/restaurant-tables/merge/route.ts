import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantTables, tableGroups, tableGroupMembers } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { mergeTablesSchema } from '@/lib/validation/schemas/restaurant'

// POST merge multiple tables into a group
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

    const parsed = await validateBody(request, mergeTablesSchema)
    if (!parsed.success) return parsed.response
    const { tableIds, name, serverId, notes } = parsed.data

    const userId = await resolveUserIdRequired(session)

    return await withTenant(session.user.tenantId, async (db) => {
      // Fetch all specified tables
      const tables = await db
        .select()
        .from(restaurantTables)
        .where(
          and(
            inArray(restaurantTables.id, tableIds),
            eq(restaurantTables.isActive, true)
          )
        )

      if (tables.length !== tableIds.length) {
        return NextResponse.json(
          { error: 'One or more tables not found or inactive' },
          { status: 404 }
        )
      }

      // Check that none of the tables are already in a group
      const alreadyGrouped = tables.filter((t) => t.tableGroupId)
      if (alreadyGrouped.length > 0) {
        const names = alreadyGrouped.map((t) => t.name).join(', ')
        return NextResponse.json(
          { error: `Tables already in a group: ${names}. Split them first.` },
          { status: 400 }
        )
      }

      // Check that tables are available or occupied (not unavailable)
      const invalidTables = tables.filter(
        (t) => t.status === 'unavailable'
      )
      if (invalidTables.length > 0) {
        const names = invalidTables.map((t) => t.name).join(', ')
        return NextResponse.json(
          { error: `Cannot merge unavailable tables: ${names}` },
          { status: 400 }
        )
      }

      // Calculate combined capacity
      const combinedCapacity = tables.reduce((sum, t) => sum + t.capacity, 0)

      // Generate group name if not provided
      const groupName =
        name || `Merged: ${tables.map((t) => t.name).join(' + ')}`

      // Create the table group
      const [newGroup] = await db
        .insert(tableGroups)
        .values({
          tenantId: session.user.tenantId,
          name: groupName,
          combinedCapacity,
          status: 'active',
          serverId: serverId || null,
          notes: notes || null,
          createdBy: userId,
        })
        .returning()

      // Create group member records
      const memberValues = tableIds.map((tableId: string) => ({
        tenantId: session.user.tenantId,
        tableGroupId: newGroup.id,
        tableId,
      }))

      await db.insert(tableGroupMembers).values(memberValues)

      // Update each table's tableGroupId and serverId
      await db
        .update(restaurantTables)
        .set({
          tableGroupId: newGroup.id,
          ...(serverId ? { serverId } : {}),
          updatedAt: new Date(),
        })
        .where(inArray(restaurantTables.id, tableIds))

      // Broadcast changes
      logAndBroadcast(session.user.tenantId, 'table-group', 'created', newGroup.id)
      logAndBroadcast(session.user.tenantId, 'table', 'updated', tableIds[0])

      return NextResponse.json(newGroup, { status: 201 })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/restaurant-tables/merge', error)
    return NextResponse.json(
      { error: 'Failed to merge tables' },
      { status: 500 }
    )
  }
}
