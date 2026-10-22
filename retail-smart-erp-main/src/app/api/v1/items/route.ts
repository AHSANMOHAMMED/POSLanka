import { NextRequest } from 'next/server'
import { z } from 'zod'
import { and, asc, eq, gte, ilike, or, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { categories, items } from '@/lib/db/schema'
import { withApiKey } from '@/lib/auth/api-keys'
import { escapeLikePattern } from '@/lib/utils/sql'
import { ITEM_V1_COLUMNS, serializeItem, stockByItem, v1Page, v1PageSchema, v1Query } from '@/lib/api-v1'

const listSchema = v1PageSchema.extend({
  search: z.string().trim().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  barcode: z.string().trim().max(100).optional(),
  updatedSince: z.coerce.date().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
})

// GET /api/v1/items — items with selling price and stock per warehouse (scope items:read)
export async function GET(request: NextRequest) {
  return withApiKey(request, 'items:read', async ({ session }) => {
    const q = v1Query(request, listSchema)
    if (!q.ok) return q.response
    const { page, pageSize, search, categoryId, barcode, updatedSince, includeInactive } = q.data

    return withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (includeInactive !== 'true') conditions.push(eq(items.isActive, true))
      if (categoryId) conditions.push(eq(items.categoryId, categoryId))
      if (barcode) conditions.push(eq(items.barcode, barcode))
      if (updatedSince) conditions.push(gte(items.updatedAt, updatedSince))
      if (search) {
        const p = `%${escapeLikePattern(search)}%`
        conditions.push(or(ilike(items.name, p), ilike(items.itemCode, p), ilike(items.sku, p), ilike(items.barcode, p)))
      }
      const where = conditions.length ? and(...conditions) : undefined
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(items).where(where)
      const rows = await db
        .select(ITEM_V1_COLUMNS)
        .from(items)
        .leftJoin(categories, eq(categories.id, items.categoryId))
        .where(where)
        .orderBy(asc(items.name), asc(items.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
      const stock = await stockByItem(db, rows.map((r) => r.id))
      return v1Page(rows.map((r) => serializeItem(r, stock.get(r.id))), page, pageSize, Number(count))
    })
  })
}
