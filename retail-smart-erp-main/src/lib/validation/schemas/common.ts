import { z } from 'zod'

// ==================== ATOMIC FIELD SCHEMAS ====================

/** UUID v4 format */
export const uuidSchema = z.string().uuid('Invalid UUID format')

/** Optional UUID - common for optional FK references.
 *  Accepts empty string (from HTML select defaults) and converts to undefined. */
export const optionalUuid = z.union([
  z.literal('').transform(() => undefined),
  z.string().uuid(),
]).nullish()

/** Date string in YYYY-MM-DD format */
export const dateStringSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Date must be in YYYY-MM-DD format'
)

/** Optional date string */
export const optionalDateString = dateStringSchema.nullish()

/** ISO datetime string */
export const isoDateTimeSchema = z.iso.datetime({ message: 'Invalid datetime format' })

/** Time string in HH:MM format */
export const timeStringSchema = z.string().regex(
  /^\d{2}:\d{2}$/,
  'Time must be in HH:MM format'
)

/** Email with normalization */
export const emailSchema = z.email('Invalid email format').max(255).transform(v => v.toLowerCase().trim())

/** Phone number (7-15 digits, allows formatting chars).
 *  Normalizes to digits-only with optional leading '+' for consistent storage. */
export const phoneSchema = z.string()
  .min(7, 'Phone must have at least 7 digits')
  .max(20, 'Phone number too long')
  .refine(
    (v) => {
      const digits = v.replace(/\D/g, '')
      return digits.length >= 7 && digits.length <= 15
    },
    'Phone number must contain 7-15 digits'
  )
  .transform((v) => {
    const hasPlus = v.trimStart().startsWith('+')
    const digits = v.replace(/\D/g, '')
    return hasPlus ? `+${digits}` : digits
  })

/** Currency amount (>= 0) */
export const currencyAmountSchema = z.coerce.number().min(0, 'Amount cannot be negative')

/** Positive currency amount (> 0) */
export const positiveCurrencySchema = z.coerce.number().positive('Amount must be greater than zero')

/** Non-negative number (>= 0) */
export const nonNegativeNumberSchema = z.coerce.number().min(0, 'Value cannot be negative')

/** Strictly positive number (> 0) */
export const positiveNumberSchema = z.coerce.number().positive('Value must be greater than zero')

/** Integer >= 0 */
export const nonNegativeIntSchema = z.coerce.number().int().min(0)

/** Integer > 0 */
export const positiveIntSchema = z.coerce.number().int().positive()

/** Percentage (0-100) */
export const percentageSchema = z.coerce.number().min(0, 'Percentage cannot be negative').max(100, 'Percentage cannot exceed 100')

/** Short text field (names, titles) - required */
export const shortTextSchema = z.string().trim().min(1, 'Required').max(255)

/** Medium text field (descriptions) - optional content allowed */
export const mediumTextSchema = z.string().trim().max(1000)

/** Long text field (notes, remarks) */
export const longTextSchema = z.string().trim().max(5000)

/** Sort order */
export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc')

/** Password with strength requirements (matches validatePasswordStrength in validation.ts) */
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters long')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')

// ==================== COMPOSITE SCHEMAS ====================

/** Standard pagination params for GET endpoints */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  all: z.string().optional().transform(v => v === 'true'),
})

/** Pagination + search (most common GET pattern) */
export const paginatedSearchSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
})

/** Date range filter (fromDate, toDate) */
export const dateRangeSchema = z.object({
  fromDate: dateStringSchema.optional(),
  toDate: dateStringSchema.optional(),
}).refine(
  (data) => {
    if (data.fromDate && data.toDate) {
      return data.fromDate <= data.toDate
    }
    return true
  },
  { message: 'fromDate must be before toDate', path: ['toDate'] }
)

/** Path params with a single UUID id */
export const idParamSchema = z.object({
  id: uuidSchema,
})

/** Optimistic locking mixin */
export const optimisticLockSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
})

/** Cancellation with required reason */
export const cancellationSchema = z.object({
  cancellationReason: z.string().trim().min(1, 'Cancellation reason is required').max(1000),
})

/** Reusable address block */
export const addressSchema = z.object({
  addressLine1: z.string().max(255).nullish(),
  addressLine2: z.string().max(255).nullish(),
  city: z.string().max(100).nullish(),
  state: z.string().max(100).nullish(),
  postalCode: z.string().max(20).nullish(),
  country: z.string().max(100).nullish(),
})

/** Cart item for sales, layaways, etc. */
export const cartItemSchema = z.object({
  itemId: uuidSchema,
  name: z.string().max(255).optional(),
  sku: z.string().max(100).optional(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
  discount: z.coerce.number().min(0).default(0),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  taxRate: z.coerce.number().min(0).optional(),
  serialNumberIds: z.array(uuidSchema).optional(),
  batchId: optionalUuid,
  notes: z.string().max(500).optional(),
})

/** Cart items array with bounds */
export const cartItemsSchema = z.array(cartItemSchema).min(1, 'Cart cannot be empty').max(200, 'Maximum 200 items')

// ==================== ENUM SCHEMAS ====================
// Each mirrors a pgEnum from src/lib/db/schema.ts

// Core enums
export const planValues = ['trial', 'basic', 'standard', 'premium'] as const
export const planSchema = z.enum(planValues) // schema.ts: planEnum

export const tenantStatusValues = ['active', 'suspended', 'cancelled', 'locked'] as const
export const tenantStatusSchema = z.enum(tenantStatusValues) // schema.ts: tenantStatusEnum

export const businessTypeValues = ['retail', 'restaurant', 'supermarket', 'auto_service', 'dealership'] as const
export const businessTypeSchema = z.enum(businessTypeValues) // schema.ts: businessTypeEnum

export const userRoleValues = [
  'owner', 'manager', 'cashier', 'technician', 'chef', 'waiter',
  'system_manager', 'accounts_manager', 'sales_manager', 'purchase_manager',
  'hr_manager', 'stock_manager', 'pos_user', 'report_user', 'dealer_sales'
] as const
export const userRoleSchema = z.enum(userRoleValues) // schema.ts: userRoleEnum

export const paymentMethodValues = ['cash', 'card', 'bank_transfer', 'credit', 'gift_card'] as const
export const paymentMethodSchema = z.enum(paymentMethodValues) // schema.ts: paymentMethodEnum

export const saleStatusValues = ['pending', 'partial', 'completed', 'void'] as const
export const saleStatusSchema = z.enum(saleStatusValues) // schema.ts: saleStatusEnum

export const discountTypeValues = ['percentage', 'fixed'] as const
export const discountTypeSchema = z.enum(discountTypeValues) // schema.ts: discountTypeEnum

// Work order / service enums
export const workOrderStatusValues = ['draft', 'confirmed', 'in_progress', 'completed', 'invoiced', 'cancelled'] as const
export const workOrderStatusSchema = z.enum(workOrderStatusValues) // schema.ts: workOrderStatusEnum

export const appointmentStatusValues = ['scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'] as const
export const appointmentStatusSchema = z.enum(appointmentStatusValues) // schema.ts: appointmentStatusEnum

// Restaurant enums
export const reservationStatusValues = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'] as const
export const reservationStatusSchema = z.enum(reservationStatusValues) // schema.ts: reservationStatusEnum

export const tableStatusValues = ['available', 'occupied', 'reserved', 'unavailable'] as const
export const tableStatusSchema = z.enum(tableStatusValues) // schema.ts: tableStatusEnum

export const orderTypeValues = ['dine_in', 'takeaway', 'delivery'] as const
export const orderTypeSchema = z.enum(orderTypeValues) // schema.ts: orderTypeEnum

export const deliveryStatusValues = ['pending', 'dispatched', 'in_transit', 'delivered', 'failed'] as const
export const deliveryStatusSchema = z.enum(deliveryStatusValues) // schema.ts: deliveryStatusEnum

export const kitchenOrderStatusValues = ['pending', 'preparing', 'ready', 'served', 'cancelled'] as const
export const kitchenOrderStatusSchema = z.enum(kitchenOrderStatusValues) // schema.ts: kitchenOrderStatusEnum

// Stock enums
export const stockMovementTypeValues = ['in', 'out', 'adjustment'] as const
export const stockMovementTypeSchema = z.enum(stockMovementTypeValues) // schema.ts: stockMovementTypeEnum

export const stockTransferStatusValues = ['draft', 'pending_approval', 'approved', 'in_transit', 'completed', 'cancelled', 'rejected'] as const
export const stockTransferStatusSchema = z.enum(stockTransferStatusValues) // schema.ts: stockTransferStatusEnum

export const stockTakeStatusValues = ['draft', 'in_progress', 'pending_review', 'completed', 'cancelled'] as const
export const stockTakeStatusSchema = z.enum(stockTakeStatusValues) // schema.ts: stockTakeStatusEnum

export const batchStatusValues = ['active', 'quarantine', 'expired', 'consumed'] as const
export const batchStatusSchema = z.enum(batchStatusValues) // schema.ts: batchStatusEnum

export const serialNumberStatusValues = ['available', 'reserved', 'sold', 'returned', 'defective', 'scrapped', 'lost'] as const
export const serialNumberStatusSchema = z.enum(serialNumberStatusValues) // schema.ts: serialNumberStatusEnum

// Layaway / gift card enums
export const layawayStatusValues = ['active', 'fully_paid', 'completed', 'cancelled', 'forfeited'] as const
export const layawayStatusSchema = z.enum(layawayStatusValues) // schema.ts: layawayStatusEnum

export const giftCardStatusValues = ['inactive', 'active', 'used', 'expired', 'blocked'] as const
export const giftCardStatusSchema = z.enum(giftCardStatusValues) // schema.ts: giftCardStatusEnum

// Loyalty / commission enums
export const loyaltyTierValues = ['bronze', 'silver', 'gold', 'platinum'] as const
export const loyaltyTierSchema = z.enum(loyaltyTierValues) // schema.ts: loyaltyTierEnum

export const commissionStatusValues = ['pending', 'approved', 'paid', 'cancelled'] as const
export const commissionStatusSchema = z.enum(commissionStatusValues) // schema.ts: commissionStatusEnum

export const payoutStatusValues = ['draft', 'approved', 'paid', 'cancelled'] as const
export const payoutStatusSchema = z.enum(payoutStatusValues) // schema.ts: payoutStatusEnum

// Vehicle / inspection enums
export const coreReturnStatusValues = ['pending', 'returned', 'forfeited'] as const
export const coreReturnStatusSchema = z.enum(coreReturnStatusValues) // schema.ts: coreReturnStatusEnum

export const estimateTypeValues = ['insurance', 'direct'] as const
export const estimateTypeSchema = z.enum(estimateTypeValues) // schema.ts: estimateTypeEnum

export const insuranceEstimateStatusValues = ['draft', 'submitted', 'under_review', 'approved', 'partially_approved', 'rejected', 'work_order_created', 'cancelled'] as const
export const insuranceEstimateStatusSchema = z.enum(insuranceEstimateStatusValues) // schema.ts: insuranceEstimateStatusEnum

export const estimateItemStatusValues = ['pending', 'approved', 'price_adjusted', 'rejected', 'requires_reinspection'] as const
export const estimateItemStatusSchema = z.enum(estimateItemStatusValues) // schema.ts: estimateItemStatusEnum

export const estimateItemTypeValues = ['service', 'part'] as const
export const estimateItemTypeSchema = z.enum(estimateItemTypeValues) // schema.ts: estimateItemTypeEnum

export const vehicleBodyTypeValues = [
  'motorcycle', 'scooter', 'three_wheeler',
  'sedan', 'hatchback', 'suv', 'pickup', 'van',
  'coupe', 'wagon', 'convertible', 'mini_truck',
  'lorry', 'bus', 'other'
] as const
export const vehicleBodyTypeSchema = z.enum(vehicleBodyTypeValues) // schema.ts: vehicleBodyTypeEnum

export const inspectionTypeValues = ['check_in', 'check_out'] as const
export const inspectionTypeSchema = z.enum(inspectionTypeValues) // schema.ts: inspectionTypeEnum

export const inspectionStatusValues = ['draft', 'completed'] as const
export const inspectionStatusSchema = z.enum(inspectionStatusValues) // schema.ts: inspectionStatusEnum

export const checklistResponseValues = ['ok', 'concern', 'fail', 'na'] as const
export const checklistResponseSchema = z.enum(checklistResponseValues) // schema.ts: checklistResponseEnum

export const damageTypeValues = ['scratch', 'dent', 'crack', 'rust', 'paint', 'broken', 'missing', 'other'] as const
export const damageTypeSchema = z.enum(damageTypeValues) // schema.ts: damageTypeEnum

export const damageSeverityValues = ['minor', 'moderate', 'severe'] as const
export const damageSeveritySchema = z.enum(damageSeverityValues) // schema.ts: damageSeverityEnum

export const checklistItemTypeValues = ['checkbox', 'select', 'text', 'number'] as const
export const checklistItemTypeSchema = z.enum(checklistItemTypeValues) // schema.ts: checklistItemTypeEnum

export const partConditionValues = ['new', 'refurbished', 'used'] as const
export const partConditionSchema = z.enum(partConditionValues) // schema.ts: partConditionEnum

// Recurrence / activity enums
export const recurrencePatternValues = ['none', 'daily', 'weekly', 'biweekly', 'monthly'] as const
export const recurrencePatternSchema = z.enum(recurrencePatternValues) // schema.ts: recurrencePatternEnum

export const activityActionValues = [
  'create', 'update', 'delete', 'status_change',
  'submit', 'approve', 'reject', 'cancel', 'convert',
  'login', 'logout', 'print', 'export', 'import'
] as const
export const activityActionSchema = z.enum(activityActionValues) // schema.ts: activityActionEnum

// Subscription / billing enums
export const subscriptionStatusValues = ['trial', 'active', 'past_due', 'cancelled', 'locked'] as const
export const subscriptionStatusSchema = z.enum(subscriptionStatusValues) // schema.ts: subscriptionStatusEnum

export const invoiceStatusValues = ['draft', 'pending', 'paid', 'failed'] as const
export const invoiceStatusSchema = z.enum(invoiceStatusValues) // schema.ts: invoiceStatusEnum

export const paymentDepositStatusValues = ['pending', 'approved', 'rejected'] as const
export const paymentDepositStatusSchema = z.enum(paymentDepositStatusValues) // schema.ts: paymentDepositStatusEnum

// Purchase enums
export const purchaseOrderStatusValues = ['draft', 'submitted', 'confirmed', 'partially_received', 'fully_received', 'invoice_created', 'cancelled'] as const
export const purchaseOrderStatusSchema = z.enum(purchaseOrderStatusValues) // schema.ts: purchaseOrderStatusEnum

export const salesOrderStatusValues = ['draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled'] as const
export const salesOrderStatusSchema = z.enum(salesOrderStatusValues) // schema.ts: salesOrderStatusEnum

export const purchaseStatusValues = ['draft', 'pending', 'partial', 'paid', 'cancelled'] as const
export const purchaseStatusSchema = z.enum(purchaseStatusValues) // schema.ts: purchaseStatusEnum

export const purchaseReceiptStatusValues = ['draft', 'completed', 'cancelled'] as const
export const purchaseReceiptStatusSchema = z.enum(purchaseReceiptStatusValues) // schema.ts: purchaseReceiptStatusEnum

export const purchaseRequisitionStatusValues = ['draft', 'pending_approval', 'approved', 'partially_ordered', 'ordered', 'rejected', 'cancelled'] as const
export const purchaseRequisitionStatusSchema = z.enum(purchaseRequisitionStatusValues) // schema.ts: purchaseRequisitionStatusEnum

export const supplierQuotationStatusValues = ['draft', 'submitted', 'received', 'awarded', 'rejected', 'expired', 'cancelled'] as const
export const supplierQuotationStatusSchema = z.enum(supplierQuotationStatusValues) // schema.ts: supplierQuotationStatusEnum

// Customer enums
export const customerBusinessTypeValues = ['individual', 'company'] as const
export const customerBusinessTypeSchema = z.enum(customerBusinessTypeValues) // schema.ts: customerBusinessTypeEnum

export const customerTypeValues = ['retail', 'wholesale', 'vip'] as const
export const customerTypeSchema = z.enum(customerTypeValues) // schema.ts: customerTypeEnum

// POS enums
export const posShiftStatusValues = ['open', 'closed', 'cancelled'] as const
export const posShiftStatusSchema = z.enum(posShiftStatusValues) // schema.ts: posShiftStatusEnum

export const posClosingStatusValues = ['draft', 'submitted', 'cancelled'] as const
export const posClosingStatusSchema = z.enum(posClosingStatusValues) // schema.ts: posClosingStatusEnum

// HR / Payroll enums
export const employmentTypeValues = ['full_time', 'part_time', 'contract', 'intern', 'probation'] as const
export const employmentTypeSchema = z.enum(employmentTypeValues) // schema.ts: employmentTypeEnum

export const employmentStatusValues = ['active', 'on_leave', 'suspended', 'terminated', 'resigned'] as const
export const employmentStatusSchema = z.enum(employmentStatusValues) // schema.ts: employmentStatusEnum

export const salaryComponentTypeValues = ['earning', 'deduction'] as const
export const salaryComponentTypeSchema = z.enum(salaryComponentTypeValues) // schema.ts: salaryComponentTypeEnum

export const salarySlipStatusValues = ['draft', 'submitted', 'cancelled'] as const
export const salarySlipStatusSchema = z.enum(salarySlipStatusValues) // schema.ts: salarySlipStatusEnum

export const payrollRunStatusValues = ['draft', 'processing', 'completed', 'failed', 'cancelled'] as const
export const payrollRunStatusSchema = z.enum(payrollRunStatusValues) // schema.ts: payrollRunStatusEnum

export const employeeAdvanceStatusValues = ['draft', 'pending_approval', 'approved', 'disbursed', 'partially_recovered', 'fully_recovered', 'cancelled'] as const
export const employeeAdvanceStatusSchema = z.enum(employeeAdvanceStatusValues) // schema.ts: employeeAdvanceStatusEnum

// Accounting enums
export const accountRootTypeValues = ['asset', 'liability', 'income', 'expense', 'equity'] as const
export const accountRootTypeSchema = z.enum(accountRootTypeValues) // schema.ts: accountRootTypeEnum

export const accountTypeValues = [
  'bank', 'cash', 'receivable', 'payable', 'stock', 'cost_of_goods_sold',
  'income_account', 'expense_account', 'tax', 'fixed_asset', 'depreciation',
  'accumulated_depreciation', 'equity', 'round_off', 'temporary',
  'current_asset', 'current_liability', 'capital_work_in_progress'
] as const
export const accountTypeSchema = z.enum(accountTypeValues) // schema.ts: accountTypeEnum

export const partyTypeValues = ['customer', 'supplier', 'employee'] as const
export const partyTypeSchema = z.enum(partyTypeValues) // schema.ts: partyTypeEnum

export const journalEntryTypeValues = ['journal', 'opening', 'adjustment', 'depreciation', 'closing'] as const
export const journalEntryTypeSchema = z.enum(journalEntryTypeValues) // schema.ts: journalEntryTypeEnum

export const journalEntryStatusValues = ['draft', 'submitted', 'cancelled'] as const
export const journalEntryStatusSchema = z.enum(journalEntryStatusValues) // schema.ts: journalEntryStatusEnum

export const bankTransactionStatusValues = ['unmatched', 'matched', 'reconciled'] as const
export const bankTransactionStatusSchema = z.enum(bankTransactionStatusValues) // schema.ts: bankTransactionStatusEnum

export const budgetControlActionValues = ['warn', 'stop', 'ignore'] as const
export const budgetControlActionSchema = z.enum(budgetControlActionValues) // schema.ts: budgetControlActionEnum

export const budgetStatusValues = ['draft', 'active', 'cancelled'] as const
export const budgetStatusSchema = z.enum(budgetStatusValues) // schema.ts: budgetStatusEnum

export const periodClosingStatusValues = ['draft', 'submitted'] as const
export const periodClosingStatusSchema = z.enum(periodClosingStatusValues) // schema.ts: periodClosingStatusEnum

// Payment module enums
export const modeOfPaymentTypeValues = ['cash', 'bank', 'general'] as const
export const modeOfPaymentTypeSchema = z.enum(modeOfPaymentTypeValues) // schema.ts: modeOfPaymentTypeEnum

export const dueDateBasedOnValues = ['days_after_invoice', 'days_after_month_end', 'months_after_month_end'] as const
export const dueDateBasedOnSchema = z.enum(dueDateBasedOnValues) // schema.ts: dueDateBasedOnEnum

export const paymentScheduleStatusValues = ['unpaid', 'partly_paid', 'paid', 'overdue'] as const
export const paymentScheduleStatusSchema = z.enum(paymentScheduleStatusValues) // schema.ts: paymentScheduleStatusEnum

export const paymentEntryTypeValues = ['receive', 'pay', 'internal_transfer'] as const
export const paymentEntryTypeSchema = z.enum(paymentEntryTypeValues) // schema.ts: paymentEntryTypeEnum

export const paymentEntryStatusValues = ['draft', 'submitted', 'cancelled'] as const
export const paymentEntryStatusSchema = z.enum(paymentEntryStatusValues) // schema.ts: paymentEntryStatusEnum

export const paymentEntryPartyTypeValues = ['customer', 'supplier'] as const
export const paymentEntryPartyTypeSchema = z.enum(paymentEntryPartyTypeValues) // schema.ts: paymentEntryPartyTypeEnum

// Letter head enum
export const letterHeadAlignmentValues = ['left', 'center', 'right'] as const
export const letterHeadAlignmentSchema = z.enum(letterHeadAlignmentValues) // schema.ts: letterHeadAlignmentEnum

// AI enums
export const aiLogLevelValues = ['error', 'warning', 'info'] as const
export const aiLogLevelSchema = z.enum(aiLogLevelValues) // schema.ts: aiLogLevelEnum

export const aiAlertTypeValues = ['anomaly', 'insight', 'error', 'suggestion'] as const
export const aiAlertTypeSchema = z.enum(aiAlertTypeValues) // schema.ts: aiAlertTypeEnum

export const aiAlertSeverityValues = ['low', 'medium', 'high', 'critical'] as const
export const aiAlertSeveritySchema = z.enum(aiAlertSeverityValues) // schema.ts: aiAlertSeverityEnum
