import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { subscriptions, pricingTiers, accounts, creditTransactions } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { quotePlanChange } from '@/lib/billing/plan-change'
import { quoteCoupon, recordCouponRedemption } from '@/lib/billing/coupons'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { upgradeSubscriptionSchema } from '@/lib/validation/schemas/account'
import { z } from 'zod'

// POST /api/account/subscriptions/[tenantId]/upgrade - Calculate proration or execute upgrade/downgrade
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = session.user.accountId

    const paramsParsed = validateParams(await params, z.object({ tenantId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { tenantId } = paramsParsed.data
    const parsed = await validateBody(request, upgradeSubscriptionSchema)
    if (!parsed.success) return parsed.response
    const { newTierId, billingCycle, action, couponCode } = parsed.data

    // Verify user is the billing account
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, tenantId),
      with: { tier: true },
    })

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    if (subscription.billingAccountId !== accountId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // Get new tier
    const newTier = await db.query.pricingTiers.findFirst({
      where: and(eq(pricingTiers.id, newTierId), eq(pricingTiers.isActive, true)),
    })
    if (!newTier) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
    }

    const currentTier = subscription.tier
    if (!currentTier) {
      return NextResponse.json({ error: 'Current tier not found' }, { status: 500 })
    }

    // Prevent "changing" to the same tier and same billing cycle
    if (currentTier.id === newTier.id && (subscription.billingCycle || 'monthly') === billingCycle) {
      return NextResponse.json({ error: 'Already on this plan and billing cycle' }, { status: 400 })
    }

    const currentBillingCycle = (subscription.billingCycle || 'monthly') as 'monthly' | 'yearly'
    const quote = quotePlanChange(subscription, currentTier, newTier, billingCycle as 'monthly' | 'yearly')
    if (!quote.ok) {
      return NextResponse.json({ error: quote.error }, { status: 400 })
    }
    const { currentPrice, newPrice } = quote

    // Fetch wallet balance (needed for both preview and execute)
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
    })
    const walletBalance = Number(account?.walletBalance || 0)

    // Promo code: discounts the amount due of an upgrade (never a downgrade credit)
    const grossDue = quote.noProration ? newPrice : quote.proration!.amountDue
    let coupon: { id: string; code: string; label: string; listAmount: number; discount: number; finalAmount: number } | null = null
    if (couponCode) {
      if (grossDue <= 0) {
        return NextResponse.json({ error: 'Promo codes apply only to plan changes that cost money', code: 'COUPON_INVALID' }, { status: 400 })
      }
      const q = await quoteCoupon({ code: couponCode, accountId, tierId: newTier.id, billingCycle: billingCycle as 'monthly' | 'yearly', amount: grossDue })
      if (!q.ok) return NextResponse.json({ error: q.error, code: 'COUPON_INVALID' }, { status: 400 })
      coupon = { id: q.coupon.id, code: q.code, label: q.label, listAmount: q.listAmount, discount: q.discount, finalAmount: q.finalAmount }
    }
    const couponInfo = coupon ? { code: coupon.code, label: coupon.label, discount: coupon.discount, amountBeforeDiscount: coupon.listAmount } : undefined

    // For trial subscriptions, no proration needed - full price for new plan
    if (quote.noProration) {
      if (action === 'preview') {
        return NextResponse.json({
          currentTier: { id: currentTier.id, name: currentTier.displayName, price: currentPrice },
          newTier: { id: newTier.id, name: newTier.displayName, price: newPrice },
          amountDue: coupon ? coupon.finalAmount : newPrice,
          isUpgrade: true,
          billingCycle,
          noProration: true,
          walletBalance,
          coupon: couponInfo,
        })
      }

      // For trial → paid, require PayHere payment (return info for checkout; the checkout
      // re-validates and applies the promo code server-side)
      return NextResponse.json({
        requiresPayment: true,
        newTierId,
        amount: coupon ? coupon.finalAmount : newPrice,
        billingCycle,
        subscriptionId: subscription.id,
        couponCode: coupon?.code,
      })
    }

    const proration = quote.proration!

    // Determine if billing cycle is changing
    const cycleChanging = currentBillingCycle !== billingCycle

    if (action === 'preview') {
      return NextResponse.json({
        currentTier: { id: currentTier.id, name: currentTier.displayName, price: currentPrice },
        newTier: { id: newTier.id, name: newTier.displayName, price: newPrice },
        proration: {
          daysRemaining: proration.daysRemaining,
          totalDaysInPeriod: proration.totalDaysInPeriod,
          creditAmount: proration.creditAmount,
          newPlanCost: proration.newPlanCost,
        },
        amountDue: coupon ? coupon.finalAmount : proration.amountDue,
        isUpgrade: proration.isUpgrade,
        billingCycle,
        currentBillingCycle,
        cycleChanging,
        walletBalance,
        coupon: couponInfo,
      })
    }

    // === EXECUTE the upgrade/downgrade ===

    // Edge case: amountDue is 0 (same effective price, e.g. billing cycle switch)
    if (proration.amountDue === 0) {
      await db.update(subscriptions)
        .set({
          tierId: newTierId,
          billingCycle,
          subscribedPriceMonthly: newTier.priceMonthly,
          subscribedPriceYearly: newTier.priceYearly,
          priceLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, subscription.id))

      broadcastAccountChange(accountId, 'account-subscription', 'updated', subscription.id)

      return NextResponse.json({ success: true, amountDue: 0 })
    }

    // UPGRADE: amountDue > 0 (less the promo code discount)
    if (proration.amountDue > 0) {
      const due = coupon ? coupon.finalAmount : proration.amountDue
      if (walletBalance >= due) {
        // Wallet covers the full amount - deduct and apply atomically. The debit is a
        // conditional decrement so two concurrent requests cannot both spend the same balance.
        const debited = await db.transaction(async (tx) => {
          // Guard on the plan we priced so a double-submit cannot charge twice
          const [changed] = await tx.update(subscriptions)
            .set({
              tierId: newTierId,
              billingCycle,
              subscribedPriceMonthly: newTier.priceMonthly,
              subscribedPriceYearly: newTier.priceYearly,
              priceLockedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(and(
              eq(subscriptions.id, subscription.id),
              eq(subscriptions.tierId, currentTier.id),
              sql`coalesce(${subscriptions.billingCycle}, 'monthly') = ${currentBillingCycle}`,
            ))
            .returning({ id: subscriptions.id })
          if (!changed) return null

          const [row] = await tx.update(accounts)
            .set({
              walletBalance: sql`${accounts.walletBalance} - ${due.toFixed(2)}::numeric`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(accounts.id, accountId),
              sql`${accounts.walletBalance} >= ${due.toFixed(2)}::numeric`,
            ))
            .returning({ walletBalance: accounts.walletBalance })
          if (!row) throw new Error('WALLET_INSUFFICIENT') // rolls back the plan change
          const newBalance = Number(row.walletBalance)

          if (due > 0) {
            await tx.insert(creditTransactions).values({
              accountId: accountId,
              type: 'debit',
              amount: due.toFixed(2),
              description: `Plan upgrade: ${currentTier.displayName} → ${newTier.displayName} (prorated)${coupon ? `, promo ${coupon.code} −${coupon.discount.toFixed(2)}` : ''}`,
              balanceAfter: newBalance.toFixed(2),
              subscriptionId: subscription.id,
            })
          }
          // Promo code use, counted with the wallet charge (same transaction)
          if (coupon) {
            await recordCouponRedemption(tx, {
              couponId: coupon.id,
              couponCode: coupon.code,
              accountId,
              source: 'wallet',
              subscriptionId: subscription.id,
              listAmount: coupon.listAmount,
              discountAmount: coupon.discount,
              paidAmount: due,
            })
          }
          return newBalance
        }).catch((err) => {
          if (err instanceof Error && err.message === 'WALLET_INSUFFICIENT') return null
          throw err
        })

        if (debited === null) {
          return NextResponse.json({ error: 'Subscription or wallet balance changed. Please refresh and try again.' }, { status: 409 })
        }

        broadcastAccountChange(accountId, 'account-subscription', 'updated', subscription.id)
        broadcastAccountChange(accountId, 'account-wallet', 'updated', accountId)

        return NextResponse.json({
          success: true,
          paidFromWallet: true,
          amountCharged: due,
          newWalletBalance: debited,
          coupon: couponInfo,
        })
      }

      // Wallet insufficient - wallet covers part, PayHere the remainder. The wallet part is
      // NOT deducted here: /api/payhere/checkout re-computes the split server-side and the
      // PayHere notify webhook deducts it only once the card payment succeeds — so an
      // abandoned / failed payment no longer silently empties the wallet.
      const walletCredit = walletBalance > 0 ? walletBalance : 0
      const paymentNeeded = Math.round((due - walletCredit) * 100) / 100

      // Return info for PayHere checkout - include newTierId so checkout can store it
      return NextResponse.json({
        requiresPayment: true,
        newTierId,
        amount: paymentNeeded,
        walletCredit,
        billingCycle,
        subscriptionId: subscription.id,
        couponCode: coupon?.code,
      })
    }

    // DOWNGRADE: amountDue < 0 - credit the difference to wallet atomically
    const creditAmount = Math.abs(proration.amountDue)

    const newBalance = await db.transaction(async (tx) => {
      // Apply the plan change first, guarded on the plan we priced: a double-submitted
      // downgrade must not credit the wallet twice.
      const [changed] = await tx.update(subscriptions)
        .set({
          tierId: newTierId,
          billingCycle,
          subscribedPriceMonthly: newTier.priceMonthly,
          subscribedPriceYearly: newTier.priceYearly,
          priceLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(subscriptions.id, subscription.id),
          eq(subscriptions.tierId, currentTier.id),
          sql`coalesce(${subscriptions.billingCycle}, 'monthly') = ${currentBillingCycle}`,
        ))
        .returning({ id: subscriptions.id })
      if (!changed) return null

      const [row] = await tx.update(accounts)
        .set({
          walletBalance: sql`${accounts.walletBalance} + ${creditAmount.toFixed(2)}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, accountId))
        .returning({ walletBalance: accounts.walletBalance })
      const balanceAfter = Number(row?.walletBalance ?? 0)

      await tx.insert(creditTransactions).values({
        accountId: accountId,
        type: 'credit',
        amount: creditAmount.toFixed(2),
        description: `Plan downgrade credit: ${currentTier.displayName} → ${newTier.displayName} (prorated)`,
        balanceAfter: balanceAfter.toFixed(2),
        subscriptionId: subscription.id,
      })
      return balanceAfter
    })

    if (newBalance === null) {
      return NextResponse.json({ error: 'Subscription changed in the meantime. Please refresh and try again.' }, { status: 409 })
    }

    broadcastAccountChange(accountId, 'account-subscription', 'updated', subscription.id)
    broadcastAccountChange(accountId, 'account-wallet', 'updated', accountId)

    return NextResponse.json({
      success: true,
      creditApplied: creditAmount,
      newWalletBalance: newBalance,
    })
  } catch (error) {
    logError('api/account/subscriptions/[tenantId]/upgrade', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
