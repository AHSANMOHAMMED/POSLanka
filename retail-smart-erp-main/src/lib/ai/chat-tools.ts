import { sql, eq, gte, desc, and } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import {
  sales, saleItems, items, customers, workOrders, categories, warehouseStock,
  purchases, suppliers, appointments, glEntries, reservations, restaurantTables,
  restaurantOrders, users, loyaltyPrograms, loyaltyTransactions, stockMovements,
  payments, employeeProfiles, vehicleInventory, testDrives, moduleAccess,
} from '@/lib/db/schema'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '@/lib/db/schema'

type DB = NodePgDatabase<typeof schema>

export interface ChatTool {
  name: string
  description: string
  category: string
  execute: (db: DB, params?: Record<string, string>) => Promise<string>
}

/** Available tools the AI can call to query the database */
export const chatTools: ChatTool[] = [
  // ==================== SALES ====================
  {
    name: 'get_today_sales',
    description: 'Get today\'s total sales amount and transaction count',
    category: 'sales',
    execute: async (db) => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const [result] = await db.select({
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(sales).where(and(gte(sales.createdAt, today), eq(sales.status, 'completed')))
      return `Today's sales: ${(result.total || 0).toLocaleString()} from ${result.count || 0} transactions`
    },
  },
  {
    name: 'get_sales_summary',
    description: 'Get sales summary for this week and month',
    category: 'sales',
    execute: async (db) => {
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 86400000)
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

      const [weekResult] = await db.select({
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(sales).where(and(gte(sales.createdAt, weekAgo), eq(sales.status, 'completed')))

      const [monthResult] = await db.select({
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(sales).where(and(gte(sales.createdAt, monthStart), eq(sales.status, 'completed')))

      return `This week: ${(weekResult.total || 0).toLocaleString()} (${weekResult.count} sales)\nThis month: ${(monthResult.total || 0).toLocaleString()} (${monthResult.count} sales)`
    },
  },
  {
    name: 'get_top_selling_items',
    description: 'Get the top 10 selling items this month by revenue',
    category: 'sales',
    execute: async (db) => {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      const results = await db.select({
        name: items.name,
        quantity: sql<number>`SUM(${saleItems.quantity}::numeric)::int`,
        revenue: sql<number>`SUM(${saleItems.total}::numeric)::float`,
      }).from(saleItems)
        .innerJoin(items, eq(saleItems.itemId, items.id))
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(gte(sales.createdAt, monthStart), eq(sales.status, 'completed')))
        .groupBy(items.name)
        .orderBy(desc(sql`SUM(${saleItems.total}::numeric)`))
        .limit(10)

      if (results.length === 0) return 'No sales data this month yet.'
      return 'Top selling items this month:\n' + results.map((r, i) =>
        `${i + 1}. ${r.name} - ${r.quantity} units, ${(r.revenue || 0).toLocaleString()}`
      ).join('\n')
    },
  },
  {
    name: 'get_payment_method_breakdown',
    description: 'Get sales breakdown by payment method for today',
    category: 'sales',
    execute: async (db) => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const results = await db.select({
        method: payments.method,
        total: sql<number>`COALESCE(SUM(${payments.amount}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(payments)
        .innerJoin(sales, eq(payments.saleId, sales.id))
        .where(and(gte(sales.createdAt, today), eq(sales.status, 'completed')))
        .groupBy(payments.method)

      if (results.length === 0) return 'No payment data today.'
      return 'Payment breakdown today:\n' + results.map(r =>
        `- ${r.method}: ${(r.total || 0).toLocaleString()} (${r.count} transactions)`
      ).join('\n')
    },
  },

  // ==================== INVENTORY ====================
  {
    name: 'get_low_stock_items',
    description: 'Get items that are running low on stock (below minimum)',
    category: 'inventory',
    execute: async (db) => {
      const results = await db.select({
        name: items.name,
        sku: items.sku,
        stock: sql<number>`${warehouseStock.currentStock}::int`,
        minStock: sql<number>`COALESCE(${warehouseStock.minStock}, 5)::int`,
      }).from(warehouseStock)
        .innerJoin(items, eq(warehouseStock.itemId, items.id))
        .where(sql`${warehouseStock.currentStock}::numeric <= COALESCE(${warehouseStock.minStock}, 5) AND ${items.isActive} = true`)
        .orderBy(sql`${warehouseStock.currentStock}::numeric`)
        .limit(15)

      if (results.length === 0) return 'All items have sufficient stock.'
      return `${results.length} items running low:\n` + results.map(r =>
        `- ${r.name}${r.sku ? ` (${r.sku})` : ''}: ${r.stock} left (min: ${r.minStock})`
      ).join('\n')
    },
  },
  {
    name: 'get_item_count',
    description: 'Get total count of active items and categories',
    category: 'inventory',
    execute: async (db) => {
      const [itemResult] = await db.select({
        count: sql<number>`count(*)::int`,
      }).from(items).where(eq(items.isActive, true))
      const [catResult] = await db.select({
        count: sql<number>`count(*)::int`,
      }).from(categories)
      return `Active items: ${itemResult.count}\nCategories: ${catResult.count}`
    },
  },
  {
    name: 'get_stock_value',
    description: 'Get total inventory stock value across all warehouses',
    category: 'inventory',
    execute: async (db) => {
      const [result] = await db.select({
        totalValue: sql<number>`COALESCE(SUM(${warehouseStock.currentStock}::numeric * COALESCE(${items.costPrice}::numeric, 0)), 0)::float`,
        totalItems: sql<number>`count(DISTINCT ${items.id})::int`,
      }).from(warehouseStock)
        .innerJoin(items, eq(warehouseStock.itemId, items.id))
        .where(sql`${warehouseStock.currentStock}::numeric > 0 AND ${items.isActive} = true`)
      return `Total stock value: ${(result.totalValue || 0).toLocaleString()}\nItems in stock: ${result.totalItems}`
    },
  },
  {
    name: 'get_stock_movement_summary',
    description: 'Get stock movements summary for today (in, out, adjustments)',
    category: 'inventory',
    execute: async (db) => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const results = await db.select({
        type: stockMovements.type,
        count: sql<number>`count(*)::int`,
        totalQty: sql<number>`COALESCE(SUM(ABS(${stockMovements.quantity}::numeric)), 0)::int`,
      }).from(stockMovements)
        .where(gte(stockMovements.createdAt, today))
        .groupBy(stockMovements.type)

      if (results.length === 0) return 'No stock movements today.'
      return 'Stock movements today:\n' + results.map(r =>
        `- ${r.type}: ${r.count} movements, ${r.totalQty} units total`
      ).join('\n')
    },
  },

  // ==================== CUSTOMERS ====================
  {
    name: 'get_top_customers',
    description: 'Get top 10 customers by total spending this month',
    category: 'customers',
    execute: async (db) => {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      const results = await db.select({
        name: customers.name,
        total: sql<number>`SUM(${sales.total}::numeric)::float`,
        count: sql<number>`count(*)::int`,
      }).from(sales)
        .innerJoin(customers, eq(sales.customerId, customers.id))
        .where(and(gte(sales.createdAt, monthStart), eq(sales.status, 'completed')))
        .groupBy(customers.name)
        .orderBy(desc(sql`SUM(${sales.total}::numeric)`))
        .limit(10)

      if (results.length === 0) return 'No customer sales data this month.'
      return 'Top customers this month:\n' + results.map((r, i) =>
        `${i + 1}. ${r.name} - ${(r.total || 0).toLocaleString()} (${r.count} purchases)`
      ).join('\n')
    },
  },
  {
    name: 'get_customer_count',
    description: 'Get total count of customers',
    category: 'customers',
    execute: async (db) => {
      const [result] = await db.select({
        count: sql<number>`count(*)::int`,
      }).from(customers)
      return `Total customers: ${result.count}`
    },
  },

  // ==================== PURCHASES & SUPPLIERS ====================
  {
    name: 'get_purchase_summary',
    description: 'Get purchase summary for this week and month',
    category: 'purchases',
    execute: async (db) => {
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 86400000)
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

      const [weekResult] = await db.select({
        total: sql<number>`COALESCE(SUM(${purchases.total}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(purchases).where(and(gte(purchases.createdAt, weekAgo), sql`${purchases.status} NOT IN ('cancelled', 'draft')`))

      const [monthResult] = await db.select({
        total: sql<number>`COALESCE(SUM(${purchases.total}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(purchases).where(and(gte(purchases.createdAt, monthStart), sql`${purchases.status} NOT IN ('cancelled', 'draft')`))

      return `Purchases this week: ${(weekResult.total || 0).toLocaleString()} (${weekResult.count})\nPurchases this month: ${(monthResult.total || 0).toLocaleString()} (${monthResult.count})`
    },
  },
  {
    name: 'get_pending_purchases',
    description: 'Get count and list of pending/draft purchase orders',
    category: 'purchases',
    execute: async (db) => {
      const results = await db.select({
        id: purchases.id,
        supplierInvoiceNo: purchases.supplierInvoiceNo,
        status: purchases.status,
        total: sql<number>`${purchases.total}::float`,
      }).from(purchases)
        .where(sql`${purchases.status} IN ('draft', 'pending')`)
        .orderBy(desc(purchases.createdAt))
        .limit(10)

      if (results.length === 0) return 'No pending purchases.'
      return `${results.length} pending purchases:\n` + results.map(r =>
        `- ${r.supplierInvoiceNo || 'Draft'}: ${r.status} - ${(r.total || 0).toLocaleString()}`
      ).join('\n')
    },
  },
  {
    name: 'get_top_suppliers',
    description: 'Get top suppliers by purchase volume this month',
    category: 'purchases',
    execute: async (db) => {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      const results = await db.select({
        name: suppliers.name,
        total: sql<number>`COALESCE(SUM(${purchases.total}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(purchases)
        .innerJoin(suppliers, eq(purchases.supplierId, suppliers.id))
        .where(and(gte(purchases.createdAt, monthStart), sql`${purchases.status} NOT IN ('cancelled', 'draft')`))
        .groupBy(suppliers.name)
        .orderBy(desc(sql`SUM(${purchases.total}::numeric)`))
        .limit(10)

      if (results.length === 0) return 'No purchase data this month.'
      return 'Top suppliers this month:\n' + results.map((r, i) =>
        `${i + 1}. ${r.name} - ${(r.total || 0).toLocaleString()} (${r.count} orders)`
      ).join('\n')
    },
  },
  {
    name: 'get_supplier_count',
    description: 'Get total count of active suppliers',
    category: 'purchases',
    execute: async (db) => {
      const [result] = await db.select({
        count: sql<number>`count(*)::int`,
      }).from(suppliers).where(eq(suppliers.isActive, true))
      return `Active suppliers: ${result.count}`
    },
  },

  // ==================== ACCOUNTING ====================
  {
    name: 'get_revenue_expenses_today',
    description: 'Get today\'s total revenue (income) and expenses from GL entries',
    category: 'accounting',
    execute: async (db) => {
      const todayStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
      const results = await db.select({
        rootType: sql<string>`(SELECT root_type FROM chart_of_accounts WHERE id = ${glEntries.accountId})`,
        totalDebit: sql<number>`COALESCE(SUM(${glEntries.debit}::numeric), 0)::float`,
        totalCredit: sql<number>`COALESCE(SUM(${glEntries.credit}::numeric), 0)::float`,
      }).from(glEntries)
        .where(eq(glEntries.postingDate, todayStr))
        .groupBy(sql`(SELECT root_type FROM chart_of_accounts WHERE id = ${glEntries.accountId})`)

      if (results.length === 0) return 'No GL entries today.'
      const income = results.find(r => r.rootType === 'income')
      const expense = results.find(r => r.rootType === 'expense')
      return `Today's GL summary:\n- Revenue: ${((income?.totalCredit || 0) - (income?.totalDebit || 0)).toLocaleString()}\n- Expenses: ${((expense?.totalDebit || 0) - (expense?.totalCredit || 0)).toLocaleString()}`
    },
  },
  {
    name: 'get_outstanding_receivables',
    description: 'Get total outstanding accounts receivable amount',
    category: 'accounting',
    execute: async (db) => {
      const results = await db.select({
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric - COALESCE(${sales.paidAmount}::numeric, 0)), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(sales)
        .where(and(eq(sales.status, 'completed'), sql`${sales.total}::numeric > COALESCE(${sales.paidAmount}::numeric, 0)`))
      return `Outstanding receivables: ${(results[0]?.total || 0).toLocaleString()} across ${results[0]?.count || 0} invoices`
    },
  },
  {
    name: 'get_outstanding_payables',
    description: 'Get total outstanding accounts payable amount to suppliers',
    category: 'accounting',
    execute: async (db) => {
      const results = await db.select({
        total: sql<number>`COALESCE(SUM(${purchases.total}::numeric - COALESCE(${purchases.paidAmount}::numeric, 0)), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(purchases)
        .where(and(sql`${purchases.status} NOT IN ('cancelled', 'draft')`, sql`${purchases.total}::numeric > COALESCE(${purchases.paidAmount}::numeric, 0)`))
      return `Outstanding payables: ${(results[0]?.total || 0).toLocaleString()} across ${results[0]?.count || 0} purchase invoices`
    },
  },

  // ==================== WORK ORDERS (Auto Service) ====================
  {
    name: 'get_pending_work_orders',
    description: 'Get count and list of pending/in-progress work orders',
    category: 'work_orders',
    execute: async (db) => {
      const results = await db.select({
        id: workOrders.id,
        orderNo: workOrders.orderNo,
        status: workOrders.status,
        createdAt: workOrders.createdAt,
      }).from(workOrders)
        .where(sql`${workOrders.status} IN ('draft', 'confirmed', 'in_progress')`)
        .orderBy(desc(workOrders.createdAt))
        .limit(10)

      if (results.length === 0) return 'No pending work orders.'
      return `${results.length} pending work orders:\n` + results.map(r =>
        `- ${r.orderNo}: ${r.status} (created ${new Date(r.createdAt).toLocaleDateString()})`
      ).join('\n')
    },
  },
  {
    name: 'get_work_order_summary',
    description: 'Get work order counts by status',
    category: 'work_orders',
    execute: async (db) => {
      const results = await db.select({
        status: workOrders.status,
        count: sql<number>`count(*)::int`,
      }).from(workOrders)
        .groupBy(workOrders.status)

      if (results.length === 0) return 'No work orders found.'
      return 'Work orders by status:\n' + results.map(r =>
        `- ${r.status}: ${r.count}`
      ).join('\n')
    },
  },

  // ==================== APPOINTMENTS ====================
  {
    name: 'get_today_appointments',
    description: 'Get today\'s scheduled appointments',
    category: 'appointments',
    execute: async (db) => {
      const todayStr = new Date().toISOString().slice(0, 10)

      const results = await db.select({
        id: appointments.id,
        status: appointments.status,
        scheduledDate: appointments.scheduledDate,
      }).from(appointments)
        .where(and(
          eq(appointments.scheduledDate, todayStr),
          sql`${appointments.status} != 'cancelled'`
        ))
        .orderBy(appointments.scheduledDate)

      if (results.length === 0) return 'No appointments today.'
      return `${results.length} appointments today:\n` + results.map(r =>
        `- ${r.scheduledDate} (${r.status})`
      ).join('\n')
    },
  },
  {
    name: 'get_upcoming_appointments',
    description: 'Get upcoming appointments for the next 7 days',
    category: 'appointments',
    execute: async (db) => {
      const today = new Date()
      const todayStr = today.toISOString().slice(0, 10)
      const weekLater = new Date(today.getTime() + 7 * 86400000)
      const weekLaterStr = weekLater.toISOString().slice(0, 10)

      const results = await db.select({
        status: appointments.status,
        scheduledDate: appointments.scheduledDate,
      }).from(appointments)
        .where(and(
          gte(appointments.scheduledDate, todayStr),
          sql`${appointments.scheduledDate} <= ${weekLaterStr}`,
          sql`${appointments.status} != 'cancelled'`
        ))
        .orderBy(appointments.scheduledDate)
        .limit(15)

      if (results.length === 0) return 'No upcoming appointments.'
      return `${results.length} upcoming appointments:\n` + results.map(r =>
        `- ${r.scheduledDate} (${r.status})`
      ).join('\n')
    },
  },

  // ==================== RESTAURANT ====================
  {
    name: 'get_table_status',
    description: 'Get current restaurant table occupancy status',
    category: 'restaurant',
    execute: async (db) => {
      const results = await db.select({
        status: restaurantTables.status,
        count: sql<number>`count(*)::int`,
      }).from(restaurantTables)
        .where(eq(restaurantTables.isActive, true))
        .groupBy(restaurantTables.status)

      if (results.length === 0) return 'No restaurant tables configured.'
      const total = results.reduce((sum, r) => sum + r.count, 0)
      return `Tables (${total} total):\n` + results.map(r =>
        `- ${r.status}: ${r.count}`
      ).join('\n')
    },
  },
  {
    name: 'get_today_reservations',
    description: 'Get today\'s restaurant reservations',
    category: 'restaurant',
    execute: async (db) => {
      const todayStr = new Date().toISOString().slice(0, 10)
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().slice(0, 10)

      const results = await db.select({
        status: reservations.status,
        count: sql<number>`count(*)::int`,
      }).from(reservations)
        .where(and(
          gte(reservations.reservationDate, todayStr),
          sql`${reservations.reservationDate} < ${tomorrowStr}`
        ))
        .groupBy(reservations.status)

      if (results.length === 0) return 'No reservations today.'
      const total = results.reduce((sum, r) => sum + r.count, 0)
      return `Today's reservations (${total} total):\n` + results.map(r =>
        `- ${r.status}: ${r.count}`
      ).join('\n')
    },
  },

  // ==================== LOYALTY ====================
  {
    name: 'get_loyalty_summary',
    description: 'Get loyalty program summary - total points issued and redeemed',
    category: 'loyalty',
    execute: async (db) => {
      const [programResult] = await db.select({
        count: sql<number>`count(*)::int`,
      }).from(loyaltyPrograms).where(eq(loyaltyPrograms.status, 'active'))

      if (programResult.count === 0) return 'No active loyalty program.'

      const results = await db.select({
        type: loyaltyTransactions.type,
        totalPoints: sql<number>`COALESCE(SUM(ABS(${loyaltyTransactions.points})), 0)::int`,
        count: sql<number>`count(*)::int`,
      }).from(loyaltyTransactions)
        .groupBy(loyaltyTransactions.type)

      if (results.length === 0) return 'Loyalty program is active but no transactions yet.'
      return 'Loyalty program summary:\n' + results.map(r =>
        `- ${r.type}: ${r.totalPoints.toLocaleString()} points (${r.count} transactions)`
      ).join('\n')
    },
  },

  // ==================== USERS / STAFF ====================
  {
    name: 'get_active_users',
    description: 'Get count of active users/staff by role',
    category: 'users',
    execute: async (db) => {
      const results = await db.select({
        role: users.role,
        count: sql<number>`count(*)::int`,
      }).from(users)
        .where(eq(users.isActive, true))
        .groupBy(users.role)

      if (results.length === 0) return 'No active users found.'
      const total = results.reduce((sum, r) => sum + r.count, 0)
      return `Active staff (${total} total):\n` + results.map(r =>
        `- ${r.role}: ${r.count}`
      ).join('\n')
    },
  },
  {
    name: 'get_user_sales_performance',
    description: 'Get sales performance by staff member this month',
    category: 'users',
    execute: async (db) => {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      const results = await db.select({
        name: users.fullName,
        total: sql<number>`COALESCE(SUM(${sales.total}::numeric), 0)::float`,
        count: sql<number>`count(*)::int`,
      }).from(sales)
        .innerJoin(users, eq(sales.createdBy, users.id))
        .where(and(gte(sales.createdAt, monthStart), eq(sales.status, 'completed')))
        .groupBy(users.fullName)
        .orderBy(desc(sql`SUM(${sales.total}::numeric)`))
        .limit(10)

      if (results.length === 0) return 'No sales data this month.'
      return 'Staff sales performance this month:\n' + results.map((r, i) =>
        `${i + 1}. ${r.name} - ${(r.total || 0).toLocaleString()} (${r.count} sales)`
      ).join('\n')
    },
  },

  // ==================== NAVIGATION ====================
  {
    name: 'find_page',
    description: 'Find a page or feature in the system by keyword',
    category: 'navigation',
    execute: async (_db, params) => {
      const { searchPages } = await import('./system-knowledge') as {
        searchPages: (query: string, businessType?: string, userRole?: string) => Array<{ name: string; path: string; description: string }>
      }
      const query = params?.query || ''
      if (!query) return 'Please provide a search term.'
      const results = searchPages(query, params?.businessType, params?.userRole)
      if (results.length === 0) return 'No matching pages found.'
      return 'Matching pages:\n' + results.slice(0, 5).map((p: { name: string; path: string; description: string }) =>
        `- **${p.name}** → \`${p.path}\`\n  ${p.description}`
      ).join('\n')
    },
  },
  {
    name: 'find_workflow',
    description: 'Find how to perform a task or workflow',
    category: 'navigation',
    execute: async (_db, params) => {
      const { searchWorkflows } = await import('./system-knowledge') as {
        searchWorkflows: (query: string) => Array<{ name: string; steps: string[]; relatedPages: string[] }>
      }
      const query = params?.query || ''
      if (!query) return 'Please provide a search term.'
      const results = searchWorkflows(query)
      if (results.length === 0) return 'No matching workflows found.'
      return results.slice(0, 3).map((w: { name: string; steps: string[]; relatedPages: string[] }) =>
        `**${w.name}:**\n${w.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}\nRelated pages: ${w.relatedPages.join(', ')}`
      ).join('\n\n')
    },
  },

  // ==================== SYSTEM ====================
  {
    name: 'get_company_info',
    description: 'Get current company name, business type, plan, and settings',
    category: 'system',
    execute: async (_db, params) => {
      if (!params?.companyName) return 'Company information unavailable.'
      return `Company: ${params.companyName}\nBusiness Type: ${params.businessType || 'Not set'}\nPlan: ${params.plan || 'free'}\nCurrency: ${params.currency || 'Not set'}\nSlug: ${params.slug || ''}`
    },
  },
  {
    name: 'get_active_modules',
    description: 'Get which modules are enabled or disabled for different roles',
    category: 'system',
    execute: async (db) => {
      const results = await db.select({
        moduleKey: moduleAccess.moduleKey,
        role: moduleAccess.role,
        isEnabled: moduleAccess.isEnabled,
      }).from(moduleAccess)

      if (results.length === 0) return 'All modules are enabled by default (no custom restrictions set).'
      const disabled = results.filter(r => !r.isEnabled)
      if (disabled.length === 0) return 'All modules are enabled for all roles.'
      return 'Disabled modules:\n' + disabled.map(r =>
        `- ${r.moduleKey} disabled for ${r.role}`
      ).join('\n')
    },
  },

  // ==================== SEARCH ====================
  {
    name: 'search_items',
    description: 'Search for items by name, SKU, or barcode',
    category: 'search',
    execute: async (db, params) => {
      const query = params?.query || ''
      if (!query) return 'Please provide a search term.'
      const escaped = escapeLikePattern(query)
      const results = await db.select({
        name: items.name,
        sku: items.sku,
        barcode: items.barcode,
        sellingPrice: sql<number>`${items.sellingPrice}::float`,
        costPrice: sql<number>`${items.costPrice}::float`,
        isActive: items.isActive,
      }).from(items)
        .where(sql`(${items.name} ILIKE ${'%' + escaped + '%'} OR ${items.sku} ILIKE ${'%' + escaped + '%'} OR ${items.barcode} ILIKE ${'%' + escaped + '%'})`)
        .limit(10)

      if (results.length === 0) return `No items found matching "${query}".`
      return `Found ${results.length} items:\n` + results.map(r =>
        `- ${r.name}${r.sku ? ` (SKU: ${r.sku})` : ''}${r.barcode ? ` [${r.barcode}]` : ''} - Sell: ${(r.sellingPrice || 0).toLocaleString()}, Cost: ${(r.costPrice || 0).toLocaleString()}${r.isActive ? '' : ' (INACTIVE)'}`
      ).join('\n')
    },
  },
  {
    name: 'search_customers',
    description: 'Search for customers by name, email, or phone number',
    category: 'search',
    execute: async (db, params) => {
      const query = params?.query || ''
      if (!query) return 'Please provide a search term.'
      const escaped = escapeLikePattern(query)
      const results = await db.select({
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        loyaltyPoints: customers.loyaltyPoints,
      }).from(customers)
        .where(sql`(${customers.name} ILIKE ${'%' + escaped + '%'} OR ${customers.email} ILIKE ${'%' + escaped + '%'} OR ${customers.phone} ILIKE ${'%' + escaped + '%'})`)
        .limit(10)

      if (results.length === 0) return `No customers found matching "${query}".`
      return `Found ${results.length} customers:\n` + results.map(r =>
        `- ${r.name}${r.email ? ` (${r.email})` : ''}${r.phone ? ` - ${r.phone}` : ''}${r.loyaltyPoints ? ` - ${r.loyaltyPoints} loyalty pts` : ''}`
      ).join('\n')
    },
  },

  // ==================== HR ====================
  {
    name: 'get_employee_count',
    description: 'Get total employee count and breakdown',
    category: 'hr',
    execute: async (db) => {
      const [result] = await db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) FILTER (WHERE ${employeeProfiles.employmentStatus} = 'active')::int`,
      }).from(employeeProfiles)
      return `Total employees: ${result.total}\nActive: ${result.active}\nInactive: ${result.total - result.active}`
    },
  },

  // ==================== DEALERSHIP ====================
  {
    name: 'get_vehicle_inventory_summary',
    description: 'Get vehicle inventory summary - counts by status and total value',
    category: 'dealership',
    execute: async (db) => {
      const results = await db.select({
        status: vehicleInventory.status,
        count: sql<number>`count(*)::int`,
        totalValue: sql<number>`COALESCE(SUM(${vehicleInventory.askingPrice}::numeric), 0)::float`,
      }).from(vehicleInventory)
        .groupBy(vehicleInventory.status)

      if (results.length === 0) return 'No vehicles in inventory.'
      const total = results.reduce((sum, r) => sum + r.count, 0)
      const totalValue = results.reduce((sum, r) => sum + (r.totalValue || 0), 0)
      return `Vehicle inventory (${total} total, value: ${totalValue.toLocaleString()}):\n` + results.map(r =>
        `- ${r.status}: ${r.count} vehicles (${(r.totalValue || 0).toLocaleString()})`
      ).join('\n')
    },
  },
  {
    name: 'get_pending_test_drives',
    description: 'Get upcoming and pending test drive appointments',
    category: 'dealership',
    execute: async (db) => {
      const results = await db.select({
        status: testDrives.status,
        count: sql<number>`count(*)::int`,
      }).from(testDrives)
        .where(sql`${testDrives.status} IN ('scheduled', 'confirmed')`)
        .groupBy(testDrives.status)

      if (results.length === 0) return 'No pending test drives.'
      const total = results.reduce((sum, r) => sum + r.count, 0)
      return `Pending test drives (${total} total):\n` + results.map(r =>
        `- ${r.status}: ${r.count}`
      ).join('\n')
    },
  },

  // ==================== ACCOUNTING (extended) ====================
  {
    name: 'get_monthly_pnl',
    description: 'Get this month profit and loss (income vs expenses)',
    category: 'accounting',
    execute: async (db) => {
      const now = new Date()
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const results = await db.select({
        rootType: sql<string>`(SELECT root_type FROM chart_of_accounts WHERE id = ${glEntries.accountId})`,
        totalDebit: sql<number>`COALESCE(SUM(${glEntries.debit}::numeric), 0)::float`,
        totalCredit: sql<number>`COALESCE(SUM(${glEntries.credit}::numeric), 0)::float`,
      }).from(glEntries)
        .where(gte(glEntries.postingDate, monthStart))
        .groupBy(sql`(SELECT root_type FROM chart_of_accounts WHERE id = ${glEntries.accountId})`)

      if (results.length === 0) return 'No GL entries this month.'
      const income = results.find(r => r.rootType === 'income')
      const expense = results.find(r => r.rootType === 'expense')
      const incomeTotal = (income?.totalCredit || 0) - (income?.totalDebit || 0)
      const expenseTotal = (expense?.totalDebit || 0) - (expense?.totalCredit || 0)
      return `This month's P&L:\n- Revenue: ${incomeTotal.toLocaleString()}\n- Expenses: ${expenseTotal.toLocaleString()}\n- Net: ${(incomeTotal - expenseTotal).toLocaleString()}`
    },
  },

  // ==================== RESTAURANT (extended) ====================
  {
    name: 'get_today_restaurant_orders',
    description: 'Get today restaurant order count and breakdown by type',
    category: 'restaurant',
    execute: async (db) => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const results = await db.select({
        orderType: restaurantOrders.orderType,
        count: sql<number>`count(*)::int`,
      }).from(restaurantOrders)
        .where(gte(restaurantOrders.createdAt, today))
        .groupBy(restaurantOrders.orderType)

      if (results.length === 0) return 'No restaurant orders today.'
      const total = results.reduce((sum, r) => sum + r.count, 0)
      return `Today's restaurant orders (${total} total):\n` + results.map(r =>
        `- ${r.orderType}: ${r.count}`
      ).join('\n')
    },
  },
]

/** Get a compact tool catalog for LLM-based selection */
export function getToolCatalog(): string {
  return chatTools.map(t => `- ${t.name}: ${t.description} [${t.category}]`).join('\n')
}

/** Find relevant tools using keyword matching (fallback) */
export function findRelevantToolsByKeyword(question: string): ChatTool[] {
  const q = question.toLowerCase()
  const matched: ChatTool[] = []

  if (q.includes('today') && (q.includes('sale') || q.includes('revenue') || q.includes('income'))) {
    matched.push(chatTools.find(t => t.name === 'get_today_sales')!)
  }
  if ((q.includes('week') || q.includes('month')) && (q.includes('sale') || q.includes('revenue') || q.includes('summary'))) {
    matched.push(chatTools.find(t => t.name === 'get_sales_summary')!)
  }
  if (q.includes('top') && (q.includes('item') || q.includes('product') || q.includes('selling') || q.includes('best'))) {
    matched.push(chatTools.find(t => t.name === 'get_top_selling_items')!)
  }
  if (q.includes('low') || (q.includes('stock') && !q.includes('value')) || q.includes('running out') || q.includes('reorder')) {
    matched.push(chatTools.find(t => t.name === 'get_low_stock_items')!)
  }
  if (q.includes('customer') && (q.includes('top') || q.includes('best') || q.includes('most'))) {
    matched.push(chatTools.find(t => t.name === 'get_top_customers')!)
  }
  if (q.includes('work order') || (q.includes('pending') && q.includes('service'))) {
    matched.push(chatTools.find(t => t.name === 'get_pending_work_orders')!)
  }
  if (q.includes('how many') && (q.includes('item') || q.includes('product'))) {
    matched.push(chatTools.find(t => t.name === 'get_item_count')!)
  }
  if (q.includes('how many') && q.includes('customer')) {
    matched.push(chatTools.find(t => t.name === 'get_customer_count')!)
  }
  if (q.includes('purchas') || q.includes('buying') || q.includes('procurement')) {
    matched.push(chatTools.find(t => t.name === 'get_purchase_summary')!)
  }
  if (q.includes('supplier') || q.includes('vendor')) {
    matched.push(chatTools.find(t => t.name === 'get_top_suppliers')!)
  }
  if (q.includes('receivable') || q.includes('owed to us') || q.includes('outstanding') && q.includes('customer')) {
    matched.push(chatTools.find(t => t.name === 'get_outstanding_receivables')!)
  }
  if (q.includes('payable') || q.includes('we owe') || (q.includes('outstanding') && q.includes('supplier'))) {
    matched.push(chatTools.find(t => t.name === 'get_outstanding_payables')!)
  }
  if (q.includes('appointment')) {
    matched.push(chatTools.find(t => t.name === 'get_today_appointments')!)
  }
  if (q.includes('table') && (q.includes('status') || q.includes('available') || q.includes('occupied'))) {
    matched.push(chatTools.find(t => t.name === 'get_table_status')!)
  }
  if (q.includes('reservation')) {
    matched.push(chatTools.find(t => t.name === 'get_today_reservations')!)
  }
  if (q.includes('loyalty') || q.includes('points') || q.includes('rewards')) {
    matched.push(chatTools.find(t => t.name === 'get_loyalty_summary')!)
  }
  if (q.includes('staff') || q.includes('employee') || q.includes('team')) {
    matched.push(chatTools.find(t => t.name === 'get_active_users')!)
  }
  if (q.includes('performance') && (q.includes('staff') || q.includes('user') || q.includes('cashier'))) {
    matched.push(chatTools.find(t => t.name === 'get_user_sales_performance')!)
  }
  if (q.includes('stock value') || q.includes('inventory value')) {
    matched.push(chatTools.find(t => t.name === 'get_stock_value')!)
  }
  if (q.includes('stock movement') || q.includes('inventory movement')) {
    matched.push(chatTools.find(t => t.name === 'get_stock_movement_summary')!)
  }
  if (q.includes('payment method') || q.includes('cash') && q.includes('card')) {
    matched.push(chatTools.find(t => t.name === 'get_payment_method_breakdown')!)
  }
  if (q.includes('expense') || q.includes('revenue') && q.includes('gl')) {
    matched.push(chatTools.find(t => t.name === 'get_revenue_expenses_today')!)
  }
  // Navigation / help
  if (q.includes('where') || q.includes('how to') || q.includes('how do') || q.includes('navigate') || q.includes('setting')) {
    matched.push(chatTools.find(t => t.name === 'find_page')!)
  }
  if (q.includes('how to') || q.includes('how do i') || q.includes('steps') || q.includes('workflow') || q.includes('guide')) {
    matched.push(chatTools.find(t => t.name === 'find_workflow')!)
  }
  // Search
  if ((q.includes('search') || q.includes('find')) && (q.includes('item') || q.includes('product'))) {
    matched.push(chatTools.find(t => t.name === 'search_items')!)
  }
  if ((q.includes('search') || q.includes('find')) && q.includes('customer')) {
    matched.push(chatTools.find(t => t.name === 'search_customers')!)
  }
  // Company / modules
  if (q.includes('company') && (q.includes('info') || q.includes('name') || q.includes('plan'))) {
    matched.push(chatTools.find(t => t.name === 'get_company_info')!)
  }
  if (q.includes('module') || q.includes('enabled') || q.includes('disabled')) {
    matched.push(chatTools.find(t => t.name === 'get_active_modules')!)
  }
  // Dealership
  if ((q.includes('vehicle') && q.includes('inventory')) || (q.includes('dealership') && q.includes('stock'))) {
    matched.push(chatTools.find(t => t.name === 'get_vehicle_inventory_summary')!)
  }
  if (q.includes('test drive')) {
    matched.push(chatTools.find(t => t.name === 'get_pending_test_drives')!)
  }
  // HR
  if (q.includes('employee') && (q.includes('count') || q.includes('how many') || q.includes('total'))) {
    matched.push(chatTools.find(t => t.name === 'get_employee_count')!)
  }
  // P&L
  if (q.includes('profit') || q.includes('loss') || q.includes('p&l') || q.includes('pnl')) {
    matched.push(chatTools.find(t => t.name === 'get_monthly_pnl')!)
  }
  // Restaurant orders
  if (q.includes('order') && (q.includes('restaurant') || q.includes('kitchen') || q.includes('dine'))) {
    matched.push(chatTools.find(t => t.name === 'get_today_restaurant_orders')!)
  }

  // If no specific match, provide general overview tools
  if (matched.length === 0) {
    matched.push(chatTools.find(t => t.name === 'get_today_sales')!)
    matched.push(chatTools.find(t => t.name === 'get_sales_summary')!)
  }

  return matched.filter(Boolean).slice(0, 5)
}

/** Parse LLM tool selection response into tool names */
export function parseToolSelection(llmResponse: string): string[] {
  try {
    // Try to parse as JSON array
    let text = llmResponse.trim()
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.filter((name: unknown) => typeof name === 'string')
    }
  } catch {
    // Fallback: extract tool names from text
    const validNames = new Set(chatTools.map(t => t.name))
    return llmResponse.split(/[\s,\n]+/).filter(word => validNames.has(word))
  }
  return []
}
