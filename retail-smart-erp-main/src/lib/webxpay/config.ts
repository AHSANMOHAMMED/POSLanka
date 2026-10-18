export const webxpayConfig = {
  apiKey: process.env.WEBXPAY_API_KEY || '',
  apiSecret: process.env.WEBXPAY_API_SECRET || '',
  mode: (process.env.WEBXPAY_MODE || 'sandbox') as 'sandbox' | 'live',
  get configured() {
    return Boolean(this.apiKey && this.apiSecret)
  },
  get baseUrl() {
    return this.mode === 'live'
      ? 'https://api.webxpay.com'
      : 'https://sandboxapi.webxpay.com'
  },
}
