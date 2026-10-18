import { z } from 'zod'
import { uuidSchema, optionalUuid, emailSchema, phoneSchema, shortTextSchema, businessTypeSchema } from './common'

// ==================== Account Profile ====================

// PUT /api/account
export const updateAccountSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(255),
  phone: phoneSchema.optional(),
})

// ==================== Account Preferences ====================

// PUT /api/account/preferences
export const updatePreferencesSchema = z.object({
  language: z.string().max(10).optional(),
  timezone: z.string().max(100).optional(),
  dateFormat: z.string().max(50).optional(),
  currency: z.string().length(3, 'Currency must be a 3-letter code').optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  notifications: z.object({
    email: z.boolean().optional(),
    billing: z.boolean().optional(),
    security: z.boolean().optional(),
    marketing: z.boolean().optional(),
  }).optional(),
})

// ==================== Companies ====================

// POST /api/account/companies
export const createCompanySchema = z.object({
  name: shortTextSchema,
  slug: z.string()
    .min(3, 'Business code must be at least 3 characters')
    .max(25, 'Business code must be 25 characters or less')
    .regex(/^[a-z0-9-]+$/, 'Business code can only contain lowercase letters, numbers, and hyphens')
    .refine(s => !s.startsWith('-') && !s.endsWith('-'), 'Business code must start and end with a letter or number'),
  businessType: businessTypeSchema,
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  address: z.string().max(500).optional(),
  country: z.string().min(2, 'Country is required').max(10),
  dateFormat: z.string().min(1, 'Date format is required').max(50),
  timeFormat: z.string().min(1, 'Time format is required').max(50),
  tierId: uuidSchema.optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  aiEnabled: z.boolean().optional(),
})

// DELETE /api/account/companies
export const deleteCompanySchema = z.object({
  tenantId: uuidSchema,
  password: z.string().min(1, 'Password is required'),
})

// ==================== Pending Companies ====================

// POST /api/account/pending-companies
export const createPendingCompanySchema = z.object({
  name: shortTextSchema,
  slug: z.string()
    .min(1, 'Slug is required')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  businessType: businessTypeSchema,
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  address: z.string().max(500).optional(),
  country: z.string().min(2, 'Country is required').max(10),
  dateFormat: z.string().min(1, 'Date format is required').max(50),
  timeFormat: z.string().min(1, 'Time format is required').max(50),
  tierId: uuidSchema,
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
})

// DELETE /api/account/pending-companies
export const deletePendingCompanySchema = z.object({
  pendingCompanyId: uuidSchema,
})

// ==================== Notifications ====================

// POST /api/account/notifications
export const createNotificationSchema = z.object({
  type: z.string().min(1, 'Type is required').max(100),
  title: z.string().min(1, 'Title is required').max(255),
  message: z.string().min(1, 'Message is required').max(2000),
  link: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// PUT /api/account/notifications
export const updateNotificationsSchema = z.object({
  notificationIds: z.array(uuidSchema).max(1000).optional(),
  markAllRead: z.boolean().optional(),
}).refine(
  (data) => data.markAllRead || (data.notificationIds && data.notificationIds.length > 0),
  { message: 'Either notificationIds or markAllRead is required' }
)

// ==================== Payments ====================

// POST /api/account/payments
export const createPaymentDepositSchema = z.object({
  subscriptionId: optionalUuid,
  pendingCompanyId: optionalUuid,
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  bankReference: z.string().max(255).optional(),
  depositDate: z.string().min(1, 'Deposit date is required'),
  notes: z.string().max(1000).optional(),
  periodMonths: z.coerce.number().int().min(0).default(1),
  isWalletDeposit: z.boolean().default(false),
})

// ==================== Invites ====================

// POST /api/account/invites
export const createInviteSchema = z.object({
  email: emailSchema,
  tenantAssignments: z.array(z.object({
    tenantId: uuidSchema,
    role: z.enum(['owner', 'manager', 'cashier', 'technician']),
  })).min(1, 'At least one tenant assignment is required').max(20),
})

// ==================== Sessions ====================

// DELETE /api/account/sessions
export const deleteSessionsSchema = z.object({
  exceptCurrent: z.boolean().optional(),
})

// ==================== Subscriptions ====================

// PUT /api/account/subscriptions/[tenantId]
export const updateSubscriptionSchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
  // tierId is explicitly rejected by the route (must use /upgrade endpoint)
  tierId: uuidSchema.optional(),
})

// POST /api/account/subscriptions/[tenantId]/upgrade
export const upgradeSubscriptionSchema = z.object({
  newTierId: uuidSchema,
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  action: z.enum(['preview', 'execute']).default('preview'),
})

// ==================== Account Messages (conversation replies) ====================

// POST /api/account/messages/[conversationId]
export const accountMessageReplySchema = z.object({
  content: z.string().trim().min(1, 'Content is required').max(5000),
})

// PUT /api/account/messages/[conversationId]
export const accountMessageActionSchema = z.object({
  action: z.enum(['close', 'reopen']),
})

// ==================== Auth Transfer ====================

// POST /api/account-auth/transfer
export const transferAuthSchema = z.object({
  tenantId: optionalUuid,
  tenantSlug: z.string().max(50).optional(),
}).refine(
  (data) => data.tenantId || data.tenantSlug,
  { message: 'tenantId or tenantSlug is required' }
)
