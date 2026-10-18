import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts, paymentDeposits, subscriptions, pendingCompanies } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { validateBody } from '@/lib/validation/helpers'
import { createPaymentDepositSchema } from '@/lib/validation/schemas/account'

// GET - List user's payment deposits
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payments = await db.query.paymentDeposits.findMany({
      where: eq(paymentDeposits.accountId, session.user.accountId),
      with: {
        subscription: {
          with: {
            tenant: true,
            tier: true,
          },
        },
      },
      orderBy: [desc(paymentDeposits.createdAt)],
    })

    return NextResponse.json(payments)
  } catch (error) {
    logError('api/account/payments', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

// POST - Submit a new payment deposit
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, createPaymentDepositSchema)
    if (!parsed.success) return parsed.response
    const {
      subscriptionId,
      pendingCompanyId,
      amount,
      bankReference,
      depositDate,
      notes,
      periodMonths,
      isWalletDeposit,
    } = parsed.data

    // For subscription payments (not wallet, not pending company), validate subscriptionId
    if (!isWalletDeposit && !subscriptionId && !pendingCompanyId) {
      return NextResponse.json(
        { error: 'Subscription or pending company is required' },
        { status: 400 }
      )
    }

    // Get user's currency
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
    })
    const userCurrency = account?.currency || 'LKR'

    // For subscription payments, verify subscription belongs to user
    if (!isWalletDeposit && subscriptionId) {
      const subscription = await db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.id, subscriptionId),
          eq(subscriptions.billingAccountId, session.user.accountId)
        ),
      })

      if (!subscription) {
        return NextResponse.json(
          { error: 'Subscription not found or access denied' },
          { status: 404 }
        )
      }
    }

    // For pending company payments, verify pending company belongs to user
    if (pendingCompanyId) {
      const pending = await db.query.pendingCompanies.findFirst({
        where: and(
          eq(pendingCompanies.id, pendingCompanyId),
          eq(pendingCompanies.accountId, session.user.accountId)
        ),
      })

      if (!pending) {
        return NextResponse.json(
          { error: 'Pending company not found or access denied' },
          { status: 404 }
        )
      }

      if (pending.status !== 'pending_payment') {
        return NextResponse.json(
          { error: 'Pending company is not awaiting payment' },
          { status: 400 }
        )
      }
    }

    // Create payment deposit
    // Format depositDate as YYYY-MM-DD string for Drizzle date type
    const formattedDepositDate = new Date(depositDate).toISOString().split('T')[0]

    const [payment] = await db.insert(paymentDeposits)
      .values({
        accountId: session.user.accountId,
        subscriptionId: isWalletDeposit ? null : subscriptionId || null,
        pendingCompanyId: pendingCompanyId || null,
        amount: String(amount),
        currency: userCurrency,
        bankReference: bankReference || null,
        depositDate: formattedDepositDate,
        notes: notes || null,
        periodMonths: isWalletDeposit ? 0 : periodMonths,
        isWalletDeposit,
        status: 'pending',
      })
      .returning()

    // Update pending company status to pending_approval
    if (pendingCompanyId) {
      await db.update(pendingCompanies)
        .set({
          status: 'pending_approval',
          paymentDepositId: payment.id,
          updatedAt: new Date(),
        })
        .where(eq(pendingCompanies.id, pendingCompanyId))
    }

    broadcastAccountChange(session.user.accountId, 'account-wallet', 'updated', payment.id)

    return NextResponse.json(payment)
  } catch (error) {
    logError('api/account/payments', error)
    return NextResponse.json({ error: 'Failed to submit payment' }, { status: 500 })
  }
}
