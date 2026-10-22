import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { accountAuth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts, subscriptions, payhereTransactions, pricingTiers, pendingCompanies } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { quotePlanChange } from '@/lib/billing/plan-change'
import { getSubscriptionPrice } from '@/lib/billing/pricing'
import { quoteCoupon } from '@/lib/billing/coupons'
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

    // The billing pages live in the account portal (account-session cookie); fall back to a
    // company session that carries an accountId (portal → company transfer).
    let accountId: string | null | undefined
    try { accountId = (await accountAuth())?.user?.accountId } catch { accountId = null }
    if (!accountId) {
      const companySession = await auth()
      accountId = companySession?.user?.accountId
    }
    if (!accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, payhereCheckoutSchema)
    if (!parsed.success) return parsed.response
    const {
      subscriptionId,
      pendingCompanyId,
      tierId,
      billingCycle: requestedCycle,
      newTierId,             // For upgrades: the tier to apply after payment
      couponCode,            // Promo code: validated and priced here
      // `walletCreditApplied` and `amount` from the client are ignored — both are computed below
    } = parsed.data

    // Get account details
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // ---- Server-side pricing -------------------------------------------------------
    // Never trust the client for WHAT is bought or HOW MUCH it costs: the tier comes from the
    // pending company / subscription, and upgrade amounts are re-quoted here. (Previously the
    // body's `tierId` and `amount` were used, so a renewal or upgrade could be bought for
    // 1 LKR, or a premium pending company paid at the cheapest tier's price.)
    let billingCycle: 'monthly' | 'yearly' = requestedCycle
    let tier: typeof pricingTiers.$inferSelect | undefined
    let price: number
    let walletCredit = 0
    let upgradeTierId: string | null = null
    // Promo code: applied to the amount due before any wallet part
    let coupon: { id: string; code: string; listAmount: number; discount: number } | null = null
    const applyCoupon = async (amount: number, tierForCoupon: string | null): Promise<NextResponse | number> => {
      if (!couponCode) return amount
      const q = await quoteCoupon({ code: couponCode, accountId: accountId!, tierId: tierForCoupon, billingCycle, amount })
      if (!q.ok) return NextResponse.json({ error: q.error, code: 'COUPON_INVALID' }, { status: 400 })
      if (q.finalAmount <= 0) {
        return NextResponse.json({ error: 'This promo code covers the whole amount, so no card payment is needed. Contact support to apply it.', code: 'COUPON_COVERS_ALL' }, { status: 400 })
      }
      coupon = { id: q.coupon.id, code: q.code, listAmount: q.listAmount, discount: q.discount }
      return q.finalAmount
    }

    if (pendingCompanyId && subscriptionId) {
      return NextResponse.json({ error: 'Provide either subscriptionId or pendingCompanyId' }, { status: 400 })
    }

    if (pendingCompanyId) {
      // Verify ownership of pendingCompanyId (must belong to this account)
      const pending = await db.query.pendingCompanies.findFirst({
        where: eq(pendingCompanies.id, pendingCompanyId),
        columns: { accountId: true, status: true, tierId: true, billingCycle: true },
      })
      if (!pending || pending.accountId !== accountId) {
        return NextResponse.json({ error: 'Pending company not found' }, { status: 404 })
      }
      if (pending.status !== 'pending_payment') {
        return NextResponse.json({ error: 'Pending company is not awaiting payment' }, { status: 400 })
      }
      billingCycle = pending.billingCycle === 'yearly' ? 'yearly' : 'monthly'
      tier = await db.query.pricingTiers.findFirst({ where: eq(pricingTiers.id, pending.tierId) })
      if (!tier) return NextResponse.json({ error: 'Pricing tier not found' }, { status: 404 })
      price = billingCycle === 'yearly' ? Number(tier.priceYearly) : Number(tier.priceMonthly)
      const discounted = await applyCoupon(price, tier.id)
      if (discounted instanceof NextResponse) return discounted
      price = discounted
    } else if (subscriptionId) {
      // For existing subscriptions, verify ownership and use the locked-in (grandfathered) price
      const sub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.id, subscriptionId),
        with: { tier: true },
      })
      if (!sub || sub.billingAccountId !== accountId) {
        return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
      }
      if (!sub.tier) return NextResponse.json({ error: 'Pricing tier not found' }, { status: 404 })

      if (newTierId) {
        // Upgrade: amount = server-side proration quote (same as /upgrade), minus wallet part
        const newTier = await db.query.pricingTiers.findFirst({
          where: and(eq(pricingTiers.id, newTierId), eq(pricingTiers.isActive, true)),
        })
        if (!newTier) return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
        const quote = quotePlanChange(sub, sub.tier, newTier, billingCycle)
        if (!quote.ok) return NextResponse.json({ error: quote.error }, { status: 400 })
        if (quote.amountDue <= 0) {
          return NextResponse.json({ error: 'No payment is needed for this plan change' }, { status: 400 })
        }
        const due = await applyCoupon(quote.amountDue, newTier.id)
        if (due instanceof NextResponse) return due
        if (!quote.noProration) {
          const walletBalance = Math.max(0, Number(account.walletBalance || 0))
          walletCredit = Math.min(walletBalance, due)
          if (walletCredit >= due) {
            return NextResponse.json({ error: 'Your wallet covers this change; no card payment is needed' }, { status: 400 })
          }
        }
        price = Math.round((due - walletCredit) * 100) / 100
        tier = newTier
        upgradeTierId = newTier.id
      } else {
        // Renewal of the CURRENT plan at the subscriber's locked-in price
        tier = sub.tier
        price = getSubscriptionPrice(sub, sub.tier, billingCycle)
        const discounted = await applyCoupon(price, sub.tier.id)
        if (discounted instanceof NextResponse) return discounted
        price = discounted
      }
    } else {
      return NextResponse.json({ error: 'subscriptionId or pendingCompanyId is required' }, { status: 400 })
    }
    void tierId // kept in the request schema for older clients; no longer used for pricing

    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: 'Cannot checkout for free tier' }, { status: 400 })
    }

    const couponApplied = coupon as { id: string; code: string; listAmount: number; discount: number } | null
    const periodMonths = billingCycle === 'yearly' ? 12 : 1
    const orderId = generateOrderId()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const isUpgrade = !!upgradeTierId
    const description = isUpgrade
      ? `Plan upgrade to ${tier.displayName} - ${billingCycle === 'yearly' ? 'Annual' : 'Monthly'} (prorated)`
      : `${tier.displayName} Plan - ${billingCycle === 'yearly' ? 'Annual' : 'Monthly'}`
    const itemDescription = couponApplied ? `${description} (promo ${couponApplied.code})` : description

    // Create pending transaction record
    await db.insert(payhereTransactions).values({
      accountId: accountId,
      subscriptionId: subscriptionId || null,
      pendingCompanyId: pendingCompanyId || null,
      orderId,
      amount: price.toFixed(2),
      currency: 'LKR',
      status: 'pending',
      description,
      periodMonths,
      billingCycle,
      newTierId: upgradeTierId,
      // Deducted from the wallet by the notify webhook only when the payment succeeds
      walletCreditApplied: walletCredit.toFixed(2),
      // Promo code: the use is counted by the notify webhook only when the payment succeeds
      ...(couponApplied ? {
        couponId: couponApplied.id,
        couponCode: couponApplied.code,
        listAmount: couponApplied.listAmount.toFixed(2),
        discountAmount: couponApplied.discount.toFixed(2),
      } : {}),
    })

    // Generate checkout form params
    const params = generateCheckoutParams({
      orderId,
      amount: price,
      currency: 'LKR',
      itemDescription: itemDescription,
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
      amount: price,
      ...(couponApplied ? { coupon: { code: couponApplied.code, listAmount: couponApplied.listAmount, discount: couponApplied.discount } } : {}),
    })
  } catch (error) {
    logError('api/payhere/checkout', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
