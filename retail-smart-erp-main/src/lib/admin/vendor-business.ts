/**
 * Super-admin vendor reports: what one business has in stock, sold, spent and earned, and the same
 * per item. Figures are the vendor's own: stock value, gross profit and low stock come from
 * ownerDashboard, net profit from getProfitAndLoss (its ledger), so they match what the vendor sees.
 * Callers run these inside withTenant(vendorId) (RLS); every query also filters tenant_id.
 */
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { tenantToday } from '@/lib/accounting/gl'
import { getProfitAndLoss } from '@/lib/accounting/reports'
import { ownerDashboard, saleProfitLines } from '@/lib/dashboard/owner'
import { tenantDayRange } from '@/lib/reports/date-range'
import { escapeLikePattern } from '@/lib/utils/sql'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'
import type { TenantDb } from '@/lib/db'

type Tx = TenantDb

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}
const money = (v: unknown) => roundCurrency(parseCurrency(v as string))
const qty = (v: unknown) => Math.round((Number(v) || 0) * 1000) / 1000
const percent = (part: number, whole: number) => (whole !== 0 ? Math.round((part / whole) * 10000) / 100 : null)

/* ------------------------------------------------------------------ period */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date')

export const periodSchema = z.object({
  period: z.enum(['today', '7d', '30d', 'month', 'year', 'all', 'custom']).default('30d'),
  fromDate: dateSchema.optional(),
  toDate: dateSchema.optional(),
})
export type PeriodQuery = z.infer<typeof periodSchema>

export const ALL_TIME_FROM = '2000-01-01'

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Preset → local dates. A custom period needs both dates, start first; null when it has not. */
export function periodDates(q: PeriodQuery, today: string): { fromDate: string; toDate: string } | null {
  switch (q.period) {
    case 'today': return { fromDate: today, toDate: today }
    case '7d': return { fromDate: shiftDays(today, -6), toDate: today }
    case '30d': return { fromDate: shiftDays(today, -29), toDate: today }
    case 'month': return { fromDate: `${today.slice(0, 8)}01`, toDate: today }
    case 'year': return { fromDate: `${today.slice(0, 5)}01-01`, toDate: today }
    case 'all': return { fromDate: ALL_TIME_FROM, toDate: today }
    case 'custom': return q.fromDate && q.toDate && q.fromDate <= q.toDate ? { fromDate: q.fromDate, toDate: q.toDate } : null
  }
}

export interface BusinessPeriod {
  tenantId: string
  fromDate: string
  toDate: string
  /** UTC instants of the vendor's local days */
  from: Date
  to: Date
  today: string
}

/** The vendor's local dates and their UTC bounds; null for an incomplete custom period */
export async function resolvePeriod(tenantId: string, q: PeriodQuery): Promise<BusinessPeriod | null> {
  const today = await tenantToday(tenantId)
  const dates = periodDates(q, today)
  if (!dates) return null
  const range = await tenantDayRange(tenantId, dates.fromDate, dates.toDate)
  return { tenantId, ...dates, from: range.from, to: range.to, today }
}

/* ------------------------------------------------------------------ summary */

export async function vendorBusinessSummary(tx: Tx, p: BusinessPeriod) {
  const { tenantId } = p
  const from = p.from.toISOString()
  const to = p.to.toISOString()
  const inPeriod = sql`created_at >= ${from}::timestamp AND created_at <= ${to}::timestamp`

  const figures = await ownerDashboard(tx, { tenantId, from: p.from, to: p.to, today: p.today, topItems: 10 })

  const [salesRow] = rows<Record<string, string>>(await tx.execute(sql`
    SELECT count(*) FILTER (WHERE NOT is_return)::int AS receipts,
           count(*) FILTER (WHERE is_return)::int AS return_count,
           COALESCE(SUM(CASE WHEN is_return THEN 0 ELSE total END), 0) AS gross,
           COALESCE(SUM(CASE WHEN is_return THEN ABS(total) ELSE 0 END), 0) AS returns,
           COALESCE(SUM(CASE WHEN is_return THEN -ABS(total) ELSE total END), 0) AS net,
           COALESCE(SUM(CASE WHEN is_return THEN 0 ELSE discount_amount END), 0) AS discounts,
           COALESCE(SUM(CASE WHEN is_return THEN -ABS(tax_amount) ELSE tax_amount END), 0) AS tax
    FROM sales WHERE tenant_id = ${tenantId} AND status <> 'void' AND ${inPeriod}
  `))
  const receipts = Number(salesRow?.receipts) || 0
  const netSales = money(salesRow?.net)

  const paymentRows = rows<{ method: string; amount: string }>(await tx.execute(sql`
    SELECT method, SUM(amount) AS amount FROM payments
    WHERE tenant_id = ${tenantId} AND voided_at IS NULL AND ${inPeriod}
    GROUP BY method ORDER BY SUM(amount) DESC
  `))

  const branchSales = rows<{ warehouse_id: string | null; name: string | null; revenue: string; cost: string }>(await tx.execute(sql`
    ${saleProfitLines(tenantId, from, to)}
    SELECT sa.warehouse_id, w.name, SUM(l.revenue) AS revenue, SUM(l.cost) AS cost
    FROM l JOIN sales sa ON sa.id = l.sale_id LEFT JOIN warehouses w ON w.id = sa.warehouse_id
    GROUP BY sa.warehouse_id, w.name
  `))
  const salesOf = new Map(branchSales.map((b) => [b.warehouse_id, b]))
  const stockIds = new Set(figures.stock.byBranch.map((b) => b.warehouseId))
  const toBranch = (name: string, b: typeof branchSales[number] | undefined, atCost: number, atSellingPrice: number, itemsInStock: number) => {
    const revenue = money(b?.revenue)
    const grossProfit = roundCurrency(revenue - money(b?.cost))
    return { name, revenue, grossProfit, atCost, atSellingPrice, itemsInStock }
  }
  const branches = [
    ...figures.stock.byBranch.map((b) => toBranch(b.name, salesOf.get(b.warehouseId), b.atCost, b.atSellingPrice, b.itemsInStock)),
    // Sold from a branch that has since been closed: no stock counted, the sales still happened
    ...branchSales.filter((b) => !b.warehouse_id || !stockIds.has(b.warehouse_id)).map((b) => toBranch(b.name ?? 'No branch', b, 0, 0, 0)),
  ]

  const [catalog] = rows<Record<string, number>>(await tx.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE i.is_active)::int AS active,
           count(*) FILTER (WHERE i.is_active AND i.track_stock AND COALESCE(st.qty, 0) > 0)::int AS in_stock,
           count(*) FILTER (WHERE i.is_active AND i.track_stock AND COALESCE(st.qty, 0) <= 0)::int AS out_of_stock,
           count(*) FILTER (WHERE i.is_active AND i.track_stock AND COALESCE(st.qty, 0) > 0 AND i.cost_price = 0)::int AS no_cost
    FROM items i
    LEFT JOIN (
      SELECT ws.item_id, SUM(ws.current_stock) AS qty
      FROM warehouse_stock ws JOIN warehouses w ON w.id = ws.warehouse_id AND w.is_active
      WHERE ws.tenant_id = ${tenantId} GROUP BY ws.item_id
    ) st ON st.item_id = i.id
    WHERE i.tenant_id = ${tenantId} AND NOT i.is_gift_card
  `))

  const [parties] = rows<Record<string, string>>(await tx.execute(sql`
    SELECT (SELECT count(*)::int FROM customers WHERE tenant_id = ${tenantId}) AS customers,
           (SELECT count(*)::int FROM suppliers WHERE tenant_id = ${tenantId}) AS suppliers,
           (SELECT COALESCE(SUM(GREATEST(total - paid_amount, 0)), 0) FROM sales
             WHERE tenant_id = ${tenantId} AND NOT is_return AND status IN ('pending', 'partial')) AS receivable,
           (SELECT COALESCE(SUM(balance), 0) FROM suppliers WHERE tenant_id = ${tenantId} AND balance > 0) AS payable
  `))

  const [purchaseRow] = rows<{ bills: number; total: string }>(await tx.execute(sql`
    SELECT count(*) FILTER (WHERE NOT is_return)::int AS bills,
           COALESCE(SUM(CASE WHEN is_return THEN -ABS(total) ELSE total END), 0) AS total
    FROM purchases WHERE tenant_id = ${tenantId} AND status NOT IN ('draft', 'cancelled') AND ${inPeriod}
  `))
  const [expenseRow] = rows<{ total: string }>(await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
    WHERE tenant_id = ${tenantId} AND status IN ('approved', 'paid')
      AND expense_date >= ${p.fromDate}::date AND expense_date <= ${p.toDate}::date
  `))

  const pnl = await getProfitAndLoss(tx, tenantId, p.fromDate, p.toDate)
  const hasLedger = pnl.income.length + pnl.expenses.length > 0

  return {
    period: { fromDate: p.fromDate, toDate: p.toDate },
    sales: {
      receipts,
      returnCount: Number(salesRow?.return_count) || 0,
      grossSales: money(salesRow?.gross),
      returns: money(salesRow?.returns),
      netSales,
      discounts: money(salesRow?.discounts),
      tax: money(salesRow?.tax),
      avgBasket: receipts > 0 ? roundCurrency(netSales / receipts) : 0,
    },
    profit: {
      revenue: figures.profit.revenue,
      costOfGoods: figures.profit.costOfGoods,
      grossProfit: figures.profit.grossProfit,
      marginPercent: figures.profit.marginPercent,
      /** From the vendor's ledger; null when nothing is posted for the period */
      netProfit: hasLedger ? pnl.netProfit : null,
    },
    stock: {
      atCost: figures.stock.atCost,
      atSellingPrice: figures.stock.atSellingPrice,
      potentialMargin: figures.stock.potentialMargin,
      units: qty(figures.stock.byBranch.reduce((s, b) => s + b.units, 0)),
      lowStock: figures.lowStock.count,
      outOfStockLines: figures.lowStock.outOfStock,
    },
    catalog: {
      total: catalog?.total ?? 0,
      active: catalog?.active ?? 0,
      inStock: catalog?.in_stock ?? 0,
      outOfStock: catalog?.out_of_stock ?? 0,
      inStockWithoutCost: catalog?.no_cost ?? 0,
    },
    money: {
      receivable: money(parties?.receivable),
      payable: money(parties?.payable),
      customers: Number(parties?.customers) || 0,
      suppliers: Number(parties?.suppliers) || 0,
      purchases: money(purchaseRow?.total),
      purchaseBills: purchaseRow?.bills ?? 0,
      expenses: money(expenseRow?.total),
    },
    payments: paymentRows.map((r) => ({ method: r.method, amount: money(r.amount) })),
    branches,
    topItems: figures.profit.topItems,
  }
}

export type VendorBusinessSummary = Awaited<ReturnType<typeof vendorBusinessSummary>>

/** Summary as section / figure / value rows (the summary sheet of a data export) */
export function summaryRows(s: VendorBusinessSummary): Array<[string, string, string | number]> {
  return [
    ['Period', 'From', s.period.fromDate],
    ['Period', 'To', s.period.toDate],
    ['Sales', 'Receipts', s.sales.receipts],
    ['Sales', 'Gross sales', s.sales.grossSales],
    ['Sales', 'Returns', s.sales.returns],
    ['Sales', 'Net sales (with tax)', s.sales.netSales],
    ['Sales', 'Discounts', s.sales.discounts],
    ['Sales', 'Tax', s.sales.tax],
    ['Profit', 'Revenue (without tax)', s.profit.revenue],
    ['Profit', 'Cost of goods sold', s.profit.costOfGoods],
    ['Profit', 'Gross profit', s.profit.grossProfit],
    ['Profit', 'Net profit (ledger)', s.profit.netProfit ?? ''],
    ['Stock', 'Value at cost', s.stock.atCost],
    ['Stock', 'Value at selling price', s.stock.atSellingPrice],
    ['Stock', 'Units on hand', s.stock.units],
    ['Items', 'Active items', s.catalog.active],
    ['Items', 'In stock', s.catalog.inStock],
    ['Items', 'Out of stock', s.catalog.outOfStock],
    ['Money', 'Customers owe', s.money.receivable],
    ['Money', 'Owed to suppliers', s.money.payable],
    ['Money', 'Purchases', s.money.purchases],
    ['Money', 'Expenses', s.money.expenses],
    ...s.payments.map((m): [string, string, number] => ['Payments received', m.method, m.amount]),
  ]
}

/* ------------------------------------------------------------------ item by item */

const ITEM_SORTS = {
  name: 'name',
  stock: 'on_hand',
  stockCost: 'stock_cost',
  stockValue: 'stock_value',
  sold: 'sold_qty',
  revenue: 'revenue',
  cost: 'cost',
  profit: 'profit',
  margin: 'margin',
} as const

export const itemReportSchema = periodSchema.extend({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(Object.keys(ITEM_SORTS) as [keyof typeof ITEM_SORTS, ...Array<keyof typeof ITEM_SORTS>]).default('profit'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
export type ItemReportQuery = z.infer<typeof itemReportSchema>

/** Every item (and every sold line whose item no longer exists): stock, cost, sales and profit. No pageSize = all rows. */
export async function vendorItemReport(tx: Tx, p: BusinessPeriod, q: Partial<Pick<ItemReportQuery, 'q' | 'sort' | 'dir' | 'page' | 'pageSize'>> = {}) {
  const { tenantId } = p
  const like = q.q ? `%${escapeLikePattern(q.q)}%` : null
  const sortColumn = ITEM_SORTS[q.sort ?? 'profit']
  const paging = q.pageSize ? sql`LIMIT ${q.pageSize} OFFSET ${((q.page ?? 1) - 1) * q.pageSize}` : sql``

  const found = rows<Record<string, string | number | boolean | null>>(await tx.execute(sql`
    ${saleProfitLines(tenantId, p.from.toISOString(), p.to.toISOString())},
    sold AS (
      SELECT item_id, MIN(item_name) AS item_name, SUM(base_qty) AS qty, SUM(revenue) AS revenue, SUM(cost) AS cost,
             count(DISTINCT sale_id)::int AS receipts
      FROM l GROUP BY item_id, CASE WHEN item_id IS NULL THEN item_name END
    ), st AS (
      SELECT ws.item_id, SUM(ws.current_stock) AS on_hand, SUM(GREATEST(ws.current_stock, 0)) AS positive
      FROM warehouse_stock ws JOIN warehouses w ON w.id = ws.warehouse_id AND w.is_active
      WHERE ws.tenant_id = ${tenantId} GROUP BY ws.item_id
    ), merged AS (
      SELECT COALESCE(i.id, sold.item_id) AS item_id, COALESCE(i.name, sold.item_name) AS name,
             i.id IS NOT NULL AS in_catalog, i.sku, i.barcode, i.unit, c.name AS category,
             COALESCE(i.cost_price, 0) AS cost_price, COALESCE(i.selling_price, 0) AS selling_price,
             COALESCE(i.track_stock, false) AS track_stock, COALESCE(i.is_active, false) AS is_active,
             CASE WHEN i.track_stock THEN COALESCE(st.on_hand, 0) ELSE 0 END AS on_hand,
             CASE WHEN i.track_stock THEN COALESCE(st.positive, 0) * i.cost_price ELSE 0 END AS stock_cost,
             CASE WHEN i.track_stock THEN COALESCE(st.positive, 0) * i.selling_price ELSE 0 END AS stock_value,
             COALESCE(sold.qty, 0) AS sold_qty, COALESCE(sold.receipts, 0) AS receipts,
             COALESCE(sold.revenue, 0) AS revenue, COALESCE(sold.cost, 0) AS cost,
             COALESCE(sold.revenue, 0) - COALESCE(sold.cost, 0) AS profit,
             CASE WHEN COALESCE(sold.revenue, 0) <> 0 THEN (sold.revenue - sold.cost) / sold.revenue END AS margin
      FROM (SELECT * FROM items WHERE tenant_id = ${tenantId} AND NOT is_gift_card) i
      FULL JOIN sold ON sold.item_id = i.id
      LEFT JOIN st ON st.item_id = i.id
      LEFT JOIN categories c ON c.id = i.category_id
    )
    SELECT *, count(*) OVER ()::int AS total_rows FROM merged
    WHERE (${like}::text IS NULL OR name ILIKE ${like} OR sku ILIKE ${like} OR barcode ILIKE ${like} OR category ILIKE ${like})
    ORDER BY ${sql.raw(sortColumn)} ${sql.raw(q.dir === 'asc' ? 'ASC' : 'DESC')} NULLS LAST, name
    ${paging}
  `))

  return {
    total: Number(found[0]?.total_rows) || 0,
    rows: found.map((r) => {
      const revenue = money(r.revenue)
      const profit = roundCurrency(revenue - money(r.cost))
      return {
        itemId: r.item_id as string | null,
        name: r.name as string,
        inCatalog: r.in_catalog === true,
        isActive: r.is_active === true,
        trackStock: r.track_stock === true,
        sku: r.sku as string | null,
        barcode: r.barcode as string | null,
        category: r.category as string | null,
        unit: r.unit as string | null,
        costPrice: money(r.cost_price),
        sellingPrice: money(r.selling_price),
        onHand: qty(r.on_hand),
        stockAtCost: money(r.stock_cost),
        stockAtSellingPrice: money(r.stock_value),
        soldQty: qty(r.sold_qty),
        receipts: Number(r.receipts) || 0,
        revenue,
        costOfGoods: money(r.cost),
        profit,
        marginPercent: percent(profit, revenue),
      }
    }),
  }
}

export const ITEM_CSV_HEADER = [
  'Item', 'SKU', 'Barcode', 'Category', 'Unit', 'Status', 'Cost price', 'Selling price', 'On hand', 'Stock at cost',
  'Stock at selling price', 'Quantity sold', 'Receipts', 'Revenue (without tax)', 'Cost of goods sold', 'Profit', 'Margin %',
]

export function itemCsvCells(r: Awaited<ReturnType<typeof vendorItemReport>>['rows'][number]): unknown[] {
  return [
    r.name, r.sku, r.barcode, r.category, r.unit, !r.inCatalog ? 'Removed' : r.isActive ? 'Active' : 'Inactive',
    r.costPrice, r.sellingPrice, r.trackStock ? r.onHand : '', r.stockAtCost, r.stockAtSellingPrice,
    r.soldQty, r.receipts, r.revenue, r.costOfGoods, r.profit, r.marginPercent ?? '',
  ]
}

/* ------------------------------------------------------------------ vendor list */

/** The three figures of the vendor list: stock at cost, then sales and gross profit since `since` */
export async function vendorQuickFigures(tx: Tx, tenantId: string, since: Date) {
  const from = since.toISOString()
  const to = new Date().toISOString()
  const [stock] = rows<{ at_cost: string }>(await tx.execute(sql`
    SELECT COALESCE(SUM(GREATEST(ws.current_stock, 0) * i.cost_price), 0) AS at_cost
    FROM warehouse_stock ws
    JOIN items i ON i.id = ws.item_id AND i.track_stock AND NOT i.is_gift_card
    JOIN warehouses w ON w.id = ws.warehouse_id AND w.is_active
    WHERE ws.tenant_id = ${tenantId}
  `))
  const [net] = rows<{ net: string }>(await tx.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN is_return THEN -ABS(total) ELSE total END), 0) AS net
    FROM sales WHERE tenant_id = ${tenantId} AND status <> 'void' AND created_at >= ${from}::timestamp AND created_at <= ${to}::timestamp
  `))
  const [gp] = rows<{ revenue: string; cost: string }>(await tx.execute(sql`
    ${saleProfitLines(tenantId, from, to)}
    SELECT COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(cost), 0) AS cost FROM l
  `))
  return {
    stockAtCost: money(stock?.at_cost),
    netSales: money(net?.net),
    grossProfit: roundCurrency(money(gp?.revenue) - money(gp?.cost)),
  }
}
