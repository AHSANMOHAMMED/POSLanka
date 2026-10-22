import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { payhereTransactions } from '@/lib/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { verifyNotificationHash, getPayhereStatusFromCode, isPayhereConfigured } from '@/lib/payhere'
import { logError } from '@/lib/ai/error-logger'
import { readFormData } from '@/lib/api/form-data'
import { activatePaidTransaction } from '@/lib/payhere/activate-payment'

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

    // Idempotency guard: a payment already recorded as success is never re-recorded. If its
    // activation failed earlier (activated_at NULL), this retry applies it now; a failure
    // answers 500 so PayHere notifies again.
    if (transaction.status === 'success') {
      if (!transaction.activatedAt) await activatePaidTransaction(transaction.id)
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
      .where(and(eq(payhereTransactions.id, transaction.id), ne(payhereTransactions.status, 'success')))

    // On successful payment, activate subscription or create company (exactly once, see
    // activatePaidTransaction). Also runs when a concurrent notification recorded the payment
    // first: the row lock + activated_at make the second call a no-op.
    if (status === 'success') {
      await activatePaidTransaction(transaction.id)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    logError('api/payhere/notify', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
