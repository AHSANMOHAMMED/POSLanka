import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { accountAuth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { payhereTransactions } from '@/lib/db/schema'
import { createWebXPayCheckout, webxpayConfig } from '@/lib/webxpay'
import { validateBody } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'

const schema = z.object({
  /** Must already exist as a pending payhere_transactions.order_id for this account. */
  orderId: z.string().min(1).max(100),
  amount: z.coerce.number().positive(),
  currency: z.string().default('LKR'),
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
})

/**
 * POST /api/webxpay/checkout — signed fields for an *existing* pending billing order.
 * Does not invent transactions: orderId must belong to the signed-in account and match amount.
 */
export async function POST(request: NextRequest) {
  const session = await accountAuth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!webxpayConfig.configured) {
    return NextResponse.json({ error: 'WebXPay not configured' }, { status: 503 })
  }

  const parsed = await validateBody(request, schema)
  if (!parsed.success) return parsed.response

  try {
    const accountId = (session.user as { accountId?: string }).accountId
    if (!accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const txn = await db.query.payhereTransactions.findFirst({
      where: and(
        eq(payhereTransactions.orderId, parsed.data.orderId),
        eq(payhereTransactions.accountId, accountId),
      ),
    })
    if (!txn || txn.status !== 'pending') {
      return NextResponse.json({ error: 'Unknown or already-paid order' }, { status: 404 })
    }

    const expected = parseFloat(String(txn.amount))
    if (isNaN(expected) || Math.abs(expected - parsed.data.amount) > 0.01) {
      return NextResponse.json({ error: 'Amount does not match the pending order' }, { status: 400 })
    }
    if (parsed.data.currency && txn.currency && parsed.data.currency !== txn.currency) {
      return NextResponse.json({ error: 'Currency does not match the pending order' }, { status: 400 })
    }

    const checkout = createWebXPayCheckout({
      ...parsed.data,
      amount: expected,
      currency: txn.currency || parsed.data.currency || 'LKR',
    })
    return NextResponse.json(checkout)
  } catch (error) {
    logError('api/webxpay/checkout', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 500 },
    )
  }
}
