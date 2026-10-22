import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'
import { RefundError, refundPayhereTransaction } from '@/lib/payhere/refund'

const schema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason (3+ characters)').max(500),
})

/**
 * POST /api/sys-control/payhere-transactions/[id]/refund — full refund of a successful PayHere
 * card payment through the PayHere Refund API. Billing role or owner. At most once per payment
 * (claimed before PayHere is called). The subscription is left unchanged: the response says what
 * the payment bought so the console can offer to end / shorten the paid period. Audited.
 *   503 REFUND_NOT_CONFIGURED   PAYHERE_APP_ID / PAYHERE_APP_SECRET missing
 *   409 ALREADY_REFUNDED | REFUND_IN_PROGRESS
 *   502 REFUND_REJECTED | REFUND_AUTH_FAILED | REFUND_UNREACHABLE (recorded as refund_status=failed)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/payhere-transactions/refund', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('billing')
    if (!session) return adminAuthError()

    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, schema)
    if (!parsed.success) return parsed.response

    try {
      const outcome = await refundPayhereTransaction({ transactionId: p.data.id, superAdminId: session.superAdminId, reason: parsed.data.reason })
      await adminAudit.update(session.superAdminId, 'payhere_transaction', p.data.id, {
        op: 'refund', orderId: outcome.orderId, amount: outcome.amount, reference: outcome.reference, reason: parsed.data.reason,
        subscriptionId: outcome.subscription?.id ?? null, subscriptionChanged: false,
      })
      return NextResponse.json({ success: true, ...outcome })
    } catch (err) {
      if (err instanceof RefundError) {
        if (err.status >= 500 && err.code !== 'REFUND_NOT_CONFIGURED') {
          await adminAudit.update(session.superAdminId, 'payhere_transaction', p.data.id, { op: 'refund_failed', code: err.code, error: err.message, reason: parsed.data.reason })
        }
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
      }
      throw err
    }
  } catch (error) {
    logError('api/sys-control/payhere-transactions/[id]/refund', error)
    return NextResponse.json({ error: 'Failed to refund the payment' }, { status: 500 })
  }
}
