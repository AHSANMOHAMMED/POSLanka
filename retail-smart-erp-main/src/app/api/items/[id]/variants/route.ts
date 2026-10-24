import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { items, warehouseStock } from '@/lib/db/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { z } from 'zod'
import { validateBody } from '@/lib/validation'
import { createItem } from '@/lib/inventory/create-item'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { toApiError } from '@/lib/db/errors'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, ['stock', 'selling'])
    if (moduleError) return moduleError

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

const generateSchema = z.object({
  /** e.g. { Size: ['S', 'M', 'L'], Colour: ['Black', 'White'] } → 6 variants (max 3 attributes, 200 variants) */
  attributes: z.record(z.string().trim().min(1).max(30), z.array(z.string().trim().min(1).max(40)).min(1).max(50))
    .refine((a) => Object.keys(a).length >= 1 && Object.keys(a).length <= 3, 'Use 1 to 3 attributes (e.g. Size, Colour)'),
  /** Optional price for every new variant (defaults to the parent's) */
  sellingPrice: z.coerce.number().min(0).optional(),
})

/**
 * POST /api/items/[id]/variants — create the size / colour variants of a product: one item per
 * combination, copying the parent's category, prices, tax, unit and tracking, each with its own
 * item code, barcode and stock. Combinations that already exist are skipped. manageItems.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const parsed = await validateBody(request, generateSchema)
    if (!parsed.success) return parsed.response
    const { id: parentId } = await params
    const { tenantId, id: userId } = session.user

    // Every combination of the attribute values
    const keys = Object.keys(parsed.data.attributes)
    let combos: Array<Record<string, string>> = [{}]
    for (const k of keys) {
      const values = Array.from(new Set(parsed.data.attributes[k]))
      combos = combos.flatMap((c) => values.map((v) => ({ ...c, [k]: v })))
    }
    if (combos.length > 200) return NextResponse.json({ error: `That makes ${combos.length} variants; the limit is 200 per product.` }, { status: 400 })

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const [parent] = await tx.select().from(items).where(and(eq(items.id, parentId), eq(items.tenantId, tenantId))).limit(1)
      if (!parent) return { status: 404 as const }
      if (parent.parentItemId) return { status: 400 as const, error: 'This item is itself a variant; add variants to its main product.' }

      const existing = await tx.select({ attrs: items.variantAttributes }).from(items)
        .where(and(eq(items.tenantId, tenantId), eq(items.parentItemId, parentId)))
      const key = (a: Record<string, string> | null | undefined) => JSON.stringify(Object.keys(a || {}).sort().map((k) => [k.toLowerCase(), String(a![k]).toLowerCase()]))
      const have = new Set(existing.map((e) => key(e.attrs)))

      const created: Array<{ id: string; name: string; barcode: string | null; itemCode: string; variantAttributes: Record<string, string> }> = []
      for (const attrs of combos) {
        if (have.has(key(attrs))) continue
        const label = keys.map((k) => attrs[k]).join(' / ')
        const { item } = await createItem(tx, {
          tenantId, userId, source: 'manual',
          data: {
            name: `${parent.name} - ${label}`.slice(0, 255),
            sku: parent.sku ? `${parent.sku}-${keys.map((k) => attrs[k]).join('-')}`.toUpperCase().replace(/\s+/g, '').slice(0, 100) : null,
            categoryId: parent.categoryId,
            brand: parent.brand,
            description: parent.description,
            costPrice: parent.costPrice,
            sellingPrice: parsed.data.sellingPrice !== undefined ? String(parsed.data.sellingPrice) : parent.sellingPrice,
            unit: parent.unit,
            trackStock: parent.trackStock,
            trackBatches: parent.trackBatches,
            productType: parent.productType,
            taxTemplateId: parent.taxTemplateId,
            supplierId: parent.supplierId,
            imageUrl: parent.imageUrl,
            parentItemId: parent.id,
            variantAttributes: attrs,
          },
        })
        created.push({ id: item.id, name: item.name, barcode: item.barcode, itemCode: item.itemCode, variantAttributes: attrs })
      }
      return { status: 200 as const, created, skipped: combos.length - created.length }
    })

    if (result.status === 404) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    if (result.status === 400) return NextResponse.json({ error: result.error }, { status: 400 })
    for (const c of result.created) logAndBroadcast(tenantId, 'item', 'created', c.id, { userId, entityName: c.name })
    return NextResponse.json({ created: result.created, skipped: result.skipped }, { status: 201 })
  } catch (error) {
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/items/[id]/variants POST', error)
    return NextResponse.json({ error: 'Failed to create variants' }, { status: 500 })
  }
}
