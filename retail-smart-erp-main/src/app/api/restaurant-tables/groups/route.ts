import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { tableGroups } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET all active table groups with member tables and server info
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
      const groups = await db.query.tableGroups.findMany({
        where: eq(tableGroups.status, 'active'),
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
        orderBy: (tg, { desc }) => [desc(tg.createdAt)],
      })

      return NextResponse.json(groups)
    })
  } catch (error) {
    logError('api/restaurant-tables/groups', error)
    return NextResponse.json(
      { error: 'Failed to fetch table groups' },
      { status: 500 }
    )
  }
}
