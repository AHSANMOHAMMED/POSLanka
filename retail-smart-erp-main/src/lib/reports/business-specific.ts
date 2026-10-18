// Business-type specific report logic

import { eq, and, sql, gte, lte } from 'drizzle-orm'
import { workOrders, workOrderServices, workOrderParts, restaurantOrders, restaurantOrderItems, restaurantTables, sales, saleItems, items, categories } from '@/lib/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any

// ==================== AUTO SERVICE ====================

export async function getServiceRevenue(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  // Revenue by service (from work order services)
  const serviceData = await db.select({
    description: workOrderServices.description,
    jobCount: sql<number>`COUNT(DISTINCT ${workOrderServices.workOrderId})::int`,
    totalHours: sql<string>`COALESCE(SUM(CAST(${workOrderServices.hours} AS numeric)), 0)`,
    totalRevenue: sql<string>`COALESCE(SUM(CAST(${workOrderServices.amount} AS numeric)), 0)`,
  })
    .from(workOrderServices)
    .innerJoin(workOrders, eq(workOrderServices.workOrderId, workOrders.id))
    .where(and(
      eq(workOrderServices.tenantId, tenantId),
      gte(workOrders.createdAt, new Date(filters.fromDate)),
      lte(workOrders.createdAt, new Date(filters.toDate + 'T23:59:59')),
      sql`${workOrders.status} NOT IN ('draft', 'cancelled')`,
    ))
    .groupBy(workOrderServices.description)
    .orderBy(sql`SUM(CAST(${workOrderServices.amount} AS numeric)) DESC`)

  // Parts revenue
  const [partsTotal] = await db.select({
    totalRevenue: sql<string>`COALESCE(SUM(CAST(${workOrderParts.total} AS numeric)), 0)`,
  })
    .from(workOrderParts)
    .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
    .where(and(
      eq(workOrderParts.tenantId, tenantId),
      gte(workOrders.createdAt, new Date(filters.fromDate)),
      lte(workOrders.createdAt, new Date(filters.toDate + 'T23:59:59')),
      sql`${workOrders.status} NOT IN ('draft', 'cancelled')`,
    ))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serviceRevenue = serviceData.reduce((s: number, r: any) => s + Number(r.totalRevenue), 0)

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    services: serviceData.map((row: any) => ({
      description: row.description || 'General Service',
      jobCount: row.jobCount,
      totalHours: Math.round(Number(row.totalHours) * 100) / 100,
      totalRevenue: Math.round(Number(row.totalRevenue) * 100) / 100,
    })),
    totalServiceRevenue: Math.round(serviceRevenue * 100) / 100,
    totalPartsRevenue: Math.round(Number(partsTotal.totalRevenue) * 100) / 100,
    grandTotal: Math.round((serviceRevenue + Number(partsTotal.totalRevenue)) * 100) / 100,
  }
}

export async function getTechnicianPerformance(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  const data = await db.select({
    technicianId: workOrders.assignedTo,
    technicianName: sql<string>`COALESCE(${workOrders.assignedToName}, 'Unassigned')`,
    jobsCompleted: sql<number>`COUNT(CASE WHEN ${workOrders.status} IN ('completed', 'invoiced') THEN 1 END)::int`,
    jobsTotal: sql<number>`COUNT(*)::int`,
    totalRevenue: sql<string>`COALESCE(SUM(CAST(${workOrders.total} AS numeric)), 0)`,
    avgJobValue: sql<string>`CASE WHEN COUNT(*) > 0 THEN SUM(CAST(${workOrders.total} AS numeric)) / COUNT(*) ELSE 0 END`,
  })
    .from(workOrders)
    .where(and(
      eq(workOrders.tenantId, tenantId),
      gte(workOrders.createdAt, new Date(filters.fromDate)),
      lte(workOrders.createdAt, new Date(filters.toDate + 'T23:59:59')),
      sql`${workOrders.status} NOT IN ('draft', 'cancelled')`,
    ))
    .groupBy(workOrders.assignedTo, workOrders.assignedToName)
    .orderBy(sql`SUM(CAST(${workOrders.total} AS numeric)) DESC`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    technicianId: row.technicianId,
    technicianName: row.technicianName,
    jobsCompleted: row.jobsCompleted,
    jobsTotal: row.jobsTotal,
    completionRate: row.jobsTotal > 0 ? Math.round((row.jobsCompleted / row.jobsTotal) * 100) : 0,
    totalRevenue: Math.round(Number(row.totalRevenue) * 100) / 100,
    avgJobValue: Math.round(Number(row.avgJobValue) * 100) / 100,
  }))
}

// ==================== RESTAURANT ====================

export async function getTableTurnover(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  const data = await db.select({
    tableId: restaurantOrders.tableId,
    tableName: restaurantTables.name,
    tableCapacity: restaurantTables.capacity,
    orderCount: sql<number>`COUNT(*)::int`,
    totalRevenue: sql<string>`COALESCE(SUM(CAST(${restaurantOrders.total} AS numeric)), 0)`,
    avgOrderValue: sql<string>`CASE WHEN COUNT(*) > 0 THEN SUM(CAST(${restaurantOrders.total} AS numeric)) / COUNT(*) ELSE 0 END`,
    totalCustomers: sql<number>`COALESCE(SUM(${restaurantOrders.customerCount}), 0)::int`,
  })
    .from(restaurantOrders)
    .leftJoin(restaurantTables, eq(restaurantOrders.tableId, restaurantTables.id))
    .where(and(
      eq(restaurantOrders.tenantId, tenantId),
      gte(restaurantOrders.createdAt, new Date(filters.fromDate)),
      lte(restaurantOrders.createdAt, new Date(filters.toDate + 'T23:59:59')),
      sql`${restaurantOrders.status} != 'cancelled'`,
      eq(restaurantOrders.orderType, 'dine_in'),
    ))
    .groupBy(restaurantOrders.tableId, restaurantTables.name, restaurantTables.capacity)
    .orderBy(sql`SUM(CAST(${restaurantOrders.total} AS numeric)) DESC`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    tableId: row.tableId,
    tableName: row.tableName || 'Unknown',
    capacity: row.tableCapacity || 0,
    orderCount: row.orderCount,
    totalRevenue: Math.round(Number(row.totalRevenue) * 100) / 100,
    avgOrderValue: Math.round(Number(row.avgOrderValue) * 100) / 100,
    totalCustomers: row.totalCustomers,
    revenuePerSeat: row.tableCapacity > 0
      ? Math.round((Number(row.totalRevenue) / row.tableCapacity) * 100) / 100
      : 0,
  }))
}

export async function getMenuPerformance(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  const data = await db.select({
    itemId: restaurantOrderItems.itemId,
    itemName: restaurantOrderItems.itemName,
    categoryName: categories.name,
    timesOrdered: sql<number>`SUM(${restaurantOrderItems.quantity})::int`,
    totalRevenue: sql<string>`COALESCE(SUM(${restaurantOrderItems.quantity} * CAST(${restaurantOrderItems.unitPrice} AS numeric)), 0)`,
    orderCount: sql<number>`COUNT(DISTINCT ${restaurantOrderItems.orderId})::int`,
  })
    .from(restaurantOrderItems)
    .innerJoin(restaurantOrders, eq(restaurantOrderItems.orderId, restaurantOrders.id))
    .leftJoin(items, eq(restaurantOrderItems.itemId, items.id))
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .where(and(
      eq(restaurantOrderItems.tenantId, tenantId),
      gte(restaurantOrders.createdAt, new Date(filters.fromDate)),
      lte(restaurantOrders.createdAt, new Date(filters.toDate + 'T23:59:59')),
      sql`${restaurantOrders.status} != 'cancelled'`,
    ))
    .groupBy(restaurantOrderItems.itemId, restaurantOrderItems.itemName, categories.name)
    .orderBy(sql`SUM(${restaurantOrderItems.quantity} * CAST(${restaurantOrderItems.unitPrice} AS numeric)) DESC`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    categoryName: row.categoryName || 'Uncategorized',
    timesOrdered: row.timesOrdered,
    totalRevenue: Math.round(Number(row.totalRevenue) * 100) / 100,
    orderCount: row.orderCount,
  }))
}

// ==================== SUPERMARKET ====================

export async function getCategorySales(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  const data = await db.select({
    categoryId: categories.id,
    categoryName: sql<string>`COALESCE(${categories.name}, 'Uncategorized')`,
    itemCount: sql<number>`COUNT(DISTINCT ${saleItems.itemId})::int`,
    qtySold: sql<string>`COALESCE(SUM(CAST(${saleItems.quantity} AS numeric)), 0)`,
    totalRevenue: sql<string>`COALESCE(SUM(CAST(${saleItems.total} AS numeric)), 0)`,
  })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .leftJoin(items, eq(saleItems.itemId, items.id))
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .where(and(
      eq(saleItems.tenantId, tenantId),
      gte(sales.createdAt, new Date(filters.fromDate)),
      lte(sales.createdAt, new Date(filters.toDate + 'T23:59:59')),
      sql`${sales.status} != 'void'`,
      eq(sales.isReturn, false),
    ))
    .groupBy(categories.id, categories.name)
    .orderBy(sql`SUM(CAST(${saleItems.total} AS numeric)) DESC`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grandTotal = data.reduce((s: number, r: any) => s + Number(r.totalRevenue), 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    itemCount: row.itemCount,
    qtySold: Math.round(Number(row.qtySold) * 1000) / 1000,
    totalRevenue: Math.round(Number(row.totalRevenue) * 100) / 100,
    contribution: grandTotal > 0 ? Math.round((Number(row.totalRevenue) / grandTotal) * 10000) / 100 : 0,
  }))
}

export async function getItemVelocity(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  // Get all items with their sales in the period
  const data = await db.select({
    itemId: items.id,
    itemName: items.name,
    sku: items.sku,
    categoryName: categories.name,
    currentStock: sql<string>`COALESCE((SELECT SUM(CAST(ws.current_stock AS numeric)) FROM warehouse_stock ws WHERE ws.item_id = ${items.id} AND ws.tenant_id = ${tenantId}), 0)`,
    qtySold: sql<string>`COALESCE(SUM(CASE WHEN ${sales.id} IS NOT NULL THEN CAST(${saleItems.quantity} AS numeric) ELSE 0 END), 0)`,
    totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${sales.id} IS NOT NULL THEN CAST(${saleItems.total} AS numeric) ELSE 0 END), 0)`,
    daysSinceLastSale: sql<string>`EXTRACT(EPOCH FROM (NOW() - MAX(${sales.createdAt}))) / 86400`,
  })
    .from(items)
    .leftJoin(saleItems, and(eq(saleItems.itemId, items.id), eq(saleItems.tenantId, tenantId)))
    .leftJoin(sales, and(
      eq(saleItems.saleId, sales.id),
      gte(sales.createdAt, new Date(filters.fromDate)),
      lte(sales.createdAt, new Date(filters.toDate + 'T23:59:59')),
      sql`${sales.status} != 'void'`,
      eq(sales.isReturn, false),
    ))
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .where(and(
      eq(items.tenantId, tenantId),
      eq(items.trackStock, true),
    ))
    .groupBy(items.id, items.name, items.sku, categories.name)
    .orderBy(sql`COALESCE(SUM(CAST(${saleItems.quantity} AS numeric)), 0) DESC`)
    .limit(200)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => {
    const qtySold = Number(row.qtySold)
    const currentStock = Number(row.currentStock)
    const rawDays = Number(row.daysSinceLastSale)
    const daysSinceLastSale = isNaN(rawDays) ? null : Math.floor(rawDays)

    let velocity: 'fast' | 'normal' | 'slow' | 'dead'
    if (qtySold > 50) velocity = 'fast'
    else if (qtySold > 10) velocity = 'normal'
    else if (qtySold > 0) velocity = 'slow'
    else velocity = 'dead'

    return {
      itemId: row.itemId,
      itemName: row.itemName,
      sku: row.sku || '-',
      categoryName: row.categoryName || 'Uncategorized',
      currentStock: Math.round(currentStock * 1000) / 1000,
      qtySold: Math.round(qtySold * 1000) / 1000,
      totalRevenue: Math.round(Number(row.totalRevenue) * 100) / 100,
      daysSinceLastSale,
      velocity,
    }
  })
}
