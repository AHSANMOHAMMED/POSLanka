import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantTables, users } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET list all server assignments (tables with their assigned servers)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      // Get all active tables with server info
      const tablesWithServers = await db
        .select({
          tableId: restaurantTables.id,
          tableName: restaurantTables.name,
          tableArea: restaurantTables.area,
          tableStatus: restaurantTables.status,
          tableCapacity: restaurantTables.capacity,
          tableGroupId: restaurantTables.tableGroupId,
          serverId: restaurantTables.serverId,
          serverName: users.fullName,
          serverRole: users.role,
        })
        .from(restaurantTables)
        .leftJoin(users, eq(restaurantTables.serverId, users.id))
        .where(eq(restaurantTables.isActive, true))
        .orderBy(users.fullName, restaurantTables.name)

      // Group by server for display
      const serverMap = new Map<
        string | null,
        {
          serverId: string | null
          serverName: string | null
          serverRole: string | null
          tables: Array<{
            id: string
            name: string
            area: string | null
            status: string
            capacity: number
            tableGroupId: string | null
          }>
        }
      >()

      for (const row of tablesWithServers) {
        const key = row.serverId || '__unassigned__'
        if (!serverMap.has(key)) {
          serverMap.set(key, {
            serverId: row.serverId,
            serverName: row.serverName,
            serverRole: row.serverRole,
            tables: [],
          })
        }
        serverMap.get(key)!.tables.push({
          id: row.tableId,
          name: row.tableName,
          area: row.tableArea,
          status: row.tableStatus,
          capacity: row.tableCapacity,
          tableGroupId: row.tableGroupId,
        })
      }

      // Convert to array, putting unassigned at the end
      const result = Array.from(serverMap.values()).sort((a, b) => {
        if (!a.serverId) return 1
        if (!b.serverId) return -1
        return (a.serverName || '').localeCompare(b.serverName || '')
      })

      // Also get all eligible servers (waiter, chef, manager, owner roles)
      const eligibleServers = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          role: users.role,
        })
        .from(users)
        .where(
          and(
            eq(users.isActive, true),
            sql`${users.role} IN ('waiter', 'chef', 'manager', 'owner')`
          )
        )
        .orderBy(users.fullName)

      return NextResponse.json({
        assignments: result,
        servers: eligibleServers,
      })
    })
  } catch (error) {
    logError('api/restaurant-tables/server-assignments', error)
    return NextResponse.json(
      { error: 'Failed to fetch server assignments' },
      { status: 500 }
    )
  }
}
