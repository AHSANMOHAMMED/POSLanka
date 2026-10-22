import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { items, warehouseStock } from '@/lib/db/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: parentId } = await params
    const { searchParams } = new URL(request.url)
    const warehouseId = searchParams.get('warehouseId')

    return await withTenant(session.user.tenantId, async (db) => {
      // Find parent item
      const parent = await db.query.items.findFirst({
        where: and(eq(items.id, parentId), eq(items.isActive, true)),
        with: {
          category: true,
        },
      })

      if (!parent) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Find all child variants
      const childVariants = await db.query.items.findMany({
        where: and(eq(items.parentItemId, parentId), eq(items.isActive, true)),
        orderBy: (items, { asc }) => [asc(items.name)],
      })

      if (childVariants.length === 0) {
        return NextResponse.json({
          parent,
          variants: [],
          attributeKeys: [],
          attributeValues: {},
        })
      }

      const variantIds = childVariants.map((v) => v.id)
      const stockMap = new Map<string, { currentStock: number; reservedStock: number; availableStock: number }>()

      if (warehouseId) {
        const wsData = await db
          .select({
            itemId: warehouseStock.itemId,
            currentStock: warehouseStock.currentStock,
            reservedStock: warehouseStock.reservedStock,
          })
          .from(warehouseStock)
          .where(and(eq(warehouseStock.warehouseId, warehouseId), inArray(warehouseStock.itemId, variantIds)))

        for (const ws of wsData) {
          const current = parseFloat(ws.currentStock) || 0
          const reserved = parseFloat(ws.reservedStock || '0') || 0
          stockMap.set(ws.itemId, {
            currentStock: current,
            reservedStock: reserved,
            availableStock: Math.max(0, current - reserved),
          })
        }
      } else {
        const aggData = await db
          .select({
            itemId: warehouseStock.itemId,
            totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
            totalReserved: sql<string>`COALESCE(SUM(CAST(${warehouseStock.reservedStock} AS DECIMAL)), 0)`,
          })
          .from(warehouseStock)
          .where(inArray(warehouseStock.itemId, variantIds))
          .groupBy(warehouseStock.itemId)

        for (const agg of aggData) {
          const current = parseFloat(agg.totalStock) || 0
          const reserved = parseFloat(agg.totalReserved || '0') || 0
          stockMap.set(agg.itemId, {
            currentStock: current,
            reservedStock: reserved,
            availableStock: Math.max(0, current - reserved),
          })
        }
      }

      // Collect attribute keys and values
      const attributeKeysSet = new Set<string>()
      const attributeValuesMap: Record<string, Set<string>> = {}

      const mappedVariants = childVariants.map((v) => {
        const stock = stockMap.get(v.id) || {
          currentStock: 0,
          reservedStock: 0,
          availableStock: v.trackStock ? 0 : 999999,
        }

        const rawAttrs = (v.variantAttributes || {}) as Record<string, string>
        for (const [k, val] of Object.entries(rawAttrs)) {
          if (val) {
            attributeKeysSet.add(k)
            if (!attributeValuesMap[k]) attributeValuesMap[k] = new Set()
            attributeValuesMap[k].add(val)
          }
        }

        return {
          ...v,
          currentStock: String(stock.currentStock),
          reservedStock: String(stock.reservedStock),
          availableStock: String(v.trackStock ? stock.availableStock : 999999),
        }
      })

      const attributeValuesFormatted: Record<string, string[]> = {}
      for (const [k, valSet] of Object.entries(attributeValuesMap)) {
        attributeValuesFormatted[k] = Array.from(valSet)
      }

      return NextResponse.json({
        parent,
        variants: mappedVariants,
        attributeKeys: Array.from(attributeKeysSet),
        attributeValues: attributeValuesFormatted,
      })
    })
  } catch (error) {
    logError('api/items/[id]/variants', error)
    return NextResponse.json({ error: 'Failed to fetch variants' }, { status: 500 })
  }
}
