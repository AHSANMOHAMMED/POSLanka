import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { validateSearchParams } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { canSyncCatalog, fetchItemSyncPage, InvalidCursorError, ITEM_SYNC_DEFAULT_LIMIT, ITEM_SYNC_MAX_LIMIT } from '@/lib/inventory/item-sync'
import { requireModule } from '@/lib/auth/roles'
import { assertBranchAccess } from '@/lib/auth/branch-access'

const itemSyncSchema = z.object({
  warehouseId: z.string().uuid().optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(ITEM_SYNC_MAX_LIMIT).default(ITEM_SYNC_DEFAULT_LIMIT),
})

// GET /api/items/sync?warehouseId&cursor&limit — offline catalog delta sync (W6)
// → { items, deleted, nextCursor, hasMore, full, serverTime }
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, ['stock', 'selling'])
    if (moduleError) return moduleError
    if (!canSyncCatalog(session)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const parsed = validateSearchParams(request, itemSyncSchema)
    if (!parsed.success) return parsed.response

    const page = await withTenant(session.user.tenantId, async (db) => {
      // K4: offline stock of another branch is not given to branch-restricted staff
      const branchDenied = await assertBranchAccess(session, parsed.data.warehouseId, db)
      if (branchDenied) return branchDenied
      return fetchItemSyncPage(db, {
        tenantId: session.user.tenantId,
        warehouseId: parsed.data.warehouseId,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      })
    })
    if (page instanceof Response) return page
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      return NextResponse.json({ error: 'Invalid sync cursor; start a full sync', code: 'INVALID_CURSOR' }, { status: 400 })
    }
    logError('api/items/sync', error)
    return NextResponse.json({ error: 'Failed to sync items' }, { status: 500 })
  }
}
