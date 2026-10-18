import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { warehouseStock, warehouses, items } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET warehouse stock details for a specific item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify item exists (RLS scopes to tenant)
      const item = await db.query.items.findFirst({
        where: eq(items.id, id),
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Get all warehouses for the tenant (RLS scopes)
      const allWarehouses = await db.query.warehouses.findMany({
        where: eq(warehouses.isActive, true),
        orderBy: (warehouses, { asc }) => [asc(warehouses.name)],
      })

      // Get stock entries for this item (RLS scopes)
      const stockEntries = await db.query.warehouseStock.findMany({
        where: eq(warehouseStock.itemId, id),
      })

      // Create a map of stock by warehouse
      const stockByWarehouse = new Map(
        stockEntries.map(s => [s.warehouseId, s])
      )

      // Build response with all warehouses, including those with no stock
      const warehouseStockDetails = allWarehouses.map(warehouse => {
        const stock = stockByWarehouse.get(warehouse.id)
        return {
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          warehouseCode: warehouse.code,
          isDefault: warehouse.isDefault,
          currentStock: stock?.currentStock || '0',
          minStock: stock?.minStock || '0',
          binLocation: stock?.binLocation || null,
          lastUpdated: stock?.updatedAt || null,
        }
      })

      // Calculate totals
      const totalStock = stockEntries.reduce(
        (sum, s) => sum + parseFloat(s.currentStock || '0'),
        0
      )

      return NextResponse.json({
        item: {
          id: item.id,
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          trackStock: item.trackStock,
        },
        totalStock: String(totalStock),
        warehouses: warehouseStockDetails,
      })
    })
  } catch (error) {
    logError('api/items/[id]/warehouse-stock', error)
    return NextResponse.json({ error: 'Failed to fetch warehouse stock' }, { status: 500 })
  }
}
