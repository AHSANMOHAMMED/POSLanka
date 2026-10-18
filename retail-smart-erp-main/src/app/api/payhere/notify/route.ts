import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { payhereTransactions, subscriptions, tenants, pendingCompanies } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { verifyNotificationHash, getPayhereStatusFromCode } from '@/lib/payhere'
import { getNextPeriodDates } from '@/lib/billing/proration'
import { logError } from '@/lib/ai/error-logger'
import { activateCompanyFromPending } from '@/lib/billing/activate-company'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'

// POST /api/payhere/notify - PayHere webhook (server-to-server)
// This is called by PayHere's servers, not by the user's browser
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

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

    // Amount validation: verify PayHere amount matches our expected amount
    if (status === 'success' && payhereAmount) {
      const paidAmount = parseFloat(payhereAmount)
      const expectedAmount = parseFloat(transaction.amount)
      if (isNaN(paidAmount) || isNaN(expectedAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) {
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
            statusMessage: `Amount mismatch: expected ${expectedAmount}, got ${paidAmount}`,
            md5sig,
            updatedAt: new Date(),
          })
          .where(eq(payhereTransactions.id, transaction.id))
        return NextResponse.json({ status: 'ok' })
      }
    }

    // Update transaction record
    await db.update(payhereTransactions)
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
      .where(eq(payhereTransactions.id, transaction.id))

    // On successful payment, activate subscription or create company
    if (status === 'success') {
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
        // Prorated upgrade: apply new tier, keep current period
        updateData.tierId = transaction.newTierId
      } else {
        // Renewal: start new billing period
        const { periodStart, periodEnd } = getNextPeriodDates(now, billingCycle)
        updateData.currentPeriodStart = periodStart
        updateData.currentPeriodEnd = periodEnd
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
