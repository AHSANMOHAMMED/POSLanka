import { webxpayConfig } from './config'
import crypto from 'crypto'

export interface WebXPayCheckoutInput {
  orderId: string
  amount: number
  currency?: string
  firstName: string
  lastName?: string
  email: string
  phone?: string
  returnUrl: string
  cancelUrl: string
}

/**
 * Build a signed checkout payload for WebXPay (Sri Lanka gateway).
 * Mirrors PayHere billing hooks so either gateway can be selected.
 */
export function createWebXPayCheckout(input: WebXPayCheckoutInput) {
  if (!webxpayConfig.configured) {
    throw new Error('WebXPay is not configured')
  }

  const currency = input.currency || 'LKR'
  const amount = input.amount.toFixed(2)
  const signature = crypto
    .createHmac('sha256', webxpayConfig.apiSecret)
    .update(`${webxpayConfig.apiKey}${input.orderId}${amount}${currency}`)
    .digest('hex')

  return {
    gateway: 'webxpay' as const,
    mode: webxpayConfig.mode,
    endpoint: `${webxpayConfig.baseUrl}/v1/checkout`,
    fields: {
      api_key: webxpayConfig.apiKey,
      order_id: input.orderId,
      amount,
      currency,
      first_name: input.firstName,
      last_name: input.lastName || '',
      email: input.email,
      phone: input.phone || '',
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      signature,
    },
  }
}

export function verifyWebXPayWebhook(payload: {
  order_id: string
  amount: string
  currency: string
  status: string
  signature: string
}): boolean {
  if (!webxpayConfig.configured) return false
  const expected = crypto
    .createHmac('sha256', webxpayConfig.apiSecret)
    .update(
      `${webxpayConfig.apiKey}${payload.order_id}${payload.amount}${payload.currency}${payload.status}`
    )
    .digest('hex')
  return expected === payload.signature
}

export { webxpayConfig }
