import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { items } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateParams, validateSearchParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { getItemHistory } from '@/lib/inventory/item-history'

const historyQuerySchema = z.object({
  kind: z.enum(['all', 'stock', 'fields', 'price']).default('all'),
  warehouseId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

// GET /api/items/[id]/history?kind=all|stock|fields|price&warehouseId&cursor&limit
// Merged newest-first timeline: stock ledger (before → after, who), field/price
// changes (item_change_log) and cost history. Keyset cursor in `nextCursor`.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const denied = requirePermission(session, 'manageItems')
    if (denied && requirePermission(session, 'manageInventory') && requirePermission(session, 'viewReports')) {
      return denied
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const qs = validateSearchParams(request, historyQuerySchema)
    if (!qs.success) return qs.response

    return await withTenant(session.user.tenantId, async (db) => {
      const [item] = await db.select({ id: items.id }).from(items).where(eq(items.id, id)).limit(1)
      if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

      const page = await getItemHistory(db, { itemId: id, ...qs.data })
      return NextResponse.json(page)
    })
  } catch (error) {
    logError('api/items/[id]/history', error)
    return NextResponse.json({ error: 'Failed to fetch item history' }, { status: 500 })
  }
}
