import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleInventory } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET vehicle inventory stats (counts by status)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      // Get counts grouped by status in a single query
      const statusCounts = await db
        .select({
          status: vehicleInventory.status,
          count: sql<number>`count(*)::int`,
        })
        .from(vehicleInventory)
        .where(eq(vehicleInventory.isActive, true))
        .groupBy(vehicleInventory.status)

      // Build result from grouped counts
      let total = 0
      let available = 0
      let reserved = 0
      let sold = 0

      for (const row of statusCounts) {
        const count = row.count
        total += count
        switch (row.status) {
          case 'available': available = count; break
          case 'reserved': reserved = count; break
          case 'sold': sold = count; break
        }
      }

      return NextResponse.json({ total, available, reserved, sold })
    })
  } catch (error) {
    logError('api/vehicle-inventory/stats', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle stats' }, { status: 500 })
  }
}
