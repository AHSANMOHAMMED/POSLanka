import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { restaurantTables } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { updateTableLayoutSchema } from '@/lib/validation/schemas/restaurant'
import { getBranchScope, canAccessBranch, branchDeniedResponse } from '@/lib/auth/branch-access'

// PUT batch update table positions
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageTables')
    if (permError) return permError

    const parsed = await validateBody(request, updateTableLayoutSchema)
    if (!parsed.success) return parsed.response
    const { tables } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // K4: a branch-restricted user only moves their own branches' tables
      const scope = await getBranchScope(session, db)
      if (scope && tables.length > 0) {
        const rows = await db.select({ warehouseId: restaurantTables.warehouseId }).from(restaurantTables)
          .where(inArray(restaurantTables.id, tables.map((t) => t.id)))
        if (rows.some((r) => !canAccessBranch(scope, r.warehouseId))) return branchDeniedResponse(scope, db)
      }

      await db.transaction(async (tx) => {
        for (const table of tables) {
          await tx.update(restaurantTables)
            .set({
              positionX: table.positionX,
              positionY: table.positionY,
              width: table.width,
              height: table.height,
              shape: table.shape,
              rotation: table.rotation,
            })
            .where(eq(restaurantTables.id, table.id))
        }
      })

      logAndBroadcast(session.user.tenantId, 'table', 'updated', 'layout')

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/restaurant-tables/layout', error)
    return NextResponse.json({ error: 'Failed to update layout' }, { status: 500 })
  }
}
