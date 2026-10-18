// Main exports for the notification system

// Types
export * from './types'

// SMS
export { sendSms, testSmsConnection } from './sms'
export { sendSmsWithLogging, getSmsUsage } from './sms/send'

// Email (platform Resend - no tenant config needed)
export { sendEmail } from './email'
export { sendEmailWithLogging } from './email/send'

// Templates
export { renderTemplate } from './templates/renderer'
// Note: previewTemplate is in a separate file for client-side use
// Import directly: import { previewTemplate } from '@/lib/notifications/templates/preview'
export {
  allVariableGroups,
  getVariablesForEntity,
  getAllVariableKeys,
  type TemplateVariable,
  type TemplateVariableGroup,
} from './templates/variables'
