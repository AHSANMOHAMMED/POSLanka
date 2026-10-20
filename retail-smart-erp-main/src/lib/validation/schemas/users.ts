import { z } from 'zod'
import { receiptSettingsPatchSchema } from '@/lib/print/receipt-settings'
import {
  emailSchema, passwordSchema, userRoleSchema, businessTypeSchema,
  optimisticLockSchema,
} from './common'

// PUT /api/users/[id]
export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(255).optional(),
  email: emailSchema.optional(),
  role: userRoleSchema.optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
  /** 4-6 digit POS PIN; empty string clears it */
  pin: z.union([z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'), z.literal('')]).optional(),
}).merge(optimisticLockSchema)

// POST /api/users (invite or add user)
export const createInviteSchema = z.object({
  mode: z.literal('invite').optional(),
  email: emailSchema,
  role: userRoleSchema,
  fullName: z.string().trim().max(255).optional(),
  warehouseIds: z.array(z.string().uuid()).optional(),
  posProfileIds: z.array(z.string().uuid()).optional(),
})

// POST /api/users { mode: 'create' } — create staff directly with a password
export const createStaffSchema = z.object({
  mode: z.literal('create'),
  email: emailSchema,
  fullName: z.string().trim().min(1, 'Full name is required').max(255),
  role: userRoleSchema,
  password: passwordSchema,
  /** Optional 4-6 digit POS PIN; empty string = none */
  pin: z.union([z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'), z.literal('')]).optional(),
  warehouseIds: z.array(z.string().uuid()).max(100).optional(),
  posProfileIds: z.array(z.string().uuid()).max(100).optional(),
})

// POST /api/users body: direct creation or email invite (mode omitted = invite)
export const createUserBodySchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !Array.isArray(v) && !(v as { mode?: unknown }).mode
    ? { ...(v as object), mode: 'invite' }
    : v),
  z.discriminatedUnion('mode', [
    createStaffSchema,
    createInviteSchema.extend({ mode: z.literal('invite') }),
  ]),
)

// PUT /api/users/[id]/pos-profiles
export const updateUserPosProfilesSchema = z.object({
  posProfileIds: z.array(z.string().uuid()).max(100),
  defaultPosProfileId: z.string().uuid().optional(),
})

// PUT /api/tenant
export const scaleBarcodeSchema = z.object({
  enabled: z.boolean(),
  prefixes: z.array(z.string().regex(/^\d{1,3}$/)).min(1).max(10),
  pluStart: z.coerce.number().int().min(1).max(11),
  pluLength: z.coerce.number().int().min(1).max(10),
  valueStart: z.coerce.number().int().min(1).max(11),
  valueLength: z.coerce.number().int().min(1).max(10),
  valueType: z.enum(['weight', 'price']),
  valueDecimals: z.coerce.number().int().min(0).max(4),
  checkDigit: z.boolean().optional(),
})

export const updateTenantSchema = z.object({
  businessType: businessTypeSchema.optional(),
  timezone: z.string().max(100).optional(),
  aiEnabled: z.boolean().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  taxInclusive: z.boolean().optional(),
  /** Weighing-scale barcode layout (stored in tenants.settings.scaleBarcode) */
  scaleBarcode: scaleBarcodeSchema.optional(),
  // Business profile (W7 receipts)
  name: z.string().trim().min(1).max(255).optional(),
  legalName: z.string().trim().max(255).nullish(),
  address: z.string().trim().max(500).nullish(),
  phone: z.string().trim().max(50).nullish(),
  email: z.string().trim().email().max(255).optional(),
  website: z.string().trim().max(255).nullish(),
  taxId: z.string().trim().max(50).nullish(),
  brn: z.string().trim().max(50).nullish(),
  receiptSettings: receiptSettingsPatchSchema.optional(),
})

// PUT /api/print-settings
const marginsSchema = z.object({
  top: z.coerce.number().min(0).max(50),
  right: z.coerce.number().min(0).max(50),
  bottom: z.coerce.number().min(0).max(50),
  left: z.coerce.number().min(0).max(50),
})

const printDocSettingsSchema = z.object({
  copies: z.coerce.number().int().min(1).max(5).optional(),
  margins: marginsSchema.optional(),
}).optional()

export const updatePrintSettingsSchema = z.object({
  receipt: printDocSettingsSchema,
  work_order: printDocSettingsSchema,
  estimate: printDocSettingsSchema,
  invoice: printDocSettingsSchema,
  purchase_order: printDocSettingsSchema,
  purchase_invoice: printDocSettingsSchema,
  stock_transfer: printDocSettingsSchema,
})

// PUT /api/sms-settings
export const updateSmsSettingsSchema = z.object({
  isEnabled: z.boolean().optional(),
  genericApiUrl: z.string().max(500).optional(),
  genericMethod: z.enum(['POST', 'GET']).optional(),
  genericMessageParam: z.string().max(50).default('text'),
  genericRecipientParam: z.string().max(50).default('to'),
  genericStaticParams: z.array(z.object({
    key: z.string().max(100),
    value: z.string().max(500),
  })).optional(),
  dailyLimit: z.coerce.number().int().min(1).max(10000).default(500),
  monthlyLimit: z.coerce.number().int().min(1).max(100000).default(10000),
})

// POST /api/sms-settings/test
export const testSmsSchema = z.object({
  action: z.literal('send_test'),
  testPhone: z.string().min(7).max(20),
})

// PUT /api/users/[id]/warehouses
export const updateUserWarehousesSchema = z.object({
  warehouseIds: z.array(z.string().uuid()).min(0),
})

// GET /api/activity-logs
export const activityLogsListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  entityType: z.string().max(50).optional(),
  action: z.string().max(200).optional(), // Comma-separated
  userId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})
