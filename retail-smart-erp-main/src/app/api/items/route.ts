import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { items, users, workOrderParts, workOrders, heldSales, insuranceEstimates, insuranceEstimateItems, warehouseStock, warehouses, stockMovements } from '@/lib/db/schema'
import { eq, and, sql, or, ilike, inArray, lte, isNotNull } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation'
import { itemsListSchema, createItemSchema } from '@/lib/validation/schemas/items'
import { createItem } from '@/lib/inventory/create-item'
import { toApiError } from '@/lib/db/errors'

// GET all items for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, itemsListSchema)
    if (!parsed.success) return parsed.response
    const { search, categoryId, warehouseId, expiringBefore, storageTemp, availableNow, includeInactive, inStockOnly, page, pageSize, all, ids } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      // By default only return active items; items list page can pass includeInactive=true
      if (!includeInactive) {
        conditions.push(eq(items.isActive, true))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(items.name, `%${escaped}%`),
            ilike(items.itemCode, `%${escaped}%`),
            ilike(items.sku, `%${escaped}%`),
            ilike(items.barcode, `%${escaped}%`),
            ilike(items.oemPartNumber, `%${escaped}%`),
            ilike(items.supplierPartNumber, `%${escaped}%`),
            ilike(items.pluCode, `%${escaped}%`),
            sql`${items.alternatePartNumbers}::text ILIKE ${'%' + escaped + '%'}`
          )
        )
      }
      if (ids) {
        const idList = ids.split(',').filter(id => id.match(/^[0-9a-f-]{36}$/i))
        if (idList.length > 0) {
          conditions.push(inArray(items.id, idList))
        }
      }
      if (categoryId) {
        conditions.push(eq(items.categoryId, categoryId))
      }
      if (expiringBefore) {
        conditions.push(and(isNotNull(items.expiryDate), lte(items.expiryDate, expiringBefore)))
      }
      if (storageTemp) {
        conditions.push(eq(items.storageTemp, storageTemp))
      }
      if (availableNow) {
        // Filter items available at current time
        // Items with no availability window are always available
        // Items with availableFrom/availableTo are filtered by current time
        const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
        conditions.push(
          or(
            // No availability window set - always available
            and(sql`${items.availableFrom} IS NULL`, sql`${items.availableTo} IS NULL`),
            // Within availability window
            and(
              sql`(${items.availableFrom} IS NULL OR ${items.availableFrom} <= ${currentTime}::time)`,
              sql`(${items.availableTo} IS NULL OR ${items.availableTo} >= ${currentTime}::time)`
            )
          )
        )
      }
      if (inStockOnly) {
        if (warehouseId) {
          // Only show items that have stock in the selected warehouse, OR items that don't track stock
          // Note: Use raw SQL column names inside EXISTS because Drizzle's relational query builder
          // (db.query.*.findMany with `with`) misaliases column references from other tables.
          conditions.push(
            or(
              eq(items.trackStock, false),
              sql`EXISTS (
                SELECT 1 FROM warehouse_stock ws
                WHERE ws.item_id = ${items.id}
                  AND ws.warehouse_id = ${warehouseId}
                  AND CAST(ws.current_stock AS DECIMAL) > 0
              )`
            )
          )
        } else {
          // No warehouse filter: show items with stock in ANY warehouse, or non-tracked items
          conditions.push(
            or(
              eq(items.trackStock, false),
              sql`EXISTS (
                SELECT 1 FROM warehouse_stock ws
                WHERE ws.item_id = ${items.id}
                  AND CAST(ws.current_stock AS DECIMAL) > 0
              )`
            )
          )
        }
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 200) // Max 200 per page (POS uses 200)
      const offset = all ? undefined : (page - 1) * pageSize

      // Get items with pagination
      const result = await db.query.items.findMany({
        where: whereClause,
        with: {
          category: true,
          supplier: true,
        },
        orderBy: (items, { asc }) => [asc(items.name)],
        limit,
        offset,
      })

      // Get reserved quantities from draft work orders (warehouse-aware if warehouseId provided)
      const workOrderReservedWhere = warehouseId
        ? and(
            eq(workOrders.status, 'draft'),
            eq(workOrders.warehouseId, warehouseId)
          )
        : eq(workOrders.status, 'draft')

      const reservedFromWorkOrders = await db
        .select({
          itemId: workOrderParts.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
        })
        .from(workOrderParts)
        .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
        .where(workOrderReservedWhere)
        .groupBy(workOrderParts.itemId)

      // Get reserved quantities from non-expired held sales (cart items stored as JSONB) - warehouse-aware
      const heldSalesWhere = warehouseId
        ? and(
            eq(heldSales.warehouseId, warehouseId),
            sql`${heldSales.expiresAt} > NOW()`
          )
        : sql`${heldSales.expiresAt} > NOW()`

      const heldSalesData = await db.query.heldSales.findMany({
        where: heldSalesWhere,
      })

      // Get reserved quantities from estimates with holdStock enabled - warehouse-aware
      const estimatesReservedWhere = warehouseId
        ? and(
            eq(insuranceEstimates.holdStock, true),
            eq(insuranceEstimates.warehouseId, warehouseId),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimateItems.itemId} IS NOT NULL`
          )
        : and(
            eq(insuranceEstimates.holdStock, true),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimateItems.itemId} IS NOT NULL`
          )

      const reservedFromEstimates = await db
        .select({
          itemId: insuranceEstimateItems.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
        })
        .from(insuranceEstimateItems)
        .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
        .where(estimatesReservedWhere)
        .groupBy(insuranceEstimateItems.itemId)

      // Create a map of itemId -> reservedQty combining all sources
      const reservedMap = new Map<string, number>()

      // Add work order reservations
      for (const r of reservedFromWorkOrders) {
        reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
      }

      // Add held sales reservations (parse JSONB cart items)
      for (const held of heldSalesData) {
        const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
        if (Array.isArray(cartItems)) {
          for (const item of cartItems) {
            if (item.itemId) {
              reservedMap.set(item.itemId, (reservedMap.get(item.itemId) || 0) + (item.quantity || 0))
            }
          }
        }
      }

      // Add estimate reservations (with holdStock enabled)
      for (const r of reservedFromEstimates) {
        if (r.itemId) {
          reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
        }
      }

      // Get stock data from warehouseStock table
      const warehouseStockMap = new Map<string, { currentStock: number; transferReserved: number; minStock: number; binLocation: string | null }>()
      const itemIds = result.map(item => item.id)

      if (itemIds.length > 0) {
        if (warehouseId) {
          // Get stock for specific warehouse
          const warehouseStockData = await db
            .select({
              itemId: warehouseStock.itemId,
              currentStock: warehouseStock.currentStock,
              reservedStock: warehouseStock.reservedStock,
              minStock: warehouseStock.minStock,
              binLocation: warehouseStock.binLocation,
            })
            .from(warehouseStock)
            .where(
              and(
                eq(warehouseStock.warehouseId, warehouseId),
                inArray(warehouseStock.itemId, itemIds)
              )
            )

          for (const ws of warehouseStockData) {
            warehouseStockMap.set(ws.itemId, {
              currentStock: parseFloat(ws.currentStock),
              transferReserved: parseFloat(ws.reservedStock || '0'),
              minStock: parseFloat(ws.minStock || '0'),
              binLocation: ws.binLocation,
            })
          }
        } else {
          // Aggregate stock across ALL warehouses
          const aggregatedStockData = await db
            .select({
              itemId: warehouseStock.itemId,
              totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
              totalReserved: sql<string>`COALESCE(SUM(CAST(${warehouseStock.reservedStock} AS DECIMAL)), 0)`,
              maxMinStock: sql<string>`COALESCE(MAX(CAST(${warehouseStock.minStock} AS DECIMAL)), 0)`,
            })
            .from(warehouseStock)
            .where(inArray(warehouseStock.itemId, itemIds))
            .groupBy(warehouseStock.itemId)

          for (const ws of aggregatedStockData) {
            warehouseStockMap.set(ws.itemId, {
              currentStock: parseFloat(ws.totalStock),
              transferReserved: parseFloat(ws.totalReserved || '0'),
              minStock: parseFloat(ws.maxMinStock || '0'),
              binLocation: null, // No single bin location when aggregating
            })
          }
        }
      }

      // Check which items have stock movement history (for low-stock filter)
      const stockHistorySet = new Set<string>()
      if (itemIds.length > 0) {
        const stockHistoryData = await db
          .select({ itemId: stockMovements.itemId })
          .from(stockMovements)
          .where(inArray(stockMovements.itemId, itemIds))
          .groupBy(stockMovements.itemId)
        for (const row of stockHistoryData) {
          stockHistorySet.add(row.itemId)
        }
      }

      // Resolve audit users (createdBy / updatedBy → { id, name })
      const auditUserIds = [...new Set(result.flatMap(i => [i.createdBy, i.updatedBy]).filter((v): v is string => !!v))]
      const auditUsers = auditUserIds.length > 0
        ? await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, auditUserIds))
        : []
      const auditUserMap = new Map(auditUsers.map(u => [u.id, u]))
      const userRef = (uid: string | null) => (uid ? (auditUserMap.get(uid) ?? { id: uid, name: null }) : null)

      // Add reserved and available stock to each item
      const itemsWithReserved = result.map(item => {
        // Combine work order / held sale / estimate reservations with transfer reservations (8G)
        const otherReserved = reservedMap.get(item.id) || 0
        const transferReserved = warehouseStockMap.get(item.id)?.transferReserved || 0
        const reserved = otherReserved + transferReserved

        // Get stock from warehouseStock (aggregated or warehouse-specific)
        const warehouseStockInfo = warehouseStockMap.get(item.id)
        const current = warehouseStockInfo ? warehouseStockInfo.currentStock : 0

        // Items that don't track stock should always appear available
        const available = item.trackStock
          ? Math.max(0, current - reserved)
          : 999999

        return {
          ...item,
          createdBy: userRef(item.createdBy),
          updatedBy: userRef(item.updatedBy),
          currentStock: String(current), // Override with warehouse stock if applicable
          reservedStock: String(reserved),
          availableStock: String(available),
          minStock: String(warehouseStockInfo?.minStock ?? 0),
          hasStockHistory: stockHistorySet.has(item.id),
          // Include warehouse-specific fields if querying by warehouse
          ...(warehouseStockInfo ? {
            warehouseMinStock: String(warehouseStockInfo.minStock),
            warehouseBinLocation: warehouseStockInfo.binLocation,
          } : {}),
        }
      })

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(itemsWithReserved)
      }

      return NextResponse.json({
        data: itemsWithReserved,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/items', error)
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
  }
}

// POST create new item
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createItemSchema)
    if (!parsed.success) return parsed.response
    const {
      name, itemCode, sku, barcode, categoryId, costPrice, sellingPrice, currentStock, minStock, unit, trackStock, trackBatches, trackSerialNumbers,
      // Auto parts fields
      oemPartNumber, alternatePartNumbers, brand, condition, reorderQty, binLocation,
      supplierId, supplierPartNumber, leadTimeDays, weight, dimensions, warrantyMonths, imageUrl, supersededBy,
      // Restaurant fields
      preparationTime, allergens, calories, isVegetarian, isVegan, isGlutenFree, spiceLevel, availableFrom, availableTo,
      // Supermarket fields
      pluCode, shelfLifeDays, storageTemp, expiryDate,
      // Gift card
      isGiftCard,
      // Tax template
      taxTemplateId,
    } = parsed.data

    const tenantId = session!.user.tenantId
    const userId = session!.user.id

    // Single creator: allocates item code + barcode atomically, maps duplicates,
    // writes the change log and books opening stock through the stock ledger.
    const newItem = await withTenantTransaction(tenantId, async (tx) => {
      // Opening stock / warehouse settings go to the default warehouse
      const initialStock = currentStock || 0
      const wantsStockRow = initialStock > 0 || (minStock || 0) > 0 || !!reorderQty || !!binLocation
      let defaultWarehouseId: string | null = null
      if (wantsStockRow) {
        const defaultWarehouse = await tx.query.warehouses.findFirst({
          where: and(eq(warehouses.isDefault, true), eq(warehouses.isActive, true)),
        })
        defaultWarehouseId = defaultWarehouse?.id ?? null
      }

      const { item } = await createItem(tx, {
        tenantId,
        userId,
        source: 'manual',
        data: {
          name,
          itemCode: itemCode || null,
          sku: sku || null,
          barcode: barcode || null,
          categoryId: categoryId || null,
          costPrice: costPrice ? String(costPrice) : '0',
          sellingPrice: String(sellingPrice),
          unit: unit || 'pcs',
          trackStock: trackStock !== undefined ? trackStock : true,
          trackBatches: trackBatches || false,
          trackSerialNumbers: trackSerialNumbers || false,
          isActive: true,
          // Auto parts fields
          oemPartNumber: oemPartNumber || null,
          alternatePartNumbers: alternatePartNumbers || null,
          brand: brand || null,
          condition: condition || 'new',
          supplierId: supplierId || null,
          supplierPartNumber: supplierPartNumber || null,
          leadTimeDays: leadTimeDays || null,
          weight: weight ? String(weight) : null,
          dimensions: dimensions || null,
          warrantyMonths: warrantyMonths || null,
          imageUrl: imageUrl || null,
          supersededBy: supersededBy || null,
          // Restaurant fields
          preparationTime: preparationTime || null,
          allergens: allergens || null,
          calories: calories || null,
          isVegetarian: isVegetarian || false,
          isVegan: isVegan || false,
          isGlutenFree: isGlutenFree || false,
          spiceLevel: spiceLevel || null,
          availableFrom: availableFrom || null,
          availableTo: availableTo || null,
          // Supermarket fields
          pluCode: pluCode || null,
          shelfLifeDays: shelfLifeDays || null,
          storageTemp: storageTemp || null,
          expiryDate: expiryDate || null,
          // Gift card
          isGiftCard: isGiftCard || false,
          // Tax template
          taxTemplateId: taxTemplateId || null,
        },
        openingStock: defaultWarehouseId ? [{
          warehouseId: defaultWarehouseId,
          qty: initialStock,
          minStock: minStock ?? null,
          reorderQty: reorderQty ?? null,
          binLocation: binLocation || null,
        }] : [],
      })

      return item
    })

    // Broadcast the change to connected clients
    logAndBroadcast(tenantId, 'item', 'created', newItem.id, { userId, entityName: newItem.name })

    return NextResponse.json(newItem)
  } catch (error) {
    const mapped = toApiError(error)
    if (mapped) return mapped
    logError('api/items', error)
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
  }
}
