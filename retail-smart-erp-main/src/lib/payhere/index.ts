// PayHere payment gateway main module

import { PAYHERE_CONFIG, getPayhereUrl } from './config'
import { generateCheckoutHash } from './hash'

export { PAYHERE_CONFIG, getPayhereUrl, isPayhereConfigured } from './config'
export { generateCheckoutHash, verifyNotificationHash } from './hash'

/**
 * Generate a unique order ID for PayHere
 * Format: RSPOS-{timestamp}-{random}
 */
export function generateOrderId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `RSPOS-${timestamp}-${random}`.toUpperCase()
}

/**
 * PayHere checkout form parameters
 */
export interface PayhereCheckoutParams {
  merchant_id: string
  return_url: string
  cancel_url: string
  notify_url: string
  order_id: string
  items: string
  currency: string
  amount: string
  first_name: string
  last_name: string
  email: string
  phone: string
  address: string
  city: string
  country: string
  hash: string
  checkout_url: string
}

/**
 * Generate all parameters needed for PayHere checkout form
 */
export function generateCheckoutParams(options: {
  orderId: string
  amount: number
  currency?: string
  itemDescription: string
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress?: string
  customerCity?: string
  customerCountry?: string
  returnUrl: string
  cancelUrl: string
  notifyUrl: string
}): PayhereCheckoutParams {
  const currency = options.currency || 'LKR'
  const hash = generateCheckoutHash(options.orderId, options.amount, currency)

  // Split name into first/last
  const nameParts = options.customerName.trim().split(/\s+/)
  const firstName = nameParts[0] || 'Customer'
  const lastName = nameParts.slice(1).join(' ') || '-'

  return {
    merchant_id: PAYHERE_CONFIG.merchantId,
    return_url: options.returnUrl,
    cancel_url: options.cancelUrl,
    notify_url: options.notifyUrl,
    order_id: options.orderId,
    items: options.itemDescription,
    currency,
    amount: options.amount.toFixed(2),
    first_name: firstName,
    last_name: lastName,
    email: options.customerEmail,
    phone: options.customerPhone || '0000000000',
    address: options.customerAddress || 'N/A',
    city: options.customerCity || 'Colombo',
    country: options.customerCountry || 'Sri Lanka',
    hash,
    checkout_url: getPayhereUrl('checkout'),
  }
}

/**
 * PayHere status codes
 * 2 = success
 * 0 = pending
 * -1 = cancelled
 * -2 = failed
 * -3 = charged back
 */
export function getPayhereStatusFromCode(statusCode: string): 'success' | 'pending' | 'cancelled' | 'failed' | 'charged_back' {
  switch (statusCode) {
    case '2': return 'success'
    case '0': return 'pending'
    case '-1': return 'cancelled'
    case '-2': return 'failed'
    case '-3': return 'charged_back'
    default: return 'pending'
  }
}
