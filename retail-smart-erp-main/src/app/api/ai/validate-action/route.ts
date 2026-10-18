import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { purchaseItems, items } from '@/lib/db/schema'
import { eq, and, isNotNull, inArray, sql } from 'drizzle-orm'
import {
  validateSaleWarnings,
  validateReturnWarnings,
  validatePurchaseWarnings,
  validateStockWarnings,
  validatePriceChangeWarnings,
  validatePaymentWarnings,
  type SmartWarning,
} from '@/lib/ai/smart-warnings'
import { validateBody } from '@/lib/validation/helpers'
import { validateActionSchema } from '@/lib/validation/schemas/ai'

export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, validateActionSchema)
  if (!parsed.success) return parsed.response
  const { action } = parsed.data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = parsed.data.data as any

  const result = await withAuthTenant(async (session, db) => {

    let warnings: SmartWarning[] = []

    switch (action) {
      case 'sale':
        warnings = validateSaleWarnings(data)
        break

      case 'return':
        warnings = validateReturnWarnings(data)
        break

      case 'purchase': {
        // Enrich items with historical pricing
        const itemIds = (data.items || [])
          .map((i: { itemId?: string }) => i.itemId)
          .filter(Boolean) as string[]

        let priceMap: Record<string, { lastPrice: number; avgPrice: number }> = {}
        if (itemIds.length > 0) {
          const priceData = await db
            .select({
              itemId: purchaseItems.itemId,
              lastPrice: sql<number>`(
                SELECT CAST(pi2.unit_price AS float)
                FROM purchase_items pi2
                WHERE pi2.item_id = ${purchaseItems.itemId}
                  AND pi2.tenant_id = ${purchaseItems.tenantId}
                ORDER BY pi2.id DESC LIMIT 1
              )`,
              avgPrice: sql<number>`AVG(CAST(${purchaseItems.unitPrice} AS float))`,
            })
            .from(purchaseItems)
            .where(
              and(
                isNotNull(purchaseItems.itemId),
                inArray(purchaseItems.itemId, itemIds)
              )
            )
            .groupBy(purchaseItems.itemId, purchaseItems.tenantId)

          priceMap = Object.fromEntries(
            priceData
              .filter(p => p.itemId)
              .map(p => [p.itemId!, { lastPrice: p.lastPrice, avgPrice: p.avgPrice }])
          )
        }

        const enrichedItems = (data.items || []).map((item: {
          itemId?: string
          itemName: string
          quantity: number
          unitPrice: number
        }) => ({
          ...item,
          lastPurchasePrice: item.itemId ? priceMap[item.itemId]?.lastPrice : undefined,
          averagePurchasePrice: item.itemId ? priceMap[item.itemId]?.avgPrice : undefined,
        }))

        warnings = validatePurchaseWarnings({ ...data, items: enrichedItems })
        break
      }

      case 'stock_adjustment':
        warnings = validateStockWarnings(data)
        break

      case 'price_change': {
        // Fetch current item prices
        if (data.itemId) {
          const [currentItem] = await db
            .select({
              sellingPrice: items.sellingPrice,
              costPrice: items.costPrice,
              name: items.name,
            })
            .from(items)
            .where(eq(items.id, data.itemId))
            .limit(1)

          if (currentItem) {
            warnings = validatePriceChangeWarnings({
              itemName: data.itemName || currentItem.name,
              oldSellingPrice: parseFloat(currentItem.sellingPrice || '0'),
              newSellingPrice: parseFloat(data.newSellingPrice || '0'),
              oldCostPrice: parseFloat(currentItem.costPrice || '0'),
              newCostPrice: parseFloat(data.newCostPrice || '0'),
            })
          }
        }
        break
      }

      case 'payment':
        warnings = validatePaymentWarnings(data)
        break

      default:
        return { error: `Unknown action: ${action}`, status: 400 }
    }

    return { warnings, timestamp: new Date().toISOString() }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if ('error' in result && 'status' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status as number })
  }

  return NextResponse.json(result)
}
