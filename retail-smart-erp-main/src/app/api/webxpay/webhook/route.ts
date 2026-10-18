import { NextRequest, NextResponse } from 'next/server'
import { verifyWebXPayWebhook } from '@/lib/webxpay'
import { logError } from '@/lib/ai/error-logger'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ok = verifyWebXPayWebhook({
      order_id: String(body.order_id || ''),
      amount: String(body.amount || ''),
      currency: String(body.currency || 'LKR'),
      status: String(body.status || ''),
      signature: String(body.signature || ''),
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
