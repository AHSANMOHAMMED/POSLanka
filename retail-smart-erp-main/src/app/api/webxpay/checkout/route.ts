import { NextRequest, NextResponse } from 'next/server'
import { accountAuth } from '@/lib/auth/account-auth'
import { createWebXPayCheckout, webxpayConfig } from '@/lib/webxpay'
import { z } from 'zod'

const schema = z.object({
  orderId: z.string().min(1),
  amount: z.coerce.number().positive(),
  currency: z.string().default('LKR'),
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
})

export async function POST(request: NextRequest) {
  const session = await accountAuth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!webxpayConfig.configured) {
    return NextResponse.json({ error: 'WebXPay not configured' }, { status: 503 })
  }

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const checkout = createWebXPayCheckout(parsed.data)
    return NextResponse.json(checkout)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 500 }
    )
  }
}
