import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  paymentDeposits,
  subscriptions,
  pendingCompanies,
  tenants,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sysUpdatePaymentSchema } from '@/lib/validation/schemas/sys-control'
import { activateCompanyFromPending, notifyPendingCompanyRejected, ActivationError } from '@/lib/billing/activate-company'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting
    const rateLimited = await withRateLimit('/api/sys-control/payments', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    // Handle approval — perform activation BEFORE marking payment as approved
    if (status === 'approved') {
      // Case 1: Pending company payment - create the company
      if (payment.pendingCompanyId) {
        const pending = await db.query.pendingCompanies.findFirst({
          where: eq(pendingCompanies.id, payment.pendingCompanyId),
        })

        if (!pending || (pending.status !== 'pending_approval' && pending.status !== 'pending_payment')) {
          return NextResponse.json({
            error: 'Pending company is not in a valid state for activation',
          }, { status: 400 })
        }

        try {
          const billingCycle = (pending.billingCycle || 'monthly') as 'monthly' | 'yearly'
          await activateCompanyFromPending(pending, billingCycle)
        } catch (err) {
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
          const currentEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : now
          const newEnd = new Date(Math.max(currentEnd.getTime(), now.getTime()))
          newEnd.setMonth(newEnd.getMonth() + payment.periodMonths)

          await db.update(subscriptions)
            .set({
              status: 'active',
              currentPeriodStart: subscription.currentPeriodStart || now,
              currentPeriodEnd: newEnd,
              lastPaymentAt: now,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, payment.subscriptionId))

          // Unlock tenant if locked
          if (subscription.tenantId) {
            await db.update(tenants)
              .set({
                status: 'active',
                lockedAt: null,
                lockedReason: null,
                deletionScheduledAt: null,
                updatedAt: now,
              })
              .where(eq(tenants.id, subscription.tenantId))
          }

          // Broadcast subscription renewal
          if (payment.accountId) {
            broadcastAccountChange(payment.accountId, 'account-subscription', 'updated', subscription.id)
          }
        }
      }
      // Case 3: Wallet deposit is handled by another flow (credit transaction)
    }

    // Now mark payment as approved/rejected (after activation succeeded)
    await db.update(paymentDeposits)
      .set({
        status,
        reviewNotes: reviewNotes ? `[Admin Review] ${reviewNotes}` : '[Admin Review]',
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentDeposits.id, id))

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
