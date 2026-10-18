import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { accounts, subscriptions, payhereTransactions, pricingTiers, pendingCompanies } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generateOrderId, generateCheckoutParams, isPayhereConfigured } from '@/lib/payhere'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { payhereCheckoutSchema } from '@/lib/validation/schemas/public'

// POST /api/payhere/checkout - Generate PayHere checkout params
export async function POST(request: NextRequest) {
  try {
    if (!isPayhereConfigured()) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 })
    }

    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, payhereCheckoutSchema)
    if (!parsed.success) return parsed.response
    const {
      subscriptionId,
      pendingCompanyId,
      tierId,
      billingCycle,
      newTierId,             // For upgrades: the tier to apply after payment
      walletCreditApplied,   // For upgrades: amount already deducted from wallet
      amount: overrideAmount, // For upgrades: prorated amount (overrides tier price)
    } = parsed.data

    // Get account details
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Get pricing tier
    const tier = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, tierId),
    })
    if (!tier) {
      return NextResponse.json({ error: 'Pricing tier not found' }, { status: 404 })
    }

    // Verify ownership of pendingCompanyId (must belong to this account)
    if (pendingCompanyId) {
      const pending = await db.query.pendingCompanies.findFirst({
        where: eq(pendingCompanies.id, pendingCompanyId),
        columns: { accountId: true, status: true },
      })
      if (!pending || pending.accountId !== session.user.accountId) {
        return NextResponse.json({ error: 'Pending company not found' }, { status: 404 })
      }
      if (pending.status !== 'pending_payment') {
        return NextResponse.json({ error: 'Pending company is not awaiting payment' }, { status: 400 })
      }
    }

    // For existing subscriptions, verify ownership and use the locked-in (grandfathered) price
    let subscribedPrice: number | null = null
    if (subscriptionId) {
      const sub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.id, subscriptionId),
      })
      if (!sub || sub.billingAccountId !== session.user.accountId) {
        return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
      }
      subscribedPrice = billingCycle === 'yearly'
        ? (sub.subscribedPriceYearly ? Number(sub.subscribedPriceYearly) : null)
        : (sub.subscribedPriceMonthly ? Number(sub.subscribedPriceMonthly) : null)
    }

    // Determine expected price: grandfathered price for renewals, tier price for new
    const expectedPrice = subscribedPrice ?? (billingCycle === 'yearly'
      ? Number(tier.priceYearly)
      : Number(tier.priceMonthly))

    // Use override amount for prorated upgrades, but validate it
    let price: number
    if (overrideAmount) {
      const overrideValue = Number(overrideAmount)
      // Override amount must be positive and cannot exceed the full tier price
      // (prorated amounts should be less than or equal to the full price)
      const maxPrice = billingCycle === 'yearly' ? Number(tier.priceYearly) : Number(tier.priceMonthly)
      if (isNaN(overrideValue) || overrideValue <= 0 || overrideValue > maxPrice) {
        return NextResponse.json({ error: 'Invalid payment amount' }, { status: 400 })
      }
      price = overrideValue
    } else {
      price = expectedPrice
    }

    if (price <= 0) {
      return NextResponse.json({ error: 'Cannot checkout for free tier' }, { status: 400 })
    }

    const periodMonths = billingCycle === 'yearly' ? 12 : 1
    const orderId = generateOrderId()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const isUpgrade = !!newTierId && !!subscriptionId
    const description = isUpgrade
      ? `Plan upgrade to ${tier.displayName} - ${billingCycle === 'yearly' ? 'Annual' : 'Monthly'} (prorated)`
      : `${tier.displayName} Plan - ${billingCycle === 'yearly' ? 'Annual' : 'Monthly'}`

    // Create pending transaction record
    await db.insert(payhereTransactions).values({
      accountId: session.user.accountId,
      subscriptionId: subscriptionId || null,
      pendingCompanyId: pendingCompanyId || null,
      orderId,
      amount: price.toFixed(2),
      currency: 'LKR',
      status: 'pending',
      description,
      periodMonths,
      billingCycle,
      newTierId: newTierId || null,
      walletCreditApplied: walletCreditApplied ? String(walletCreditApplied) : '0',
    })

    // Generate checkout form params
    const params = generateCheckoutParams({
      orderId,
      amount: price,
      currency: 'LKR',
      itemDescription: description,
      customerName: account.fullName,
      customerEmail: account.email,
      customerPhone: account.phone || '',
      returnUrl: `${baseUrl}/api/payhere/return?order_id=${orderId}`,
      cancelUrl: `${baseUrl}/api/payhere/cancel?order_id=${orderId}`,
      notifyUrl: `${baseUrl}/api/payhere/notify`,
    })

    return NextResponse.json({
      orderId,
      params,
      checkoutUrl: params.checkout_url,
    })
  } catch (error) {
    logError('api/payhere/checkout', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
