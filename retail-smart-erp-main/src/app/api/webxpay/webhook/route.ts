import { NextRequest, NextResponse } from 'next/server'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { payhereTransactions } from '@/lib/db/schema'
import { verifyWebXPayWebhook, webxpayConfig } from '@/lib/webxpay'
import { activatePaidTransaction } from '@/lib/payhere/activate-payment'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { clientIp, consumeRateLimit, rateLimitedResponse } from '@/lib/auth/rate-limit'

const webhookSchema = z.object({
  order_id: z.coerce.string().min(1),
  amount: z.coerce.string().min(1),
  currency: z.coerce.string().default('LKR'),
  status: z.coerce.string().min(1),
  signature: z.coerce.string().min(1),
  payment_id: z.coerce.string().optional(),
  method: z.coerce.string().optional(),
  status_message: z.coerce.string().optional(),
}).passthrough()

const WEBHOOK_LIMIT = { maxAttempts: 120, windowMs: 60_000, category: 'webxpay_webhook' }

function mapStatus(raw: string): 'success' | 'failed' | 'pending' | 'cancelled' {
  const s = raw.trim().toLowerCase()
  if (['success', 'successful', 'paid', 'completed', '2', '1'].includes(s)) return 'success'
  if (['cancel', 'canceled', 'cancelled', '0', '-1'].includes(s)) return 'cancelled'
  if (['pending', 'processing'].includes(s)) return 'pending'
  return 'failed'
}

/**
 * POST /api/webxpay/webhook — server-to-server notification.
 * Mirrors PayHere: verify HMAC, match pending order amount, activate exactly once.
 */
export async function POST(request: NextRequest) {
  try {
    const limit = await consumeRateLimit(clientIp(request), WEBHOOK_LIMIT)
    if (limit.limited) return rateLimitedResponse(limit)

    if (!webxpayConfig.configured) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 })
    }

    const parsed = await validateBody(request, webhookSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const ok = verifyWebXPayWebhook({
      order_id: body.order_id,
      amount: body.amount,
      currency: body.currency || 'LKR',
      status: body.status,
      signature: body.signature,
    })
    if (!ok) {
      logError('api/webxpay/webhook', new Error(`Invalid signature for order ${body.order_id}`))
      return NextResponse.json({ error: 'Invalid notification' }, { status: 403 })
    }

    const transaction = await db.query.payhereTransactions.findFirst({
      where: eq(payhereTransactions.orderId, body.order_id),
    })
    if (!transaction) {
      logError('api/webxpay/webhook', new Error(`Transaction not found for order ${body.order_id}`))
      return NextResponse.json({ error: 'Invalid notification' }, { status: 403 })
    }

    const status = mapStatus(body.status)

    if (transaction.status === 'success') {
      if (!transaction.activatedAt) await activatePaidTransaction(transaction.id)
      return NextResponse.json({ status: 'ok' })
    }

    if (status === 'success') {
      const paidAmount = parseFloat(body.amount)
      const expectedAmount = parseFloat(String(transaction.amount))
      const currencyOk = !body.currency || !transaction.currency || body.currency === transaction.currency
      if (!currencyOk || isNaN(paidAmount) || isNaN(expectedAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) {
        logError('api/webxpay/webhook', new Error(
          `Amount mismatch for order ${body.order_id}: expected ${expectedAmount}, got ${paidAmount}`,
        ))
        await db.update(payhereTransactions)
          .set({
            payherePaymentId: body.payment_id || transaction.payherePaymentId,
            status: 'failed',
            paymentMethod: body.method || 'webxpay',
            statusCode: body.status,
            statusMessage: `Amount mismatch: expected ${expectedAmount} ${transaction.currency}, got ${paidAmount} ${body.currency}`,
            updatedAt: new Date(),
          })
          .where(eq(payhereTransactions.id, transaction.id))
        return NextResponse.json({ status: 'ok' })
      }
    }

    await db.update(payhereTransactions)
      .set({
        payherePaymentId: body.payment_id || null,
        status,
        paymentMethod: body.method || 'webxpay',
        statusCode: body.status.slice(0, 10),
        statusMessage: body.status_message || null,
        paidAt: status === 'success' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(payhereTransactions.id, transaction.id), ne(payhereTransactions.status, 'success')))

    if (status === 'success') {
      await activatePaidTransaction(transaction.id)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    logError('api/webxpay/webhook', error)
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 })
  }
}
