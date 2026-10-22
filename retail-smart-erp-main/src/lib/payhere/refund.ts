/**
 * Refund a PayHere card payment through the PayHere Merchant API.
 *
 *   1. OAuth client credentials: POST {base}/merchant/v1/oauth/token
 *        Authorization: Basic base64(PAYHERE_APP_ID:PAYHERE_APP_SECRET), grant_type=client_credentials
 *   2. POST {base}/merchant/v1/payment/refund  { payment_id, description }  (Bearer token)
 *        → { status: 1, msg, data } on success; status <= 0 with msg on failure
 *
 * base = https://sandbox.payhere.lk (PAYHERE_MODE=sandbox, the default) or https://www.payhere.lk.
 * The App ID / secret come from a "Business App" created in the PayHere merchant portal with the
 * Payment Retrieval / Refund permission — they are NOT the merchant id / secret used at checkout.
 *
 * refundPayhereTransaction() makes a refund happen at most once: the transaction row is claimed
 * with a conditional UPDATE (refund_status NULL/failed → processing) before PayHere is called, so
 * a double click or two admins get "already being refunded" instead of a second refund.
 * PayHere's refund API refunds the whole payment (it takes no amount), so only full refunds are offered.
 */
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { payhereTransactions, subscriptions, tenants } from '@/lib/db/schema'
import { PAYHERE_CONFIG } from './config'
import { fetchWithTimeout } from '@/lib/utils/fetch-timeout'

/** A claim older than this (a crash between claim and answer) may be retried. */
const STALE_PROCESSING_MS = 10 * 60 * 1000

export class RefundError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message) }
}

export function payhereApiBase(): string {
  return PAYHERE_CONFIG.mode === 'live' ? 'https://www.payhere.lk' : 'https://sandbox.payhere.lk'
}

export function isPayhereRefundConfigured(): boolean {
  return !!(process.env.PAYHERE_APP_ID && process.env.PAYHERE_APP_SECRET)
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try { return (await res.json()) as Record<string, unknown> } catch { return {} }
}

/** OAuth access token for the merchant API. Throws RefundError. */
export async function getPayhereAccessToken(): Promise<string> {
  const appId = process.env.PAYHERE_APP_ID
  const appSecret = process.env.PAYHERE_APP_SECRET
  if (!appId || !appSecret) {
    throw new RefundError('PayHere refunds are not configured. Set PAYHERE_APP_ID and PAYHERE_APP_SECRET (a PayHere Business App with refund permission) on the server.', 503, 'REFUND_NOT_CONFIGURED')
  }
  const res = await fetchWithTimeout(`${payhereApiBase()}/merchant/v1/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  })
  const body = await readJson(res)
  const token = typeof body.access_token === 'string' ? body.access_token : null
  if (!res.ok || !token) {
    const msg = typeof body.error_description === 'string' ? body.error_description : typeof body.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new RefundError(`PayHere rejected the app credentials (${msg}). Check PAYHERE_APP_ID / PAYHERE_APP_SECRET and PAYHERE_MODE.`, 502, 'REFUND_AUTH_FAILED')
  }
  return token
}

/** Call the refund endpoint. Returns PayHere's reference for the refund (or its message). Throws RefundError. */
export async function requestPayhereRefund(paymentId: string, description: string): Promise<{ reference: string | null; message: string }> {
  const token = await getPayhereAccessToken()
  const res = await fetchWithTimeout(`${payhereApiBase()}/merchant/v1/payment/refund`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ payment_id: paymentId, description: description.slice(0, 255) }),
  })
  const body = await readJson(res)
  const status = Number(body.status)
  const msg = typeof body.msg === 'string' ? body.msg : typeof body.message === 'string' ? body.message : ''
  if (!res.ok || status !== 1) {
    throw new RefundError(`PayHere did not accept the refund: ${msg || `HTTP ${res.status}`}`, 502, 'REFUND_REJECTED')
  }
  const data = body.data
  const reference = data == null ? null : typeof data === 'object' ? JSON.stringify(data).slice(0, 100) : String(data).slice(0, 100)
  return { reference, message: msg || 'Refund submitted' }
}

export interface RefundOutcome {
  transactionId: string
  orderId: string
  amount: number
  reference: string | null
  message: string
  /** What the payment bought — the admin decides what happens to it (nothing is changed here) */
  subscription: {
    id: string
    tenantId: string
    tenantName: string | null
    status: string
    currentPeriodEnd: Date | null
    periodMonths: number
    wasUpgrade: boolean
  } | null
}

/**
 * Full refund of a successful PayHere payment, at most once. The subscription is NOT changed:
 * the outcome tells the console what the payment bought so the admin can decide.
 */
export async function refundPayhereTransaction(input: { transactionId: string; superAdminId: string; reason: string }): Promise<RefundOutcome> {
  if (!isPayhereRefundConfigured()) {
    throw new RefundError('PayHere refunds are not configured. Set PAYHERE_APP_ID and PAYHERE_APP_SECRET (a PayHere Business App with refund permission) on the server.', 503, 'REFUND_NOT_CONFIGURED')
  }
  const tx = await db.query.payhereTransactions.findFirst({ where: eq(payhereTransactions.id, input.transactionId) })
  if (!tx) throw new RefundError('Payment not found', 404, 'NOT_FOUND')
  if (tx.refundStatus === 'refunded' || tx.status === 'refunded') throw new RefundError('This payment has already been refunded.', 409, 'ALREADY_REFUNDED')
  if (tx.status !== 'success') throw new RefundError('Only successful payments can be refunded.', 400, 'NOT_REFUNDABLE')
  if (!tx.payherePaymentId) throw new RefundError('PayHere did not report a payment id for this order, so it cannot be refunded here. Refund it in the PayHere merchant portal.', 400, 'NO_PAYMENT_ID')

  // Claim: only one request may talk to PayHere for this payment
  const now = new Date()
  const [claimed] = await db.update(payhereTransactions)
    .set({ refundStatus: 'processing', refundRequestedAt: now, refundReason: input.reason, refundError: null, refundedBy: input.superAdminId, updatedAt: now })
    .where(and(
      eq(payhereTransactions.id, tx.id),
      eq(payhereTransactions.status, 'success'),
      isNotNull(payhereTransactions.payherePaymentId),
      or(
        isNull(payhereTransactions.refundStatus),
        eq(payhereTransactions.refundStatus, 'failed'),
        and(eq(payhereTransactions.refundStatus, 'processing'), lt(payhereTransactions.refundRequestedAt, new Date(now.getTime() - STALE_PROCESSING_MS))),
      ),
    ))
    .returning({ id: payhereTransactions.id })
  if (!claimed) throw new RefundError('A refund for this payment is already in progress or done.', 409, 'REFUND_IN_PROGRESS')

  let result: { reference: string | null; message: string }
  try {
    result = await requestPayhereRefund(tx.payherePaymentId, `Refund ${tx.orderId}: ${input.reason}`)
  } catch (err) {
    const message = err instanceof RefundError ? err.message : `Could not reach PayHere (${err instanceof Error ? err.message : 'network error'}). Check the merchant portal before trying again.`
    await db.update(payhereTransactions)
      .set({ refundStatus: 'failed', refundError: message.slice(0, 1000), updatedAt: new Date() })
      .where(eq(payhereTransactions.id, tx.id))
    if (err instanceof RefundError) throw err
    throw new RefundError(message, 502, 'REFUND_UNREACHABLE')
  }

  const amount = Number(tx.amount)
  await db.update(payhereTransactions)
    .set({
      status: 'refunded',
      refundStatus: 'refunded',
      refundedAmount: amount.toFixed(2),
      refundReference: result.reference,
      refundError: null,
      refundedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(payhereTransactions.id, tx.id))

  let subscription: RefundOutcome['subscription'] = null
  if (tx.subscriptionId) {
    const [row] = await db.select({
      id: subscriptions.id, tenantId: subscriptions.tenantId, status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd, tenantName: tenants.name,
    }).from(subscriptions).leftJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(eq(subscriptions.id, tx.subscriptionId)).limit(1)
    if (row) subscription = { ...row, periodMonths: tx.periodMonths, wasUpgrade: !!tx.newTierId }
  }
  return { transactionId: tx.id, orderId: tx.orderId, amount, reference: result.reference, message: result.message, subscription }
}
