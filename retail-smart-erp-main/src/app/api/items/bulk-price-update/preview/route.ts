import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { items } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { bulkPriceUpdatePreviewSchema } from '@/lib/validation/schemas/items'

// POST - Preview bulk price updates (shows current vs new prices)
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, bulkPriceUpdatePreviewSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageItems')
    if (permError) return { error: permError }

    const itemIds = body.updates.map(u => u.itemId)
    const currentItems = await db.select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      costPrice: items.costPrice,
      sellingPrice: items.sellingPrice,
    })
      .from(items)
      .where(inArray(items.id, itemIds))

    const itemMap = new Map(currentItems.map(i => [i.id, i]))

    const preview = body.updates.map(update => {
      const current = itemMap.get(update.itemId)
      if (!current) return { itemId: update.itemId, error: 'Not found' }

      return {
        itemId: update.itemId,
        name: current.name,
        sku: current.sku,
        currentCostPrice: current.costPrice,
        newCostPrice: update.costPrice !== undefined ? update.costPrice.toFixed(2) : current.costPrice,
        costPriceChanged: update.costPrice !== undefined && update.costPrice.toFixed(2) !== current.costPrice,
        currentSellingPrice: current.sellingPrice,
        newSellingPrice: update.sellingPrice !== undefined ? update.sellingPrice.toFixed(2) : current.sellingPrice,
        sellingPriceChanged: update.sellingPrice !== undefined && update.sellingPrice.toFixed(2) !== current.sellingPrice,
      }
    })

    return { data: preview }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
