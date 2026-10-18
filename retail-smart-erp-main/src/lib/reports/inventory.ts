// Inventory report calculation logic
// Queries from items, warehouse_stock, stock_movements, purchases, sale_items tables

import { eq, and, sql, gte, lte, desc, ne } from 'drizzle-orm'
import { items, warehouseStock, stockMovements, purchases, sales, saleItems, categories, suppliers, journalEntryItems, journalEntries, paymentEntryReferences } from '@/lib/db/schema'

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
  const conditions = [
    eq(stockMovements.tenantId, tenantId),
    gte(stockMovements.createdAt, new Date(filters.fromDate)),
    lte(stockMovements.createdAt, new Date(filters.toDate + 'T23:59:59')),
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
    referenceType: stockMovements.referenceType,
    referenceId: stockMovements.referenceId,
    notes: stockMovements.notes,
  })
    .from(stockMovements)
    .leftJoin(items, eq(stockMovements.itemId, items.id))
    .where(and(...conditions))
    .orderBy(desc(stockMovements.createdAt))
    .limit(500)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: row.id,
    date: row.date,
    itemName: row.itemName || 'Unknown',
    sku: row.sku || '-',
    type: row.type,
    qtyIn: row.type === 'in' ? Math.abs(Number(row.quantity)) : (row.type === 'adjustment' && Number(row.quantity) > 0 ? Number(row.quantity) : 0),
    qtyOut: row.type === 'out' ? Math.abs(Number(row.quantity)) : (row.type === 'adjustment' && Number(row.quantity) < 0 ? Math.abs(Number(row.quantity)) : 0),
    adjustment: row.type === 'adjustment' ? Number(row.quantity) : 0,
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

  // Totals
  const [totals] = await db.select({
    totalPurchases: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = false THEN CAST(${purchases.total} AS numeric) ELSE 0 END), 0)`,
    totalReturns: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = true THEN CAST(${purchases.total} AS numeric) ELSE 0 END), 0)`,
    orderCount: sql<number>`COUNT(CASE WHEN ${purchases.isReturn} = false THEN 1 END)::int`,
  })
    .from(purchases)
    .where(and(
      eq(purchases.tenantId, tenantId),
      gte(purchases.createdAt, new Date(fromDate)),
      lte(purchases.createdAt, new Date(toDate + 'T23:59:59')),
      sql`${purchases.status} NOT IN ('cancelled', 'draft')`,
    ))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let groupExpr: any
  let groupLabel: string

  if (groupBy === 'supplier') {
    groupExpr = sql`COALESCE((SELECT name FROM suppliers WHERE id = ${purchases.supplierId}), 'Unknown')`
    groupLabel = 'Supplier'
  } else {
    groupExpr = sql`TO_CHAR(${purchases.createdAt}, 'YYYY-MM')`
    groupLabel = 'Month'
  }

  const grouped = await db.select({
    group: groupExpr.as('group_key'),
    totalPurchases: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = false THEN CAST(${purchases.total} AS numeric) ELSE 0 END), 0)`,
    totalReturns: sql<string>`COALESCE(SUM(CASE WHEN ${purchases.isReturn} = true THEN CAST(${purchases.total} AS numeric) ELSE 0 END), 0)`,
    orderCount: sql<number>`COUNT(CASE WHEN ${purchases.isReturn} = false THEN 1 END)::int`,
  })
    .from(purchases)
    .where(and(
      eq(purchases.tenantId, tenantId),
      gte(purchases.createdAt, new Date(fromDate)),
      lte(purchases.createdAt, new Date(toDate + 'T23:59:59')),
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
      gte(purchases.createdAt, new Date(filters.fromDate)),
      lte(purchases.createdAt, new Date(filters.toDate + 'T23:59:59')),
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
  const conditions = [
    eq(saleItems.tenantId, tenantId),
    gte(sales.createdAt, new Date(filters.fromDate)),
    lte(sales.createdAt, new Date(filters.toDate + 'T23:59:59')),
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

export async function getReorderSuggestions(
  db: DbInstance,
  tenantId: string,
  filters: { warehouseId?: string; supplierId?: string } = {}
) {
  const conditions = [
    eq(warehouseStock.tenantId, tenantId),
    sql`CAST(${warehouseStock.currentStock} AS numeric) <= CAST(${warehouseStock.minStock} AS numeric)`,
    sql`CAST(${warehouseStock.minStock} AS numeric) > 0`,
  ]

  if (filters.warehouseId) {
    conditions.push(eq(warehouseStock.warehouseId, filters.warehouseId))
  }

  const data = await db.select({
    itemId: items.id,
    itemName: items.name,
    itemSku: items.sku,
    categoryName: categories.name,
    supplierId: items.supplierId,
    supplierName: suppliers.name,
    warehouseId: warehouseStock.warehouseId,
    currentStock: warehouseStock.currentStock,
    minStock: warehouseStock.minStock,
    reorderQty: warehouseStock.reorderQty,
    costPrice: items.costPrice,
    leadTimeDays: items.leadTimeDays,
  })
    .from(warehouseStock)
    .innerJoin(items, eq(warehouseStock.itemId, items.id))
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .leftJoin(suppliers, eq(items.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(sql`CAST(${warehouseStock.currentStock} AS numeric) - CAST(${warehouseStock.minStock} AS numeric)`)

  // Filter by supplier if specified
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filtered: any[] = data
  if (filters.supplierId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filtered = data.filter((d: any) => d.supplierId === filters.supplierId)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = filtered.map((row: any) => {
    const currentStock = Number(row.currentStock)
    const minStock = Number(row.minStock)
    const reorderQty = Number(row.reorderQty || 0)
    const costPrice = Number(row.costPrice)
    const suggestedQty = reorderQty > 0 ? reorderQty : Math.max(1, minStock - currentStock)

    return {
      itemId: row.itemId,
      itemName: row.itemName,
      itemSku: row.itemSku || '-',
      categoryName: row.categoryName || 'Uncategorized',
      supplierId: row.supplierId,
      supplierName: row.supplierName || 'No Supplier',
      warehouseId: row.warehouseId,
      currentStock: Math.round(currentStock * 1000) / 1000,
      minStock: Math.round(minStock * 1000) / 1000,
      suggestedQty: Math.round(suggestedQty * 1000) / 1000,
      estimatedCost: Math.round(suggestedQty * costPrice * 100) / 100,
      leadTimeDays: row.leadTimeDays,
    }
  })

  // Group by supplier
  const supplierGroups = new Map<string, { supplierName: string; items: typeof results; totalCost: number }>()
  for (const item of results) {
    const key = item.supplierId || 'no-supplier'
    if (!supplierGroups.has(key)) {
      supplierGroups.set(key, { supplierName: item.supplierName, items: [], totalCost: 0 })
    }
    const group = supplierGroups.get(key)!
    group.items.push(item)
    group.totalCost += item.estimatedCost
  }

  const summary = {
    totalItemsBelowReorder: results.length,
    suppliersAffected: supplierGroups.size,
    estimatedReorderValue: Math.round(results.reduce((s, r) => s + r.estimatedCost, 0) * 100) / 100,
  }

  return {
    data: results,
    supplierGroups: Array.from(supplierGroups.entries()).map(([id, g]) => ({
      supplierId: id,
      supplierName: g.supplierName,
      items: g.items,
      totalCost: Math.round(g.totalCost * 100) / 100,
    })),
    summary,
  }
}
