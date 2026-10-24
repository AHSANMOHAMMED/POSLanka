// Server-side metric/chart/list registry for workspace blocks
// Each key maps to a validated DB query - prevents arbitrary queries

import { TenantDb } from '@/lib/db/tenant-context'
import {
  appointments, workOrders, insuranceEstimates, warehouseStock,
  items, customers, suppliers, purchaseOrders, sales,
  vehicles, warehouses, payments, saleItems, stockMovements,
  posOpeningEntries, posClosingEntries, posClosingReconciliation, users,
  restaurantOrders, restaurantTables,
} from '@/lib/db/schema'
import { eq, and, or, sql, desc } from 'drizzle-orm'
import { hasPermission, type Permission } from '@/lib/auth/roles'

// ==================== ACCESS ====================

/**
 * H4: blocks that show money (revenue, cash variance, stock value, document totals) need one of
 * these permissions; counts and operational lists stay visible to every signed-in role.
 */
const FINANCIAL_PERMISSIONS: Permission[] = ['viewReports', 'manageSales', 'viewAccounting']
const STOCK_VALUE_PERMISSIONS: Permission[] = ['viewReports', 'viewAccounting', 'manageInventory']
const PURCHASE_PERMISSIONS: Permission[] = ['managePurchases', 'viewReports', 'viewAccounting']

const BLOCK_PERMISSIONS: Record<string, Permission[]> = {
  // number cards
  today_sales_total: FINANCIAL_PERMISSIONS,
  month_sales_total: FINANCIAL_PERMISSIONS,
  today_cash_variance: FINANCIAL_PERMISSIONS,
  week_cash_variance: FINANCIAL_PERMISSIONS,
  // charts
  sales_last_7_days: FINANCIAL_PERMISSIONS,
  sales_by_payment_method: FINANCIAL_PERMISSIONS,
  monthly_revenue: FINANCIAL_PERMISSIONS,
  stock_value_by_warehouse: STOCK_VALUE_PERMISSIONS,
  // quick lists
  recent_sales: FINANCIAL_PERMISSIONS,
  recent_restaurant_orders: FINANCIAL_PERMISSIONS,
  recent_shift_variance: FINANCIAL_PERMISSIONS,
  recent_purchase_orders: PURCHASE_PERMISSIONS,
}

type AccessSession = { user: { role: string; tenantId: string; customRoleId?: string | null } }

/** Whether this user may see the metric / chart / list `key`. */
export function canViewBlock(session: AccessSession, key: string): boolean {
  const perms = BLOCK_PERMISSIONS[key]
  if (!perms) return true
  const { role, tenantId, customRoleId } = session.user
  return perms.some((p) => hasPermission(role, p, tenantId, customRoleId))
}

/** Drop blocks this user may not see (number cards, charts, quick lists keyed by a restricted key). */
export function filterBlocksForSession<T extends { type: string; data?: unknown }>(blocks: T[], session: AccessSession): T[] {
  return blocks.filter((b) => {
    const d = (b.data || {}) as { metricKey?: string; chartKey?: string; listKey?: string }
    const key = b.type === 'number_card' ? d.metricKey : b.type === 'chart' ? d.chartKey : b.type === 'quick_list' ? d.listKey : undefined
    return !key || canViewBlock(session, key)
  })
}

/** Local business day for timestamps stored in UTC (Sri Lanka default, like tenantToday()). */
const LOCAL_TZ = 'Asia/Colombo'
const localDay = (col: unknown) => sql`(${col} AT TIME ZONE 'UTC' AT TIME ZONE ${LOCAL_TZ})::date`
const localToday = sql`(now() AT TIME ZONE ${LOCAL_TZ})::date`

// ==================== NUMBER CARD METRICS ====================

type MetricFn = (db: TenantDb) => Promise<number>

const METRICS: Record<string, MetricFn> = {
  today_appointments: async (db) => {
    const today = new Date().toISOString().split('T')[0]
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(appointments)
      .where(and(
        eq(appointments.scheduledDate, today),
        or(
          eq(appointments.status, 'scheduled'),
          eq(appointments.status, 'confirmed'),
          eq(appointments.status, 'arrived'),
        ),
      ))
    return Number(result?.count || 0)
  },

  draft_work_orders: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(workOrders)
      .where(eq(workOrders.status, 'draft'))
    return Number(result?.count || 0)
  },

  pending_work_orders: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(workOrders)
      .where(or(
        eq(workOrders.status, 'in_progress'),
        eq(workOrders.status, 'confirmed'),
      ))
    return Number(result?.count || 0)
  },

  pending_estimates: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(insuranceEstimates)
      .where(or(
        eq(insuranceEstimates.status, 'submitted'),
        eq(insuranceEstimates.status, 'under_review'),
      ))
    return Number(result?.count || 0)
  },

  low_stock_items: async (db) => {
    try {
      const [result] = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${warehouseStock.itemId})` })
        .from(warehouseStock)
        .innerJoin(items, eq(items.id, warehouseStock.itemId))
        .where(and(
          eq(items.isActive, true),
          eq(items.trackStock, true),
          // only items with a reorder level (0 means none set), same rule as the list below
          sql`CAST(${warehouseStock.minStock} AS DECIMAL) > 0`,
          sql`CAST(${warehouseStock.currentStock} AS DECIMAL) <= CAST(${warehouseStock.minStock} AS DECIMAL)`,
        ))
      return Number(result?.count || 0)
    } catch {
      return 0
    }
  },

  total_items: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(items)
      .where(eq(items.isActive, true))
    return Number(result?.count || 0)
  },

  total_customers: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(customers)
    return Number(result?.count || 0)
  },

  today_sales_count: async (db) => {
    const today = new Date().toISOString().split('T')[0]
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sales)
      .where(and(
        sql`DATE(${sales.createdAt}) = ${today}`,
        eq(sales.status, 'completed'),
      ))
    return Number(result?.count || 0)
  },

  today_sales_total: async (db) => {
    const today = new Date().toISOString().split('T')[0]
    const [result] = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${sales.total} AS DECIMAL)), 0)` })
      .from(sales)
      .where(and(
        sql`DATE(${sales.createdAt}) = ${today}`,
        eq(sales.status, 'completed'),
      ))
    return Number(result?.total || 0)
  },

  month_sales_total: async (db) => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const [result] = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${sales.total} AS DECIMAL)), 0)` })
      .from(sales)
      .where(and(
        sql`DATE(${sales.createdAt}) >= ${startOfMonth}`,
        eq(sales.status, 'completed'),
      ))
    return Number(result?.total || 0)
  },

  total_suppliers: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
    return Number(result?.count || 0)
  },

  pending_purchase_orders: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(purchaseOrders)
      .where(or(
        eq(purchaseOrders.status, 'draft'),
        eq(purchaseOrders.status, 'submitted'),
        eq(purchaseOrders.status, 'confirmed'),
      ))
    return Number(result?.count || 0)
  },

  total_vehicles: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(vehicles)
    return Number(result?.count || 0)
  },

  // H4: shifts currently open (any counter)
  open_shifts: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(posOpeningEntries)
      .where(eq(posOpeningEntries.status, 'open'))
    return Number(result?.count || 0)
  },

  // H4: counted − expected cash over shifts closed (submitted) today; negative = cash short
  today_cash_variance: async (db) => {
    const [result] = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${posClosingReconciliation.actualAmount} AS DECIMAL) - CAST(${posClosingReconciliation.expectedAmount} AS DECIMAL)), 0)` })
      .from(posClosingReconciliation)
      .innerJoin(posClosingEntries, eq(posClosingEntries.id, posClosingReconciliation.closingEntryId))
      .where(and(
        eq(posClosingEntries.status, 'submitted'),
        eq(posClosingReconciliation.paymentMethod, 'cash'),
        sql`${localDay(posClosingEntries.closingTime)} = ${localToday}`,
      ))
    return Number(result?.total || 0)
  },

  // H4: same over the last 7 local days
  week_cash_variance: async (db) => {
    const [result] = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${posClosingReconciliation.actualAmount} AS DECIMAL) - CAST(${posClosingReconciliation.expectedAmount} AS DECIMAL)), 0)` })
      .from(posClosingReconciliation)
      .innerJoin(posClosingEntries, eq(posClosingEntries.id, posClosingReconciliation.closingEntryId))
      .where(and(
        eq(posClosingEntries.status, 'submitted'),
        eq(posClosingReconciliation.paymentMethod, 'cash'),
        sql`${localDay(posClosingEntries.closingTime)} > ${localToday} - 7`,
      ))
    return Number(result?.total || 0)
  },

  total_warehouses: async (db) => {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(warehouses)
      .where(eq(warehouses.isActive, true))
    return Number(result?.count || 0)
  },
}

export function getMetricKeys(): string[] {
  return Object.keys(METRICS)
}

export async function fetchMetric(db: TenantDb, key: string): Promise<number | null> {
  const fn = METRICS[key]
  if (!fn) return null
  return fn(db)
}

export async function fetchMetrics(db: TenantDb, keys: string[]): Promise<Record<string, { value: number }>> {
  const results: Record<string, { value: number }> = {}
  await Promise.all(
    keys.map(async (key) => {
      const value = await fetchMetric(db, key)
      if (value !== null) {
        results[key] = { value }
      }
    }),
  )
  return results
}

// ==================== CHART DATA ====================

interface ChartResult {
  labels: string[]
  datasets: Array<{
    label: string
    data: number[]
    colors?: string[]
  }>
}

type ChartFn = (db: TenantDb) => Promise<ChartResult>

const CHARTS: Record<string, ChartFn> = {
  sales_last_7_days: async (db) => {
    const labels: string[] = []
    const data: number[] = []

    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const dayLabel = d.toLocaleDateString('en', { weekday: 'short' })
      labels.push(dayLabel)

      const [result] = await db
        .select({ total: sql<number>`COALESCE(SUM(CAST(${sales.total} AS DECIMAL)), 0)` })
        .from(sales)
        .where(and(
          sql`DATE(${sales.createdAt}) = ${dateStr}`,
          eq(sales.status, 'completed'),
        ))
      data.push(Number(result?.total || 0))
    }

    return { labels, datasets: [{ label: 'Sales', data }] }
  },

  sales_by_payment_method: async (db) => {
    const rows = await db
      .select({
        method: payments.method,
        total: sql<number>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL)), 0)`,
      })
      .from(payments)
      .where(sql`${payments.voidedAt} IS NULL`)
      .groupBy(payments.method)

    const labels = rows.map((r) => {
      const m = r.method as string
      return m.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    })
    const data = rows.map((r) => Number(r.total))

    return {
      labels,
      datasets: [{
        label: 'Payment Methods',
        data,
        colors: ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'],
      }],
    }
  },

  work_orders_by_status: async (db) => {
    const rows = await db
      .select({
        status: workOrders.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(workOrders)
      .groupBy(workOrders.status)

    const statusLabels: Record<string, string> = {
      draft: 'Draft',
      confirmed: 'Confirmed',
      in_progress: 'In Progress',
      completed: 'Completed',
      invoiced: 'Invoiced',
      cancelled: 'Cancelled',
    }
    const statusColors: Record<string, string> = {
      draft: '#94a3b8',
      confirmed: '#3b82f6',
      in_progress: '#f59e0b',
      completed: '#22c55e',
      invoiced: '#a855f7',
      cancelled: '#ef4444',
    }

    const labels = rows.map((r) => statusLabels[r.status] || r.status)
    const data = rows.map((r) => Number(r.count))
    const colors = rows.map((r) => statusColors[r.status] || '#94a3b8')

    return { labels, datasets: [{ label: 'Work Orders', data, colors }] }
  },

  top_selling_items: async (db) => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

    const rows = await db
      .select({
        name: saleItems.itemName,
        qty: sql<number>`COALESCE(SUM(CAST(${saleItems.quantity} AS DECIMAL)), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(
        sql`DATE(${sales.createdAt}) >= ${startOfMonth}`,
        eq(sales.status, 'completed'),
      ))
      .groupBy(saleItems.itemName)
      .orderBy(sql`SUM(CAST(${saleItems.quantity} AS DECIMAL)) DESC`)
      .limit(10)

    return {
      labels: rows.map((r) => (r.name as string) || 'Unknown'),
      datasets: [{ label: 'Qty Sold', data: rows.map((r) => Number(r.qty)) }],
    }
  },

  monthly_revenue: async (db) => {
    const labels: string[] = []
    const data: number[] = []

    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const monthLabel = d.toLocaleDateString('en', { month: 'short' })
      labels.push(monthLabel)

      const startDate = `${year}-${String(month).padStart(2, '0')}-01`
      const endD = new Date(year, month, 0) // last day of month
      const endDate = endD.toISOString().split('T')[0]

      const [result] = await db
        .select({ total: sql<number>`COALESCE(SUM(CAST(${sales.total} AS DECIMAL)), 0)` })
        .from(sales)
        .where(and(
          sql`DATE(${sales.createdAt}) >= ${startDate}`,
          sql`DATE(${sales.createdAt}) <= ${endDate}`,
          eq(sales.status, 'completed'),
        ))
      data.push(Number(result?.total || 0))
    }

    return { labels, datasets: [{ label: 'Revenue', data }] }
  },

  purchase_orders_by_status: async (db) => {
    const rows = await db
      .select({
        status: purchaseOrders.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(purchaseOrders)
      .groupBy(purchaseOrders.status)

    const statusLabels: Record<string, string> = {
      draft: 'Draft',
      submitted: 'Submitted',
      confirmed: 'Confirmed',
      invoice_created: 'Invoice Created',
      cancelled: 'Cancelled',
    }
    const statusColors: Record<string, string> = {
      draft: '#94a3b8',
      submitted: '#3b82f6',
      confirmed: '#22c55e',
      invoice_created: '#a855f7',
      cancelled: '#ef4444',
    }

    return {
      labels: rows.map((r) => statusLabels[r.status] || r.status),
      datasets: [{
        label: 'Purchase Orders',
        data: rows.map((r) => Number(r.count)),
        colors: rows.map((r) => statusColors[r.status] || '#94a3b8'),
      }],
    }
  },

  stock_value_by_warehouse: async (db) => {
    const rows = await db
      .select({
        warehouseName: warehouses.name,
        value: sql<number>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL) * CAST(${items.costPrice} AS DECIMAL)), 0)`,
      })
      .from(warehouseStock)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStock.warehouseId))
      .innerJoin(items, eq(items.id, warehouseStock.itemId))
      .where(and(
        eq(items.isActive, true),
        eq(warehouses.isActive, true),
      ))
      .groupBy(warehouses.name)

    return {
      labels: rows.map((r) => r.warehouseName),
      datasets: [{ label: 'Stock Value', data: rows.map((r) => Number(r.value)) }],
    }
  },
}

export function getChartKeys(): string[] {
  return Object.keys(CHARTS)
}

export async function fetchChartData(db: TenantDb, key: string): Promise<ChartResult | null> {
  const fn = CHARTS[key]
  if (!fn) return null
  return fn(db)
}

// ==================== QUICK LISTS ====================

interface QuickListResult {
  title: string
  columns: Array<{ key: string; label: string; type?: string }>
  rows: Array<Record<string, unknown>>
  totalCount: number
}

type QuickListFn = (db: TenantDb, limit: number) => Promise<QuickListResult>

const QUICK_LISTS: Record<string, QuickListFn> = {
  recent_sales: async (db, limit) => {
    const rows = await db
      .select({
        id: sales.id,
        invoiceNo: sales.invoiceNo,
        customerName: sales.customerName,
        total: sales.total,
        status: sales.status,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .orderBy(desc(sales.createdAt))
      .limit(limit)

    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(sales)

    return {
      title: 'Recent Sales',
      columns: [
        { key: 'invoiceNo', label: 'Invoice #', type: 'text' },
        { key: 'customerName', label: 'Customer', type: 'text' },
        { key: 'total', label: 'Total', type: 'currency' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'createdAt', label: 'Date', type: 'date' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totalCount: Number(countResult?.count || 0),
    }
  },

  recent_restaurant_orders: async (db, limit) => {
    const rows = await db
      .select({
        id: restaurantOrders.id,
        orderNo: restaurantOrders.orderNo,
        tableName: restaurantTables.name,
        orderType: restaurantOrders.orderType,
        total: restaurantOrders.total,
        status: restaurantOrders.status,
        createdAt: restaurantOrders.createdAt,
      })
      .from(restaurantOrders)
      .leftJoin(restaurantTables, eq(restaurantTables.id, restaurantOrders.tableId))
      .orderBy(desc(restaurantOrders.createdAt))
      .limit(limit)

    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(restaurantOrders)

    return {
      title: 'Recent Orders',
      columns: [
        { key: 'orderNo', label: 'Order #', type: 'text' },
        { key: 'tableName', label: 'Table', type: 'text' },
        { key: 'total', label: 'Total', type: 'currency' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'createdAt', label: 'Date', type: 'date' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totalCount: Number(countResult?.count || 0),
    }
  },

  recent_work_orders: async (db, limit) => {
    const rows = await db
      .select({
        id: workOrders.id,
        orderNo: workOrders.orderNo,
        customerName: sql<string>`COALESCE(${workOrders.customerName}, ${customers.name}, 'Walk-in')`,
        vehiclePlate: sql<string>`COALESCE(${workOrders.vehiclePlate}, CONCAT(${vehicles.licensePlate}, ' ', ${vehicles.year}, ' ', ${vehicles.make}, ' ', ${vehicles.model}), '')`,
        status: workOrders.status,
        createdAt: workOrders.createdAt,
      })
      .from(workOrders)
      .leftJoin(customers, eq(workOrders.customerId, customers.id))
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .orderBy(desc(workOrders.createdAt))
      .limit(limit)

    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(workOrders)

    return {
      title: 'Recent Work Orders',
      columns: [
        { key: 'orderNo', label: 'Order #', type: 'text' },
        { key: 'customerName', label: 'Customer', type: 'text' },
        { key: 'vehiclePlate', label: 'Vehicle', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'createdAt', label: 'Date', type: 'date' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totalCount: Number(countResult?.count || 0),
    }
  },

  recent_customers: async (db, limit) => {
    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .orderBy(desc(customers.createdAt))
      .limit(limit)

    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(customers)

    return {
      title: 'Recent Customers',
      columns: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'createdAt', label: 'Date', type: 'date' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totalCount: Number(countResult?.count || 0),
    }
  },

  recent_purchase_orders: async (db, limit) => {
    const rows = await db
      .select({
        id: purchaseOrders.id,
        orderNo: purchaseOrders.orderNo,
        total: purchaseOrders.total,
        status: purchaseOrders.status,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(limit)

    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(purchaseOrders)

    return {
      title: 'Recent Purchase Orders',
      columns: [
        { key: 'orderNo', label: 'PO #', type: 'text' },
        { key: 'total', label: 'Total', type: 'currency' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'createdAt', label: 'Date', type: 'date' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totalCount: Number(countResult?.count || 0),
    }
  },

  recent_estimates: async (db, limit) => {
    const rows = await db
      .select({
        id: insuranceEstimates.id,
        estimateNo: insuranceEstimates.estimateNo,
        status: insuranceEstimates.status,
        originalTotal: insuranceEstimates.originalTotal,
        createdAt: insuranceEstimates.createdAt,
      })
      .from(insuranceEstimates)
      .orderBy(desc(insuranceEstimates.createdAt))
      .limit(limit)

    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(insuranceEstimates)

    return {
      title: 'Recent Estimates',
      columns: [
        { key: 'estimateNo', label: 'Estimate #', type: 'text' },
        { key: 'originalTotal', label: 'Total', type: 'currency' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'createdAt', label: 'Date', type: 'date' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totalCount: Number(countResult?.count || 0),
    }
  },

  recent_appointments: async (db, limit) => {
    const rows = await db
      .select({
        id: appointments.id,
        customerName: appointments.customerName,
        vehiclePlate: appointments.vehiclePlate,
        serviceName: appointments.serviceName,
        scheduledDate: appointments.scheduledDate,
        status: appointments.status,
      })
      .from(appointments)
      .orderBy(desc(appointments.scheduledDate))
      .limit(limit)

    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(appointments)

    return {
      title: 'Recent Appointments',
      columns: [
        { key: 'customerName', label: 'Customer', type: 'text' },
        { key: 'vehiclePlate', label: 'Vehicle', type: 'text' },
        { key: 'serviceName', label: 'Service', type: 'text' },
        { key: 'scheduledDate', label: 'Date', type: 'date' },
        { key: 'status', label: 'Status', type: 'status' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totalCount: Number(countResult?.count || 0),
    }
  },

  // H4: latest closed shifts with their cash variance (counted − expected)
  recent_shift_variance: async (db, limit) => {
    const rows = await db
      .select({
        id: posClosingEntries.id,
        entryNumber: posClosingEntries.entryNumber,
        cashierName: users.fullName,
        closingTime: posClosingEntries.closingTime,
        expected: sql<string>`COALESCE(SUM(CAST(${posClosingReconciliation.expectedAmount} AS DECIMAL)) FILTER (WHERE ${posClosingReconciliation.paymentMethod} = 'cash'), 0)`,
        counted: sql<string>`COALESCE(SUM(CAST(${posClosingReconciliation.actualAmount} AS DECIMAL)) FILTER (WHERE ${posClosingReconciliation.paymentMethod} = 'cash'), 0)`,
        variance: sql<string>`COALESCE(SUM(CAST(${posClosingReconciliation.actualAmount} AS DECIMAL) - CAST(${posClosingReconciliation.expectedAmount} AS DECIMAL)) FILTER (WHERE ${posClosingReconciliation.paymentMethod} = 'cash'), 0)`,
      })
      .from(posClosingEntries)
      .leftJoin(posClosingReconciliation, eq(posClosingReconciliation.closingEntryId, posClosingEntries.id))
      .leftJoin(users, eq(users.id, posClosingEntries.userId))
      .where(eq(posClosingEntries.status, 'submitted'))
      .groupBy(posClosingEntries.id, users.fullName)
      .orderBy(desc(posClosingEntries.closingTime))
      .limit(limit)

    const [countResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(posClosingEntries)
      .where(eq(posClosingEntries.status, 'submitted'))

    return {
      title: 'Shift Cash Variance',
      columns: [
        { key: 'entryNumber', label: 'Closing #', type: 'text' },
        { key: 'cashierName', label: 'Cashier', type: 'text' },
        { key: 'closingTime', label: 'Closed', type: 'date' },
        { key: 'expected', label: 'Expected', type: 'currency' },
        { key: 'counted', label: 'Counted', type: 'currency' },
        { key: 'variance', label: 'Variance', type: 'currency' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totalCount: Number(countResult?.count || 0),
    }
  },

  low_stock_items: async (db, limit) => {
    try {
      const rows = await db
        .select({
          id: items.id,
          name: items.name,
          currentStock: warehouseStock.currentStock,
          minStock: warehouseStock.minStock,
          warehouseName: warehouses.name,
        })
        .from(warehouseStock)
        .innerJoin(items, eq(items.id, warehouseStock.itemId))
        .innerJoin(warehouses, eq(warehouses.id, warehouseStock.warehouseId))
        .where(and(
          eq(items.isActive, true),
          eq(items.trackStock, true),
          sql`CAST(${warehouseStock.minStock} AS DECIMAL) > 0`,
          sql`CAST(${warehouseStock.currentStock} AS DECIMAL) <= CAST(${warehouseStock.minStock} AS DECIMAL)`,
          sql`EXISTS (SELECT 1 FROM ${stockMovements} sm WHERE sm.item_id = ${items.id})`,
        ))
        .limit(limit)

      return {
        title: 'Low Stock Items',
        columns: [
          { key: 'name', label: 'Item', type: 'text' },
          { key: 'currentStock', label: 'Stock', type: 'number' },
          { key: 'minStock', label: 'Min', type: 'number' },
          { key: 'warehouseName', label: 'Warehouse', type: 'text' },
        ],
        rows: rows as unknown as Record<string, unknown>[],
        totalCount: rows.length,
      }
    } catch {
      return { title: 'Low Stock Items', columns: [], rows: [], totalCount: 0 }
    }
  },
}

export function getQuickListKeys(): string[] {
  return Object.keys(QUICK_LISTS)
}

export async function fetchQuickListData(
  db: TenantDb,
  key: string,
  limit: number = 5,
): Promise<QuickListResult | null> {
  const fn = QUICK_LISTS[key]
  if (!fn) return null
  return fn(db, limit)
}
