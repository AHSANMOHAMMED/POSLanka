import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, vehicles, workOrders, insuranceEstimates, sales, items, tenants, suppliers, categories, purchaseOrders } from '@/lib/db/schema'
import { eq, or, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'

// X1: Unified global search across multiple modules
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '5'), 20)

    if (!query || query.length < 2) {
      return NextResponse.json({ error: 'Search query must be at least 2 characters' }, { status: 400 })
    }

    const searchPattern = `%${escapeLikePattern(query)}%`
    const isAutoService = session.user.businessType === 'auto_service' || session.user.businessType === 'dealership'
    const slug = session.user.tenantSlug

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get tenant's currency for proper formatting
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, session.user.tenantId),
      })
      const tenantCurrency = tenant?.currency || 'LKR'

      // Search customers (RLS scopes)
      const customerResults = await db
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
        })
        .from(customers)
        .where(
          or(
            ilike(customers.name, searchPattern),
            ilike(sql`COALESCE(${customers.phone}, '')`, searchPattern),
            ilike(sql`COALESCE(${customers.email}, '')`, searchPattern)
          )
        )
        .limit(limit)

      // Search vehicles (for auto_service) - RLS scopes
      let vehicleResults: Array<{ id: string; make: string; model: string; licensePlate: string | null; customerName: string | null }> = []
      if (isAutoService) {
        vehicleResults = await db
          .select({
            id: vehicles.id,
            make: vehicles.make,
            model: vehicles.model,
            licensePlate: vehicles.licensePlate,
            customerName: customers.name,
          })
          .from(vehicles)
          .leftJoin(customers, eq(vehicles.customerId, customers.id))
          .where(
            or(
              ilike(vehicles.make, searchPattern),
              ilike(vehicles.model, searchPattern),
              ilike(sql`COALESCE(${vehicles.licensePlate}, '')`, searchPattern),
              ilike(sql`COALESCE(${vehicles.vin}, '')`, searchPattern)
            )
          )
          .limit(limit)
      }

      // Search work orders (for auto_service) - RLS scopes
      let workOrderResults: Array<{ id: string; orderNo: string; status: string; customerName: string | null }> = []
      if (isAutoService) {
        workOrderResults = await db
          .select({
            id: workOrders.id,
            orderNo: workOrders.orderNo,
            status: workOrders.status,
            customerName: customers.name,
          })
          .from(workOrders)
          .leftJoin(customers, eq(workOrders.customerId, customers.id))
          .where(
            or(
              ilike(workOrders.orderNo, searchPattern),
              ilike(sql`COALESCE(${workOrders.customerComplaint}, '')`, searchPattern),
              ilike(sql`COALESCE(${customers.name}, '')`, searchPattern)
            )
          )
          .limit(limit)
      }

      // Search estimates (for auto_service) - RLS scopes
      let estimateResults: Array<{ id: string; estimateNo: string; status: string; customerName: string | null }> = []
      if (isAutoService) {
        estimateResults = await db
          .select({
            id: insuranceEstimates.id,
            estimateNo: insuranceEstimates.estimateNo,
            status: insuranceEstimates.status,
            customerName: customers.name,
          })
          .from(insuranceEstimates)
          .leftJoin(customers, eq(insuranceEstimates.customerId, customers.id))
          .where(
            or(
              ilike(insuranceEstimates.estimateNo, searchPattern),
              ilike(sql`COALESCE(${insuranceEstimates.claimNumber}, '')`, searchPattern),
              ilike(sql`COALESCE(${customers.name}, '')`, searchPattern)
            )
          )
          .limit(limit)
      }

      // Search sales/invoices (RLS scopes)
      const salesResults = await db
        .select({
          id: sales.id,
          invoiceNo: sales.invoiceNo,
          total: sales.total,
          customerName: customers.name,
        })
        .from(sales)
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .where(
          or(
            ilike(sales.invoiceNo, searchPattern),
            ilike(sql`COALESCE(${customers.name}, '')`, searchPattern)
          )
        )
        .limit(limit)

      // Search items/products (RLS scopes)
      const itemResults = await db
        .select({
          id: items.id,
          name: items.name,
          sku: items.sku,
          sellingPrice: items.sellingPrice,
        })
        .from(items)
        .where(
          or(
            ilike(items.name, searchPattern),
            ilike(sql`COALESCE(${items.sku}, '')`, searchPattern),
            ilike(sql`COALESCE(${items.barcode}, '')`, searchPattern)
          )
        )
        .limit(limit)

      // Search suppliers (RLS scopes)
      const supplierResults = await db
        .select({
          id: suppliers.id,
          name: suppliers.name,
          phone: suppliers.phone,
        })
        .from(suppliers)
        .where(
          or(
            ilike(suppliers.name, searchPattern),
            ilike(sql`COALESCE(${suppliers.phone}, '')`, searchPattern),
            ilike(sql`COALESCE(${suppliers.email}, '')`, searchPattern)
          )
        )
        .limit(limit)

      // Search categories (RLS scopes)
      const categoryResults = await db
        .select({
          id: categories.id,
          name: categories.name,
        })
        .from(categories)
        .where(ilike(categories.name, searchPattern))
        .limit(limit)

      // Search purchase orders (RLS scopes)
      const purchaseOrderResults = await db
        .select({
          id: purchaseOrders.id,
          orderNo: purchaseOrders.orderNo,
          status: purchaseOrders.status,
          supplierName: suppliers.name,
        })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(
          or(
            ilike(purchaseOrders.orderNo, searchPattern),
            ilike(sql`COALESCE(${suppliers.name}, '')`, searchPattern)
          )
        )
        .limit(limit)

      // Search navigation pages (static, no DB query)
      const navigationPages = getNavigationPages(slug, session.user.businessType || '')
      const searchLower = query.toLowerCase()
      const pageResults = navigationPages.filter(p =>
        p.title.toLowerCase().includes(searchLower) ||
        p.keywords.some(k => k.toLowerCase().includes(searchLower))
      ).slice(0, limit)

      // Format results with proper tenant-scoped URLs
      const base = `/c/${slug}`
      const results = {
        customers: customerResults.map(c => ({
          id: c.id,
          type: 'customer' as const,
          title: c.name,
          subtitle: c.phone || undefined,
          url: `${base}/customers?id=${c.id}`,
        })),
        vehicles: vehicleResults.map(v => ({
          id: v.id,
          type: 'vehicle' as const,
          title: `${v.licensePlate ? `[${v.licensePlate}] ` : ''}${v.make} ${v.model}`,
          subtitle: v.customerName || undefined,
          url: `${base}/vehicles?id=${v.id}`,
        })),
        workOrders: workOrderResults.map(wo => ({
          id: wo.id,
          type: 'work_order' as const,
          title: wo.orderNo,
          subtitle: wo.customerName || wo.status,
          url: `${base}/work-orders/${wo.id}`,
        })),
        estimates: estimateResults.map(e => ({
          id: e.id,
          type: 'estimate' as const,
          title: e.estimateNo,
          subtitle: e.customerName || e.status,
          url: `${base}/insurance-estimates/${e.id}`,
        })),
        sales: salesResults.map(s => ({
          id: s.id,
          type: 'sale' as const,
          title: s.invoiceNo,
          subtitle: s.customerName || formatCurrencyWithSymbol(parseFloat(s.total), tenantCurrency),
          url: `${base}/sales?id=${s.id}`,
        })),
        items: itemResults.map(i => ({
          id: i.id,
          type: 'item' as const,
          title: i.name,
          subtitle: i.sku || formatCurrencyWithSymbol(parseFloat(i.sellingPrice), tenantCurrency),
          url: `${base}/items?id=${i.id}`,
        })),
        suppliers: supplierResults.map(s => ({
          id: s.id,
          type: 'supplier' as const,
          title: s.name,
          subtitle: s.phone || undefined,
          url: `${base}/suppliers?id=${s.id}`,
        })),
        categories: categoryResults.map(c => ({
          id: c.id,
          type: 'category' as const,
          title: c.name,
          subtitle: undefined,
          url: `${base}/items?categoryId=${c.id}`,
        })),
        purchaseOrders: purchaseOrderResults.map(po => ({
          id: po.id,
          type: 'purchase_order' as const,
          title: po.orderNo,
          subtitle: po.supplierName || po.status,
          url: `${base}/purchase-orders/${po.id}`,
        })),
        pages: pageResults.map(p => ({
          id: p.url,
          type: 'page' as const,
          title: p.title,
          subtitle: p.section,
          url: p.url,
        })),
      }

      // Calculate total count
      const totalCount =
        results.customers.length +
        results.vehicles.length +
        results.workOrders.length +
        results.estimates.length +
        results.sales.length +
        results.items.length +
        results.suppliers.length +
        results.categories.length +
        results.purchaseOrders.length +
        results.pages.length

      return NextResponse.json({
        query,
        totalCount,
        results,
      })
    })
  } catch (error) {
    logError('api/search', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}

// Static navigation pages for search
interface NavPage {
  title: string
  section: string
  url: string
  keywords: string[]
}

function getNavigationPages(slug: string, businessType: string): NavPage[] {
  const base = `/c/${slug}`
  const pages: NavPage[] = [
    // Core
    { title: 'Dashboard', section: 'Home', url: `${base}/dashboard`, keywords: ['home', 'overview', 'metrics'] },
    { title: 'Point of Sale', section: 'Sales', url: `${base}/pos`, keywords: ['pos', 'checkout', 'register', 'billing'] },
    { title: 'Items', section: 'Inventory', url: `${base}/items`, keywords: ['products', 'stock', 'inventory', 'parts'] },
    { title: 'Categories', section: 'Inventory', url: `${base}/categories`, keywords: ['groups', 'classification'] },
    { title: 'Customers', section: 'Sales', url: `${base}/customers`, keywords: ['clients', 'buyers'] },
    { title: 'Sales', section: 'Sales', url: `${base}/sales`, keywords: ['invoices', 'transactions', 'orders'] },
    { title: 'Suppliers', section: 'Purchasing', url: `${base}/suppliers`, keywords: ['vendors'] },
    { title: 'Purchases', section: 'Purchasing', url: `${base}/purchases`, keywords: ['buying', 'procurement', 'receiving'] },
    { title: 'Purchase Orders', section: 'Purchasing', url: `${base}/purchase-orders`, keywords: ['po', 'ordering'] },
    // Stock
    { title: 'Stock Transfers', section: 'Inventory', url: `${base}/stock/transfers`, keywords: ['transfer', 'move stock', 'warehouse'] },
    { title: 'Stock Takes', section: 'Inventory', url: `${base}/stock-takes`, keywords: ['stocktake', 'count', 'audit', 'physical'] },
    { title: 'Reorder Dashboard', section: 'Inventory', url: `${base}/stock/reorder-dashboard`, keywords: ['reorder', 'low stock', 'replenish'] },
    // Accounting
    { title: 'Chart of Accounts', section: 'Accounting', url: `${base}/accounting/chart-of-accounts`, keywords: ['coa', 'accounts', 'ledger', 'gl'] },
    { title: 'Journal Entries', section: 'Accounting', url: `${base}/accounting/journal-entries`, keywords: ['journal', 'entries', 'transactions'] },
    { title: 'Bank Accounts', section: 'Accounting', url: `${base}/accounting/bank-accounts`, keywords: ['bank', 'reconciliation'] },
    { title: 'Budgets', section: 'Accounting', url: `${base}/accounting/budgets`, keywords: ['budget', 'planning', 'forecast'] },
    { title: 'Reports', section: 'Reports', url: `${base}/reports`, keywords: ['analytics', 'financial', 'profit', 'loss', 'balance sheet'] },
    // HR
    { title: 'Employees', section: 'HR', url: `${base}/hr/employees`, keywords: ['staff', 'team', 'personnel'] },
    { title: 'Payroll', section: 'HR', url: `${base}/hr/payroll`, keywords: ['salary', 'wages', 'pay'] },
    // Gift Cards
    { title: 'Gift Cards', section: 'Sales', url: `${base}/gift-cards`, keywords: ['voucher', 'coupon', 'card'] },
    { title: 'Loyalty', section: 'Sales', url: `${base}/loyalty`, keywords: ['points', 'rewards', 'program'] },
    // Settings
    { title: 'Company Settings', section: 'Settings', url: `${base}/settings`, keywords: ['configuration', 'preferences', 'setup', 'company info'] },
    { title: 'Staff Management', section: 'Settings', url: `${base}/settings/staff`, keywords: ['users', 'roles', 'permissions', 'team'] },
    { title: 'Warehouses', section: 'Settings', url: `${base}/settings/warehouses`, keywords: ['locations', 'stores', 'branches'] },
    { title: 'Tax Templates', section: 'Settings', url: `${base}/settings/tax-templates`, keywords: ['tax', 'vat', 'gst'] },
    { title: 'Payment Methods', section: 'Settings', url: `${base}/settings/payment-methods`, keywords: ['payment', 'modes', 'cash', 'card'] },
    { title: 'Module Access', section: 'Settings', url: `${base}/settings/modules`, keywords: ['features', 'modules', 'enable', 'disable'] },
    { title: 'Accounting Settings', section: 'Settings', url: `${base}/settings/accounting`, keywords: ['fiscal year', 'accounting config'] },
  ]

  // Business-type-specific pages
  if (businessType === 'auto_service' || businessType === 'dealership') {
    pages.push(
      { title: 'Work Orders', section: 'Service', url: `${base}/work-orders`, keywords: ['jobs', 'repair', 'service'] },
      { title: 'Vehicles', section: 'Service', url: `${base}/vehicles`, keywords: ['cars', 'auto', 'fleet'] },
      { title: 'Appointments', section: 'Service', url: `${base}/appointments`, keywords: ['booking', 'schedule'] },
      { title: 'Insurance Estimates', section: 'Service', url: `${base}/insurance-estimates`, keywords: ['estimate', 'quote', 'insurance', 'claim'] },
    )
  }
  if (businessType === 'restaurant') {
    pages.push(
      { title: 'Kitchen Display', section: 'Restaurant', url: `${base}/restaurant/kitchen`, keywords: ['kitchen', 'orders', 'cooking'] },
      { title: 'Tables', section: 'Restaurant', url: `${base}/restaurant/tables`, keywords: ['table', 'seating', 'floor plan'] },
      { title: 'Reservations', section: 'Restaurant', url: `${base}/restaurant/reservations`, keywords: ['booking', 'reserve'] },
    )
  }

  return pages
}
