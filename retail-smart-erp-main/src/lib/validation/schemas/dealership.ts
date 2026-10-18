import { z } from 'zod'
import {
  paginatedSearchSchema,
  paginationSchema,
  emailSchema,
  optionalUuid,
  uuidSchema,
  dateStringSchema,
  timeStringSchema,
} from './common'

// ==================== DEALERS ====================

// Dealer type/status enums (varchar fields in schema)
export const dealerTypeValues = ['authorized', 'sub_dealer', 'agent', 'franchise'] as const
export const dealerTypeSchema = z.enum(dealerTypeValues)

export const dealerStatusValues = ['active', 'suspended', 'inactive'] as const
export const dealerStatusSchema = z.enum(dealerStatusValues)

// GET /api/dealers
export const dealersListSchema = paginatedSearchSchema.extend({
  status: z.string().max(20).optional(),
  type: z.string().max(20).optional(),
})

// POST /api/dealers
export const createDealerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  code: z.string().trim().min(1, 'Code is required').max(50),
  type: dealerTypeSchema.default('authorized'),
  contactPerson: z.string().trim().max(255).nullish(),
  email: emailSchema.nullish(),
  phone: z.string().max(50).nullish(),
  address: z.string().max(5000).nullish(),
  warehouseId: optionalUuid,
  territory: z.string().max(255).nullish(),
  commissionRate: z.coerce.number().min(0).max(100).nullish(),
  creditLimit: z.coerce.number().min(0).nullish(),
  paymentTermDays: z.coerce.number().int().min(0).default(30),
  status: dealerStatusSchema.default('active'),
  contractStartDate: z.string().nullish(),
  contractEndDate: z.string().nullish(),
  notes: z.string().max(5000).nullish(),
})

// PUT /api/dealers/[id]
export const updateDealerSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  code: z.string().trim().min(1).max(50).optional(),
  type: dealerTypeSchema.optional(),
  contactPerson: z.string().trim().max(255).nullish(),
  email: emailSchema.nullish(),
  phone: z.string().max(50).nullish(),
  address: z.string().max(5000).nullish(),
  warehouseId: optionalUuid,
  territory: z.string().max(255).nullish(),
  commissionRate: z.coerce.number().min(0).max(100).nullish(),
  creditLimit: z.coerce.number().min(0).nullish(),
  paymentTermDays: z.coerce.number().int().min(0).optional(),
  status: dealerStatusSchema.optional(),
  contractStartDate: z.string().nullish(),
  contractEndDate: z.string().nullish(),
  notes: z.string().max(5000).nullish(),
  isActive: z.boolean().optional(),
})

// ==================== DEALER ALLOCATIONS ====================

// Allocation status enum
export const allocationStatusValues = ['allocated', 'returned', 'sold'] as const
export const allocationStatusSchema = z.enum(allocationStatusValues)

// GET /api/dealer-allocations
export const dealerAllocationsListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  dealerId: z.string().uuid().optional(),
  vehicleInventoryId: z.string().uuid().optional(),
  status: z.string().max(20).optional(),
})

// POST /api/dealer-allocations
export const createDealerAllocationSchema = z.object({
  dealerId: uuidSchema,
  vehicleInventoryId: uuidSchema,
  askingPrice: z.coerce.number().min(0).nullish(),
  minimumPrice: z.coerce.number().min(0).nullish(),
  notes: z.string().max(5000).nullish(),
})

// PUT /api/dealer-allocations/[id]
export const updateDealerAllocationSchema = z.object({
  status: allocationStatusSchema.optional(),
  returnReason: z.string().max(1000).nullish(),
  askingPrice: z.coerce.number().min(0).nullish(),
  minimumPrice: z.coerce.number().min(0).nullish(),
  notes: z.string().max(5000).optional(),
})

// ==================== DEALER PAYMENTS ====================

// Dealer payment type/direction/status enums
export const dealerPaymentTypeValues = ['advance', 'settlement', 'commission', 'refund', 'adjustment'] as const
export const dealerPaymentTypeSchema = z.enum(dealerPaymentTypeValues)

export const dealerPaymentDirectionValues = ['inbound', 'outbound'] as const
export const dealerPaymentDirectionSchema = z.enum(dealerPaymentDirectionValues)

export const dealerPaymentStatusValues = ['pending', 'confirmed', 'cancelled'] as const
export const dealerPaymentStatusSchema = z.enum(dealerPaymentStatusValues)

export const dealerPaymentMethodValues = ['cash', 'bank_transfer', 'cheque', 'offset'] as const
export const dealerPaymentMethodSchema = z.enum(dealerPaymentMethodValues)

// GET /api/dealer-payments
export const dealerPaymentsListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  dealerId: z.string().uuid().optional(),
  type: z.string().max(20).optional(),
  direction: z.string().max(10).optional(),
  status: z.string().max(20).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// POST /api/dealer-payments
export const createDealerPaymentSchema = z.object({
  dealerId: uuidSchema,
  type: dealerPaymentTypeSchema,
  direction: dealerPaymentDirectionSchema,
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  paymentMethod: dealerPaymentMethodSchema.nullish(),
  referenceNo: z.string().max(100).nullish(),
  vehicleInventoryId: optionalUuid,
  dealerAllocationId: optionalUuid,
  saleId: optionalUuid,
  paymentDate: z.string().nullish(),
  dueDate: z.string().nullish(),
  notes: z.string().max(5000).nullish(),
})

// PUT /api/dealer-payments/[id]
export const updateDealerPaymentSchema = z.object({
  type: dealerPaymentTypeSchema.optional(),
  direction: dealerPaymentDirectionSchema.optional(),
  paymentMethod: dealerPaymentMethodSchema.nullish(),
  referenceNo: z.string().max(100).nullish(),
  paymentDate: z.string().nullish(),
  dueDate: z.string().nullish(),
  notes: z.string().max(5000).optional(),
  cancellationReason: z.string().trim().min(1).max(1000).optional(),
})

// ==================== DEALER DETAIL ====================

// GET /api/dealers/[id]/statement
export const dealerStatementSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// ==================== TRADE-INS ====================

// Trade-in status and condition enums
export const tradeInStatusValues = ['pending', 'accepted', 'rejected', 'added_to_inventory'] as const
export const tradeInStatusSchema = z.enum(tradeInStatusValues)

export const tradeInConditionValues = ['new', 'excellent', 'good', 'fair', 'poor', 'salvage', 'used'] as const
export const tradeInConditionSchema = z.enum(tradeInConditionValues)

// GET /api/trade-ins
export const tradeInsListSchema = paginationSchema.extend({
  status: z.string().max(20).optional(),
  saleId: z.string().uuid().optional(),
})

// POST /api/trade-ins
export const createTradeInSchema = z.object({
  saleId: optionalUuid,
  make: z.string().trim().min(1, 'Make is required').max(100),
  model: z.string().trim().min(1, 'Model is required').max(100),
  year: z.coerce.number().int().min(1900).max(2100),
  vin: z.string().trim().max(50).nullish(),
  mileage: z.coerce.number().int().min(0).nullish(),
  condition: z.string().max(20).nullish(),
  color: z.string().max(50).nullish(),
  appraisalValue: z.coerce.number().min(0).nullish(),
  tradeInAllowance: z.coerce.number().min(0).nullish(),
  conditionNotes: z.string().max(5000).nullish(),
  appraisedBy: optionalUuid,
})

// PUT /api/trade-ins/[id]
export const updateTradeInSchema = z.object({
  saleId: optionalUuid,
  make: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  vin: z.string().trim().max(50).nullish(),
  mileage: z.coerce.number().int().min(0).nullish(),
  condition: z.string().max(20).nullish(),
  color: z.string().max(50).nullish(),
  appraisalValue: z.coerce.number().min(0).nullish(),
  tradeInAllowance: z.coerce.number().min(0).nullish(),
  conditionNotes: z.string().max(5000).nullish(),
  appraisedBy: optionalUuid,
  status: tradeInStatusSchema.optional(),
})

// ==================== TEST DRIVES ====================

// Test drive status enum
export const testDriveStatusValues = ['scheduled', 'completed', 'cancelled', 'no_show'] as const
export const testDriveStatusSchema = z.enum(testDriveStatusValues)

// GET /api/test-drives
export const testDrivesListSchema = paginationSchema.extend({
  status: z.string().max(20).optional(),
  vehicleInventoryId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

// POST /api/test-drives
export const createTestDriveSchema = z.object({
  vehicleInventoryId: uuidSchema,
  customerId: optionalUuid,
  salespersonId: optionalUuid,
  scheduledDate: dateStringSchema,
  scheduledTime: z.string().max(10).nullish(),
  durationMinutes: z.coerce.number().int().min(1).max(480).default(30),
  customerName: z.string().trim().max(255).nullish(),
  customerPhone: z.string().max(50).nullish(),
  customerEmail: z.string().max(255).nullish(),
  notes: z.string().max(5000).nullish(),
}).refine(
  (data) => data.customerId || data.customerName,
  { message: 'Customer or customer name is required', path: ['customerName'] }
)

// PUT /api/test-drives/[id]
export const updateTestDriveSchema = z.object({
  vehicleInventoryId: z.string().uuid().optional(),
  customerId: optionalUuid,
  salespersonId: optionalUuid,
  scheduledDate: dateStringSchema.optional(),
  scheduledTime: z.string().max(10).nullish(),
  durationMinutes: z.coerce.number().int().min(1).max(480).nullish(),
  customerName: z.string().trim().max(255).nullish(),
  customerPhone: z.string().max(50).nullish(),
  customerEmail: z.string().max(255).nullish(),
  status: testDriveStatusSchema.optional(),
  notes: z.string().max(5000).nullish(),
  feedback: z.string().max(5000).nullish(),
  cancellationReason: z.string().max(1000).nullish(),
})

// ==================== FINANCING OPTIONS ====================

// Financing loan type enum
export const financingLoanTypeValues = ['new', 'used', 'refinance'] as const
export const financingLoanTypeSchema = z.enum(financingLoanTypeValues)

// GET /api/financing-options
export const financingOptionsListSchema = paginatedSearchSchema.extend({
  isActive: z.string().optional(),
})

// POST /api/financing-options
export const createFinancingOptionSchema = z.object({
  lenderName: z.string().trim().min(1, 'Lender name is required').max(100),
  contactInfo: z.string().max(255).nullish(),
  loanType: z.string().max(50).nullish(),
  minAmount: z.coerce.number().min(0).nullish(),
  maxAmount: z.coerce.number().min(0).nullish(),
  minTermMonths: z.coerce.number().int().min(0).nullish(),
  maxTermMonths: z.coerce.number().int().min(0).nullish(),
  interestRateMin: z.coerce.number().min(0).max(100).nullish(),
  interestRateMax: z.coerce.number().min(0).max(100).nullish(),
  notes: z.string().max(5000).nullish(),
  isActive: z.boolean().default(true),
})

// PUT /api/financing-options (same shape, all optional)
export const updateFinancingOptionSchema = z.object({
  lenderName: z.string().trim().min(1).max(100).optional(),
  contactInfo: z.string().max(255).nullish(),
  loanType: z.string().max(50).nullish(),
  minAmount: z.coerce.number().min(0).nullish(),
  maxAmount: z.coerce.number().min(0).nullish(),
  minTermMonths: z.coerce.number().int().min(0).nullish(),
  maxTermMonths: z.coerce.number().int().min(0).nullish(),
  interestRateMin: z.coerce.number().min(0).max(100).nullish(),
  interestRateMax: z.coerce.number().min(0).max(100).nullish(),
  notes: z.string().max(5000).nullish(),
  isActive: z.boolean().optional(),
})

// ==================== APPOINTMENTS ====================

// POST /api/appointments/check-conflicts
export const checkAppointmentConflictsSchema = z.object({
  scheduledDate: dateStringSchema,
  scheduledTime: timeStringSchema,
  durationMinutes: z.coerce.number().int().min(1).max(480).default(60),
  excludeAppointmentId: optionalUuid,
})

// POST /api/appointments/check-customer
export const checkCustomerAppointmentsSchema = z.object({
  vehicleId: z.string().uuid().optional(),
  excludeAppointmentId: optionalUuid,
})
