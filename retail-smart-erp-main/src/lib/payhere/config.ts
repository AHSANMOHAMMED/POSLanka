// PayHere payment gateway configuration

export const PAYHERE_CONFIG = {
  merchantId: process.env.PAYHERE_MERCHANT_ID || '',
  merchantSecret: process.env.PAYHERE_MERCHANT_SECRET || '',
  mode: (process.env.PAYHERE_MODE || 'sandbox') as 'sandbox' | 'live',
}

export const PAYHERE_URLS = {
  sandbox: {
    checkout: 'https://sandbox.payhere.lk/pay/checkout',
    recurring: 'https://sandbox.payhere.lk/pay/preapprove',
    authorize: 'https://sandbox.payhere.lk/pay/authorize',
  },
  live: {
    checkout: 'https://www.payhere.lk/pay/checkout',
    recurring: 'https://www.payhere.lk/pay/preapprove',
    authorize: 'https://www.payhere.lk/pay/authorize',
  },
} as const

export function getPayhereUrl(type: 'checkout' | 'recurring' | 'authorize' = 'checkout'): string {
  return PAYHERE_URLS[PAYHERE_CONFIG.mode][type]
}

export function isPayhereConfigured(): boolean {
  return !!(PAYHERE_CONFIG.merchantId && PAYHERE_CONFIG.merchantSecret)
}
