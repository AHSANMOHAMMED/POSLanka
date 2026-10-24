import { NextRequest, NextResponse } from 'next/server'
import { notInRecycleBin } from '@/lib/recycle-bin'
import { authWithCompany } from '@/lib/auth'
import { requirePermission, requireModule } from '@/lib/auth/roles'
import { canViewCostPrices, redactItemCost } from '@/lib/auth/field-access'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { items, users, workOrderParts, workOrders, heldSales, insuranceEstimates, insuranceEstimateItems, warehouseStock, warehouses, stockMovements } from '@/lib/db/schema'
import { eq, and, sql, or, ilike, inArray, lte, isNotNull, isNull } from 'drizzle-orm'
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
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, ['stock', 'selling'])
    if (moduleError) return moduleError

    const parsed = validateSearchParams(request, itemsListSchema)
    if (!parsed.success) return parsed.response
    const { search, categoryId, warehouseId, expiringBefore, storageTemp, availableNow, includeInactive, inStockOnly, hideVariants, page, pageSize, all, ids } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      // By default only return active items; items list page can pass includeInactive=true
      if (!includeInactive) {
        conditions.push(eq(items.isActive, true))
      } else {
        // Deactivated items show; ones moved to the recycle bin do not
        conditions.push(notInRecycleBin('item', items.id))
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
            ilike(items.genericName, `%${escaped}%`),
            sql`${items.alternatePartNumbers}::text ILIKE ${'%' + escaped + '%'}`,
            // H5: additional barcodes / unit barcodes (prefix match)
            // (uncorrelated IN: an unqualified "id" here must mean items.id in both the count and the list query)
            sql`${items.id} IN (SELECT ib.item_id FROM item_barcodes ib WHERE ib.barcode ILIKE ${escaped + '%'})`,
            sql`${items.id} IN (SELECT iu.item_id FROM item_uoms iu WHERE iu.barcode ILIKE ${escaped + '%'})`
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
              )`,
              // A main product whose stock sits on its size / colour variants
              sql`EXISTS (
                SELECT 1 FROM items v JOIN warehouse_stock ws ON ws.item_id = v.id
                WHERE v.parent_item_id = ${items.id} AND v.is_active
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
              )`,
              sql`EXISTS (
                SELECT 1 FROM items v JOIN warehouse_stock ws ON ws.item_id = v.id
                WHERE v.parent_item_id = ${items.id} AND v.is_active
                  AND CAST(ws.current_stock AS DECIMAL) > 0
              )`
            )
          )
        }
      }
      if (hideVariants) conditions.push(isNull(items.parentItemId))
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 200) // Max 200 per page (POS uses 200)
      const offset = all ? undefined : (page - 1) * pageSize

      // Stage 1: Get total count and items concurrently
      const [countResult, result] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(items)
          .where(whereClause),
        db.query.items.findMany({
          where: whereClause,
          with: {
            category: true,
            supplier: true,
          },
          orderBy: (items, { asc }) => [asc(items.name)],
          limit,
          offset,
        }),
      ])

      const totalCount = countResult[0]?.count ?? 0
      const itemIds = result.map(item => item.id)

      // Stage 2: Run all auxiliary stock, reservations, and audit lookups in parallel
      const workOrderReservedWhere = and(
        inArray(workOrderParts.itemId, itemIds.length > 0 ? itemIds : ['00000000-0000-0000-0000-000000000000']),
        eq(workOrders.status, 'draft'),
        warehouseId ? eq(workOrders.warehouseId, warehouseId) : undefined
      )

      const heldSalesWhere = warehouseId
        ? and(
            eq(heldSales.warehouseId, warehouseId),
            sql`${heldSales.expiresAt} > NOW()`
          )
        : sql`${heldSales.expiresAt} > NOW()`

      const estimatesReservedWhere = and(
        inArray(insuranceEstimateItems.itemId, itemIds.length > 0 ? itemIds : ['00000000-0000-0000-0000-000000000000']),
        eq(insuranceEstimates.holdStock, true),
        warehouseId ? eq(insuranceEstimates.warehouseId, warehouseId) : undefined,
        sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
        sql`${insuranceEstimateItems.itemId} IS NOT NULL`
      )

      const auditUserIds = [...new Set(result.flatMap(i => [i.createdBy, i.updatedBy]).filter((v): v is string => !!v))]

      const [
        reservedFromWorkOrders,
        heldSalesData,
        reservedFromEstimates,
        stockDataRows,
        stockHistoryData,
        parentRows,
        auditUsers,
      ] = itemIds.length === 0
        ? [[], [], [], [], [], [], []]
        : await Promise.all([
            db
              .select({
                itemId: workOrderParts.itemId,
                reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
              })
              .from(workOrderParts)
              .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
              .where(workOrderReservedWhere)
              .groupBy(workOrderParts.itemId),

            db.query.heldSales.findMany({
              where: heldSalesWhere,
            }),

            db
              .select({
                itemId: insuranceEstimateItems.itemId,
                reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
              })
              .from(insuranceEstimateItems)
              .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
              .where(estimatesReservedWhere)
              .groupBy(insuranceEstimateItems.itemId),

            warehouseId
              ? db
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
              : db
                  .select({
                    itemId: warehouseStock.itemId,
                    totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
                    totalReserved: sql<string>`COALESCE(SUM(CAST(${warehouseStock.reservedStock} AS DECIMAL)), 0)`,
                    maxMinStock: sql<string>`COALESCE(MAX(CAST(${warehouseStock.minStock} AS DECIMAL)), 0)`,
                  })
                  .from(warehouseStock)
                  .where(inArray(warehouseStock.itemId, itemIds))
                  .groupBy(warehouseStock.itemId),

            db
              .select({ itemId: stockMovements.itemId })
              .from(stockMovements)
              .where(inArray(stockMovements.itemId, itemIds))
              .groupBy(stockMovements.itemId),

            db
              .select({ parentItemId: items.parentItemId })
              .from(items)
              .where(and(isNotNull(items.parentItemId), inArray(items.parentItemId, itemIds), eq(items.isActive, true)))
              .groupBy(items.parentItemId),

            auditUserIds.length > 0
              ? db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, auditUserIds))
              : Promise.resolve([]),
          ])

      // Create a map of itemId -> reservedQty combining all sources
      const reservedMap = new Map<string, number>()

      for (const r of reservedFromWorkOrders) {
        reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
      }

      for (const held of heldSalesData) {
        const cartItems = held.cartItems as Array<{ itemId: string; quantity: number; uomFactor?: number }>
        if (Array.isArray(cartItems)) {
          for (const item of cartItems) {
            if (item.itemId) {
              // H5: held lines sold in another unit reserve quantity × factor base units
              reservedMap.set(item.itemId, (reservedMap.get(item.itemId) || 0) + (item.quantity || 0) * (Number(item.uomFactor) || 1))
            }
          }
        }
      }

      for (const r of reservedFromEstimates) {
        if (r.itemId) {
          reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
        }
      }

      // Populate warehouseStockMap
      const warehouseStockMap = new Map<string, { currentStock: number; transferReserved: number; minStock: number; binLocation: string | null }>()
      for (const ws of stockDataRows as Array<{ itemId: string; currentStock?: string; reservedStock?: string; minStock?: string; totalStock?: string; totalReserved?: string; maxMinStock?: string; binLocation?: string | null }>) {
        warehouseStockMap.set(ws.itemId, {
          currentStock: parseFloat(ws.currentStock || ws.totalStock || '0'),
          transferReserved: parseFloat(ws.reservedStock || ws.totalReserved || '0'),
          minStock: parseFloat(ws.minStock || ws.maxMinStock || '0'),
          binLocation: ws.binLocation || null,
        })
      }

      // Populate stock history and variants
      const stockHistorySet = new Set<string>()
      for (const row of stockHistoryData) {
        stockHistorySet.add(row.itemId)
      }

      const parentIdSet = new Set<string>()
      for (const row of parentRows) {
        if (row.parentItemId) parentIdSet.add(row.parentItemId)
      }

      const auditUserMap = new Map((auditUsers as Array<{ id: string; name: string | null }>).map(u => [u.id, u]))
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
          hasVariants: parentIdSet.has(item.id),
          // Include warehouse-specific fields if querying by warehouse
          ...(warehouseStockInfo ? {
            warehouseMinStock: String(warehouseStockInfo.minStock),
            warehouseBinLocation: warehouseStockInfo.binLocation,
          } : {}),
        }
      })

      // H4: POS-only roles (cashier, waiter, ...) look items up but must not see cost prices
      const visibleItems = canViewCostPrices(session)
        ? itemsWithReserved
        : itemsWithReserved.map((item) => ({
            ...redactItemCost(item),
            supplier: item.supplier ? { id: item.supplier.id, name: item.supplier.name } : null,
          }))

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(visibleItems)
      }

      return NextResponse.json({
        data: visibleItems,
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
      // Pharmacy fields
      genericName, strength, dosageForm, drugSchedule,
      // Gift card
      isGiftCard,
      // Tax template
      taxTemplateId,
      // H5 product type
      productType,
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
        // Opening stock must land somewhere: never accept a quantity and silently drop it
        if (!defaultWarehouseId && initialStock !== 0) {
          throw new Error('NO_DEFAULT_WAREHOUSE')
        }
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
          // H5: product type decides stock tracking (DB trigger keeps the two consistent)
          productType: productType ?? (trackStock === false ? (isGiftCard ? 'consumable' : 'service') : 'stockable'),
          trackStock: productType ? productType === 'stockable' : (trackStock !== undefined ? trackStock : true),
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
          // Pharmacy fields
          genericName: genericName || null,
          strength: strength || null,
          dosageForm: dosageForm || null,
          drugSchedule: drugSchedule || null,
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
    if (error instanceof Error && error.message === 'NO_DEFAULT_WAREHOUSE') {
      return NextResponse.json({
        error: 'Opening stock needs an active default warehouse. Set a default warehouse or create the item without opening stock.',
        code: 'NO_DEFAULT_WAREHOUSE',
      }, { status: 400 })
    }
    logError('api/items', error)
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
  }
}
