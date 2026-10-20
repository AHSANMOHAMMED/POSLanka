import { NextRequest, NextResponse } from 'next/server'
import { verifyWebXPayWebhook } from '@/lib/webxpay'
import { logError } from '@/lib/ai/error-logger'
import { z } from 'zod'
import { validateBody } from '@/lib/validation/helpers'

const webhookSchema = z.object({
  order_id: z.coerce.string().default(''),
  amount: z.coerce.string().default(''),
  currency: z.coerce.string().default('LKR'),
  status: z.coerce.string().default(''),
  signature: z.coerce.string().default(''),
}).passthrough()

export async function POST(request: NextRequest) {
  try {
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
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    // Billing activation hooks can be wired similarly to PayHere notify
    return NextResponse.json({ received: true, status: body.status })
  } catch (error) {
    logError('api/webxpay/webhook', error)
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 })
  }
}
