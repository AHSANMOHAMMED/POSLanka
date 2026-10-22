// Inventory report calculation logic
// Queries from items, warehouse_stock, stock_movements, purchases, sale_items tables

import { eq, and, sql, gte, lte, desc, ne } from 'drizzle-orm'
import { items, warehouseStock, stockMovements, purchases, sales, saleItems, categories, suppliers, journalEntryItems, journalEntries, paymentEntryReferences } from '@/lib/db/schema'
import { tenantDayRange, localTs } from './date-range'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any

export async function getStockBalance(
  db: DbInstance,
  tenantId: string,
  filters: { categoryId?: string; belowReorder?: boolean }
) {
  const conditions = [eq(items.tenantId, tenantId), eq(items.trackStock, true)]

  if (filters.categoryId) {
    conditions.push(eq(items.categoryId, filters.categoryId))
  }

  const data = await db.select({
    itemId: items.id,
    itemName: items.name,
    sku: items.sku,
    categoryName: categories.name,
    costPrice: items.costPrice,
    sellingPrice: items.sellingPrice,
    currentStock: sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS numeric)), 0)`,
    minStock: sql<string>`COALESCE(MAX(CAST(${warehouseStock.minStock} AS numeric)), 0)`,
  })
    .from(items)
    .leftJoin(warehouseStock, and(eq(warehouseStock.itemId, items.id), eq(warehouseStock.tenantId, tenantId)))
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .where(and(...conditions))
    .groupBy(items.id, items.name, items.sku, categories.name, items.costPrice, items.sellingPrice)
    .orderBy(items.name)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result = data.map((row: any) => {
    const currentStock = Number(row.currentStock)
    const minStock = Number(row.minStock)
    const costPrice = Number(row.costPrice)
    return {
      itemId: row.itemId,
      itemName: row.itemName,
      sku: row.sku || '-',
      categoryName: row.categoryName || 'Uncategorized',
      currentStock: Math.round(currentStock * 1000) / 1000,
      minStock: Math.round(minStock * 1000) / 1000,
      costPrice: Math.round(costPrice * 100) / 100,
      sellingPrice: Math.round(Number(row.sellingPrice) * 100) / 100,
      stockValue: Math.round(currentStock * costPrice * 100) / 100,
      belowReorder: currentStock <= minStock && minStock > 0,
    }
  })

  if (filters.belowReorder) {
    result = result.filter((r: { belowReorder: boolean }) => r.belowReorder)
  }

  return result
}

export async function getStockMovement(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string; itemId?: string; movementType?: string }
) {
  const range = await tenantDayRange(tenantId, filters.fromDate, filters.toDate)
  const conditions = [
    eq(stockMovements.tenantId, tenantId),
    gte(stockMovements.createdAt, range.from),
    lte(stockMovements.createdAt, range.to),
  ]

  if (filters.itemId) {
    conditions.push(eq(stockMovements.itemId, filters.itemId))
  }
  if (filters.movementType) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditions.push(eq(stockMovements.type, filters.movementType as any))
  }

  const data = await db.select({
    id: stockMovements.id,
    date: stockMovements.createdAt,
    itemId: stockMovements.itemId,
    itemName: items.name,
    sku: items.sku,
    type: stockMovements.type,
    quantity: stockMovements.quantity,
    qtyChange: stockMovements.qtyChange,
    stockBefore: stockMovements.stockBefore,
    stockAfter: stockMovements.stockAfter,
    referenceType: stockMovements.referenceType,
    referenceId: stockMovements.referenceId,
    notes: stockMovements.notes,
  })
    .from(stockMovements)
    .leftJoin(items, eq(stockMovements.itemId, items.id))
    .where(and(...conditions, sql`COALESCE(${stockMovements.referenceType}, '') <> 'ledger_baseline'`))
    .orderBy(desc(stockMovements.createdAt))
    .limit(500)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: row.id,
    date: row.date,
    itemName: row.itemName || 'Unknown',
    sku: row.sku || '-',
    type: row.type,
    // qty_change is the signed ledger quantity (quantity is always the magnitude)
    qtyChange: Number(row.qtyChange),
    qtyIn: row.type !== 'adjustment' && Number(row.qtyChange) > 0 ? Number(row.qtyChange) : 0,
    qtyOut: row.type !== 'adjustment' && Number(row.qtyChange) < 0 ? Math.abs(Number(row.qtyChange)) : 0,
    adjustment: row.type === 'adjustment' ? Number(row.qtyChange) : 0,
    stockBefore: row.stockBefore !== null ? Number(row.stockBefore) : null,
    stockAfter: row.stockAfter !== null ? Number(row.stockAfter) : null,
    referenceType: row.referenceType || '-',
    referenceId: row.referenceId,
    notes: row.notes,
  }))
}

export async function getPurchaseSummary(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string; groupBy?: 'supplier' | 'month' }
) {
  const { fromDate, toDate, groupBy = 'month' } = filters
  const range = await tenantDayRange(tenantId, fromDate, toDate)

  // Totals
  const [totals] = await db.select({
    totalPurchases: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = false THEN CAST(${purchases.total} AS numeric) ELSE 0 END), 0)`,
    // Purchase returns carry negative totals: report the magnitude so net = purchases - returns
    totalReturns: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = true THEN ABS(CAST(${purchases.total} AS numeric)) ELSE 0 END), 0)`,
    orderCount: sql<number>`COUNT(CASE WHEN ${purchases.isReturn} = false THEN 1 END)::int`,
  })
    .from(purchases)
    .where(and(
      eq(purchases.tenantId, tenantId),
      gte(purchases.createdAt, range.from),
      lte(purchases.createdAt, range.to),
      sql`${purchases.status} NOT IN ('cancelled', 'draft')`,
    ))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let groupExpr: any
  let groupLabel: string

  if (groupBy === 'supplier') {
    groupExpr = sql`COALESCE((SELECT name FROM suppliers WHERE id = ${purchases.supplierId}), 'Unknown')`
    groupLabel = 'Supplier'
  } else {
    groupExpr = sql`TO_CHAR(${localTs(purchases.createdAt, range.tz)}, 'YYYY-MM')`
    groupLabel = 'Month'
  }

  const grouped = await db.select({
    group: groupExpr.as('group_key'),
    totalPurchases: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = false THEN CAST(${purchases.total} AS numeric) ELSE 0 END), 0)`,
    // Purchase returns carry negative totals: report the magnitude so net = purchases - returns
    totalReturns: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = true THEN ABS(CAST(${purchases.total} AS numeric)) ELSE 0 END), 0)`,
    orderCount: sql<number>`COUNT(CASE WHEN ${purchases.isReturn} = false THEN 1 END)::int`,
  })
    .from(purchases)
    .where(and(
      eq(purchases.tenantId, tenantId),
      gte(purchases.createdAt, range.from),
      lte(purchases.createdAt, range.to),
      sql`${purchases.status} NOT IN ('cancelled', 'draft')`,
    ))
    .groupBy(groupExpr)
    .orderBy(groupExpr)

  return {
    summary: {
      totalPurchases: Math.round(Number(totals.totalPurchases) * 100) / 100,
      totalReturns: Math.round(Number(totals.totalReturns) * 100) / 100,
      netPurchases: Math.round((Number(totals.totalPurchases) - Number(totals.totalReturns)) * 100) / 100,
      orderCount: totals.orderCount,
    },
    groupLabel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: grouped.map((row: any) => ({
      group: row.group,
      totalPurchases: Math.round(Number(row.totalPurchases) * 100) / 100,
      totalReturns: Math.round(Number(row.totalReturns) * 100) / 100,
      netPurchases: Math.round((Number(row.totalPurchases) - Number(row.totalReturns)) * 100) / 100,
      orderCount: row.orderCount,
    })),
  }
}

export async function getPurchaseBySupplier(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  const range = await tenantDayRange(tenantId, filters.fromDate, filters.toDate)
  const data = await db.select({
    supplierId: purchases.supplierId,
    supplierName: sql<string>`COALESCE((SELECT name FROM suppliers WHERE id = ${purchases.supplierId}), 'Unknown')`,
    orderCount: sql<number>`COUNT(CASE WHEN ${purchases.isReturn} = false THEN 1 END)::int`,
    totalAmount: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = false THEN CAST(${purchases.total} AS numeric) ELSE 0 END), 0)`,
    outstanding: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = false THEN CAST(${purchases.total} AS numeric) - CAST(${purchases.paidAmount} AS numeric) ELSE 0 END), 0)`,
    lastPurchaseDate: sql<string>`MAX(${purchases.createdAt})`,
  })
    .from(purchases)
    .where(and(
      eq(purchases.tenantId, tenantId),
      gte(purchases.createdAt, range.from),
      lte(purchases.createdAt, range.to),
      sql`${purchases.status} NOT IN ('cancelled', 'draft')`,
    ))
    .groupBy(purchases.supplierId)
    .orderBy(sql`SUM(CASE WHEN ${purchases.isReturn} = false THEN CAST(${purchases.total} AS numeric) ELSE 0 END) DESC`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    orderCount: row.orderCount,
    totalAmount: Math.round(Number(row.totalAmount) * 100) / 100,
    outstanding: Math.round(Number(row.outstanding) * 100) / 100,
    lastPurchaseDate: row.lastPurchaseDate,
  }))
}

export async function getItemProfitability(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string; categoryId?: string }
) {
  const range = await tenantDayRange(tenantId, filters.fromDate, filters.toDate)
  const conditions = [
    eq(saleItems.tenantId, tenantId),
    gte(sales.createdAt, range.from),
    lte(sales.createdAt, range.to),
    sql`${sales.status} != 'void'`,
    eq(sales.isReturn, false),
  ]
  if (filters.categoryId) {
    conditions.push(eq(items.categoryId, filters.categoryId))
  }

  const data = await db.select({
    itemId: saleItems.itemId,
    itemName: saleItems.itemName,
    sku: items.sku,
    costPrice: items.costPrice,
    sellingPrice: items.sellingPrice,
    qtySold: sql<string>`SUM(CAST(${saleItems.quantity} AS numeric))`,
    totalRevenue: sql<string>`SUM(CAST(${saleItems.total} AS numeric))`,
  })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .leftJoin(items, eq(saleItems.itemId, items.id))
    .where(and(...conditions))
    .groupBy(saleItems.itemId, saleItems.itemName, items.sku, items.costPrice, items.sellingPrice)
    .orderBy(sql`SUM(CAST(${saleItems.total} AS numeric)) DESC`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => {
    const costPrice = Number(row.costPrice) || 0
    const sellingPrice = Number(row.sellingPrice) || 0
    const qtySold = Number(row.qtySold)
    const totalRevenue = Number(row.totalRevenue)
    const totalCost = costPrice * qtySold
    const totalProfit = totalRevenue - totalCost
    const marginPercent = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

    return {
      itemId: row.itemId,
      itemName: row.itemName,
      sku: row.sku || '-',
      costPrice: Math.round(costPrice * 100) / 100,
      sellingPrice: Math.round(sellingPrice * 100) / 100,
      marginPercent: Math.round(marginPercent * 100) / 100,
      qtySold: Math.round(qtySold * 1000) / 1000,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
    }
  })
}

export async function getAgedPayables(
  db: DbInstance,
  tenantId: string,
  filters: { asOfDate?: string } = {}
) {
  const asOf = filters.asOfDate ? new Date(filters.asOfDate) : new Date()
  const asOfStr = asOf.toISOString().slice(0, 10)

  // Get all unpaid/partially-paid purchase invoices (not returns, not cancelled)
  const data = await db.select({
    id: purchases.id,
    purchaseNo: purchases.purchaseNo,
    supplierId: purchases.supplierId,
    supplierName: suppliers.name,
    total: purchases.total,
    paidAmount: purchases.paidAmount,
    status: purchases.status,
    createdAt: purchases.createdAt,
  })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(and(
      eq(purchases.tenantId, tenantId),
      eq(purchases.isReturn, false),
      ne(purchases.status, 'cancelled'),
      ne(purchases.status, 'paid'),
      ne(purchases.status, 'draft'),
      lte(purchases.createdAt, new Date(asOfStr + 'T23:59:59')),
    ))
    .orderBy(purchases.createdAt)

  // Bucket by age
  const supplierMap = new Map<string, { supplierName: string; current: number; days30: number; days60: number; days90Plus: number; total: number }>()

  for (const row of data) {
    const total = Number(row.total) || 0
    const paid = Number(row.paidAmount) || 0
    const outstanding = total - paid
    if (outstanding <= 0) continue

    const invoiceDate = new Date(row.createdAt)
    const daysDiff = Math.floor((asOf.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24))

    const suppId = row.supplierId || 'unknown'
    if (!supplierMap.has(suppId)) {
      supplierMap.set(suppId, {
        supplierName: row.supplierName || 'Unknown',
        current: 0,
        days30: 0,
        days60: 0,
        days90Plus: 0,
        total: 0,
      })
    }

    const entry = supplierMap.get(suppId)!
    entry.total += outstanding

    if (daysDiff <= 30) {
      entry.current += outstanding
    } else if (daysDiff <= 60) {
      entry.days30 += outstanding
    } else if (daysDiff <= 90) {
      entry.days60 += outstanding
    } else {
      entry.days90Plus += outstanding
    }
  }

  // Include JE-based payables (credit to AP for suppliers)
  const jePayables = await db.select({
    jeItemId: journalEntryItems.id,
    credit: journalEntryItems.credit,
    partyId: journalEntryItems.partyId,
    entryNumber: journalEntries.entryNumber,
    postingDate: journalEntries.postingDate,
  })
    .from(journalEntryItems)
    .innerJoin(journalEntries, eq(journalEntryItems.journalEntryId, journalEntries.id))
    .where(and(
      eq(journalEntryItems.tenantId, tenantId),
      eq(journalEntryItems.partyType, 'supplier'),
      eq(journalEntries.status, 'submitted'),
      sql`CAST(${journalEntryItems.credit} AS numeric) > 0`,
      sql`${journalEntries.postingDate} <= ${asOfStr}`,
    ))

  for (const je of jePayables) {
    if (!je.partyId) continue
    const creditAmount = Number(je.credit)

    const [allocated] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${paymentEntryReferences.allocatedAmount} AS numeric)), 0)`,
    })
      .from(paymentEntryReferences)
      .where(and(
        eq(paymentEntryReferences.referenceType, 'journal_entry'),
        eq(paymentEntryReferences.referenceId, je.jeItemId),
      ))

    const allocatedAmount = Number(allocated?.total || 0)
    const outstanding = creditAmount - allocatedAmount
    if (outstanding <= 0) continue

    const jeDate = new Date(je.postingDate)
    const daysDiff = Math.floor((asOf.getTime() - jeDate.getTime()) / (1000 * 60 * 60 * 24))

    const suppId = je.partyId
    if (!supplierMap.has(suppId)) {
      // Fetch supplier name
      const [sup] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, suppId))
      supplierMap.set(suppId, {
        supplierName: sup?.name || 'Unknown',
        current: 0,
        days30: 0,
        days60: 0,
        days90Plus: 0,
        total: 0,
      })
    }

    const entry = supplierMap.get(suppId)!
    entry.total += outstanding

    if (daysDiff <= 30) {
      entry.current += outstanding
    } else if (daysDiff <= 60) {
      entry.days30 += outstanding
    } else if (daysDiff <= 90) {
      entry.days60 += outstanding
    } else {
      entry.days90Plus += outstanding
    }
  }

  const results = Array.from(supplierMap.entries()).map(([supplierId, data]) => ({
    supplierId,
    supplierName: data.supplierName,
    current: Math.round(data.current * 100) / 100,
    days30: Math.round(data.days30 * 100) / 100,
    days60: Math.round(data.days60 * 100) / 100,
    days90Plus: Math.round(data.days90Plus * 100) / 100,
    total: Math.round(data.total * 100) / 100,
  }))

  // Sort by total descending
  results.sort((a, b) => b.total - a.total)

  // Calculate summary
  const summary = {
    current: results.reduce((s, r) => s + r.current, 0),
    days30: results.reduce((s, r) => s + r.days30, 0),
    days60: results.reduce((s, r) => s + r.days60, 0),
    days90Plus: results.reduce((s, r) => s + r.days90Plus, 0),
    total: results.reduce((s, r) => s + r.total, 0),
    supplierCount: results.length,
  }

  return { data: results, summary, asOfDate: asOfStr }
}

/**
 * Reorder suggestions per (warehouse, item).
 *
 *   projected = current stock − reserved + on order (open POs: ordered − received)
 *               + on requisition (open requisitions: requested − ordered)
 * An item is suggested when projected ≤ min stock (min stock > 0). Quantity:
 *   max stock set  → order up to it:  max − projected
 *   else reorder qty, at least enough to get back above min:  max(reorderQty, min − projected)
 *   else min − projected (at least 1)
 * Supplier: the item's primary supplier, else the supplier it was last bought from; unit cost:
 * that supplier's last price, else the item cost.
 */
export async function getReorderSuggestions(
  db: DbInstance,
  tenantId: string,
  filters: { warehouseId?: string; supplierId?: string } = {}
) {
  const res = await db.execute(sql`
    WITH on_order AS (
      SELECT po.warehouse_id, poi.item_id, SUM(GREATEST(poi.quantity - poi.received_quantity, 0)) AS q
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      WHERE po.tenant_id = ${tenantId}
        AND po.status IN ('draft', 'submitted', 'confirmed', 'partially_received')
        AND poi.item_id IS NOT NULL
      GROUP BY po.warehouse_id, poi.item_id
    ),
    on_req AS (
      SELECT ri.warehouse_id, ri.item_id, SUM(GREATEST(ri.quantity - ri.ordered_quantity, 0)) AS q
      FROM purchase_requisition_items ri
      JOIN purchase_requisitions r ON r.id = ri.requisition_id
      WHERE r.tenant_id = ${tenantId}
        AND r.status IN ('draft', 'pending_approval', 'approved', 'partially_ordered')
        AND ri.item_id IS NOT NULL AND ri.warehouse_id IS NOT NULL
      GROUP BY ri.warehouse_id, ri.item_id
    )
    SELECT ws.warehouse_id, w.name AS warehouse_name,
           i.id AS item_id, i.name AS item_name, i.sku AS item_sku, c.name AS category_name,
           COALESCE(i.supplier_id, last_sup.supplier_id) AS supplier_id,
           s.name AS supplier_name,
           ws.current_stock, ws.reserved_stock, ws.min_stock, ws.max_stock, ws.reorder_qty,
           COALESCE(oo.q, 0) AS on_order, COALESCE(orq.q, 0) AS on_requisition,
           COALESCE(NULLIF(sup_cost.last_cost_price, 0), i.cost_price) AS unit_cost,
           i.lead_time_days
    FROM warehouse_stock ws
    JOIN items i ON i.id = ws.item_id
    JOIN warehouses w ON w.id = ws.warehouse_id
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN LATERAL (
      SELECT isc.supplier_id FROM item_supplier_costs isc
      WHERE isc.item_id = i.id ORDER BY isc.last_purchase_date DESC NULLS LAST LIMIT 1
    ) last_sup ON i.supplier_id IS NULL
    LEFT JOIN suppliers s ON s.id = COALESCE(i.supplier_id, last_sup.supplier_id)
    LEFT JOIN item_supplier_costs sup_cost ON sup_cost.item_id = i.id AND sup_cost.supplier_id = COALESCE(i.supplier_id, last_sup.supplier_id)
    LEFT JOIN on_order oo ON oo.warehouse_id = ws.warehouse_id AND oo.item_id = ws.item_id
    LEFT JOIN on_req orq ON orq.warehouse_id = ws.warehouse_id AND orq.item_id = ws.item_id
    WHERE ws.tenant_id = ${tenantId}
      AND i.is_active = true AND i.track_stock = true
      AND ws.min_stock > 0
      AND ws.current_stock - ws.reserved_stock + COALESCE(oo.q, 0) + COALESCE(orq.q, 0) <= ws.min_stock
      ${filters.warehouseId ? sql`AND ws.warehouse_id = ${filters.warehouseId}` : sql``}
      ${filters.supplierId ? sql`AND COALESCE(i.supplier_id, last_sup.supplier_id) = ${filters.supplierId}` : sql``}
    ORDER BY (ws.current_stock - ws.min_stock), i.name
  `)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = (res as { rows?: unknown[] }).rows || []

  const r3 = (n: number) => Math.round(n * 1000) / 1000
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = data.map((row: any) => {
    const currentStock = Number(row.current_stock)
    const reservedStock = Number(row.reserved_stock || 0)
    const minStock = Number(row.min_stock)
    const maxStock = row.max_stock !== null && row.max_stock !== undefined ? Number(row.max_stock) : 0
    const reorderQty = Number(row.reorder_qty || 0)
    const onOrder = Number(row.on_order || 0)
    const onRequisition = Number(row.on_requisition || 0)
    const unitCost = Number(row.unit_cost || 0)
    const projected = r3(currentStock - reservedStock + onOrder + onRequisition)
    const shortfall = minStock - projected
    let suggestedQty: number
    if (maxStock > 0 && maxStock > projected) suggestedQty = maxStock - projected
    else if (reorderQty > 0) suggestedQty = Math.max(reorderQty, shortfall)
    else suggestedQty = Math.max(1, shortfall)
    suggestedQty = r3(Math.max(suggestedQty, 0))

    return {
      itemId: row.item_id,
      itemName: row.item_name,
      itemSku: row.item_sku || '-',
      categoryName: row.category_name || 'Uncategorized',
      supplierId: row.supplier_id,
      supplierName: row.supplier_name || 'No Supplier',
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      currentStock: r3(currentStock),
      reservedStock: r3(reservedStock),
      onOrder: r3(onOrder),
      onRequisition: r3(onRequisition),
      projectedStock: projected,
      minStock: r3(minStock),
      maxStock: maxStock > 0 ? r3(maxStock) : null,
      reorderQty: reorderQty > 0 ? r3(reorderQty) : null,
      suggestedQty,
      unitCost: Math.round(unitCost * 100) / 100,
      estimatedCost: Math.round(suggestedQty * unitCost * 100) / 100,
      leadTimeDays: row.lead_time_days,
    }
  }).filter((r) => r.suggestedQty > 0)

  // Group by supplier + warehouse (one purchase order each)
  const supplierGroups = new Map<string, { supplierId: string; supplierName: string; warehouseId: string; warehouseName: string; items: typeof results; totalCost: number }>()
  for (const item of results) {
    const supplierKey = item.supplierId || 'no-supplier'
    const key = `${supplierKey}:${item.warehouseId}`
    if (!supplierGroups.has(key)) {
      supplierGroups.set(key, { supplierId: supplierKey, supplierName: item.supplierName, warehouseId: item.warehouseId, warehouseName: item.warehouseName, items: [], totalCost: 0 })
    }
    const group = supplierGroups.get(key)!
    group.items.push(item)
    group.totalCost += item.estimatedCost
  }

  const summary = {
    totalItemsBelowReorder: results.length,
    suppliersAffected: new Set(results.map((r) => r.supplierId || 'no-supplier')).size,
    estimatedReorderValue: Math.round(results.reduce((s, r) => s + r.estimatedCost, 0) * 100) / 100,
  }

  return {
    data: results,
    supplierGroups: Array.from(supplierGroups.entries()).map(([key, g]) => ({
      key,
      supplierId: g.supplierId,
      supplierName: g.supplierName,
      warehouseId: g.warehouseId,
      warehouseName: g.warehouseName,
      items: g.items,
      totalCost: Math.round(g.totalCost * 100) / 100,
    })),
    summary,
  }
}

// ==================== H3: ADJUSTMENTS BY REASON ====================

/**
 * Stock adjustments (manual / bulk adjustments, stock takes, waste) grouped by reason code.
 * Value = the GL value posted for the movement (stock_adjustment voucher), signed by direction;
 * movements without a GL entry (item without cost, accounting not configured) are counted as
 * unvalued and estimated at the item's current cost.
 */
export async function getAdjustmentsByReason(
  db: DbInstance,
  tenantId: string,
  filters: { startDate?: string; endDate?: string; warehouseId?: string } = {}
) {
  const range = filters.startDate || filters.endDate
    ? await tenantDayRange(tenantId, filters.startDate || '1970-01-01', filters.endDate || '9999-12-31')
    : null
  const res = await db.execute(sql`
    WITH adj AS (
      SELECT m.id, m.item_id, m.warehouse_id, m.qty_change, m.reference_type,
             COALESCE(m.reason_code,
               CASE m.reference_type WHEN 'stock_take' THEN 'count_correction' WHEN 'waste' THEN 'other' ELSE 'unspecified' END) AS reason_code,
             (SELECT SUM(g.debit) FROM gl_entries g
               WHERE g.tenant_id = m.tenant_id AND g.voucher_type = 'stock_adjustment' AND g.voucher_id = m.id
                 AND COALESCE(g.remarks, '') NOT LIKE 'Reversal:%') AS gl_value
      FROM stock_movements m
      WHERE m.tenant_id = ${tenantId}
        AND m.reference_type IN ('manual_adjustment', 'bulk_adjustment', 'stock_take', 'waste')
        ${range ? sql`AND m.created_at >= ${range.from.toISOString()}::timestamp AND m.created_at <= ${range.to.toISOString()}::timestamp` : sql``}
        ${filters.warehouseId ? sql`AND m.warehouse_id = ${filters.warehouseId}` : sql``}
    )
    SELECT adj.reason_code,
           COUNT(*)::int AS movements,
           SUM(CASE WHEN adj.qty_change > 0 THEN adj.qty_change ELSE 0 END) AS qty_in,
           SUM(CASE WHEN adj.qty_change < 0 THEN -adj.qty_change ELSE 0 END) AS qty_out,
           SUM(CASE WHEN adj.gl_value IS NOT NULL THEN SIGN(adj.qty_change) * adj.gl_value ELSE 0 END) AS gl_value,
           COUNT(*) FILTER (WHERE adj.gl_value IS NULL)::int AS unvalued,
           SUM(CASE WHEN adj.gl_value IS NULL THEN adj.qty_change * i.cost_price ELSE 0 END) AS unvalued_estimate
    FROM adj JOIN items i ON i.id = adj.item_id
    GROUP BY adj.reason_code
    ORDER BY SUM(CASE WHEN adj.gl_value IS NOT NULL THEN SIGN(adj.qty_change) * adj.gl_value ELSE adj.qty_change * i.cost_price END)
  `)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = (res as { rows?: unknown[] }).rows || []
  const r2 = (n: number) => Math.round(n * 100) / 100
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  const { ADJUSTMENT_REASON_LABELS } = await import('@/lib/inventory/adjustment-reasons')
  const data = rows.map((r) => ({
    reasonCode: r.reason_code as string,
    reasonLabel: (ADJUSTMENT_REASON_LABELS as Record<string, string>)[r.reason_code] || 'Unspecified',
    movements: Number(r.movements),
    qtyIn: r3(Number(r.qty_in || 0)),
    qtyOut: r3(Number(r.qty_out || 0)),
    value: r2(Number(r.gl_value || 0)),
    unvaluedMovements: Number(r.unvalued || 0),
    unvaluedEstimate: r2(Number(r.unvalued_estimate || 0)),
  }))
  return {
    data,
    summary: {
      movements: data.reduce((s, r) => s + r.movements, 0),
      netValue: r2(data.reduce((s, r) => s + r.value, 0)),
      lossValue: r2(data.reduce((s, r) => s + Math.min(0, r.value), 0)),
      unvaluedMovements: data.reduce((s, r) => s + r.unvaluedMovements, 0),
    },
  }
}

// ==================== H3: INVENTORY VALUATION vs GL ====================

/**
 * Stock value per warehouse at the weighted-average cost (current stock × items.cost_price) next
 * to the balance of the stock account(s) in the GL. The difference shows postings that bypassed
 * the ledger (e.g. stock moved with accounting off, unvalued items, cost rounding).
 */
export async function getInventoryValuationReconciliation(db: DbInstance, tenantId: string) {
  const whRes = await db.execute(sql`
    SELECT w.id AS warehouse_id, w.name AS warehouse_name,
           COUNT(*) FILTER (WHERE ws.current_stock <> 0)::int AS items,
           COALESCE(SUM(ws.current_stock * i.cost_price), 0) AS value,
           COUNT(*) FILTER (WHERE ws.current_stock > 0 AND COALESCE(i.cost_price, 0) = 0)::int AS zero_cost_items,
           COALESCE(SUM(CASE WHEN ws.current_stock < 0 THEN ws.current_stock * i.cost_price ELSE 0 END), 0) AS negative_value
    FROM warehouse_stock ws
    JOIN items i ON i.id = ws.item_id AND i.track_stock = true
    JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE ws.tenant_id = ${tenantId}
    GROUP BY w.id, w.name
    ORDER BY w.name
  `)
  const glRes = await db.execute(sql`
    SELECT coa.id, coa.account_number, coa.name,
           (s.default_stock_account_id = coa.id) AS is_default,
           COALESCE(SUM(g.debit - g.credit), 0) AS balance
    FROM chart_of_accounts coa
    LEFT JOIN accounting_settings s ON s.tenant_id = coa.tenant_id
    LEFT JOIN gl_entries g ON g.account_id = coa.id AND g.tenant_id = coa.tenant_id
    WHERE coa.tenant_id = ${tenantId} AND coa.is_group = false
      AND (coa.account_type = 'stock' OR coa.id = s.default_stock_account_id)
    GROUP BY coa.id, coa.account_number, coa.name, s.default_stock_account_id
    ORDER BY coa.account_number
  `)
  const srbnbRes = await db.execute(sql`
    SELECT coa.id, coa.account_number, coa.name, COALESCE(SUM(g.credit - g.debit), 0) AS balance
    FROM accounting_settings s
    JOIN chart_of_accounts coa ON coa.id = s.default_srbnb_account_id
    LEFT JOIN gl_entries g ON g.account_id = coa.id AND g.tenant_id = s.tenant_id
    WHERE s.tenant_id = ${tenantId}
    GROUP BY coa.id, coa.account_number, coa.name
  `)
  const r2 = (n: number) => Math.round(n * 100) / 100
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warehouses = ((whRes as { rows?: any[] }).rows || []).map((r: any) => ({
    warehouseId: r.warehouse_id as string,
    warehouseName: r.warehouse_name as string,
    items: Number(r.items),
    stockValue: r2(Number(r.value)),
    zeroCostItems: Number(r.zero_cost_items),
    negativeStockValue: r2(Number(r.negative_value)),
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = ((glRes as { rows?: any[] }).rows || []).map((r: any) => ({
    accountId: r.id as string, accountNumber: r.account_number as string, name: r.name as string,
    isDefault: r.is_default === true, balance: r2(Number(r.balance)),
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const srbnbRow = ((srbnbRes as { rows?: any[] }).rows || [])[0]
  const stockValue = r2(warehouses.reduce((s, w) => s + w.stockValue, 0))
  const glBalance = r2(accounts.reduce((s, a) => s + a.balance, 0))
  const difference = r2(glBalance - stockValue)
  return {
    warehouses,
    accounts,
    srbnb: srbnbRow ? { accountId: srbnbRow.id, accountNumber: srbnbRow.account_number, name: srbnbRow.name, balance: r2(Number(srbnbRow.balance)) } : null,
    summary: {
      stockValue,
      glBalance,
      difference,
      // a difference within 0.5% (min 1.00) is rounding of the 2-decimal average cost
      tolerance: r2(Math.max(1, Math.abs(stockValue) * 0.005)),
      reconciled: Math.abs(difference) <= Math.max(1, Math.abs(stockValue) * 0.005),
      zeroCostItems: warehouses.reduce((s, w) => s + w.zeroCostItems, 0),
    },
  }
}
