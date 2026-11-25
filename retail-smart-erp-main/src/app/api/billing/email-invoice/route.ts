import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { db } from '@/lib/db'
import { accounts, pricingTiers, subscriptions, tenants, tenantUsage } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { foldTenantUsage } from '@/lib/db/storage-quota'
import { readDueNoticeFromSettings } from '@/lib/tenant/lock-message'
import { getSubscriptionPrice } from '@/lib/billing/pricing'
import { sendBillingStatementEmail } from '@/lib/email/billing-email'
import { logError } from '@/lib/ai/error-logger'

const BILLING_ROLES = new Set(['owner', 'manager', 'system_manager'])

/**
 * POST /api/billing/email-invoice
 * Sends the current billing statement / due invoice / payment receipt to the company's Primary Owner email.
 */
export async function POST() {
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
    })
    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, tenantId),
    })
    const ownerAccountId = subscription?.billingAccountId || tenant.primaryOwnerId
    const ownerAccount = ownerAccountId
      ? await db.query.accounts.findFirst({
          where: eq(accounts.id, ownerAccountId),
          columns: { email: true, fullName: true },
        })
      : null

    const recipientEmail = ownerAccount?.email || tenant.email
    if (!recipientEmail) {
      return NextResponse.json({ error: 'No owner email address is configured for this company' }, { status: 400 })
    }

    const tier = subscription
      ? await db.query.pricingTiers.findFirst({
          where: eq(pricingTiers.id, subscription.tierId),
        })
      : null

    await foldTenantUsage(tenantId)
    const usage = await db.query.tenantUsage.findFirst({
      where: eq(tenantUsage.tenantId, tenantId),
    })

    const dueNotice = readDueNoticeFromSettings(tenant.settings)
    const billingCycle = (subscription?.billingCycle || 'monthly') as 'monthly' | 'yearly'
    const planPrice = subscription && tier ? getSubscriptionPrice(subscription, tier, billingCycle) : 0
    const amountDue =
      dueNotice?.dueAmount && dueNotice.dueAmount > 0
        ? dueNotice.dueAmount
        : subscription?.status === 'active'
        ? planPrice
        : 0
    const currency = dueNotice?.dueCurrency || tier?.currency || tenant.currency || 'LKR'
    const statementNo = `STMT-${tenant.slug.toUpperCase().slice(0, 8)}-${new Date().toISOString().slice(0, 7).replace('-', '')}`
    const periodLabel =
      dueNotice?.billingPeriod ||
      (subscription?.currentPeriodStart && subscription?.currentPeriodEnd
        ? `${new Date(subscription.currentPeriodStart).toLocaleDateString()} – ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
        : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const result = await sendBillingStatementEmail({
      to: recipientEmail,
      ownerName: ownerAccount?.fullName || tenant.name,
      companyName: tenant.name,
      statementNo,
      billingPeriod: periodLabel,
      tierName: tier?.displayName || 'Platform',
      amountDue,
      currency,
      dueDate: dueNotice?.dueDate || (subscription?.currentPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null),
      dueTime: dueNotice?.dueTime || null,
      usage: usage
        ? {
            databaseBytes: usage.storageBytes || 0,
            fileStorageBytes: usage.fileStorageBytes || 0,
            usersCount: usage.usersCount || 0,
            salesCount: usage.salesCount || 0,
            itemsCount: usage.itemsCount || 0,
            customersCount: usage.customersCount || 0,
          }
        : null,
      dueNotice,
      billingUrl: appUrl ? `${appUrl}/c/${tenant.slug}/billing` : undefined,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Email service failed' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      sentTo: recipientEmail,
      message: `Billing statement emailed to ${recipientEmail}`,
    })
  } catch (error) {
    logError('api/billing/email-invoice', error)
    return NextResponse.json({ error: 'Failed to email billing statement' }, { status: 500 })
  }
}
