import { NextRequest } from 'next/server'
import { z } from 'zod'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { items, warehouseStock, warehouses } from '@/lib/db/schema'
import { withApiKey } from '@/lib/auth/api-keys'
import { v1Iso, v1Page, v1PageSchema, v1Query } from '@/lib/api-v1'

const listSchema = v1PageSchema.extend({
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  updatedSince: z.coerce.date().optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
})

// GET /api/v1/stock — stock levels per item and warehouse (scope stock:read)
export async function GET(request: NextRequest) {
  return withApiKey(request, 'stock:read', async ({ session }) => {
    const q = v1Query(request, listSchema)
    if (!q.ok) return q.response
    const { page, pageSize, warehouseId, itemId, updatedSince } = q.data

    return withTenant(session.user.tenantId, async (db) => {
      const conditions = [eq(items.trackStock, true)]
      if (warehouseId) conditions.push(eq(warehouseStock.warehouseId, warehouseId))
      if (itemId) conditions.push(eq(warehouseStock.itemId, itemId))
      if (updatedSince) conditions.push(gte(warehouseStock.updatedAt, updatedSince))
      const where = and(...conditions)
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(warehouseStock)
        .innerJoin(items, eq(items.id, warehouseStock.itemId))
        .where(where)
      const rows = await db
        .select({
          itemId: warehouseStock.itemId,
          itemCode: items.itemCode,
          sku: items.sku,
          barcode: items.barcode,
          itemName: items.name,
          warehouseId: warehouseStock.warehouseId,
          warehouseName: warehouses.name,
          currentStock: warehouseStock.currentStock,
          reservedStock: warehouseStock.reservedStock,
          minStock: warehouseStock.minStock,
          updatedAt: warehouseStock.updatedAt,
        })
        .from(warehouseStock)
        .innerJoin(items, eq(items.id, warehouseStock.itemId))
        .innerJoin(warehouses, eq(warehouses.id, warehouseStock.warehouseId))
        .where(where)
        .orderBy(asc(items.name), asc(warehouseStock.warehouseId))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
      return v1Page(rows.map((r) => ({
        ...r,
        availableStock: Math.max(0, Number(r.currentStock) - Number(r.reservedStock || 0)).toFixed(3),
        updatedAt: v1Iso(r.updatedAt),
      })), page, pageSize, Number(count))
    })
  })
}
