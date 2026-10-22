import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { categories, items } from '@/lib/db/schema'
import { withApiKey } from '@/lib/auth/api-keys'
import { isUuid } from '@/lib/offline/sync-policy'
import { ITEM_V1_COLUMNS, serializeItem, stockByItem, v1Error } from '@/lib/api-v1'

// GET /api/v1/items/{id} — one item with stock per warehouse (scope items:read)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiKey(request, 'items:read', async ({ session }) => {
    const { id } = await params
    if (!isUuid(id)) return v1Error(400, 'Invalid item id', 'VALIDATION_ERROR')
    return withTenant(session.user.tenantId, async (db) => {
      const [row] = await db
        .select(ITEM_V1_COLUMNS)
        .from(items)
        .leftJoin(categories, eq(categories.id, items.categoryId))
        .where(eq(items.id, id))
        .limit(1)
      if (!row) return v1Error(404, 'Item not found', 'NOT_FOUND')
      const stock = await stockByItem(db, [row.id])
      return NextResponse.json({ data: serializeItem(row, stock.get(row.id)) })
    })
  })
}
