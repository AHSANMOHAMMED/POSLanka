/** Platform SMS / WhatsApp add-on. Server-only entry point (phone.ts and templates.ts are client-safe). */
export { sendMessage, messagingAvailability, getSubscription, CODE_MESSAGES, type SendMessageInput, type SendMessageResult, type MessageChannel } from './service'
export { sendSaleReceipt, sendPaymentReminder, sendLowStockMessage } from './actions'
export { normalizeMsisdn, isLankanMobile, smsSegments } from './phone'
export { setMessagingFetchForTests, type MessagingCode } from './providers'
