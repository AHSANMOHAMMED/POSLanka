import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { stockTakes, stockTakeItems, warehouseStock, items, warehouses, users } from '@/lib/db/schema'
import { eq, and, desc, sql, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { stockTakesListSchema, createStockTakeSchema } from '@/lib/validation/schemas/stock'

// GET - List stock takes with pagination and filters
export async function GET(request: NextRequest) {
  const parsed = validateSearchParams(request, stockTakesListSchema)
  if (!parsed.success) return parsed.response
  const { page, pageSize, search, status, warehouseId } = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    const conditions = [eq(stockTakes.tenantId, session.user.tenantId)]

    if (status) conditions.push(eq(stockTakes.status, status))
    if (warehouseId) conditions.push(eq(stockTakes.warehouseId, warehouseId))
    if (search) conditions.push(ilike(stockTakes.countNo, `%${escapeLikePattern(search)}%`))

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(stockTakes)
      .where(and(...conditions))

    const total = Number(countResult.count)
    const totalPages = Math.ceil(total / pageSize)

    const data = await db.select({
      id: stockTakes.id,
      countNo: stockTakes.countNo,
      warehouseId: stockTakes.warehouseId,
      warehouseName: warehouses.name,
      status: stockTakes.status,
      countType: stockTakes.countType,
      totalItems: stockTakes.totalItems,
      itemsCounted: stockTakes.itemsCounted,
      varianceCount: stockTakes.varianceCount,
      totalVarianceValue: stockTakes.totalVarianceValue,
      createdBy: stockTakes.createdBy,
      createdByName: users.fullName,
      createdAt: stockTakes.createdAt,
      completedAt: stockTakes.completedAt,
    })
      .from(stockTakes)
      .leftJoin(warehouses, eq(stockTakes.warehouseId, warehouses.id))
      .leftJoin(users, eq(stockTakes.createdBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(stockTakes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return {
      data,
      pagination: { page, pageSize, total, totalPages },
    }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(result)
}

// POST - Create new stock take
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, createStockTakeSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return { error: permError }

    // Advisory lock for atomic count number generation
    await tx.execute(sql`SELECT pg_advisory_xact_lock(9)`)

    // Generate count number
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
    const existing = await tx
      .select({ countNo: stockTakes.countNo })
      .from(stockTakes)
      .where(and(
        eq(stockTakes.tenantId, session.user.tenantId),
        sql`${stockTakes.countNo} LIKE ${'SC-' + dateStr + '-%'}`
      ))

    const nextSeq = existing.length + 1
    const countNo = `SC-${dateStr}-${String(nextSeq).padStart(3, '0')}`

    // Get warehouse stock items for auto-population
    const stockConditions = [
      eq(warehouseStock.warehouseId, body.warehouseId),
      eq(warehouseStock.tenantId, session.user.tenantId),
    ]

    // Build query for stock items with item info
    // Use costPrice if set, otherwise fall back to valuationRate (updated by purchases)
    const stockItems = await tx.select({
      itemId: warehouseStock.itemId,
      itemName: items.name,
      itemSku: items.sku,
      currentStock: warehouseStock.currentStock,
      costPrice: sql<string>`CASE WHEN COALESCE(${items.costPrice}, 0) > 0 THEN ${items.costPrice} ELSE COALESCE(${items.valuationRate}, 0) END`,
      binLocation: warehouseStock.binLocation,
      categoryId: items.categoryId,
    })
      .from(warehouseStock)
      .innerJoin(items, eq(warehouseStock.itemId, items.id))
      .where(and(...stockConditions))
      .orderBy(items.name)

    // Filter by category if specified
    let filteredItems = stockItems
    if (body.countType === 'category' && body.categoryId) {
      filteredItems = stockItems.filter(s => s.categoryId === body.categoryId)
    }

    // Create stock take
    const [stockTake] = await tx.insert(stockTakes).values({
      tenantId: session.user.tenantId,
      countNo,
      warehouseId: body.warehouseId,
      countType: body.countType || 'full',
      categoryId: body.categoryId || null,
      notes: body.notes || null,
      createdBy: session.user.id,
      totalItems: filteredItems.length,
    }).returning()

    // Create stock take items with expected quantities
    for (const si of filteredItems) {
      await tx.insert(stockTakeItems).values({
        tenantId: session.user.tenantId,
        stockTakeId: stockTake.id,
        itemId: si.itemId,
        itemName: si.itemName,
        itemSku: si.itemSku || null,
        binLocation: si.binLocation || null,
        expectedQuantity: si.currentStock,
        costPrice: si.costPrice,
      })
    }

    logAndBroadcast(session.user.tenantId, 'stock-take', 'created', stockTake.id)

    return { data: stockTake }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data, { status: 201 })
}
