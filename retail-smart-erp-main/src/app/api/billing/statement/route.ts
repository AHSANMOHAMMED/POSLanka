import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  tenants,
  subscriptions,
  pricingTiers,
  tenantUsage,
  billingInvoices,
} from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { foldTenantUsage } from '@/lib/db/storage-quota'
import {
  readDueNoticeFromSettings,
  resolveDueNoticeUrgency,
  formatDueAmount,
} from '@/lib/tenant/lock-message'
import { getSubscriptionPrice } from '@/lib/billing/pricing'
import { logError } from '@/lib/ai/error-logger'

const BILLING_ROLES = new Set(['owner', 'manager', 'system_manager'])

/**
 * GET /api/billing/statement
 * Tenant-authenticated postpaid usage & billing statement for Store Owner / Manager.
 * Works directly from `/c/[slug]/billing` without requiring a separate `/account` session.
 */
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!BILLING_ROLES.has(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden — Owner or Manager access required' }, { status: 403 })
    }

    const tenantId = session.user.tenantId
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        id: true,
        name: true,
        slug: true,
        currency: true,
        status: true,
        primaryOwnerId: true,
        settings: true,
        createdAt: true,
      },
    })
    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, tenantId),
    })

    const tier = subscription
      ? await db.query.pricingTiers.findFirst({
          where: eq(pricingTiers.id, subscription.tierId),
        })
      : null

    await foldTenantUsage(tenantId)
    const usage = await db.query.tenantUsage.findFirst({
      where: eq(tenantUsage.tenantId, tenantId),
    })

    const billingAccountId = subscription?.billingAccountId || tenant.primaryOwnerId
    const recentInvoices = billingAccountId
      ? await db
          .select()
          .from(billingInvoices)
          .where(eq(billingInvoices.accountId, billingAccountId))
          .orderBy(desc(billingInvoices.createdAt))
          .limit(12)
      : []

    const dueNotice = readDueNoticeFromSettings(tenant.settings)
    const dueUrgency = dueNotice ? resolveDueNoticeUrgency(dueNotice) : null

    const billingCycle = (subscription?.billingCycle || 'monthly') as 'monthly' | 'yearly'
    const planPrice =
      subscription && tier ? getSubscriptionPrice(subscription, tier, billingCycle) : 0
    const planCurrency = tier?.currency || tenant.currency || 'LKR'

    const effectiveDbLimit = subscription?.overrideDatabaseBytes ?? tier?.maxDatabaseBytes ?? null
    const effectiveFileLimit = subscription?.overrideFileStorageBytes ?? tier?.maxFileStorageBytes ?? null

    const statementAmount =
      dueNotice?.dueAmount && dueNotice.dueAmount > 0
        ? dueNotice.dueAmount
        : subscription?.status === 'active'
        ? planPrice
        : 0
    const statementCurrency = dueNotice?.dueCurrency || planCurrency

    return NextResponse.json({
      company: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        currency: tenant.currency,
        status: tenant.status,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            billingCycle,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            trialEndsAt: subscription.trialEndsAt,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            lastPaymentAt: subscription.lastPaymentAt,
          }
        : null,
      tier: tier
        ? {
            id: tier.id,
            name: tier.name,
            displayName: tier.displayName,
            priceMonthly: tier.priceMonthly,
            priceYearly: tier.priceYearly,
            currency: tier.currency || 'LKR',
            maxUsers: tier.maxUsers,
            maxSalesMonthly: tier.maxSalesMonthly,
            maxDatabaseBytes: effectiveDbLimit,
            maxFileStorageBytes: effectiveFileLimit,
          }
        : null,
      usage: {
        usersCount: usage?.usersCount ?? 0,
        customersCount: usage?.customersCount ?? 0,
        itemsCount: usage?.itemsCount ?? 0,
        salesCount: usage?.salesCount ?? 0,
        purchasesCount: usage?.purchasesCount ?? 0,
        databaseBytes: usage?.storageBytes ?? 0,
        fileStorageBytes: usage?.fileStorageBytes ?? 0,
        updatedAt: usage?.updatedAt ?? null,
      },
      dueNotice: dueNotice
        ? {
            ...dueNotice,
            formattedAmount: formatDueAmount(dueNotice.dueAmount, dueNotice.dueCurrency),
            urgency: dueUrgency,
          }
        : null,
      currentStatement: {
        statementNo: `STMT-${tenant.slug.toUpperCase().slice(0, 8)}-${new Date().toISOString().slice(0, 7).replace('-', '')}`,
        periodLabel:
          dueNotice?.billingPeriod ||
          (subscription?.currentPeriodStart && subscription?.currentPeriodEnd
            ? `${new Date(subscription.currentPeriodStart).toLocaleDateString()} – ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
            : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })),
        amountDue: statementAmount,
        currency: statementCurrency,
        dueDate: dueNotice?.dueDate || subscription?.currentPeriodEnd || null,
        status: dueUrgency?.label || (subscription?.status === 'trial' ? 'FREE PLAN' : 'CURRENT'),
      },
      recentInvoices: recentInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        subtotal: inv.subtotal,
        volumeDiscount: inv.volumeDiscount,
        total: inv.total,
        status: inv.status,
        paidAt: inv.paidAt,
      })),
    })
  } catch (error) {
    logError('api/billing/statement', error)
    return NextResponse.json({ error: 'Failed to load billing statement' }, { status: 500 })
  }
}
