// Server-side metric/chart/list registry for workspace blocks
// Each key maps to a validated DB query - prevents arbitrary queries

import { TenantDb } from '@/lib/db/tenant-context'
import {
  appointments, workOrders, insuranceEstimates, warehouseStock,
  items, customers, suppliers, purchaseOrders, sales,
  vehicles, warehouses, payments, saleItems, stockMovements,
} from '@/lib/db/schema'
import { eq, and, or, sql, desc } from 'drizzle-orm'

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
