// PayHere MD5 hash generation and verification
// Per PayHere docs: https://support.payhere.lk/api-&-mobile-sdk/payhere-checkout

import crypto from 'crypto'
import { PAYHERE_CONFIG } from './config'

/**
 * Generate MD5 hash for PayHere checkout form submission
 * Hash = MD5(merchantId + orderId + amountFormatted + currency + MD5(merchantSecret))
 */
export function generateCheckoutHash(
  orderId: string,
  amount: number,
  currency: string = 'LKR'
): string {
  const { merchantId, merchantSecret } = PAYHERE_CONFIG

  // Format amount to 2 decimal places
  const amountFormatted = amount.toFixed(2)

  // MD5 of merchant secret (uppercase)
  const secretHash = crypto
    .createHash('md5')
    .update(merchantSecret)
    .digest('hex')
    .toUpperCase()

  // Final hash
  const hashString = merchantId + orderId + amountFormatted + currency + secretHash
  return crypto
    .createHash('md5')
    .update(hashString)
    .digest('hex')
    .toUpperCase()
}

/**
 * Verify PayHere notification (webhook) MD5 signature
 * Hash = MD5(merchantId + orderId + payhereAmount + payhereCurrency + statusCode + MD5(merchantSecret))
 */
export function verifyNotificationHash(
  orderId: string,
  payhereAmount: string,
  payhereCurrency: string,
  statusCode: string,
  md5sig: string
): boolean {
  const { merchantId, merchantSecret } = PAYHERE_CONFIG

  const secretHash = crypto
    .createHash('md5')
    .update(merchantSecret)
    .digest('hex')
    .toUpperCase()

  const localHash = crypto
    .createHash('md5')
    .update(merchantId + orderId + payhereAmount + payhereCurrency + statusCode + secretHash)
    .digest('hex')
    .toUpperCase()

  const received = String(md5sig || '').toUpperCase()
  // Constant-time compare (MD5 is mandated by PayHere's protocol; the compare need not leak timing).
  return received.length === localHash.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(localHash))
}
