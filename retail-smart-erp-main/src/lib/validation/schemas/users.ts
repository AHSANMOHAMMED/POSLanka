import { z } from 'zod'
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
}).merge(optimisticLockSchema)

// POST /api/users (invite or add user)
export const createInviteSchema = z.object({
  email: emailSchema,
  role: userRoleSchema,
  fullName: z.string().trim().max(255).optional(),
  warehouseIds: z.array(z.string().uuid()).optional(),
})

// PUT /api/tenant
export const updateTenantSchema = z.object({
  businessType: businessTypeSchema.optional(),
  timezone: z.string().max(100).optional(),
  aiEnabled: z.boolean().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  taxInclusive: z.boolean().optional(),
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
