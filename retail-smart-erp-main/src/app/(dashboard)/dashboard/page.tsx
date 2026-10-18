import { auth } from '@/lib/auth'
import Link from 'next/link'
import { db } from '@/lib/db'
import { sales, customers, items, workOrders, appointments, insuranceEstimates, warehouseStock, tenants } from '@/lib/db/schema'
import { eq, and, gte, sql, or } from 'drizzle-orm'
import { formatCurrencyShort } from '@/lib/config'
import {
  DollarSign,
  TrendingUp,
  Users,
  AlertTriangle,
  ShoppingCart,
  Package,
  UserPlus,
  CheckCircle,
  Wrench,
  Calendar,
  Car,
  ArrowRight,
  FileText,
  Clock
} from 'lucide-react'

async function getDashboardStats(tenantId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  // Get today's sales
  const [todayStats] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${sales.total}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(sales)
    .where(and(
      eq(sales.tenantId, tenantId),
      gte(sales.createdAt, today),
      eq(sales.status, 'completed')
    ))

  // Get this month's sales
  const [monthStats] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${sales.total}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(sales)
    .where(and(
      eq(sales.tenantId, tenantId),
      gte(sales.createdAt, monthStart),
      eq(sales.status, 'completed')
    ))

  // Get customer count
  const [customerCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(customers)
    .where(eq(customers.tenantId, tenantId))

  // Get low stock items count (items with stock at or below min level in any warehouse)
  // Wrapped in try-catch in case warehouse_stock table doesn't exist yet
  let lowStockCount = { count: 0 }
  try {
    const [result] = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${warehouseStock.itemId})` })
      .from(warehouseStock)
      .innerJoin(items, eq(items.id, warehouseStock.itemId))
      .where(and(
        eq(warehouseStock.tenantId, tenantId),
        eq(items.isActive, true),
        eq(items.trackStock, true),
        sql`CAST(${warehouseStock.currentStock} AS DECIMAL) <= CAST(${warehouseStock.minStock} AS DECIMAL)`
      ))
    if (result) lowStockCount = result
  } catch {
    // warehouse_stock table may not exist yet - return 0
  }

  return {
    todaySales: parseFloat(todayStats?.total || '0'),
    todayTransactions: Number(todayStats?.count || 0),
    monthSales: parseFloat(monthStats?.total || '0'),
    monthTransactions: Number(monthStats?.count || 0),
    customerCount: Number(customerCount?.count || 0),
    lowStockCount: Number(lowStockCount?.count || 0),
  }
}

// X2: Get pending items for dashboard widgets
async function getPendingItems(tenantId: string, isAutoService: boolean) {
  const today = new Date().toISOString().split('T')[0]

  // Today's appointments count
  const [todayAppointments] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(appointments)
    .where(and(
      eq(appointments.tenantId, tenantId),
      eq(appointments.scheduledDate, today),
      or(
        eq(appointments.status, 'scheduled'),
        eq(appointments.status, 'confirmed'),
        eq(appointments.status, 'arrived')
      )
    ))

  // Draft work orders count
  const [draftWorkOrders] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(workOrders)
    .where(and(
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.status, 'draft')
    ))

  // Pending estimates count (submitted or under_review)
  const [pendingEstimates] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(insuranceEstimates)
    .where(and(
      eq(insuranceEstimates.tenantId, tenantId),
      or(
        eq(insuranceEstimates.status, 'submitted'),
        eq(insuranceEstimates.status, 'under_review')
      )
    ))

  // Get today's appointment details
  const todayAppointmentsList = isAutoService ? await db.query.appointments.findMany({
    where: and(
      eq(appointments.tenantId, tenantId),
      eq(appointments.scheduledDate, today),
      or(
        eq(appointments.status, 'scheduled'),
        eq(appointments.status, 'confirmed'),
        eq(appointments.status, 'arrived')
      )
    ),
    orderBy: (a, { asc }) => [asc(a.scheduledTime)],
    limit: 5,
    with: {
      customer: { columns: { name: true } },
      serviceType: { columns: { name: true } },
    }
  }) : []

  return {
    todayAppointmentsCount: Number(todayAppointments?.count || 0),
    draftWorkOrdersCount: Number(draftWorkOrders?.count || 0),
    pendingEstimatesCount: Number(pendingEstimates?.count || 0),
    todayAppointmentsList: todayAppointmentsList.map(a => {
      const customer = Array.isArray(a.customer) ? a.customer[0] : a.customer
      const serviceType = Array.isArray(a.serviceType) ? a.serviceType[0] : a.serviceType
      return {
        id: a.id,
        time: a.scheduledTime,
        customerName: customer?.name || null,
        serviceName: serviceType?.name || null,
        status: a.status,
      }
    }),
  }
}

interface RecentSale {
  id: string
  invoiceNo: string
  total: string
  createdAt: Date
  customerName: string | null
}

interface RecentWorkOrder {
  id: string
  orderNo: string
  status: string
  total: string
  createdAt: Date
  customerName: string | null
  vehicleInfo: string | null
}

async function getRecentActivity(tenantId: string, isAutoService: boolean) {
  // Get recent sales (last 5)
  const recentSales = await db.query.sales.findMany({
    where: eq(sales.tenantId, tenantId),
    orderBy: (sales, { desc }) => [desc(sales.createdAt)],
    limit: 5,
    with: {
      customer: {
        columns: { name: true }
      }
    }
  })

  const formattedSales: RecentSale[] = recentSales.map(s => {
    const customer = Array.isArray(s.customer) ? s.customer[0] : s.customer
    return {
      id: s.id,
      invoiceNo: s.invoiceNo,
      total: s.total,
      createdAt: s.createdAt,
      customerName: customer?.name || null
    }
  })

  // Get recent work orders (last 5) if auto_service
  let formattedWorkOrders: RecentWorkOrder[] = []
  if (isAutoService) {
    const recentWorkOrders = await db.query.workOrders.findMany({
      where: eq(workOrders.tenantId, tenantId),
      orderBy: (workOrders, { desc }) => [desc(workOrders.createdAt)],
      limit: 5,
      with: {
        customer: {
          columns: { name: true }
        },
        vehicle: {
          columns: { make: true, model: true, licensePlate: true }
        }
      }
    })

    formattedWorkOrders = recentWorkOrders.map(wo => {
      const customer = Array.isArray(wo.customer) ? wo.customer[0] : wo.customer
      const vehicle = Array.isArray(wo.vehicle) ? wo.vehicle[0] : wo.vehicle
      return {
        id: wo.id,
        orderNo: wo.orderNo,
        status: wo.status,
        total: wo.total,
        createdAt: wo.createdAt,
        customerName: customer?.name || null,
        vehicleInfo: vehicle ? `${vehicle.licensePlate ? `[${vehicle.licensePlate}] ` : ''}${vehicle.make} ${vehicle.model}` : null
      }
    })
  }

  return { recentSales: formattedSales, recentWorkOrders: formattedWorkOrders }
}

export default async function DashboardPage() {
  const session = await auth()
  const tenantSlug = session?.user?.tenantSlug || ''
  const isAutoService = session?.user?.businessType === 'auto_service'

  // Get tenant currency
  let currencyCode = 'LKR'
  if (session?.user?.tenantId) {
    const [tenant] = await db.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, session.user.tenantId))
    if (tenant) currencyCode = tenant.currency
  }

  const stats = session?.user?.tenantId
    ? await getDashboardStats(session.user.tenantId)
    : { todaySales: 0, todayTransactions: 0, monthSales: 0, monthTransactions: 0, customerCount: 0, lowStockCount: 0 }

  const activity = session?.user?.tenantId
    ? await getRecentActivity(session.user.tenantId, isAutoService)
    : { recentSales: [], recentWorkOrders: [] }

  // X2: Fetch pending items for widgets
  const pending = session?.user?.tenantId
    ? await getPendingItems(session.user.tenantId, isAutoService)
    : { todayAppointmentsCount: 0, draftWorkOrdersCount: 0, pendingEstimatesCount: 0, todayAppointmentsList: [] }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-md p-6 text-white">
        <h1 className="text-2xl font-bold">Welcome back, {session?.user?.name}!</h1>
        <p className="text-blue-100 mt-1">
          {session?.user?.tenantName} - {session?.user?.businessType?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white p-5 rounded-md border shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium">Today&apos;s Sales</p>
              <p className="text-2xl font-bold mt-1">{currencyCode} {formatCurrencyShort(stats.todaySales)}</p>
              <p className="text-xs text-gray-400 mt-1">{stats.todayTransactions} transaction{stats.todayTransactions !== 1 ? 's' : ''}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-md flex items-center justify-center">
              <DollarSign className="text-green-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-md border shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium">This Month</p>
              <p className="text-2xl font-bold mt-1">{currencyCode} {formatCurrencyShort(stats.monthSales)}</p>
              <p className="text-xs text-gray-400 mt-1">{stats.monthTransactions} transaction{stats.monthTransactions !== 1 ? 's' : ''}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-md flex items-center justify-center">
              <TrendingUp className="text-blue-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-md border shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium">Customers</p>
              <p className="text-2xl font-bold mt-1">{stats.customerCount.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">Total customers</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-md flex items-center justify-center">
              <Users className="text-purple-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-md border shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium">Low Stock Items</p>
              <p className={`text-2xl font-bold mt-1 ${stats.lowStockCount > 0 ? 'text-orange-600' : ''}`}>{stats.lowStockCount}</p>
              <p className="text-xs text-gray-400 mt-1">Need restocking</p>
            </div>
            <div className="w-12 h-12 bg-orange-100 rounded-md flex items-center justify-center">
              <AlertTriangle className="text-orange-600" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* X2: Pending Items Widgets (for auto_service) */}
      {isAutoService && (pending.todayAppointmentsCount > 0 || pending.draftWorkOrdersCount > 0 || pending.pendingEstimatesCount > 0) && (
        <div className="grid gap-4 md:grid-cols-3">
          {/* Today's Appointments */}
          <Link
            href={tenantSlug ? `/c/${tenantSlug}/appointments` : '/appointments'}
            className={`bg-white p-5 rounded-md border shadow-sm hover:shadow-md transition-shadow ${pending.todayAppointmentsCount > 0 ? 'border-l-4 border-l-blue-500' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Today&apos;s Appointments</p>
                <p className={`text-2xl font-bold mt-1 ${pending.todayAppointmentsCount > 0 ? 'text-blue-600' : ''}`}>
                  {pending.todayAppointmentsCount}
                </p>
                <p className="text-xs text-gray-400 mt-1">scheduled for today</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-md flex items-center justify-center">
                <Calendar className="text-blue-600" size={24} />
              </div>
            </div>
          </Link>

          {/* Draft Work Orders */}
          <Link
            href={tenantSlug ? `/c/${tenantSlug}/work-orders?status=draft` : '/work-orders?status=draft'}
            className={`bg-white p-5 rounded-md border shadow-sm hover:shadow-md transition-shadow ${pending.draftWorkOrdersCount > 0 ? 'border-l-4 border-l-yellow-500' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Draft Work Orders</p>
                <p className={`text-2xl font-bold mt-1 ${pending.draftWorkOrdersCount > 0 ? 'text-yellow-600' : ''}`}>
                  {pending.draftWorkOrdersCount}
                </p>
                <p className="text-xs text-gray-400 mt-1">awaiting completion</p>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-md flex items-center justify-center">
                <Clock className="text-yellow-600" size={24} />
              </div>
            </div>
          </Link>

          {/* Pending Estimates */}
          <Link
            href={tenantSlug ? `/c/${tenantSlug}/insurance-estimates?status=awaiting_review` : '/insurance-estimates?status=awaiting_review'}
            className={`bg-white p-5 rounded-md border shadow-sm hover:shadow-md transition-shadow ${pending.pendingEstimatesCount > 0 ? 'border-l-4 border-l-purple-500' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Pending Estimates</p>
                <p className={`text-2xl font-bold mt-1 ${pending.pendingEstimatesCount > 0 ? 'text-purple-600' : ''}`}>
                  {pending.pendingEstimatesCount}
                </p>
                <p className="text-xs text-gray-400 mt-1">awaiting review</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-md flex items-center justify-center">
                <FileText className="text-purple-600" size={24} />
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* X2: Today's Appointments List */}
      {isAutoService && pending.todayAppointmentsList.length > 0 && (
        <div className="bg-white p-6 rounded-md border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar size={20} className="text-blue-600" />
              Today&apos;s Appointments
            </h2>
            <Link href={tenantSlug ? `/c/${tenantSlug}/appointments` : '/appointments'} className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pending.todayAppointmentsList.map((apt) => (
              <div
                key={apt.id}
                className="p-3 rounded border bg-gray-50 flex items-center gap-3"
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                  apt.status === 'arrived' ? 'bg-yellow-100 text-yellow-700' :
                  apt.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {apt.time.slice(0, 5)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{apt.customerName || 'Walk-in'}</p>
                  <p className="text-xs text-gray-500 truncate">{apt.serviceName || 'No service specified'}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  apt.status === 'arrived' ? 'bg-yellow-100 text-yellow-700' :
                  apt.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {apt.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions and Getting Started */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Quick Actions */}
        <div className="bg-white p-6 rounded-md border shadow-sm">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ArrowRight size={20} className="text-blue-600" />
            Quick Actions
          </h2>
          <div className="grid gap-3">
            <Link
              href={tenantSlug ? `/c/${tenantSlug}/pos` : '/pos'}
              className="flex items-center gap-3 p-4 rounded-md bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium hover:from-blue-700 hover:to-blue-800 transition-all shadow-sm hover:shadow-md"
            >
              <ShoppingCart size={20} />
              <span>Open Point of Sale</span>
            </Link>

            {isAutoService && (
              <>
                <Link
                  href={tenantSlug ? `/c/${tenantSlug}/work-orders` : '/work-orders'}
                  className="flex items-center gap-3 p-4 rounded-md border-2 border-green-200 bg-green-50 text-green-700 font-medium hover:bg-green-100 transition-colors"
                >
                  <Wrench size={20} />
                  <span>Work Orders</span>
                </Link>
                <Link
                  href={tenantSlug ? `/c/${tenantSlug}/appointments` : '/appointments'}
                  className="flex items-center gap-3 p-4 rounded-md border hover:bg-gray-50 transition-colors"
                >
                  <Calendar size={20} className="text-gray-500" />
                  <span>Appointments</span>
                </Link>
                <Link
                  href={tenantSlug ? `/c/${tenantSlug}/vehicles` : '/vehicles'}
                  className="flex items-center gap-3 p-4 rounded-md border hover:bg-gray-50 transition-colors"
                >
                  <Car size={20} className="text-gray-500" />
                  <span>Vehicles</span>
                </Link>
              </>
            )}

            {!isAutoService && (
              <>
                <Link
                  href={tenantSlug ? `/c/${tenantSlug}/items` : '/items'}
                  className="flex items-center gap-3 p-4 rounded-md border hover:bg-gray-50 transition-colors"
                >
                  <Package size={20} className="text-gray-500" />
                  <span>Manage Items</span>
                </Link>
                <Link
                  href={tenantSlug ? `/c/${tenantSlug}/customers` : '/customers'}
                  className="flex items-center gap-3 p-4 rounded-md border hover:bg-gray-50 transition-colors"
                >
                  <UserPlus size={20} className="text-gray-500" />
                  <span>Manage Customers</span>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Getting Started */}
        <div className="bg-white p-6 rounded-md border shadow-sm">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle size={20} className="text-green-600" />
            Getting Started
          </h2>
          <div className="space-y-4">
            {isAutoService ? (
              <>
                <Step number={1} text="Add service types for your workshop" />
                <Step number={2} text="Add parts and inventory items" />
                <Step number={3} text="Register customers and their vehicles" />
                <Step number={4} text="Create work orders and start servicing!" />
              </>
            ) : (
              <>
                <Step number={1} text="Add categories to organize your products" />
                <Step number={2} text="Add your products with prices and stock" />
                <Step number={3} text="Register your customers (optional)" />
                <Step number={4} text="Start making sales with the POS!" />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Sales */}
        <div className="bg-white p-6 rounded-md border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ShoppingCart size={20} className="text-blue-600" />
              Recent Sales
            </h2>
            <Link href={tenantSlug ? `/c/${tenantSlug}/sales` : '/sales'} className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          {activity.recentSales.length === 0 ? (
            <div className="text-center py-6 text-gray-500">
              <ShoppingCart size={32} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No sales yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activity.recentSales.map((sale) => (
                <Link
                  key={sale.id}
                  href={tenantSlug ? `/c/${tenantSlug}/sales?search=${encodeURIComponent(sale.invoiceNo)}` : `/sales?search=${encodeURIComponent(sale.invoiceNo)}`}
                  className="flex items-center justify-between p-3 rounded hover:bg-gray-50 transition-colors border"
                >
                  <div>
                    <p className="font-medium text-sm">{sale.invoiceNo}</p>
                    <p className="text-xs text-gray-500">
                      {sale.customerName || 'Walk-in'} • {new Date(sale.createdAt).toLocaleDateString()}{' '}
                      {new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className="font-semibold text-green-600">
                    {currencyCode} {parseFloat(sale.total).toFixed(2)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Work Orders (for auto_service) or Low Stock Items */}
        {isAutoService ? (
          <div className="bg-white p-6 rounded-md border shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Wrench size={20} className="text-green-600" />
                Recent Work Orders
              </h2>
              <Link href={tenantSlug ? `/c/${tenantSlug}/work-orders` : '/work-orders'} className="text-sm text-blue-600 hover:underline">View all</Link>
            </div>
            {activity.recentWorkOrders.length === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <Wrench size={32} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm">No work orders yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activity.recentWorkOrders.map((wo) => (
                  <Link
                    key={wo.id}
                    href={tenantSlug ? `/c/${tenantSlug}/work-orders/${wo.id}` : `/work-orders/${wo.id}`}
                    className="flex items-center justify-between p-3 rounded hover:bg-gray-50 transition-colors border"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{wo.orderNo}</p>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          wo.status === 'completed' || wo.status === 'invoiced' ? 'bg-green-100 text-green-800' :
                          wo.status === 'in_progress' ? 'bg-purple-100 text-purple-800' :
                          wo.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {wo.status.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {wo.vehicleInfo || wo.customerName || 'No customer'} • {new Date(wo.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="font-semibold">
                      {currencyCode} {parseFloat(wo.total).toFixed(2)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white p-6 rounded-md border shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle size={20} className="text-orange-600" />
              Inventory Alerts
            </h2>
            {stats.lowStockCount === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <CheckCircle size={32} className="mx-auto mb-2 text-green-300" />
                <p className="text-sm">All items are well stocked</p>
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="w-16 h-16 mx-auto mb-3 bg-orange-100 rounded-full flex items-center justify-center">
                  <AlertTriangle size={32} className="text-orange-600" />
                </div>
                <p className="text-2xl font-bold text-orange-600">{stats.lowStockCount}</p>
                <p className="text-sm text-gray-500 mb-4">items need restocking</p>
                <Link
                  href={tenantSlug ? `/c/${tenantSlug}/items?filter=low-stock` : '/items?filter=low-stock'}
                  className="text-sm text-blue-600 hover:underline"
                >
                  View low stock items
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Step({ number, text }: { number: number; text: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded hover:bg-gray-50 transition-colors">
      <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
        {number}
      </span>
      <span className="text-gray-700">{text}</span>
    </div>
  )
}
