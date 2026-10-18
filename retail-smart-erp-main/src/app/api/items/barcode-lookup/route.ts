import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { items, warehouseStock } from '@/lib/db/schema'
import { eq, or, and } from 'drizzle-orm'
import { validateSearchParams } from '@/lib/validation/helpers'
import { barcodeLookupSchema } from '@/lib/validation/schemas/items'

// GET /api/items/barcode-lookup?barcode=xxx&warehouseId=yyy
// Fast exact-match barcode/PLU lookup for supermarket POS auto-add
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, barcodeLookupSchema)
    if (!parsed.success) return parsed.response
    const { barcode, warehouseId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Exact match on barcode or PLU code
      const result = await db.query.items.findFirst({
        where: and(
          eq(items.isActive, true),
          or(
            eq(items.barcode, barcode),
            eq(items.pluCode, barcode)
          )
        ),
        with: {
          category: { columns: { name: true } },
        },
      })

      if (!result) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Get warehouse stock
      let currentStockVal = '0'
      let reservedStockVal = '0'
      let availableStockVal = '0'

      if (warehouseId) {
        const stock = await db.query.warehouseStock.findFirst({
          where: and(
            eq(warehouseStock.itemId, result.id),
            eq(warehouseStock.warehouseId, warehouseId)
          ),
        })
        if (stock) {
          currentStockVal = stock.currentStock || '0'
          reservedStockVal = stock.reservedStock || '0'
          availableStockVal = String(Math.round((parseFloat(currentStockVal) - parseFloat(reservedStockVal)) * 100) / 100)
        }
      }

      return NextResponse.json({
        id: result.id,
        name: result.name,
        sku: result.sku,
        barcode: result.barcode,
        sellingPrice: result.sellingPrice,
        currentStock: currentStockVal,
        reservedStock: reservedStockVal,
        availableStock: availableStockVal,
        trackStock: result.trackStock,
        trackSerialNumbers: result.trackSerialNumbers,
        oemPartNumber: result.oemPartNumber,
        supplierPartNumber: result.supplierPartNumber,
        alternatePartNumbers: result.alternatePartNumbers,
        categoryId: result.categoryId,
        categoryName: result.category?.name || null,
        isWeighable: result.isWeighable,
        pluCode: result.pluCode,
        coreCharge: result.coreCharge,
      })
    })
  } catch (error) {
    console.error('Barcode lookup error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
