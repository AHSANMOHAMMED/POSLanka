import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { subscriptions, pricingTiers, accounts, creditTransactions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { calculateProration, getPriceForCycle } from '@/lib/billing/proration'
import { getSubscriptionPrice } from '@/lib/billing/pricing'
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
    const { newTierId, billingCycle, action } = parsed.data

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
    const currentPrice = getSubscriptionPrice(subscription, currentTier, currentBillingCycle)
    const newPrice = getPriceForCycle(
      Number(newTier.priceMonthly),
      Number(newTier.priceYearly),
      billingCycle as 'monthly' | 'yearly'
    )

    // Fetch wallet balance (needed for both preview and execute)
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
    })
    const walletBalance = Number(account?.walletBalance || 0)

    // For trial subscriptions, no proration needed - full price for new plan
    if (subscription.status === 'trial') {
      if (action === 'preview') {
        return NextResponse.json({
          currentTier: { id: currentTier.id, name: currentTier.displayName, price: currentPrice },
          newTier: { id: newTier.id, name: newTier.displayName, price: newPrice },
          amountDue: newPrice,
          isUpgrade: true,
          billingCycle,
          noProration: true,
          walletBalance,
        })
      }

      // For trial → paid, require PayHere payment (return info for checkout)
      return NextResponse.json({
        requiresPayment: true,
        newTierId,
        amount: newPrice,
        billingCycle,
        subscriptionId: subscription.id,
      })
    }

    // Calculate proration for paid plan changes
    if (!subscription.currentPeriodStart || !subscription.currentPeriodEnd) {
      return NextResponse.json({ error: 'Subscription period not set' }, { status: 400 })
    }

    const proration = calculateProration({
      currentPlanPrice: currentPrice,
      newPlanPrice: newPrice,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
    })

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
        amountDue: proration.amountDue,
        isUpgrade: proration.isUpgrade,
        billingCycle,
        currentBillingCycle,
        cycleChanging,
        walletBalance,
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

    // UPGRADE: amountDue > 0
    if (proration.amountDue > 0) {
      if (walletBalance >= proration.amountDue) {
        // Wallet covers the full amount - deduct and apply atomically
        const newBalance = Math.round((walletBalance - proration.amountDue) * 100) / 100

        await db.transaction(async (tx) => {
          await tx.update(accounts)
            .set({ walletBalance: newBalance.toFixed(2), updatedAt: new Date() })
            .where(eq(accounts.id, accountId))

          await tx.insert(creditTransactions).values({
            accountId: accountId,
            type: 'debit',
            amount: proration.amountDue.toFixed(2),
            description: `Plan upgrade: ${currentTier.displayName} → ${newTier.displayName} (prorated)`,
            balanceAfter: newBalance.toFixed(2),
            subscriptionId: subscription.id,
          })

          await tx.update(subscriptions)
            .set({
              tierId: newTierId,
              billingCycle,
              subscribedPriceMonthly: newTier.priceMonthly,
              subscribedPriceYearly: newTier.priceYearly,
              priceLockedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, subscription.id))
        })

        broadcastAccountChange(accountId, 'account-subscription', 'updated', subscription.id)
        broadcastAccountChange(accountId, 'account-wallet', 'updated', accountId)

        return NextResponse.json({
          success: true,
          paidFromWallet: true,
          amountCharged: proration.amountDue,
          newWalletBalance: newBalance,
        })
      }

      // Wallet insufficient - partial wallet deduction + PayHere for remainder
      const walletCredit = walletBalance > 0 ? walletBalance : 0
      const paymentNeeded = Math.round((proration.amountDue - walletCredit) * 100) / 100

      // If wallet has balance, deduct atomically (will be recorded in credit transaction)
      if (walletCredit > 0) {
        await db.transaction(async (tx) => {
          await tx.update(accounts)
            .set({ walletBalance: '0.00', updatedAt: new Date() })
            .where(eq(accounts.id, accountId))

          await tx.insert(creditTransactions).values({
            accountId: accountId,
            type: 'debit',
            amount: walletCredit.toFixed(2),
            description: `Partial wallet deduction for upgrade: ${currentTier.displayName} → ${newTier.displayName}`,
            balanceAfter: '0.00',
            subscriptionId: subscription.id,
          })
        })
      }

      // Return info for PayHere checkout - include newTierId so checkout can store it
      return NextResponse.json({
        requiresPayment: true,
        newTierId,
        amount: paymentNeeded,
        walletCredit,
        billingCycle,
        subscriptionId: subscription.id,
      })
    }

    // DOWNGRADE: amountDue < 0 - credit the difference to wallet atomically
    const creditAmount = Math.abs(proration.amountDue)
    const newBalance = Math.round((walletBalance + creditAmount) * 100) / 100

    await db.transaction(async (tx) => {
      await tx.update(accounts)
        .set({ walletBalance: newBalance.toFixed(2), updatedAt: new Date() })
        .where(eq(accounts.id, accountId))

      await tx.insert(creditTransactions).values({
        accountId: accountId,
        type: 'credit',
        amount: creditAmount.toFixed(2),
        description: `Plan downgrade credit: ${currentTier.displayName} → ${newTier.displayName} (prorated)`,
        balanceAfter: newBalance.toFixed(2),
        subscriptionId: subscription.id,
      })

      await tx.update(subscriptions)
        .set({
          tierId: newTierId,
          billingCycle,
          subscribedPriceMonthly: newTier.priceMonthly,
          subscribedPriceYearly: newTier.priceYearly,
          priceLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, subscription.id))
    })

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
