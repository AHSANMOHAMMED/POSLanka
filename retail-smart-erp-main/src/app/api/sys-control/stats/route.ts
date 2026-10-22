import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  accounts,
  tenants,
  subscriptions,
  paymentDeposits,
} from '@/lib/db/schema'
import { eq, sql, gte, and, count } from 'drizzle-orm'
import { adminAuthError, withRateLimit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

export async function GET() {
  try {
    const [rateLimited, session] = await Promise.all([
      withRateLimit('/api/sys-control/stats'),
      validateAdminSession('read'),
    ])
    if (rateLimited) return rateLimited
    if (!session) {
      return adminAuthError()
    }

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    // All independent — run in parallel (previously 14 sequential round trips).
    const [
      [accountsCount],
      [tenantsCount],
      [activeSubsCount],
      [trialSubsCount],
      [pendingPaymentsCount],
      [newSignups],
      [newCompanies],
      revenueResult,
      monthlyRevenueResult,
      subscriptionsByStatus,
      tenantsByType,
      recentSignups,
      recentCompanies,
      expiringTrials,
    ] = await Promise.all([
      db.select({ count: count() }).from(accounts),
      db.select({ count: count() }).from(tenants),
      db.select({ count: count() }).from(subscriptions).where(eq(subscriptions.status, 'active')),
      db.select({ count: count() }).from(subscriptions).where(eq(subscriptions.status, 'trial')),
      db.select({ count: count() }).from(paymentDeposits).where(eq(paymentDeposits.status, 'pending')),
      db.select({ count: count() }).from(accounts).where(gte(accounts.createdAt, sevenDaysAgo)),
      db.select({ count: count() }).from(tenants).where(gte(tenants.createdAt, sevenDaysAgo)),
      db.select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
        .from(paymentDeposits)
        .where(eq(paymentDeposits.status, 'approved')),
      db.select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
        .from(paymentDeposits)
        .where(and(eq(paymentDeposits.status, 'approved'), gte(paymentDeposits.reviewedAt, firstOfMonth))),
      db.select({ status: subscriptions.status, count: count() }).from(subscriptions).groupBy(subscriptions.status),
      db.select({ businessType: tenants.businessType, count: count() }).from(tenants).groupBy(tenants.businessType),
      db.query.accounts.findMany({
        columns: { id: true, email: true, fullName: true, createdAt: true },
        orderBy: (a, { desc }) => [desc(a.createdAt)],
        limit: 10,
      }),
      db.query.tenants.findMany({
        columns: { id: true, name: true, slug: true, businessType: true, createdAt: true },
        orderBy: (t, { desc }) => [desc(t.createdAt)],
        limit: 10,
      }),
      db.query.subscriptions.findMany({
        where: and(
          eq(subscriptions.status, 'trial'),
          gte(subscriptions.trialEndsAt, now),
          sql`${subscriptions.trialEndsAt} <= ${nextWeek}`
        ),
        with: {
          tenant: { columns: { name: true, slug: true } },
          billingAccount: { columns: { email: true, fullName: true } },
        },
      }),
    ])

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
