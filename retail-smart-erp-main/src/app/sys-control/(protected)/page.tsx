import { db } from '@/lib/db'
import { accounts, tenants, subscriptions, paymentDeposits, pricingTiers, tenantUsage, payhereTransactions, systemSettings } from '@/lib/db/schema'
import { count, eq, sql, and, gte, gt } from 'drizzle-orm'
import Link from 'next/link'
import {
  Users, Building2, CreditCard, Clock, CheckCircle,
  Database, HardDrive, TrendingUp, AlertTriangle, Lock, Zap,
  Bell, Settings, Ticket, Sparkles, ArrowRight,
} from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'


// Safe query helper -- returns fallback on error (e.g. missing tables in local dev)
async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.warn('[AdminDashboard] Query failed (table may not exist locally):', (e as Error).message?.slice(0, 120))
    return fallback
  }
}

export default async function AdminDashboard() {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const emptyCount = [{ count: 0 }]

  // Get stats -- each query is safe so one failure doesn't crash the page
  const [
    totalAccounts,
    totalTenants,
    activeSubscriptions,
    freeSubscriptions,
    lockedSubscriptions,
    pastDueSubscriptions,
    pendingPayments,
    successfulPayhere,
    allCoupons,
    seasonalOfferSetting,
  ] = await Promise.all([
    safeQuery(() => db.select({ count: count() }).from(accounts), emptyCount),
    safeQuery(() => db.select({ count: count() }).from(tenants), emptyCount),
    safeQuery(() => db.select({ count: count() }).from(subscriptions).where(eq(subscriptions.status, 'active')), emptyCount),
    safeQuery(() => db.select({ count: count() }).from(subscriptions).where(eq(subscriptions.status, 'trial')), emptyCount),
    safeQuery(() => db.select({ count: count() }).from(subscriptions).where(eq(subscriptions.status, 'locked')), emptyCount),
    safeQuery(() => db.select({ count: count() }).from(subscriptions).where(eq(subscriptions.status, 'past_due')), emptyCount),
    safeQuery(() => db.select({ count: count() }).from(paymentDeposits).where(eq(paymentDeposits.status, 'pending')), emptyCount),
    safeQuery(() => db.select({ count: count() }).from(payhereTransactions).where(eq(payhereTransactions.status, 'success')), emptyCount),
    safeQuery(() => db.query.couponCodes.findMany(), []),
    safeQuery(() => db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'seasonal_offer'),
    }), null),
  ])

  // Count active coupons (isActive && validUntil is null or > now)
  const activeCouponsCount = allCoupons.filter((c) => {
    if (!c.isActive) return false
    if (c.validUntil && new Date(c.validUntil) < now) return false
    return true
  }).length

  // Parse seasonal offer
  const seasonalOffer = seasonalOfferSetting?.value as { enabled?: boolean; title?: string; discountPercent?: number; validUntil?: string } | null
  const isSeasonalOfferActive = !!(seasonalOffer?.enabled && (!seasonalOffer.validUntil || new Date(seasonalOffer.validUntil) > now))

  // Revenue stats: MRR from active subscriptions
  const mrrResult = await safeQuery(() => db
    .select({
      totalMrr: sql<number>`COALESCE(SUM(CAST(${pricingTiers.priceMonthly} AS NUMERIC)), 0)`,
    })
    .from(subscriptions)
    .innerJoin(pricingTiers, eq(subscriptions.tierId, pricingTiers.id))
    .where(eq(subscriptions.status, 'active')),
    [{ totalMrr: 0 }]
  )

  const mrr = Number(mrrResult[0]?.totalMrr || 0)
  const arr = mrr * 12

  // Revenue this month from approved bank deposits
  const monthlyBankRevenueResult = await safeQuery(() => db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${paymentDeposits.amount} AS NUMERIC)), 0)`,
    })
    .from(paymentDeposits)
    .where(
      and(
        eq(paymentDeposits.status, 'approved'),
        gte(paymentDeposits.createdAt, startOfMonth)
      )
    ),
    [{ total: 0 }]
  )

  // Revenue this month from PayHere successful transactions
  const monthlyPayhereRevenueResult = await safeQuery(() => db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${payhereTransactions.amount} AS NUMERIC)), 0)`,
    })
    .from(payhereTransactions)
    .where(
      and(
        eq(payhereTransactions.status, 'success'),
        gte(payhereTransactions.createdAt, startOfMonth)
      )
    ),
    [{ total: 0 }]
  )

  const revenueThisMonth = Number(monthlyBankRevenueResult[0]?.total || 0) + Number(monthlyPayhereRevenueResult[0]?.total || 0)

  // Pending payments total
  const pendingTotalResult = await safeQuery(() => db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${paymentDeposits.amount} AS NUMERIC)), 0)`,
    })
    .from(paymentDeposits)
    .where(eq(paymentDeposits.status, 'pending')),
    [{ total: 0 }]
  )

  const pendingTotal = Number(pendingTotalResult[0]?.total || 0)

  // Subscriber count by tier
  const tierBreakdown = await safeQuery(() => db
    .select({
      tierName: pricingTiers.displayName,
      count: count(),
    })
    .from(subscriptions)
    .innerJoin(pricingTiers, eq(subscriptions.tierId, pricingTiers.id))
    .where(sql`${subscriptions.status} IN ('active', 'trial')`)
    .groupBy(pricingTiers.displayName),
    []
  )

  // Storage overview: companies near limit (>80% usage)
  const storageAtRisk = await safeQuery(() => db
    .select({
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      storageBytes: tenantUsage.storageBytes,
      fileStorageBytes: tenantUsage.fileStorageBytes,
      maxDb: pricingTiers.maxDatabaseBytes,
      maxFiles: pricingTiers.maxFileStorageBytes,
      tierName: pricingTiers.displayName,
    })
    .from(tenantUsage)
    .innerJoin(tenants, eq(tenantUsage.tenantId, tenants.id))
    .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .innerJoin(pricingTiers, eq(subscriptions.tierId, pricingTiers.id))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        gt(pricingTiers.maxDatabaseBytes, 0)
      )
    ),
    []
  )

  const atRiskCompanies = storageAtRisk.filter((r) => {
    const dbPercent = r.maxDb ? (Number(r.storageBytes) / Number(r.maxDb)) * 100 : 0
    const filePercent = r.maxFiles ? (Number(r.fileStorageBytes) / Number(r.maxFiles)) * 100 : 0
    return dbPercent >= 80 || filePercent >= 80
  })

  // Get recent pending payments
  const recentPendingPayments = await safeQuery(() => db.query.paymentDeposits.findMany({
    where: eq(paymentDeposits.status, 'pending'),
    with: {
      account: true,
    },
    orderBy: (deposits, { desc }) => [desc(deposits.createdAt)],
    limit: 5,
  }), [])

  // Get recent accounts
  const recentAccounts = await safeQuery(() => db.query.accounts.findMany({
    orderBy: (accounts, { desc }) => [desc(accounts.createdAt)],
    limit: 5,
  }), [])

  const quickActions = [
    {
      label: 'Send Notification',
      href: '/sys-control/notifications',
      icon: Bell,
      color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50',
      iconBg: 'bg-blue-100 dark:bg-blue-800',
    },
    {
      label: 'View Subscriptions',
      href: '/sys-control/subscriptions',
      icon: Clock,
      color: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50',
      iconBg: 'bg-amber-100 dark:bg-amber-800',
    },
    {
      label: 'Review Payments',
      href: '/sys-control/payments',
      icon: CreditCard,
      color: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50',
      iconBg: 'bg-emerald-100 dark:bg-emerald-800',
    },
    {
      label: 'Manage Settings',
      href: '/sys-control/settings',
      icon: Settings,
      color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50',
      iconBg: 'bg-purple-100 dark:bg-purple-800',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Platform overview and key metrics</p>
      </div>

      {/* Quick Actions Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={`flex items-center gap-3 px-4 py-3 rounded-md border border-transparent transition-all ${action.color}`}
          >
            <div className={`w-9 h-9 rounded flex items-center justify-center ${action.iconBg}`}>
              <action.icon className="w-4.5 h-4.5" />
            </div>
            <span className="text-sm font-medium">{action.label}</span>
            <ArrowRight className="w-4 h-4 ml-auto opacity-50" />
          </Link>
        ))}
      </div>

      {/* Revenue Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-md p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-100">Monthly Recurring Revenue</p>
              <p className="text-3xl font-bold mt-1">{formatCurrencyWithSymbol(mrr, 'USD')}</p>
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-md flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
          </div>
          <p className="text-sm text-emerald-100 mt-2">
            ARR: {formatCurrencyWithSymbol(arr, 'USD')}
          </p>
        </div>

        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-md p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-100">Revenue This Month</p>
              <p className="text-3xl font-bold mt-1">{formatCurrencyWithSymbol(revenueThisMonth, 'USD')}</p>
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-md flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
          </div>
          <p className="text-sm text-blue-100 mt-2">
            PayHere + bank deposits since {startOfMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-md p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-orange-100">Pending Payments</p>
              <p className="text-3xl font-bold mt-1">{formatCurrencyWithSymbol(pendingTotal, 'USD')}</p>
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-md flex items-center justify-center">
              <Clock className="w-6 h-6 text-white" />
            </div>
          </div>
          <Link
            href="/sys-control/payments"
            className="text-sm text-orange-100 hover:text-white mt-2 inline-block"
          >
            {pendingPayments[0]?.count || 0} bank deposits to review →
          </Link>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-md p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-purple-100">PayHere Transactions</p>
              <p className="text-3xl font-bold mt-1">{successfulPayhere[0]?.count || 0}</p>
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-md flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
          </div>
          <Link
            href="/sys-control/payments"
            className="text-sm text-purple-100 hover:text-white mt-2 inline-block"
          >
            Successful payments →
          </Link>
        </div>
      </div>

      {/* Platform Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Users</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {totalAccounts[0]?.count || 0}
              </p>
            </div>
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-md flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <Link
            href="/sys-control/users"
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mt-2 inline-block"
          >
            View all →
          </Link>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Companies</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {totalTenants[0]?.count || 0}
              </p>
            </div>
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/40 rounded-md flex items-center justify-center">
              <Building2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Active</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {activeSubscriptions[0]?.count || 0}
              </p>
            </div>
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/40 rounded-md flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
          <Link
            href="/sys-control/subscriptions"
            className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 mt-2 inline-block"
          >
            Manage →
          </Link>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Free Plans</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {freeSubscriptions[0]?.count || 0}
              </p>
            </div>
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/40 rounded-md flex items-center justify-center">
              <Clock className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Locked</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                {lockedSubscriptions[0]?.count || 0}
              </p>
            </div>
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/40 rounded-md flex items-center justify-center">
              <Lock className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Past Due</p>
              <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">
                {pastDueSubscriptions[0]?.count || 0}
              </p>
            </div>
            <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/40 rounded-md flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Active Coupons</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {activeCouponsCount}
              </p>
            </div>
            <div className="w-10 h-10 bg-pink-100 dark:bg-pink-900/40 rounded-md flex items-center justify-center">
              <Ticket className="w-5 h-5 text-pink-600 dark:text-pink-400" />
            </div>
          </div>
          <Link
            href="/sys-control/coupons"
            className="text-xs text-pink-600 dark:text-pink-400 hover:text-pink-700 dark:hover:text-pink-300 mt-2 inline-block"
          >
            Manage →
          </Link>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Seasonal Offer</p>
              <p className="text-2xl font-bold mt-1">
                {isSeasonalOfferActive ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Active</span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">Off</span>
                )}
              </p>
            </div>
            <div className={`w-10 h-10 rounded-md flex items-center justify-center ${
              isSeasonalOfferActive
                ? 'bg-emerald-100 dark:bg-emerald-900/40'
                : 'bg-gray-100 dark:bg-gray-700'
            }`}>
              <Sparkles className={`w-5 h-5 ${
                isSeasonalOfferActive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`} />
            </div>
          </div>
          {isSeasonalOfferActive && seasonalOffer?.discountPercent ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
              {seasonalOffer.discountPercent}% off
              {seasonalOffer.validUntil && ` until ${new Date(seasonalOffer.validUntil).toLocaleDateString()}`}
            </p>
          ) : (
            <Link
              href="/sys-control/settings"
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mt-2 inline-block"
            >
              Configure →
            </Link>
          )}
        </div>
      </div>

      {/* Subscribers by Tier */}
      {tierBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Subscribers by Tier</h2>
          <div className="flex flex-wrap gap-4">
            {tierBreakdown.map((tier) => (
              <div key={tier.tierName} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700/50 rounded px-4 py-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{tier.tierName}</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">{tier.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* At Risk Section */}
      {atRiskCompanies.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-6">
          <h2 className="font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5" />
            Attention Required
          </h2>
          <div className="space-y-3">
            {atRiskCompanies.map((company) => {
              const dbPercent = company.maxDb ? Math.round((Number(company.storageBytes) / Number(company.maxDb)) * 100) : 0
              const filePercent = company.maxFiles ? Math.round((Number(company.fileStorageBytes) / Number(company.maxFiles)) * 100) : 0
              return (
                <div key={company.tenantSlug} className="flex items-center justify-between bg-white dark:bg-gray-800 rounded px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{company.tenantName}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{company.tierName}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {dbPercent >= 80 && (
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        dbPercent >= 95 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        <Database className="w-3 h-3" />
                        DB {dbPercent}%
                      </span>
                    )}
                    {filePercent >= 80 && (
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        filePercent >= 95 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        <HardDrive className="w-3 h-3" />
                        Files {filePercent}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Pending Payments */}
        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-white">Pending Payments</h2>
              <Link
                href="/sys-control/payments"
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                View all
              </Link>
            </div>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {recentPendingPayments.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                No pending payments
              </div>
            ) : (
              recentPendingPayments.map((payment) => {
                const account = Array.isArray(payment.account) ? payment.account[0] : payment.account
                return (
                  <div key={payment.id} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {account?.fullName || 'Unknown'}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {account?.email}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {formatCurrencyWithSymbol(Number(payment.amount), 'USD')}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {new Date(payment.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Recent Users */}
        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-white">Recent Users</h2>
              <Link
                href="/sys-control/users"
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                View all
              </Link>
            </div>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {recentAccounts.map((account) => (
              <div key={account.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{account.fullName}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{account.email}</p>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(account.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
