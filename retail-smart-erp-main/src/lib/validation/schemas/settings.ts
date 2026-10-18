import { z } from 'zod'
import {
  optionalUuid, paginatedSearchSchema,
  shortTextSchema, letterHeadAlignmentSchema,
} from './common'

// ==================== PRINT TEMPLATES ====================

// Reusable margins schema for print templates
const printTemplateMarginsSchema = z.object({
  top: z.coerce.number().min(0).max(100),
  right: z.coerce.number().min(0).max(100),
  bottom: z.coerce.number().min(0).max(100),
  left: z.coerce.number().min(0).max(100),
})

// GET /api/print-templates
export const printTemplatesListSchema = z.object({
  documentType: z.string().max(50).optional(),
})

// POST /api/print-templates
export const createPrintTemplateSchema = z.object({
  name: shortTextSchema,
  documentType: z.string().trim().min(1, 'Document type is required').max(50),
  letterHeadId: optionalUuid,
  paperSize: z.enum(['a4', 'a5', 'letter', 'legal', 'receipt']).default('a4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins: printTemplateMarginsSchema.optional(),
  showLogo: z.boolean().default(true),
  showHeader: z.boolean().default(true),
  showFooter: z.boolean().default(true),
  customCss: z.string().max(10000).nullish(),
  headerFields: z.array(z.string().max(100)).max(20).nullish(),
  bodyFields: z.array(z.string().max(100)).max(50).nullish(),
  footerFields: z.array(z.string().max(100)).max(20).nullish(),
  isDefault: z.boolean().default(false),
})

// PUT /api/print-templates/[id]
export const updatePrintTemplateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  documentType: z.string().trim().max(50).optional(),
  letterHeadId: optionalUuid,
  paperSize: z.enum(['a4', 'a5', 'letter', 'legal', 'receipt']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margins: printTemplateMarginsSchema.optional(),
  showLogo: z.boolean().optional(),
  showHeader: z.boolean().optional(),
  showFooter: z.boolean().optional(),
  customCss: z.string().max(10000).nullish(),
  headerFields: z.array(z.string().max(100)).max(20).nullish(),
  bodyFields: z.array(z.string().max(100)).max(50).nullish(),
  footerFields: z.array(z.string().max(100)).max(20).nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

// ==================== LETTER HEADS ====================

// POST /api/letter-heads
export const createLetterHeadSchema = z.object({
  name: shortTextSchema,
  headerHtml: z.string().max(10000).nullish(),
  footerHtml: z.string().max(10000).nullish(),
  headerImage: z.string().max(2000).nullish(),
  footerImage: z.string().max(2000).nullish(),
  headerHeight: z.coerce.number().int().min(0).max(500).default(60),
  footerHeight: z.coerce.number().int().min(0).max(500).default(30),
  alignment: letterHeadAlignmentSchema.default('center'),
  isDefault: z.boolean().default(false),
})

// PUT /api/letter-heads/[id]
export const updateLetterHeadSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  headerHtml: z.string().max(10000).nullish(),
  footerHtml: z.string().max(10000).nullish(),
  headerImage: z.string().max(2000).nullish(),
  footerImage: z.string().max(2000).nullish(),
  headerHeight: z.coerce.number().int().min(0).max(500).optional(),
  footerHeight: z.coerce.number().int().min(0).max(500).optional(),
  alignment: letterHeadAlignmentSchema.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

// ==================== NOTIFICATION TEMPLATES ====================

const notificationChannelSchema = z.enum(['sms', 'email', 'both'])

// GET /api/notification-templates
export const notificationTemplatesListSchema = paginatedSearchSchema.extend({
  channel: z.string().max(20).optional(),
})

// POST /api/notification-templates
export const createNotificationTemplateSchema = z.object({
  name: shortTextSchema,
  channel: notificationChannelSchema,
  triggerEvent: z.string().max(100).nullish(),
  isAutoTrigger: z.boolean().default(false),
  smsContent: z.string().max(5000).nullish(),
  emailSubject: z.string().max(255).nullish(),
  emailBody: z.string().max(50000).nullish(),
  isActive: z.boolean().default(true),
}).superRefine((data, ctx) => {
  if ((data.channel === 'sms' || data.channel === 'both') && !data.smsContent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'SMS content is required for SMS templates',
      path: ['smsContent'],
    })
  }
  if ((data.channel === 'email' || data.channel === 'both') && !data.emailSubject) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Email subject is required for email templates',
      path: ['emailSubject'],
    })
  }
  if ((data.channel === 'email' || data.channel === 'both') && !data.emailBody) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Email body is required for email templates',
      path: ['emailBody'],
    })
  }
})

// PUT /api/notification-templates/[id]
export const updateNotificationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  channel: notificationChannelSchema.optional(),
  triggerEvent: z.string().max(100).nullish(),
  isAutoTrigger: z.boolean().optional(),
  smsContent: z.string().max(5000).nullish(),
  emailSubject: z.string().max(255).nullish(),
  emailBody: z.string().max(50000).nullish(),
  isActive: z.boolean().optional(),
})

// ==================== NOTIFICATION LOGS ====================

// GET /api/notification-logs
export const notificationLogsListSchema = paginatedSearchSchema.extend({
  channel: z.string().max(20).optional(),
  status: z.string().max(20).optional(),
  startDate: z.string().optional(),
})

// ==================== SMS LOG ====================

// GET /api/sms-log
export const smsLogListSchema = paginatedSearchSchema.extend({
  status: z.string().max(20).optional(),
})

// ==================== SEND NOTIFICATION ====================

const notificationRecipientSchema = z.object({
  contact: z.string().trim().min(1, 'Contact is required').max(255),
  name: z.string().max(255).optional(),
  type: z.enum(['customer', 'supplier', 'staff', 'manual']).optional(),
  id: z.string().uuid().optional(),
})

// POST /api/send-notification
export const sendNotificationSchema = z.object({
  channel: notificationChannelSchema,
  recipients: z.array(notificationRecipientSchema).min(1, 'At least one recipient is required').max(100),
  templateId: z.string().uuid().optional(),
  templateVariables: z.record(z.string(), z.string()).optional(),
  smsContent: z.string().max(5000).optional(),
  emailSubject: z.string().max(255).optional(),
  emailBody: z.string().max(50000).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.string().uuid().optional(),
  entityReference: z.string().max(100).optional(),
})

// ==================== EMAIL SETTINGS ====================

// PUT /api/email-settings
export const updateEmailSettingsSchema = z.object({
  provider: z.enum(['none', 'smtp', 'sendgrid', 'resend']).default('none'),
  isEnabled: z.boolean().default(false),
  fromName: z.string().max(100).nullish(),
  fromEmail: z.string().max(255).nullish(),
  replyToEmail: z.string().max(255).nullish(),
  smtpHost: z.string().max(255).nullish(),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpSecure: z.boolean().default(true),
  smtpUser: z.string().max(255).nullish(),
  smtpPassword: z.string().max(255).nullish(),
  sendgridApiKey: z.string().max(255).nullish(),
  resendApiKey: z.string().max(255).nullish(),
  dailyLimit: z.coerce.number().int().min(1).max(100000).default(500),
  monthlyLimit: z.coerce.number().int().min(1).max(1000000).default(10000),
})

// ==================== SAVED REPORTS ====================

// POST /api/saved-reports
export const createSavedReportSchema = z.object({
  name: shortTextSchema,
  reportType: z.string().trim().min(1, 'Report type is required').max(50),
  filters: z.record(z.string(), z.unknown()).default({}),
  columns: z.array(z.string().max(100)).max(50).nullish(),
  isPublic: z.boolean().default(false),
})

// PUT /api/saved-reports/[id]
export const updateSavedReportSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  columns: z.array(z.string().max(100)).max(50).nullish(),
  isPublic: z.boolean().optional(),
})

// ==================== CANCELLATION REASONS ====================

// GET /api/cancellation-reasons
export const cancellationReasonsListSchema = z.object({
  documentType: z.string().trim().min(1, 'documentType is required').max(30),
})

// ==================== MODULE ACCESS ====================

// PUT /api/module-access
const moduleAccessEntrySchema = z.object({
  moduleKey: z.string().trim().min(1, 'Module key is required').max(100),
  role: z.string().trim().min(1, 'Role is required').max(50),
  isEnabled: z.boolean(),
})

export const updateModuleAccessSchema = z.object({
  entries: z.array(moduleAccessEntrySchema).min(1, 'At least one entry is required').max(500),
})

// ==================== SETUP WIZARD ====================

// POST /api/c/[slug]/setup/step/[stepIndex]
export const setupStepSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional().default({}),
  completed: z.boolean().optional().default(false),
})

// POST /api/c/[slug]/setup/complete
// All fields optional because stripNullValues removes empty strings before Zod runs,
// which would cause required fields to fail when the user leaves inputs blank.
const setupBankAccountSchema = z.object({
  accountName: z.string().max(255).optional(),
  bankName: z.string().max(255).optional(),
  accountNumber: z.string().max(100).optional(),
  branchCode: z.string().max(100).optional(),
  isDefault: z.boolean().optional(),
})

const setupUserSchema = z.object({
  email: z.string().email().max(255).optional(),
  role: z.string().max(50).optional(),
  sendInvite: z.boolean().optional(),
})

export const setupCompleteSchema = z.object({
  taxRate: z.coerce.number().min(0).max(100).optional(),
  taxInclusive: z.boolean().optional(),
  logoUrl: z.string().max(2000).optional(),
  timezone: z.string().max(50).optional(),
  coaTemplate: z.string().max(50).optional(),
  fiscalYearStart: z.string().max(20).optional(),
  fiscalYearEnd: z.string().max(20).optional(),
  fiscalYearName: z.string().max(100).optional(),
  selectedCategories: z.array(z.string()).optional(),
  numberOfTables: z.coerce.number().int().min(0).max(500).optional(),
  tableAreas: z.array(z.any()).optional(),
  selectedServiceGroups: z.array(z.any()).optional(),
  defaultLaborRate: z.coerce.number().min(0).optional(),
  warehouses: z.array(z.any()).optional(),
  warehouseName: z.string().max(255).optional(),
  costCenters: z.array(z.any()).optional(),
  defaultCostCenter: z.string().max(255).optional(),
  bankAccounts: z.array(setupBankAccountSchema).optional(),
  accountOverrides: z.record(z.string(), z.string()).optional(),
  paymentMethods: z.array(z.string()).optional(),
  posProfileName: z.string().max(255).optional(),
  receiptFormat: z.string().max(20).optional(),
  posWarehouseName: z.string().max(255).optional(),
  posCostCenter: z.string().max(255).optional(),
  users: z.array(setupUserSchema).optional(),
})

// ==================== WORKSPACE ====================

// PUT /api/workspace/[key]
export const updateWorkspaceSchema = z.object({
  blocks: z.array(z.record(z.string(), z.unknown())).min(0).max(50),
})

// ==================== EXCHANGE RATES ====================
// GET /api/exchange-rates has no query params, no schema needed
