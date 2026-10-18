import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { items, saleItems, workOrderParts, heldSales, layawayItems, purchaseItems, purchaseOrderItems, stockMovements, warehouseStock, itemCostHistory } from '@/lib/db/schema'
import { eq, and, sql, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { checkPriceChangeAnomalies } from '@/lib/ai/anomaly-detector'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateItemSchema } from '@/lib/validation/schemas/items'
import { deleteFromR2, keyFromUrl } from '@/lib/files'
import { deleteFilesByDocument } from '@/lib/utils/file-cleanup'
import { adjustFileStorage } from '@/lib/db/storage-quota'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const item = await db.query.items.findFirst({
        where: eq(items.id, id),
        with: {
          category: true,
          supplier: true,
        },
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Get aggregated stock from all warehouses (RLS scopes the query)
      const [stockData] = await db
        .select({
          totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)`,
          maxMinStock: sql<string>`COALESCE(MAX(CAST(${warehouseStock.minStock} AS DECIMAL)), 0)`,
        })
        .from(warehouseStock)
        .where(eq(warehouseStock.itemId, id))

      return NextResponse.json({
        ...item,
        currentStock: stockData?.totalStock || '0',
        minStock: stockData?.maxMinStock || '0',
      })
    })
  } catch (error) {
    logError('api/items/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch item' }, { status: 500 })
  }
}

// PUT update item
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateItemSchema)
    if (!parsed.success) return parsed.response
    const {
      name, sku, barcode, categoryId, costPrice, sellingPrice, unit, isActive, trackStock, trackSerialNumbers, expectedUpdatedAt,
      // Auto parts fields
      oemPartNumber, alternatePartNumbers, brand, condition,
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

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Capture old prices before transaction for anomaly detection
      let oldSellingPrice = 0
      let oldCostPrice = 0

      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock and get current item (RLS scopes the query)
        const [currentItem] = await tx
          .select()
          .from(items)
          .where(eq(items.id, id))
          .for('update')

        if (!currentItem) {
          throw new Error('NOT_FOUND')
        }

        // Store old prices for post-update anomaly detection
        oldSellingPrice = parseFloat(currentItem.sellingPrice || '0')
        oldCostPrice = parseFloat(currentItem.costPrice || '0')

        // Optimistic locking - check if record was modified since client fetched it
        if (expectedUpdatedAt) {
          const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
          const serverUpdatedAt = currentItem.updatedAt ? new Date(currentItem.updatedAt).getTime() : 0
          if (serverUpdatedAt > clientUpdatedAt) {
            throw new Error('CONFLICT')
          }
        }

        // Check for duplicate SKU (excluding current item) - RLS scopes
        if (sku) {
          const existingSku = await tx.query.items.findFirst({
            where: and(
              eq(items.sku, sku),
              ne(items.id, id)
            ),
          })
          if (existingSku) {
            throw new Error('DUPLICATE_SKU')
          }
        }

        // Check for duplicate barcode (excluding current item) - RLS scopes
        if (barcode) {
          const existingBarcode = await tx.query.items.findFirst({
            where: and(
              eq(items.barcode, barcode),
              ne(items.id, id)
            ),
          })
          if (existingBarcode) {
            throw new Error('DUPLICATE_BARCODE')
          }
        }

        const [updated] = await tx.update(items)
          .set({
            name,
            sku: sku || null,
            barcode: barcode || null,
            categoryId: categoryId || null,
            costPrice: costPrice ? String(costPrice) : '0',
            sellingPrice: String(sellingPrice),
            unit: unit || 'pcs',
            isActive: isActive !== undefined ? isActive : true,
            trackStock: trackStock !== undefined ? trackStock : true,
            trackSerialNumbers: trackSerialNumbers !== undefined ? trackSerialNumbers : undefined,
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
            preparationTime: preparationTime !== undefined ? (preparationTime || null) : undefined,
            allergens: allergens !== undefined ? (allergens || null) : undefined,
            calories: calories !== undefined ? (calories || null) : undefined,
            isVegetarian: isVegetarian !== undefined ? isVegetarian : undefined,
            isVegan: isVegan !== undefined ? isVegan : undefined,
            isGlutenFree: isGlutenFree !== undefined ? isGlutenFree : undefined,
            spiceLevel: spiceLevel !== undefined ? (spiceLevel || null) : undefined,
            availableFrom: availableFrom !== undefined ? (availableFrom || null) : undefined,
            availableTo: availableTo !== undefined ? (availableTo || null) : undefined,
            // Supermarket fields
            pluCode: pluCode !== undefined ? (pluCode || null) : undefined,
            shelfLifeDays: shelfLifeDays !== undefined ? (shelfLifeDays || null) : undefined,
            storageTemp: storageTemp !== undefined ? (storageTemp || null) : undefined,
            expiryDate: expiryDate !== undefined ? (expiryDate || null) : undefined,
            // Gift card
            isGiftCard: isGiftCard !== undefined ? isGiftCard : undefined,
            // Tax template
            taxTemplateId: taxTemplateId !== undefined ? (taxTemplateId || null) : undefined,
            updatedAt: new Date(),
          })
          .where(eq(items.id, id))
          .returning()

        // Log cost change if costPrice was manually adjusted
        const newCostPriceVal = parseFloat(costPrice ? String(costPrice) : '0')
        if (oldCostPrice !== newCostPriceVal) {
          // Get total stock across all warehouses for context
          const [stockData] = await tx
            .select({ totalStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL)), 0)` })
            .from(warehouseStock)
            .where(eq(warehouseStock.itemId, id))

          const totalStock = parseFloat(stockData?.totalStock || '0')

          await tx.insert(itemCostHistory).values({
            tenantId: session!.user.tenantId,
            itemId: id,
            source: 'manual_adjustment',
            previousCostPrice: oldCostPrice.toString(),
            newCostPrice: newCostPriceVal.toString(),
            stockBefore: totalStock.toString(),
            stockAfter: totalStock.toString(),
            notes: 'Manual cost price adjustment',
            createdBy: session!.user.id,
          })
        }

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'item', 'updated', id)

      // AI: Price change anomaly detection (fire-and-forget)
      const newSellingPrice = parseFloat(String(sellingPrice))
      const newCostPrice = parseFloat(String(costPrice || '0'))
      if (oldSellingPrice !== newSellingPrice || oldCostPrice !== newCostPrice) {
        checkPriceChangeAnomalies(session!.user.tenantId, {
          itemId: id,
          itemName: name,
          oldSellingPrice,
          newSellingPrice,
          oldCostPrice,
          newCostPrice,
          changedBy: session!.user.name || undefined,
        })
      }

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/items/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This item was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (message === 'DUPLICATE_SKU') {
      return NextResponse.json({ error: 'An item with this SKU already exists' }, { status: 400 })
    }
    if (message === 'DUPLICATE_BARCODE') {
      return NextResponse.json({ error: 'An item with this barcode already exists' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
}

// DELETE item
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    // Execute with RLS tenant context
    return await withTenant(tenantId, async (db) => {
      // Check for dependencies before deletion (RLS scopes all queries)
      const dependencies: string[] = []

      // Check for sale items (historical data)
      const [itemSales] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(saleItems)
        .where(eq(saleItems.itemId, id))
      if (itemSales?.count > 0) {
        dependencies.push(`${itemSales.count} sale record(s)`)
      }

      // Check for work order parts
      const [itemWorkOrders] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workOrderParts)
        .where(eq(workOrderParts.itemId, id))
      if (itemWorkOrders?.count > 0) {
        dependencies.push(`${itemWorkOrders.count} work order part(s)`)
      }

      // Check for held sales containing this item
      const [itemHeldSales] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(heldSales)
        .where(sql`${heldSales.cartItems}::jsonb @> ${JSON.stringify([{ itemId: id }])}::jsonb`)
      if (itemHeldSales?.count > 0) {
        dependencies.push(`${itemHeldSales.count} held sale(s)`)
      }

      // Check for active layaway items
      const [itemLayaways] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(layawayItems)
        .where(eq(layawayItems.itemId, id))
      if (itemLayaways?.count > 0) {
        dependencies.push(`${itemLayaways.count} layaway item(s)`)
      }

      // Check for purchase items (purchase history)
      const [itemPurchases] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseItems)
        .where(eq(purchaseItems.itemId, id))
      if (itemPurchases?.count > 0) {
        dependencies.push(`${itemPurchases.count} purchase record(s)`)
      }

      // Check for purchase order items
      const [itemPOItems] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.itemId, id))
      if (itemPOItems?.count > 0) {
        dependencies.push(`${itemPOItems.count} purchase order(s)`)
      }

      // Check for stock movements (stock history)
      const [itemStockMoves] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(stockMovements)
        .where(eq(stockMovements.itemId, id))
      if (itemStockMoves?.count > 0) {
        dependencies.push(`${itemStockMoves.count} stock movement(s)`)
      }

      // If there are dependencies, prevent deletion but suggest deactivation
      if (dependencies.length > 0) {
        return NextResponse.json({
          error: `Cannot delete item. Item is used in: ${dependencies.join(', ')}. Consider deactivating the item instead to preserve historical records.`,
          dependencies,
          suggestion: 'deactivate'
        }, { status: 400 })
      }

      // Get item before deletion to clean up R2 files
      const item = await db.query.items.findFirst({
        where: eq(items.id, id),
        columns: { id: true, imageUrl: true, imageSize: true },
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      const [deleted] = await db.delete(items)
        .where(eq(items.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Clean up item image from R2
      if (item.imageUrl) {
        const key = keyFromUrl(item.imageUrl)
        if (key) {
          try { await deleteFromR2(key) } catch { /* ignore */ }
        }
      }

      // Subtract item image from file storage counter (bypasses files table)
      if (item.imageSize) {
        adjustFileStorage(tenantId, -item.imageSize).catch(() => {})
      }

      // Clean up any files attached via files table
      deleteFilesByDocument(tenantId, 'item', id, session!.user.tenantSlug).catch(() => {})

      // Broadcast the change to connected clients
      logAndBroadcast(tenantId, 'item', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/items/[id]', error)
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
