import { z } from 'zod'
import { emailSchema, shortTextSchema, uuidSchema } from './common'

// ==================== AUTH ====================

// POST /api/sys-control/auth/login
export const sysLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
})

// ==================== COUPONS ====================

// POST /api/sys-control/coupons
export const sysCreateCouponSchema = z.object({
  code: z.string().trim().min(1, 'Coupon code is required').max(50),
  description: z.string().max(500).optional(),
  discountType: z.enum(['percentage', 'fixed_amount']).default('percentage'),
  discountValue: z.coerce.number().positive('Discount value must be greater than 0').optional(),
  applicableTiers: z.array(z.string()).optional(),
  minBillingCycle: z.string().max(20).optional(),
  maxUses: z.coerce.number().int().min(1).optional(),
  maxUsesPerAccount: z.coerce.number().int().min(1).default(1),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  isActive: z.boolean().default(true),
})

// PUT /api/sys-control/coupons/[id]
export const sysUpdateCouponSchema = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  description: z.string().max(500).optional(),
  discountType: z.enum(['percentage', 'fixed_amount']).optional(),
  discountValue: z.coerce.number().positive('Discount value must be greater than 0').optional(),
  applicableTiers: z.array(z.string()).optional(),
  minBillingCycle: z.string().max(20).optional(),
  maxUses: z.coerce.number().int().min(1).optional(),
  maxUsesPerAccount: z.coerce.number().int().min(1).optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  isActive: z.boolean().optional(),
})

// ==================== SETTINGS ====================

// PUT /api/sys-control/settings
export const sysUpdateSettingSchema = z.object({
  key: shortTextSchema,
  value: z.unknown(),
  description: z.string().max(500).optional(),
})

// ==================== NOTIFICATIONS ====================

// POST /api/sys-control/notifications
export const sysCreateNotificationSchema = z.object({
  type: z.string().trim().min(1, 'Type is required').max(50),
  title: z.string().trim().min(1, 'Title is required').max(255),
  message: z.string().trim().min(1, 'Message is required').max(5000),
  link: z.string().max(500).optional(),
  accountIds: z.array(uuidSchema).optional(),
  sendToAll: z.boolean().optional(),
})

// DELETE /api/sys-control/notifications
export const sysDeleteNotificationsSchema = z.object({
  ids: z.array(uuidSchema).min(1, 'Notification IDs required'),
})

// ==================== PRICING TIERS ====================

// POST /api/sys-control/pricing-tiers
export const sysCreatePricingTierSchema = z.object({
  name: shortTextSchema,
  displayName: shortTextSchema,
  priceMonthly: z.coerce.number().min(0).optional(),
  priceYearly: z.coerce.number().min(0).optional(),
  currency: z.string().min(2).max(10).default('LKR'),
  maxUsers: z.coerce.number().int().min(1).optional(),
  maxSalesMonthly: z.coerce.number().int().min(1).optional(),
  maxDatabaseBytes: z.coerce.number().int().min(0).optional(),
  maxFileStorageBytes: z.coerce.number().int().min(0).optional(),
  features: z.record(z.string(), z.unknown()).default({}),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

// PUT /api/sys-control/pricing-tiers/[id]
export const sysUpdatePricingTierSchema = z.object({
  displayName: z.string().trim().min(1).max(255).optional(),
  priceMonthly: z.coerce.number().min(0).optional(),
  priceYearly: z.coerce.number().min(0).optional(),
  currency: z.string().min(2).max(10).optional(),
  maxUsers: z.coerce.number().int().min(1).optional(),
  maxSalesMonthly: z.coerce.number().int().min(1).optional(),
  maxDatabaseBytes: z.coerce.number().int().min(0).optional(),
  maxFileStorageBytes: z.coerce.number().int().min(0).optional(),
  features: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
})

// ==================== SUBSCRIPTIONS ====================

// PUT /api/sys-control/subscriptions/[id]
export const sysUpdateSubscriptionSchema = z.object({
  extendMonths: z.coerce.number().int().optional(),
  adjustMonths: z.coerce.number().int().optional(),
  setEndDate: z.string().optional(),
  reason: z.string().max(1000).optional(),
  status: z.enum(['trial', 'active', 'past_due', 'cancelled', 'locked']).optional(),
  overrideDatabaseBytes: z.coerce.number().int().min(0).optional(),
  overrideFileStorageBytes: z.coerce.number().int().min(0).optional(),
  lock: z.boolean().optional(),
  unlock: z.boolean().optional(),
  lockReason: z.string().max(500).optional(),
})

// ==================== SEND EMAIL ====================

// POST /api/sys-control/send-email
export const sysSendEmailSchema = z.object({
  to: emailSchema,
  subject: z.string().trim().min(1, 'Subject is required').max(500),
  html: z.string().max(50000).optional(),
  text: z.string().max(50000).optional(),
}).refine(
  (data) => !!data.html || !!data.text,
  { message: 'Either html or text content is required', path: ['html'] }
)

// ==================== USERS ====================

// PUT /api/sys-control/users/[id]
export const sysUpdateUserSchema = z.object({
  isActive: z.boolean().optional(),
  deactivationReason: z.string().max(1000).optional(),
})

// ==================== PAYMENTS ====================

// PUT /api/sys-control/payments/[id]
export const sysUpdatePaymentSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNotes: z.string().max(2000).optional(),
})

// ==================== MESSAGES ====================

// POST /api/sys-control/messages
export const sysCreateConversationSchema = z.object({
  accountId: uuidSchema,
  subject: z.string().trim().min(1, 'Subject is required').max(255),
  category: z.enum(['general', 'billing', 'technical', 'feature_request', 'bug_report']).default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  message: z.string().trim().min(1, 'Message is required').max(5000),
})

// POST /api/sys-control/messages/[conversationId] - Admin reply
export const sysReplyMessageSchema = z.object({
  content: z.string().trim().min(1, 'Content is required').max(5000),
})

// PUT /api/sys-control/messages/[conversationId] - Update status/priority
export const sysUpdateConversationSchema = z.object({
  status: z.enum(['open', 'closed', 'archived']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  action: z.enum(['close', 'reopen', 'archive']).optional(),
})

// ==================== ERROR LOGS ====================

// PUT /api/sys-control/error-logs
export const sysUpdateErrorLogSchema = z.object({
  id: uuidSchema,
  resolutionStatus: z.enum(['open', 'investigating', 'resolved', 'wont_fix']).optional(),
  resolutionNotes: z.string().max(5000).optional(),
})

// ==================== R2 CLEANUP ====================

// POST /api/sys-control/r2-cleanup
export const sysR2CleanupSchema = z.object({
  prefix: z.string().max(255).optional(),
  confirm: z.literal(true, { message: 'Set confirm: true to proceed with deletion' }),
})
