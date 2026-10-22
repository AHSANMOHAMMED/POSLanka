import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { payhereTransactions, subscriptions, tenants, pendingCompanies, pricingTiers, accounts, creditTransactions } from '@/lib/db/schema'
import { and, eq, ne, sql } from 'drizzle-orm'
import { verifyNotificationHash, getPayhereStatusFromCode, isPayhereConfigured } from '@/lib/payhere'
import { getNextPeriodDates, renewalStartDate } from '@/lib/billing/proration'
import { logError } from '@/lib/ai/error-logger'
import { activateCompanyFromPending } from '@/lib/billing/activate-company'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { readFormData } from '@/lib/api/form-data'

// POST /api/payhere/notify - PayHere webhook (server-to-server)
// This is called by PayHere's servers, not by the user's browser
export async function POST(request: NextRequest) {
  try {
    const formData = await readFormData(request)
    if (formData instanceof NextResponse) return formData

    const orderId = formData.get('order_id') as string
    const payhereAmount = formData.get('payhere_amount') as string
    const payhereCurrency = formData.get('payhere_currency') as string
    const statusCode = formData.get('status_code') as string
    const md5sig = formData.get('md5sig') as string
    const payherePaymentId = formData.get('payment_id') as string
    const paymentMethod = formData.get('method') as string
    const statusMessage = formData.get('status_message') as string
    const cardHolderName = formData.get('card_holder_name') as string
    const cardNo = formData.get('card_no') as string

    // An unconfigured merchant secret would make every signature forgeable (MD5 of '')
    if (!isPayhereConfigured()) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 })
    }

    if (!orderId || !statusCode || !md5sig) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify MD5 signature
    const isValid = verifyNotificationHash(orderId, payhereAmount, payhereCurrency, statusCode, md5sig)
    if (!isValid) {
      logError('api/payhere/notify', new Error(`Invalid MD5 signature for order ${orderId}`))
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    // Find the transaction
    const transaction = await db.query.payhereTransactions.findFirst({
      where: eq(payhereTransactions.orderId, orderId),
    })
    if (!transaction) {
      logError('api/payhere/notify', new Error(`Transaction not found for order ${orderId}`))
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    const status = getPayhereStatusFromCode(statusCode)

    // Idempotency guard: if already processed as success, skip reprocessing
    if (transaction.status === 'success') {
      return NextResponse.json({ status: 'ok' })
    }

    // Amount + currency validation: verify PayHere amount matches our expected amount
    if (status === 'success') {
      const paidAmount = parseFloat(payhereAmount)
      const expectedAmount = parseFloat(transaction.amount)
      const currencyOk = !payhereCurrency || !transaction.currency || payhereCurrency === transaction.currency
      if (!currencyOk || isNaN(paidAmount) || isNaN(expectedAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) {
        logError('api/payhere/notify', new Error(
          `Amount mismatch for order ${orderId}: expected ${expectedAmount}, got ${paidAmount}`
        ))
        // Update transaction status to flag it, but do NOT activate
        await db.update(payhereTransactions)
          .set({
            payherePaymentId: payherePaymentId || null,
            status: 'failed',
            paymentMethod: paymentMethod || null,
            statusCode,
            statusMessage: `Amount mismatch: expected ${expectedAmount} ${transaction.currency}, got ${paidAmount} ${payhereCurrency}`,
            md5sig,
            updatedAt: new Date(),
          })
          .where(eq(payhereTransactions.id, transaction.id))
        return NextResponse.json({ status: 'ok' })
      }
    }

    // Update transaction record. Guarded on "not already success" so concurrent / retried
    // notifications cannot both run the activation below (double company creation, etc.).
    const [updatedTxn] = await db.update(payhereTransactions)
      .set({
        payherePaymentId: payherePaymentId || null,
        status,
        paymentMethod: paymentMethod || null,
        statusCode,
        statusMessage: statusMessage || null,
        md5sig,
        cardHolderName: cardHolderName || null,
        cardNo: cardNo || null,
        paidAt: status === 'success' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(payhereTransactions.id, transaction.id), ne(payhereTransactions.status, 'success')))
      .returning({ id: payhereTransactions.id })

    // On successful payment, activate subscription or create company
    if (status === 'success' && updatedTxn) {
      await handleSuccessfulPayment(transaction)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    logError('api/payhere/notify', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function handleSuccessfulPayment(transaction: {
  id: string
  accountId: string
  subscriptionId: string | null
  pendingCompanyId: string | null
  periodMonths: number
  billingCycle: string | null
  newTierId: string | null
  walletCreditApplied: string | null
}) {
  const billingCycle = (transaction.billingCycle || 'monthly') as 'monthly' | 'yearly'

  // Case 1: Existing subscription renewal/upgrade
  if (transaction.subscriptionId) {
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, transaction.subscriptionId),
    })
    if (subscription) {
      const now = new Date()

      // If this is a prorated upgrade (newTierId set), apply the tier change
      // and keep the current period dates (customer already paid for this period).
      // For renewals (no newTierId), start a new billing period.
      const isUpgradePayment = !!transaction.newTierId

      const updateData: Record<string, unknown> = {
        status: 'active',
        billingCycle,
        lastPaymentAt: now,
        updatedAt: now,
      }

      if (isUpgradePayment) {
        // Prorated upgrade: apply new tier AND lock in its price — otherwise the next renewal
        // checkout would charge the old (cheaper) grandfathered price for the new plan.
        updateData.tierId = transaction.newTierId
        const newTier = await db.query.pricingTiers.findFirst({
          where: eq(pricingTiers.id, transaction.newTierId!),
          columns: { priceMonthly: true, priceYearly: true },
        })
        if (newTier) {
          updateData.subscribedPriceMonthly = newTier.priceMonthly
          updateData.subscribedPriceYearly = newTier.priceYearly
          updateData.priceLockedAt = now
        }
        // Trial → paid (full price, no proration) or a lapsed period: the payment buys a
        // fresh billing period. A prorated mid-period upgrade keeps the current period.
        const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null
        if (subscription.status === 'trial' || !periodEnd || periodEnd.getTime() <= now.getTime()) {
          const { periodStart, periodEnd: nextEnd } = getNextPeriodDates(now, billingCycle)
          updateData.currentPeriodStart = periodStart
          updateData.currentPeriodEnd = nextEnd
          updateData.trialEndsAt = null
        }
      } else {
        // Renewal: next period starts when the current one ends (early renewal keeps the
        // remaining days), or now if it already lapsed.
        const { periodStart, periodEnd } = getNextPeriodDates(renewalStartDate(now, subscription), billingCycle)
        updateData.currentPeriodStart = periodStart
        updateData.currentPeriodEnd = periodEnd
        if (subscription.status === 'trial') updateData.trialEndsAt = null
      }

      // Wallet part of a split upgrade payment — deducted only now that the card payment
      // succeeded (the upgrade route no longer pre-deducts it).
      const walletPart = Number(transaction.walletCreditApplied || 0)
      if (walletPart > 0) {
        await db.transaction(async (tx) => {
          const [acc] = await tx.update(accounts)
            .set({
              walletBalance: sql`${accounts.walletBalance} - least(${accounts.walletBalance}, ${walletPart.toFixed(2)}::numeric)`,
              updatedAt: now,
            })
            .where(eq(accounts.id, transaction.accountId))
            .returning({ walletBalance: accounts.walletBalance })
          if (acc) {
            await tx.insert(creditTransactions).values({
              accountId: transaction.accountId,
              type: 'debit',
              amount: walletPart.toFixed(2),
              description: 'Wallet portion of plan upgrade (card payment confirmed)',
              balanceAfter: Number(acc.walletBalance).toFixed(2),
              subscriptionId: subscription.id,
            })
          }
        })
      }

      await db.update(subscriptions)
        .set(updateData)
        .where(eq(subscriptions.id, subscription.id))

      // Unlock tenant if locked
      await db.update(tenants)
        .set({
          status: 'active',
          lockedAt: null,
          lockedReason: null,
          deletionScheduledAt: null,
          updatedAt: now,
        })
        .where(eq(tenants.id, subscription.tenantId))

      // Broadcast subscription update
      broadcastAccountChange(transaction.accountId, 'account-subscription', 'updated', subscription.id)
      broadcastAccountChange(transaction.accountId, 'account-wallet', 'updated', transaction.accountId)
    }
  }

  // Case 2: Pending company creation
  if (transaction.pendingCompanyId) {
    const pending = await db.query.pendingCompanies.findFirst({
      where: eq(pendingCompanies.id, transaction.pendingCompanyId),
    })
    if (pending && pending.status === 'pending_payment') {
      await activateCompanyFromPending(pending, billingCycle)
    }
  }
}
