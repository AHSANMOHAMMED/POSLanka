// ==================== SMS TYPES ====================

export type SmsProvider = 'none' | 'websms_lk' | 'twilio' | 'generic_http'

export interface SmsSettings {
  id: string
  tenantId: string
  provider: SmsProvider
  isEnabled: boolean

  // WebSMS.lk
  websmsApiKey?: string | null
  websmsApiToken?: string | null
  websmsSenderId?: string | null

  // Twilio
  twilioAccountSid?: string | null
  twilioAuthToken?: string | null
  twilioPhoneNumber?: string | null

  // Generic HTTP (ERPNext-style config)
  genericApiUrl?: string | null
  genericMethod?: string | null
  genericHeaders?: Record<string, string> | null
  genericBodyTemplate?: string | null // Legacy - kept for backward compatibility
  genericAuthType?: 'none' | 'basic' | 'bearer' | 'api_key' | null
  genericAuthValue?: string | null
  // ERPNext-style params
  genericMessageParam?: string | null // e.g., "text" or "message"
  genericRecipientParam?: string | null // e.g., "to" or "mobile"
  genericStaticParams?: Array<{ key: string; value: string }> | null // Key-value pairs

  dailyLimit?: number | null
  monthlyLimit?: number | null

  createdAt: Date
  updatedAt: Date
}

export interface WebSmsConfig {
  apiKey: string
  apiToken: string
  senderId: string
}

export interface TwilioConfig {
  accountSid: string
  authToken: string
  phoneNumber: string
}

export interface GenericHttpConfig {
  apiUrl: string
  method: 'GET' | 'POST' | 'PUT'
  headers: Record<string, string>
  bodyTemplate?: string // Legacy - JSON string with {{to}}, {{message}} placeholders
  authType: 'none' | 'basic' | 'bearer' | 'api_key'
  authValue: string
  // ERPNext-style params (preferred)
  messageParam?: string // Parameter name for message content (e.g., "text")
  recipientParam?: string // Parameter name for phone number (e.g., "to")
  staticParams?: Array<{ key: string; value: string }> // Additional fixed params
}

export interface SendSmsRequest {
  to: string // Phone number
  message: string
  tenantId: string
  userId?: string
  // Optional metadata for logging
  recipientType?: 'customer' | 'supplier' | 'staff' | 'manual'
  recipientId?: string
  recipientName?: string
  entityType?: string
  entityId?: string
  entityReference?: string
  templateId?: string
}

export interface SendSmsResult {
  success: boolean
  messageId?: string
  segments?: number
  cost?: number
  errorMessage?: string
  providerResponse?: Record<string, unknown>
}

// ==================== EMAIL TYPES ====================

// All notification emails are sent via platform Resend account (slug@retailsmarterp.com)
// No tenant email configuration needed

export interface ResendConfig {
  apiKey: string
  fromName: string
  fromEmail: string
  replyTo?: string
}

export interface SendEmailRequest {
  to: string | string[] // Email address(es)
  subject: string
  body: string // HTML content
  textBody?: string // Plain text fallback
  tenantId: string
  userId?: string
  // Optional metadata for logging
  recipientType?: 'customer' | 'supplier' | 'staff' | 'manual'
  recipientId?: string
  recipientName?: string
  entityType?: string
  entityId?: string
  entityReference?: string
  templateId?: string
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  errorMessage?: string
  providerResponse?: Record<string, unknown>
}

// ==================== TEMPLATE TYPES ====================

export type NotificationChannel = 'sms' | 'email' | 'both'

export interface NotificationTemplate {
  id: string
  tenantId: string
  name: string
  channel: NotificationChannel

  triggerEvent?: string | null
  isAutoTrigger: boolean

  smsContent?: string | null
  emailSubject?: string | null
  emailBody?: string | null

  isActive: boolean
  createdBy?: string | null
  createdAt: Date
  updatedAt: Date
}

// Available trigger events for auto-notifications.
// Canonical names use underscores (what triggerNotification() fires). Older templates were
// saved with dotted names ('work_order.completed'); normalizeTriggerEvent() maps them.
export type TriggerEvent =
  | 'work_order_created'
  | 'work_order_completed'
  | 'work_order_invoiced'
  | 'appointment_created'
  | 'appointment_confirmed'
  | 'appointment_reminder' // 24h before
  | 'appointment_reminder_1h' // 1h before
  | 'sale_completed'
  | 'reservation_confirmed'
  | 'vehicle_service_due'
  | 'customer_birthday'
  | 'estimate_approved'
  | 'estimate_rejected'
  | 'delivery_dispatched'
  | 'delivery_delivered'

export const TRIGGER_EVENT_LABELS: Record<TriggerEvent, string> = {
  work_order_created: 'Work Order Created',
  work_order_completed: 'Work Order Completed',
  work_order_invoiced: 'Work Order Invoice Created',
  appointment_created: 'Appointment Scheduled',
  appointment_confirmed: 'Appointment Confirmed',
  appointment_reminder: 'Appointment Reminder (24h)',
  appointment_reminder_1h: 'Appointment Reminder (1h)',
  sale_completed: 'Sale Completed',
  reservation_confirmed: 'Reservation Confirmed',
  vehicle_service_due: 'Vehicle Service Due',
  customer_birthday: 'Customer Birthday',
  estimate_approved: 'Estimate Approved',
  estimate_rejected: 'Estimate Rejected',
  delivery_dispatched: 'Delivery Dispatched',
  delivery_delivered: 'Delivery Delivered',
}

const TRIGGER_EVENT_ALIASES: Record<string, TriggerEvent> = {
  'work_order.invoice_created': 'work_order_invoiced',
  work_order_invoice_created: 'work_order_invoiced',
  'work_order.invoiced': 'work_order_invoiced',
}

/** Map any stored trigger name ('a.b' legacy or 'a_b') to the canonical underscore form. */
export function normalizeTriggerEvent(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  return TRIGGER_EVENT_ALIASES[trimmed] || trimmed.replace(/\./g, '_')
}

// ==================== LOG TYPES ====================

export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'failed'

export interface NotificationLog {
  id: string
  tenantId: string
  channel: 'sms' | 'email'
  status: NotificationStatus

  recipientType?: string | null
  recipientId?: string | null
  recipientName?: string | null
  recipientContact: string

  templateId?: string | null
  subject?: string | null
  content: string

  entityType?: string | null
  entityId?: string | null
  entityReference?: string | null

  provider?: string | null
  providerMessageId?: string | null
  providerResponse?: Record<string, unknown> | null
  errorMessage?: string | null

  cost?: string | null
  segments?: number | null

  sentBy?: string | null
  sentAt?: Date | null
  deliveredAt?: Date | null
  createdAt: Date
}

// ==================== USAGE TYPES ====================

export interface NotificationUsage {
  id: string
  tenantId: string
  channel: 'sms' | 'email'
  periodMonth: string // ISO date string (first day of month)
  sentCount: number
  failedCount: number
  totalCost?: string | null
}

export interface UsageSummary {
  sms: {
    sentToday: number
    sentThisMonth: number
    dailyLimit: number
    monthlyLimit: number
    remainingDaily: number
    remainingMonthly: number
  }
  email: {
    sentToday: number
    sentThisMonth: number
    dailyLimit: number
    monthlyLimit: number
    remainingDaily: number
    remainingMonthly: number
  }
}

// ==================== SEND NOTIFICATION REQUEST ====================

export interface SendNotificationRequest {
  channel: 'sms' | 'email' | 'both'

  // Recipients (can provide multiple)
  recipients: Array<{
    contact: string // Phone or email
    name?: string
    type?: 'customer' | 'supplier' | 'staff' | 'manual'
    id?: string
  }>

  // Message content (either template or direct)
  templateId?: string
  templateVariables?: Record<string, string>

  // OR direct content
  smsContent?: string
  emailSubject?: string
  emailBody?: string

  // Related entity (for tracking)
  entityType?: string
  entityId?: string
  entityReference?: string
}

export interface SendNotificationResult {
  success: boolean
  results: Array<{
    channel: 'sms' | 'email'
    recipient: string
    success: boolean
    messageId?: string
    errorMessage?: string
  }>
  totalSent: number
  totalFailed: number
}
