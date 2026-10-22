import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  paymentDeposits,
  subscriptions,
  pendingCompanies,
  tenants,
  accounts,
  creditTransactions,
} from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { adminAuthError, adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sysUpdatePaymentSchema } from '@/lib/validation/schemas/sys-control'
import { activateCompanyFromPending, notifyPendingCompanyRejected, ActivationError } from '@/lib/billing/activate-company'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { renewalStartDate } from '@/lib/billing/proration'
import { syncTenantPlanExpiry } from '@/lib/billing/subscription-state'
import { recordCouponRedemption } from '@/lib/billing/coupons'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting
    const rateLimited = await withRateLimit('/api/sys-control/payments', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession('billing')
    if (!session) {
      return adminAuthError()
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, sysUpdatePaymentSchema)
    if (!parsed.success) return parsed.response
    const { status, reviewNotes } = parsed.data

    // Get the payment
    const payment = await db.query.paymentDeposits.findFirst({
      where: eq(paymentDeposits.id, id),
    })

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (payment.status !== 'pending') {
      return NextResponse.json({ error: 'Payment already processed' }, { status: 400 })
    }

    // Claim the deposit atomically so a double-click / two admins cannot approve it twice
    // (each approval would extend the subscription again or try to create the company twice).
    const [claimed] = await db.update(paymentDeposits)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(paymentDeposits.id, id), eq(paymentDeposits.status, 'pending')))
      .returning({ id: paymentDeposits.id })
    if (!claimed) {
      return NextResponse.json({ error: 'Payment already processed' }, { status: 400 })
    }
    const releaseClaim = () => db.update(paymentDeposits)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(paymentDeposits.id, id))

    // Handle approval — perform activation BEFORE marking payment as approved
    if (status === 'approved') {
      // Case 1: Pending company payment - create the company
      if (payment.pendingCompanyId) {
        const pending = await db.query.pendingCompanies.findFirst({
          where: eq(pendingCompanies.id, payment.pendingCompanyId),
        })

        if (!pending || (pending.status !== 'pending_approval' && pending.status !== 'pending_payment')) {
          await releaseClaim()
          return NextResponse.json({
            error: 'Pending company is not in a valid state for activation',
          }, { status: 400 })
        }

        try {
          const billingCycle = (pending.billingCycle || 'monthly') as 'monthly' | 'yearly'
          await activateCompanyFromPending(pending, billingCycle)
        } catch (err) {
          await releaseClaim()
          if (err instanceof ActivationError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
          }
          throw err
        }
      }
      // Case 2: Existing subscription payment - extend the subscription
      else if (payment.subscriptionId) {
        const subscription = await db.query.subscriptions.findFirst({
          where: eq(subscriptions.id, payment.subscriptionId),
        })

        if (subscription) {
          const now = new Date()
          // Lapsed or trial → the paid months start now; otherwise they extend the current period.
          const newEnd = new Date(renewalStartDate(now, subscription))
          newEnd.setMonth(newEnd.getMonth() + payment.periodMonths)
          const lapsed = subscription.status === 'trial' || !subscription.currentPeriodEnd || subscription.currentPeriodEnd.getTime() <= now.getTime()

          await db.transaction(async (tx) => {
            await tx.update(subscriptions)
              .set({
                status: 'active',
                currentPeriodStart: lapsed ? now : (subscription.currentPeriodStart || now),
                currentPeriodEnd: newEnd,
                trialEndsAt: null,
                lastPaymentAt: now,
                updatedAt: now,
              })
              .where(eq(subscriptions.id, subscription.id))

            // Lift a billing lock only — a vendor suspended or archived by an admin stays that way.
            await tx.update(tenants)
              .set({ status: 'active', lockedAt: null, lockedReason: null, deletionScheduledAt: null, updatedAt: now })
              .where(and(eq(tenants.id, subscription.tenantId), eq(tenants.status, 'locked')))
            await syncTenantPlanExpiry(subscription.tenantId, tx)
          }).catch(async (err) => {
            await releaseClaim() // nothing was applied — leave the slip pending so it can be retried
            throw err
          })

          // Broadcast subscription renewal
          if (payment.accountId) {
            broadcastAccountChange(payment.accountId, 'account-subscription', 'updated', subscription.id)
          }
        }
      }
      // Case 3: Wallet top-up — credit the account wallet (exactly once: the deposit is claimed above)
      else if (payment.isWalletDeposit) {
        const amount = Number(payment.amount)
        await db.transaction(async (tx) => {
          const [acc] = await tx.update(accounts)
            .set({ walletBalance: sql`${accounts.walletBalance} + ${amount.toFixed(2)}::numeric`, updatedAt: new Date() })
            .where(eq(accounts.id, payment.accountId))
            .returning({ walletBalance: accounts.walletBalance })
          if (!acc) throw new Error('Billing account not found')
          await tx.insert(creditTransactions).values({
            accountId: payment.accountId,
            type: 'credit',
            amount: amount.toFixed(2),
            currency: payment.currency,
            description: `Bank transfer top-up${payment.bankReference ? ` (${payment.bankReference})` : ''}`,
            balanceAfter: Number(acc.walletBalance).toFixed(2),
            paymentDepositId: payment.id,
          })
        }).catch(async (err) => {
          await releaseClaim()
          throw err
        })
        broadcastAccountChange(payment.accountId, 'account-wallet', 'updated', payment.accountId)
      }
    }

    // Now mark payment as approved/rejected (after activation succeeded). A promo code on an
    // approved slip is counted in the same transaction (unique per slip: never twice).
    await db.transaction(async (tx) => {
      await tx.update(paymentDeposits)
        .set({
          status,
          reviewNotes: reviewNotes ? `[Admin Review] ${reviewNotes}` : '[Admin Review]',
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(paymentDeposits.id, id))
      if (status === 'approved' && payment.couponCode && !payment.isWalletDeposit) {
        await recordCouponRedemption(tx, {
          couponId: payment.couponId,
          couponCode: payment.couponCode,
          accountId: payment.accountId,
          source: 'bank_deposit',
          paymentDepositId: payment.id,
          subscriptionId: payment.subscriptionId,
          listAmount: payment.listAmount ?? Number(payment.amount) + Number(payment.discountAmount || 0),
          discountAmount: payment.discountAmount || 0,
          paidAmount: payment.amount,
        })
      }
    })

    // Handle rejection for pending company
    if (status === 'rejected' && payment.pendingCompanyId) {
      const pending = await db.query.pendingCompanies.findFirst({
        where: eq(pendingCompanies.id, payment.pendingCompanyId),
      })

      await db.update(pendingCompanies)
        .set({
          status: 'rejected',
          rejectionReason: reviewNotes || 'Payment rejected by admin',
          updatedAt: new Date(),
        })
        .where(eq(pendingCompanies.id, payment.pendingCompanyId))

      // Send rejection notification
      if (pending) {
        await notifyPendingCompanyRejected(
          pending.accountId,
          pending.name,
          reviewNotes || 'Payment rejected by admin',
        )
      }
    }

    // Audit log
    const auditAction = status === 'approved' ? adminAudit.approve : adminAudit.reject
    await auditAction(session.superAdminId, 'payment', id, {
      amount: payment.amount,
      ...(payment.couponCode ? { couponCode: payment.couponCode, discountAmount: payment.discountAmount } : {}),
      reviewNotes,
      subscriptionId: payment.subscriptionId,
      pendingCompanyId: payment.pendingCompanyId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/sys-control/payments/[id]', error)
    return NextResponse.json({ error: 'Failed to update payment' }, { status: 500 })
  }
}
