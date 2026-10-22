// Sales report calculation logic
// All reports query from sales, sale_items, payments tables

import { eq, and, sql, gte, lte } from 'drizzle-orm'
import { sales, saleItems, payments, items, glEntries, chartOfAccounts } from '@/lib/db/schema'
import { tenantDayRange, localTs } from './date-range'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any

export async function getSalesSummary(
  db: DbInstance,
  tenantId: string,
  filters: {
    fromDate: string
    toDate: string
    groupBy?: 'day' | 'week' | 'month' | 'customer' | 'salesperson' | 'payment_method'
  }
) {
  const { fromDate, toDate, groupBy = 'day' } = filters
  const range = await tenantDayRange(tenantId, fromDate, toDate)

  // Totals
  const [totals] = await db.select({
    totalSales: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} = false THEN CAST(${sales.total} AS numeric) ELSE 0 END), 0)`,
    // Return documents are stored with NEGATIVE totals; report the returned amount as a
    // positive magnitude so netSales = sales - returns (it was sales + returns).
    totalReturns: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} = true THEN ABS(CAST(${sales.total} AS numeric)) ELSE 0 END), 0)`,
    orderCount: sql<number>`COUNT(CASE WHEN ${sales.isReturn} = false THEN 1 END)::int`,
    returnCount: sql<number>`COUNT(CASE WHEN ${sales.isReturn} = true THEN 1 END)::int`,
  })
    .from(sales)
    .where(and(
      eq(sales.tenantId, tenantId),
      gte(sales.createdAt, range.from),
      lte(sales.createdAt, range.to),
      sql`${sales.status} != 'void'`,
    ))

  const totalSales = Number(totals.totalSales)
  const totalReturns = Number(totals.totalReturns)
  const netSales = totalSales - totalReturns
  const avgOrderValue = totals.orderCount > 0 ? netSales / totals.orderCount : 0

  // Grouped data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let groupExpr: any
  let groupLabel: string

  switch (groupBy) {
    case 'week':
      groupExpr = sql`TO_CHAR(DATE_TRUNC('week', ${localTs(sales.createdAt, range.tz)}), 'IYYY-"W"IW')`
      groupLabel = 'Week'
      break
    case 'month':
      groupExpr = sql`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM')`
      groupLabel = 'Month'
      break
    case 'customer':
      groupExpr = sql`COALESCE(${sales.customerName}, 'Walk-in')`
      groupLabel = 'Customer'
      break
    case 'salesperson':
      groupExpr = sql`COALESCE((SELECT full_name FROM users WHERE id = ${sales.createdBy}), 'Unknown')`
      groupLabel = 'Salesperson'
      break
    case 'payment_method':
      groupExpr = sql`COALESCE(${sales.paymentMethod}, 'mixed')`
      groupLabel = 'Payment Method'
      break
    default:
      groupExpr = sql`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM-DD')`
      groupLabel = 'Date'
  }

  const grouped = await db.select({
    group: groupExpr.as('group_key'),
    totalSales: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} = false THEN CAST(${sales.total} AS numeric) ELSE 0 END), 0)`,
    // Return documents are stored with NEGATIVE totals; report the returned amount as a
    // positive magnitude so netSales = sales - returns (it was sales + returns).
    totalReturns: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} = true THEN ABS(CAST(${sales.total} AS numeric)) ELSE 0 END), 0)`,
    orderCount: sql<number>`COUNT(CASE WHEN ${sales.isReturn} = false THEN 1 END)::int`,
  })
    .from(sales)
    .where(and(
      eq(sales.tenantId, tenantId),
      gte(sales.createdAt, range.from),
      lte(sales.createdAt, range.to),
      sql`${sales.status} != 'void'`,
    ))
    .groupBy(groupExpr)
    .orderBy(groupExpr)

  return {
    summary: {
      totalSales: Math.round(totalSales * 100) / 100,
      totalReturns: Math.round(totalReturns * 100) / 100,
      netSales: Math.round(netSales * 100) / 100,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      orderCount: totals.orderCount,
      returnCount: totals.returnCount,
    },
    groupLabel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: grouped.map((row: any) => ({
      group: row.group,
      totalSales: Math.round(Number(row.totalSales) * 100) / 100,
      totalReturns: Math.round(Number(row.totalReturns) * 100) / 100,
      netSales: Math.round((Number(row.totalSales) - Number(row.totalReturns)) * 100) / 100,
      orderCount: row.orderCount,
    })),
  }
}

export async function getSalesByItem(
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
  ]
  if (filters.categoryId) {
    conditions.push(eq(items.categoryId, filters.categoryId))
  }

  const data = await db.select({
    itemId: saleItems.itemId,
    itemName: saleItems.itemName,
    sku: items.sku,
    qtySold: sql<string>`SUM(CASE WHEN ${sales.isReturn} = false THEN CAST(${saleItems.quantity} AS numeric) ELSE 0 END)`,
    qtyReturned: sql<string>`SUM(CASE WHEN ${sales.isReturn} = true THEN ABS(CAST(${saleItems.quantity} AS numeric)) ELSE 0 END)`,
    revenue: sql<string>`SUM(CASE WHEN ${sales.isReturn} = false THEN CAST(${saleItems.total} AS numeric) ELSE 0 END)`,
    avgPrice: sql<string>`COALESCE(AVG(CASE WHEN ${sales.isReturn} = false THEN CAST(${saleItems.unitPrice} AS numeric) END), 0)`,
  })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .leftJoin(items, eq(saleItems.itemId, items.id))
    .where(and(...conditions))
    .groupBy(saleItems.itemId, saleItems.itemName, items.sku)
    .orderBy(sql`SUM(CASE WHEN ${sales.isReturn} = false THEN CAST(${saleItems.total} AS numeric) ELSE 0 END) DESC`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    sku: row.sku || '-',
    qtySold: Math.round(Number(row.qtySold) * 1000) / 1000,
    qtyReturned: Math.round(Number(row.qtyReturned) * 1000) / 1000,
    revenue: Math.round(Number(row.revenue) * 100) / 100,
    avgPrice: Math.round(Number(row.avgPrice) * 100) / 100,
  }))
}

export async function getSalesByCustomer(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  const range = await tenantDayRange(tenantId, filters.fromDate, filters.toDate)
  const data = await db.select({
    customerId: sales.customerId,
    customerName: sql<string>`COALESCE(${sales.customerName}, 'Walk-in Customer')`,
    orderCount: sql<number>`COUNT(CASE WHEN ${sales.isReturn} = false THEN 1 END)::int`,
    totalSpent: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} = false THEN CAST(${sales.total} AS numeric) ELSE 0 END), 0)`,
    avgOrderValue: sql<string>`CASE WHEN COUNT(CASE WHEN ${sales.isReturn} = false THEN 1 END) > 0 THEN SUM(CASE WHEN ${sales.isReturn} = false THEN CAST(${sales.total} AS numeric) ELSE 0 END) / COUNT(CASE WHEN ${sales.isReturn} = false THEN 1 END) ELSE 0 END`,
    lastOrderDate: sql<string>`MAX(${sales.createdAt})`,
  })
    .from(sales)
    .where(and(
      eq(sales.tenantId, tenantId),
      gte(sales.createdAt, range.from),
      lte(sales.createdAt, range.to),
      sql`${sales.status} != 'void'`,
    ))
    .groupBy(sales.customerId, sales.customerName)
    .orderBy(sql`SUM(CASE WHEN ${sales.isReturn} = false THEN CAST(${sales.total} AS numeric) ELSE 0 END) DESC`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    customerId: row.customerId,
    customerName: row.customerName,
    orderCount: row.orderCount,
    totalSpent: Math.round(Number(row.totalSpent) * 100) / 100,
    avgOrderValue: Math.round(Number(row.avgOrderValue) * 100) / 100,
    lastOrderDate: row.lastOrderDate,
  }))
}

export async function getDailySales(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  const range = await tenantDayRange(tenantId, filters.fromDate, filters.toDate)
  const data = await db.select({
    date: sql<string>`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM-DD')`,
    totalSales: sql<string>`COALESCE(SUM(CAST(${sales.total} AS numeric)), 0)`,
    orderCount: sql<number>`COUNT(*)::int`,
    avgOrder: sql<string>`CASE WHEN COUNT(*) > 0 THEN SUM(CAST(${sales.total} AS numeric)) / COUNT(*) ELSE 0 END`,
  })
    .from(sales)
    .where(and(
      eq(sales.tenantId, tenantId),
      gte(sales.createdAt, range.from),
      lte(sales.createdAt, range.to),
      sql`${sales.status} != 'void'`,
      eq(sales.isReturn, false),
    ))
    .groupBy(sql`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM-DD')`)

  // Get payment breakdown per day
  const paymentData = await db.select({
    date: sql<string>`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM-DD')`,
    method: payments.method,
    amount: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)`,
  })
    .from(payments)
    .innerJoin(sales, eq(payments.saleId, sales.id))
    .where(and(
      eq(payments.tenantId, tenantId),
      gte(sales.createdAt, range.from),
      lte(sales.createdAt, range.to),
      sql`${sales.status} != 'void'`,
      sql`${payments.voidedAt} IS NULL`,
      eq(sales.isReturn, false),
    ))
    .groupBy(sql`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM-DD')`, payments.method)

  // Build payment map
  const paymentMap = new Map<string, Record<string, number>>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of paymentData as any[]) {
    if (!paymentMap.has(row.date)) paymentMap.set(row.date, {})
    const map = paymentMap.get(row.date)!
    map[row.method] = Math.round(Number(row.amount) * 100) / 100
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    date: row.date,
    totalSales: Math.round(Number(row.totalSales) * 100) / 100,
    orderCount: row.orderCount,
    avgOrder: Math.round(Number(row.avgOrder) * 100) / 100,
    payments: paymentMap.get(row.date) || {},
  }))
}

export async function getPaymentCollection(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  // Use GL entries as the single source of truth for payment collections.
  // Debit entries on cash/bank accounts from sale or payment_entry vouchers
  // capture ALL collections regardless of how the payment was recorded.
  const glData = await db.select({
    accountType: chartOfAccounts.accountType,
    totalAmount: sql<string>`COALESCE(SUM(CAST(${glEntries.debit} AS numeric)), 0)`,
    transactionCount: sql<number>`COUNT(*)::int`,
  })
    .from(glEntries)
    .innerJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
    .where(and(
      eq(glEntries.tenantId, tenantId),
      gte(glEntries.postingDate, filters.fromDate),
      lte(glEntries.postingDate, filters.toDate),
      sql`${chartOfAccounts.accountType} IN ('cash', 'bank')`,
      sql`CAST(${glEntries.debit} AS numeric) > 0`,
      sql`${glEntries.voucherType} IN ('sale', 'payment_entry')`,
    ))
    .groupBy(chartOfAccounts.accountType)

  // Map account types to display-friendly method names
  const accountTypeToMethod: Record<string, string> = {
    cash: 'cash',
    bank: 'bank_transfer',
  }

  const data: { method: string; totalAmount: number; transactionCount: number; percentage: number }[] = []
  let grandTotal = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of glData as any[]) {
    grandTotal += Number(row.totalAmount)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of glData as any[]) {
    const amount = Math.round(Number(row.totalAmount) * 100) / 100
    data.push({
      method: accountTypeToMethod[row.accountType] || row.accountType,
      totalAmount: amount,
      transactionCount: row.transactionCount,
      percentage: grandTotal > 0 ? Math.round((amount / grandTotal) * 10000) / 100 : 0,
    })
  }

  data.sort((a, b) => b.totalAmount - a.totalAmount)

  return {
    data,
    grandTotal: Math.round(grandTotal * 100) / 100,
  }
}

export async function getTaxReport(
  db: DbInstance,
  tenantId: string,
  filters: { fromDate: string; toDate: string }
) {
  const range = await tenantDayRange(tenantId, filters.fromDate, filters.toDate)
  // Tax collected on sales
  const salesTax = await db.select({
    month: sql<string>`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM')`,
    // Output tax is NET of returns: a refunded sale gives the VAT back (return documents carry
    // negative amounts). Excluding returns over-stated the tax payable.
    taxCollected: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} THEN -ABS(CAST(${sales.taxAmount} AS numeric)) ELSE CAST(${sales.taxAmount} AS numeric) END), 0)`,
    salesTotal: sql<string>`COALESCE(SUM(CASE WHEN ${sales.isReturn} THEN -ABS(CAST(${sales.total} AS numeric)) ELSE CAST(${sales.total} AS numeric) END), 0)`,
  })
    .from(sales)
    .where(and(
      eq(sales.tenantId, tenantId),
      gte(sales.createdAt, range.from),
      lte(sales.createdAt, range.to),
      sql`${sales.status} != 'void'`,
    ))
    .groupBy(sql`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${localTs(sales.createdAt, range.tz)}, 'YYYY-MM')`)

  // Import purchases for tax paid
  const { purchases: purchasesTable } = await import('@/lib/db/schema')

  const purchaseTax = await db.select({
    month: sql<string>`TO_CHAR(${localTs(purchasesTable.createdAt, range.tz)}, 'YYYY-MM')`,
    // Input tax net of purchase returns (returned goods give the input VAT back)
    taxPaid: sql<string>`COALESCE(SUM(CASE WHEN ${purchasesTable.isReturn} THEN -ABS(CAST(${purchasesTable.taxAmount} AS numeric)) ELSE CAST(${purchasesTable.taxAmount} AS numeric) END), 0)`,
    purchaseTotal: sql<string>`COALESCE(SUM(CASE WHEN ${purchasesTable.isReturn} THEN -ABS(CAST(${purchasesTable.total} AS numeric)) ELSE CAST(${purchasesTable.total} AS numeric) END), 0)`,
  })
    .from(purchasesTable)
    .where(and(
      eq(purchasesTable.tenantId, tenantId),
      gte(purchasesTable.createdAt, range.from),
      lte(purchasesTable.createdAt, range.to),
      sql`${purchasesTable.status} NOT IN ('cancelled', 'draft')`,
    ))
    .groupBy(sql`TO_CHAR(${localTs(purchasesTable.createdAt, range.tz)}, 'YYYY-MM')`)

  // H2: customer credit notes reduce and debit notes add output VAT (by posting date)
  const noteTax = await db.execute(sql`
    SELECT TO_CHAR(posting_date, 'YYYY-MM') AS month, SUM(tax) AS tax, SUM(total) AS total FROM (
      SELECT COALESCE(posting_date, created_at::date) AS posting_date, -tax AS tax, -total AS total
        FROM credit_notes WHERE tenant_id = ${tenantId} AND status IN ('issued', 'applied')
      UNION ALL
      SELECT COALESCE(posting_date, created_at::date), tax, total
        FROM debit_notes WHERE tenant_id = ${tenantId} AND status = 'issued'
    ) n
    WHERE posting_date BETWEEN ${filters.fromDate}::date AND ${filters.toDate}::date
    GROUP BY 1
  `)

  // Merge by month — collect all months from BOTH sales and purchases
  const salesMap = new Map<string, { taxCollected: number; salesTotal: number }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of salesTax as any[]) {
    salesMap.set(row.month, {
      taxCollected: Math.round(Number(row.taxCollected) * 100) / 100,
      salesTotal: Math.round(Number(row.salesTotal) * 100) / 100,
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of ((noteTax as any).rows ?? noteTax) as any[]) {
    const cur = salesMap.get(row.month) || { taxCollected: 0, salesTotal: 0 }
    salesMap.set(row.month, {
      taxCollected: Math.round((cur.taxCollected + Number(row.tax)) * 100) / 100,
      salesTotal: Math.round((cur.salesTotal + Number(row.total)) * 100) / 100,
    })
  }

  const purchaseMap = new Map<string, { taxPaid: number; purchaseTotal: number }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of purchaseTax as any[]) {
    purchaseMap.set(row.month, {
      taxPaid: Math.round(Number(row.taxPaid) * 100) / 100,
      purchaseTotal: Math.round(Number(row.purchaseTotal) * 100) / 100,
    })
  }

  // Union of all months from both sources
  const allMonths = Array.from(new Set([...salesMap.keys(), ...purchaseMap.keys()])).sort()

  let totalTaxCollected = 0
  let totalTaxPaid = 0

  const data = allMonths.map((month) => {
    const sale = salesMap.get(month)
    const purchase = purchaseMap.get(month)
    const taxCollected = sale?.taxCollected || 0
    const taxPaid = purchase?.taxPaid || 0
    totalTaxCollected += taxCollected
    totalTaxPaid += taxPaid

    return {
      month,
      salesTotal: sale?.salesTotal || 0,
      taxCollected,
      purchaseTotal: purchase?.purchaseTotal || 0,
      taxPaid,
      netTax: Math.round((taxCollected - taxPaid) * 100) / 100,
    }
  })

  return {
    data,
    totals: {
      totalTaxCollected: Math.round(totalTaxCollected * 100) / 100,
      totalTaxPaid: Math.round(totalTaxPaid * 100) / 100,
      netTaxLiability: Math.round((totalTaxCollected - totalTaxPaid) * 100) / 100,
    },
  }
}
