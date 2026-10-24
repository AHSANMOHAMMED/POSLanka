import { z } from 'zod'
import { receiptSettingsPatchSchema } from '@/lib/print/receipt-settings'
import { uuidSchema, optionalUuid, paymentMethodSchema } from './common'

// GET /api/pos-opening-entries
export const posOpeningListSchema = z.object({
  status: z.enum(['open', 'closed', 'all']).optional(),
  userId: z.string().uuid().optional(),
  current: z.string().optional().transform(v => v === 'true'),
})

const openingBalanceSchema = z.object({
  paymentMethod: paymentMethodSchema,
  amount: z.coerce.number().min(0),
})

// POST /api/pos-opening-entries
export const createPosOpeningSchema = z.object({
  posProfileId: uuidSchema,
  openingBalances: z.array(openingBalanceSchema).max(50).optional(),
  notes: z.string().max(2000).optional(),
})

const closingAmountSchema = z.object({
  paymentMethod: paymentMethodSchema,
  amount: z.coerce.number().min(0, 'Amount cannot be negative'),
})

/** H1: why the counted drawer differs from the expected amount (required when it does) */
export const SHIFT_VARIANCE_REASONS = [
  'counting_error', 'change_error', 'unrecorded_sale', 'unrecorded_expense',
  'card_terminal_mismatch', 'theft_suspected', 'other',
] as const

// POST /api/pos-opening-entries/[id]/close
export const closePosShiftSchema = z.object({
  actualAmounts: z.array(closingAmountSchema).min(1, 'At least one payment method amount is required').max(50),
  notes: z.string().max(2000).optional(),
  varianceReason: z.enum(SHIFT_VARIANCE_REASONS).optional(),
  varianceNote: z.string().trim().max(1000).optional(),
  version: z.string().optional(), // Optimistic locking
}).superRefine((data, ctx) => {
  if (data.varianceReason === 'other' && !data.varianceNote) {
    ctx.addIssue({ code: 'custom', path: ['varianceNote'], message: 'Describe the variance when the reason is "other"' })
  }
})

// ==================== H1: CASH PAID IN / PAID OUT ====================

export const CASH_MOVEMENT_CATEGORIES = {
  paid_out: ['petty_expense', 'supplier_payment', 'bank_drop', 'other'],
  paid_in: ['float_top_up', 'other'],
} as const

// GET /api/pos-cash-movements
export const posCashMovementListSchema = z.object({
  openingEntryId: z.string().uuid(),
})

// POST /api/pos-cash-movements
export const createPosCashMovementSchema = z.object({
  openingEntryId: uuidSchema,
  type: z.enum(['paid_in', 'paid_out']),
  category: z.enum(['petty_expense', 'supplier_payment', 'bank_drop', 'float_top_up', 'other']),
  amount: z.coerce.number().positive('Amount must be greater than zero').max(100_000_000),
  accountId: optionalUuid,
  note: z.string().trim().max(1000).optional(),
  /** Supervisor approval (POST /api/auth/verify-pin → approvalToken) */
  approvalToken: z.string().max(2000).optional(),
}).superRefine((data, ctx) => {
  if (!(CASH_MOVEMENT_CATEGORIES[data.type] as readonly string[]).includes(data.category)) {
    ctx.addIssue({ code: 'custom', path: ['category'], message: `"${data.category}" is not a ${data.type === 'paid_in' ? 'paid-in' : 'paid-out'} category` })
  }
  if (data.category === 'other' && !data.note) {
    ctx.addIssue({ code: 'custom', path: ['note'], message: 'A note is required for "other" cash movements' })
  }
})

// POST /api/pos-cash-movements/[id]/void
export const voidPosCashMovementSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(1000),
  approvalToken: z.string().max(2000).optional(),
})

// GET /api/pos-closing-entries
export const posClosingListSchema = z.object({
  status: z.enum(['draft', 'submitted', 'cancelled']).optional(),
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// GET /api/pos-daily-summary
export const posDailySummarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
})

// ==================== POS PROFILES ====================

const posProfilePaymentMethodInputSchema = z.union([
  z.string().max(50),
  z.object({
    paymentMethod: z.string().max(50),
    isDefault: z.boolean().optional(),
    allowInReturns: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).optional(),
  }),
])

const posProfileUserAssignmentSchema = z.union([
  uuidSchema,
  z.object({
    userId: uuidSchema,
    isDefault: z.boolean().optional(),
  }),
])

// POST /api/pos-profiles
export const createPosProfileSchema = z.object({
  name: z.string().trim().min(1, 'Profile name is required').max(255),
  code: z.string().trim().max(50).nullish(),
  warehouseId: uuidSchema,
  costCenterId: uuidSchema,
  isDefault: z.boolean().default(false),
  applyDiscountOn: z.enum(['grand_total', 'net_total']).default('grand_total'),
  // Permissions
  allowRateChange: z.boolean().default(true),
  allowDiscountChange: z.boolean().default(true),
  maxDiscountPercent: z.coerce.number().min(0).max(100).default(100),
  /** K1: drawer expenses a cashier may record without a supervisor (null = always approve) */
  expenseLimit: z.coerce.number().min(0).max(100_000_000).nullish(),
  allowNegativeStock: z.boolean().default(false),
  validateStockOnSave: z.boolean().default(true),
  // Display
  hideUnavailableItems: z.boolean().default(true),
  autoAddItemToCart: z.boolean().default(false),
  // Print
  printReceiptOnComplete: z.boolean().default(false),
  skipPrintPreview: z.boolean().default(false),
  receiptPrintFormat: z.string().max(50).default('80mm'),
  showLogoOnReceipt: z.boolean().default(true),
  receiptHeader: z.string().max(2000).nullish(),
  receiptFooter: z.string().max(2000).nullish(),
  receiptSettings: receiptSettingsPatchSchema.optional(),
  // Payment
  defaultPaymentMethod: z.string().max(50).default('cash'),
  allowCreditSale: z.boolean().default(true),
  // Child records
  paymentMethods: z.array(posProfilePaymentMethodInputSchema).max(20).default(['cash', 'card']),
  userIds: z.array(uuidSchema).max(100).default([]),
  userAssignments: z.array(posProfileUserAssignmentSchema).max(100).optional(),
}).refine(
  (data) => {
    const hasUsers = (data.userAssignments && data.userAssignments.length > 0) || data.userIds.length > 0
    return hasUsers
  },
  { message: 'At least one user must be assigned to the POS profile', path: ['userAssignments'] }
)

// PUT /api/pos-profiles/[id]
export const updatePosProfileSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  code: z.string().trim().max(50).nullish(),
  warehouseId: optionalUuid,
  defaultCustomerId: optionalUuid,
  costCenterId: optionalUuid,
  isDefault: z.boolean().optional(),
  applyDiscountOn: z.enum(['grand_total', 'net_total']).optional(),
  allowRateChange: z.boolean().optional(),
  allowDiscountChange: z.boolean().optional(),
  maxDiscountPercent: z.coerce.number().min(0).max(100).optional(),
  expenseLimit: z.coerce.number().min(0).max(100_000_000).nullish(),
  allowNegativeStock: z.boolean().optional(),
  validateStockOnSave: z.boolean().optional(),
  hideUnavailableItems: z.boolean().optional(),
  autoAddItemToCart: z.boolean().optional(),
  printReceiptOnComplete: z.boolean().optional(),
  skipPrintPreview: z.boolean().optional(),
  receiptPrintFormat: z.string().max(50).optional(),
  showLogoOnReceipt: z.boolean().optional(),
  receiptHeader: z.string().max(2000).nullish(),
  receiptFooter: z.string().max(2000).nullish(),
  receiptSettings: receiptSettingsPatchSchema.optional(),
  defaultPaymentMethod: z.string().max(50).optional(),
  allowCreditSale: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  // Child records (replace all)
  paymentMethods: z.array(posProfilePaymentMethodInputSchema).max(20).optional(),
  userIds: z.array(uuidSchema).max(100).optional(),
  userAssignments: z.array(posProfileUserAssignmentSchema).max(100).optional(),
  categoryIds: z.array(uuidSchema).max(100).optional(),
})

// PUT /api/pos-closing-entries/[id]
export const updatePosClosingEntrySchema = z.object({
  status: z.enum(['submitted', 'cancelled']).optional(),
  notes: z.string().max(2000).nullish(),
  cancellationReason: z.string().min(1, 'Cancellation reason is required').max(2000).optional(),
})

// PUT /api/pos-opening-entries/[id]
export const updatePosOpeningEntrySchema = z.object({
  notes: z.string().max(2000).nullish(),
  status: z.enum(['cancelled']).optional(),
  cancellationReason: z.string().min(1, 'Cancellation reason is required').max(2000).optional(),
})

// POST /api/pos-profiles/[id]/payment-methods
const paymentMethodEntrySchema = z.union([
  paymentMethodSchema,
  z.object({
    paymentMethod: paymentMethodSchema,
    isDefault: z.boolean().optional(),
    allowInReturns: z.boolean().default(true),
  }),
])

export const posProfilePaymentMethodsSchema = z.object({
  paymentMethods: z.array(paymentMethodEntrySchema).min(1, 'At least one payment method required').max(20),
})

// POST /api/pos-profiles/[id]/users
export const posProfileUsersSchema = z.object({
  userIds: z.array(uuidSchema).min(1, 'At least one user required').max(100),
  defaultUserId: optionalUuid,
})

// POST /api/pos-profiles/[id]/item-groups
export const posProfileItemGroupsSchema = z.object({
  categoryIds: z.array(uuidSchema).min(1, 'At least one category required').max(100),
})

// PUT /api/pos-profiles/[id]/item-groups (add single category)
export const posProfileAddCategorySchema = z.object({
  categoryId: uuidSchema,
})

// PUT /api/pos-profiles/[id]/users (add single user)
export const posProfileAddUserSchema = z.object({
  userId: uuidSchema,
  isDefault: z.boolean().optional().default(false),
})
