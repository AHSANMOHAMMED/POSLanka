import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts, tenants, subscriptions, pricingTiers, billingInvoices } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { getVolumeDiscountPercentAsync, getVolumeDiscountTiers } from '@/lib/billing/settings'
import { getSubscriptionPrice, isGrandfathered } from '@/lib/billing/pricing'

// GET /api/account/billing - Get billing summary with volume discount
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's currency
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
    })
    const userCurrency = account?.currency || 'LKR'

    // Get all active companies where user is the billing account
    const companies = await db
      .select({
        tenant: tenants,
        subscription: subscriptions,
        tier: pricingTiers,
      })
      .from(subscriptions)
      .innerJoin(tenants, eq(subscriptions.tenantId, tenants.id))
      .innerJoin(pricingTiers, eq(subscriptions.tierId, pricingTiers.id))
      .where(
        and(
          eq(subscriptions.billingAccountId, session.user.accountId),
          eq(tenants.status, 'active')
        )
      )

    // Calculate billing
    const activeCompanies = companies.filter(c =>
      c.subscription.status === 'active' || c.subscription.status === 'trial'
    )

    const companyCount = activeCompanies.length
    const discountPercent = await getVolumeDiscountPercentAsync(companyCount)

    const lineItems = activeCompanies.map(c => {
      const billingCycle = (c.subscription.billingCycle || 'monthly') as 'monthly' | 'yearly'
      const effectivePrice = getSubscriptionPrice(c.subscription, c.tier, billingCycle)
      const grandfathered = isGrandfathered(c.subscription, c.tier)

      return {
        tenantId: c.tenant.id,
        tenantName: c.tenant.name,
        tierName: c.tier.displayName,
        priceMonthly: billingCycle === 'yearly' ? effectivePrice / 12 : effectivePrice,
        tierCurrency: c.tier.currency || 'LKR',
        status: c.subscription.status,
        trialEndsAt: c.subscription.trialEndsAt,
        grandfathered,
        currentTierPrice: c.tier.priceMonthly ? parseFloat(c.tier.priceMonthly) : null,
      }
    })

    // Calculate subtotal (exclude trials)
    const subtotal = lineItems
      .filter(item => item.status === 'active')
      .reduce((sum, item) => sum + item.priceMonthly, 0)

    const discount = subtotal * (discountPercent / 100)
    const total = subtotal - discount

    // Get recent invoices
    const recentInvoices = await db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.accountId, session.user.accountId))
      .orderBy(desc(billingInvoices.createdAt))
      .limit(10)

    return NextResponse.json({
      summary: {
        companyCount,
        discountPercent,
        subtotal,
        discount,
        total,
        currency: 'LKR',
      },
      lineItems,
      userCurrency,
      discountTiers: (await getVolumeDiscountTiers()).map(t => ({
        minCompanies: t.min,
        discount: t.percent,
      })),
      recentInvoices: recentInvoices.map(inv => ({
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
    logError('api/account/billing', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
