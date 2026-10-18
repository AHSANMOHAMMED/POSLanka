import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  accounts,
  tenants,
  subscriptions,
  paymentDeposits,
} from '@/lib/db/schema'
import { eq, sql, gte, and, count } from 'drizzle-orm'
import { withRateLimit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function GET() {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/stats')
    if (rateLimited) return rateLimited

    // Validate super admin session
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Total counts
    const [accountsCount] = await db.select({ count: count() }).from(accounts)
    const [tenantsCount] = await db.select({ count: count() }).from(tenants)
    const [activeSubsCount] = await db.select({ count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active'))
    const [trialSubsCount] = await db.select({ count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'trial'))
    const [pendingPaymentsCount] = await db.select({ count: count() })
      .from(paymentDeposits)
      .where(eq(paymentDeposits.status, 'pending'))

    // New signups in last 7 days
    const [newSignups] = await db.select({ count: count() })
      .from(accounts)
      .where(gte(accounts.createdAt, sevenDaysAgo))

    // New companies in last 7 days
    const [newCompanies] = await db.select({ count: count() })
      .from(tenants)
      .where(gte(tenants.createdAt, sevenDaysAgo))

    // Total revenue from approved payments
    const revenueResult = await db.select({
      total: sql<string>`COALESCE(SUM(amount), 0)`,
    })
      .from(paymentDeposits)
      .where(eq(paymentDeposits.status, 'approved'))

    // Revenue this month
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthlyRevenueResult = await db.select({
      total: sql<string>`COALESCE(SUM(amount), 0)`,
    })
      .from(paymentDeposits)
      .where(and(
        eq(paymentDeposits.status, 'approved'),
        gte(paymentDeposits.reviewedAt, firstOfMonth)
      ))

    // Subscription status breakdown
    const subscriptionsByStatus = await db.select({
      status: subscriptions.status,
      count: count(),
    })
      .from(subscriptions)
      .groupBy(subscriptions.status)

    // Tenant by business type
    const tenantsByType = await db.select({
      businessType: tenants.businessType,
      count: count(),
    })
      .from(tenants)
      .groupBy(tenants.businessType)

    // Recent signups (last 10)
    const recentSignups = await db.query.accounts.findMany({
      columns: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
      },
      orderBy: (a, { desc }) => [desc(a.createdAt)],
      limit: 10,
    })

    // Recent companies (last 10)
    const recentCompanies = await db.query.tenants.findMany({
      columns: {
        id: true,
        name: true,
        slug: true,
        businessType: true,
        createdAt: true,
      },
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 10,
    })

    // Expiring trials (next 7 days)
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const expiringTrials = await db.query.subscriptions.findMany({
      where: and(
        eq(subscriptions.status, 'trial'),
        gte(subscriptions.trialEndsAt, now),
        sql`${subscriptions.trialEndsAt} <= ${nextWeek}`
      ),
      with: {
        tenant: {
          columns: { name: true, slug: true },
        },
        billingAccount: {
          columns: { email: true, fullName: true },
        },
      },
    })

    return NextResponse.json({
      overview: {
        totalAccounts: accountsCount.count,
        totalCompanies: tenantsCount.count,
        activeSubscriptions: activeSubsCount.count,
        trialSubscriptions: trialSubsCount.count,
        pendingPayments: pendingPaymentsCount.count,
        newSignupsThisWeek: newSignups.count,
        newCompaniesThisWeek: newCompanies.count,
        totalRevenue: parseFloat(revenueResult[0]?.total || '0'),
        monthlyRevenue: parseFloat(monthlyRevenueResult[0]?.total || '0'),
      },
      subscriptionsByStatus: subscriptionsByStatus.reduce((acc, s) => {
        acc[s.status] = s.count
        return acc
      }, {} as Record<string, number>),
      tenantsByType: tenantsByType.reduce((acc, t) => {
        acc[t.businessType] = t.count
        return acc
      }, {} as Record<string, number>),
      recentSignups,
      recentCompanies,
      expiringTrials,
    })
  } catch (error) {
    logError('api/sys-control/stats', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
