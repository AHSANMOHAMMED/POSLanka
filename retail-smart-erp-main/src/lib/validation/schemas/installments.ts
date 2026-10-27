import { z } from 'zod'
import { dateStringSchema, optionalUuid, paginatedSearchSchema } from './common'
import { chequeDetailsSchema } from './cheques'

// drizzle/0181: hire purchase / installment plans, deliveries, warranty claims

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).nullish())

/** Sri Lankan NIC: old 9 digits + V/X, or new 12 digits (not enforced strictly: passports too) */
const nicSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toUpperCase()) : v),
  z.string().max(20).regex(/^[0-9A-Z-]{5,20}$/, 'Enter a valid NIC / passport number').nullish(),
)

export const agreementItemSchema = z.object({
  itemId: optionalUuid,
  saleItemId: optionalUuid,
  itemName: z.string().trim().min(1, 'Item name is required').max(255),
  quantity: z.coerce.number().positive().max(100000),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000),
  serialNumbers: z.array(z.string().trim().min(1).max(255)).max(500).optional(),
})

export const installmentMethodSchema = z.enum(['cash', 'card', 'bank_transfer', 'cheque'], {
  message: 'Installments can be paid by cash, card, bank transfer or cheque',
})

// GET /api/installments
export const installmentsListSchema = paginatedSearchSchema.extend({
  status: z.enum(['active', 'completed', 'defaulted', 'cancelled', 'repossessed', 'all']).optional(),
  /** due = installments due today, overdue = unpaid past due (rows, not plans) */
  view: z.enum(['plans', 'due', 'overdue']).default('plans'),
  customerId: z.string().uuid().optional(),
  saleId: z.string().uuid().optional(),
})

// POST /api/installments/preview and POST /api/installments
export const installmentTermsSchema = z.object({
  cashPrice: z.coerce.number().positive('Cash price must be greater than zero').max(1_000_000_000),
  downPayment: z.coerce.number().min(0).max(1_000_000_000).default(0),
  interestType: z.enum(['flat', 'fixed']).default('flat'),
  /** flat: annual % on the financed amount; fixed: ignored */
  interestRate: z.coerce.number().min(0).max(200).default(0),
  /** fixed: total interest amount */
  interestAmount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  termMonths: z.coerce.number().int().min(1, 'Term must be at least 1 month').max(120),
  frequency: z.enum(['monthly', 'weekly']).default('monthly'),
  /** first installment due date */
  startDate: dateStringSchema,
  lateFeeType: z.enum(['none', 'fixed', 'percent']).default('none'),
  lateFeeValue: z.coerce.number().min(0).max(1_000_000).default(0),
  graceDays: z.coerce.number().int().min(0).max(90).default(0),
}).refine((d) => d.downPayment < d.cashPrice, { message: 'Down payment must be less than the cash price', path: ['downPayment'] })
  .refine((d) => d.lateFeeType !== 'percent' || d.lateFeeValue <= 100, { message: 'Late fee % cannot exceed 100', path: ['lateFeeValue'] })

export const createInstallmentPlanSchema = z.object({
  saleId: optionalUuid,
  customerId: optionalUuid,
  /** branch for a plan without a sale (a sale-linked plan takes the sale's branch) */
  warehouseId: optionalUuid,
  customerName: z.string().trim().min(1, 'Customer name is required').max(255),
  customerNic: nicSchema,
  customerPhone: optText(50),
  customerAddress: optText(1000),
  guarantorName: optText(255),
  guarantorNic: nicSchema,
  guarantorPhone: optText(50),
  guarantorAddress: optText(1000),
  items: z.array(agreementItemSchema).min(1, 'Add the goods on this agreement').max(100),
  terms: installmentTermsSchema,
  agreementTerms: optText(10000),
  notes: optText(2000),
  /** Down payment taken now (manual plan) — a sale-linked plan's down payment is already on the sale */
  recordDownPayment: z.boolean().default(false),
  downPaymentMethod: installmentMethodSchema.default('cash'),
  downPaymentReference: optText(255),
  /** 0186: cheque details when the down payment is by cheque (goes to the cheques register) */
  downPaymentCheque: chequeDetailsSchema.nullish(),
  /**
   * 0186: an agreement carried over from paper books / an old system (the sale was booked
   * there): its receivable is booked against Retained Earnings, not Sales Revenue
   */
  openingAgreement: z.boolean().default(false),
})

// POST /api/installments/[id]/payments
export const installmentPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero').max(1_000_000_000),
  paymentMethod: installmentMethodSchema.default('cash'),
  reference: optText(255),
  paymentDate: dateStringSchema.optional(),
  notes: optText(1000),
  /** Waive outstanding late fees instead of collecting them */
  waiveLateFees: z.boolean().default(false),
  /** Early settlement: pay off the plan; future interest is reduced by rebatePercent */
  settle: z.boolean().default(false),
  rebatePercent: z.coerce.number().min(0).max(100).default(50),
  /** 0186: required for paymentMethod 'cheque' (registered in the cheques register) */
  cheque: chequeDetailsSchema.nullish(),
}).superRefine((d, ctx) => {
  if (d.paymentMethod === 'cheque' && !d.cheque) ctx.addIssue({ code: 'custom', path: ['cheque'], message: 'Enter the cheque details (number, bank, date)' })
})

// POST /api/installments/[id]/payments/[paymentId] — void a receipt / its cheque bounced (0186)
export const installmentReceiptActionSchema = z.object({
  action: z.enum(['void', 'bounce']),
  reason: z.string().trim().min(3, 'Give a reason').max(1000),
  /** date of the reversal / bounce (default today; never in the future) */
  date: dateStringSchema.optional(),
})

// PATCH /api/installments/[id]
export const updateInstallmentPlanSchema = z.object({
  action: z.enum(['update', 'cancel', 'default', 'repossess', 'reactivate']).default('update'),
  reason: optText(1000),
  customerPhone: optText(50),
  customerAddress: optText(1000),
  guarantorName: optText(255),
  guarantorNic: nicSchema,
  guarantorPhone: optText(50),
  guarantorAddress: optText(1000),
  notes: optText(2000),
  agreementTerms: optText(10000),
  // 0186: repossession
  returnToStock: z.boolean().default(false),
  returnWarehouseId: optionalUuid,
  condition: z.enum(['good', 'used', 'damaged']).default('good'),
  /** value the goods go back into stock at (default: their cost) */
  recoveredValue: z.coerce.number().min(0).max(1_000_000_000).nullish(),
  writeOff: z.boolean().default(false),
})

// ==================== DELIVERIES ====================

export const deliveryStatusValues = ['scheduled', 'out_for_delivery', 'delivered', 'installed', 'failed', 'cancelled'] as const

export const deliveriesListSchema = paginatedSearchSchema.extend({
  date: dateStringSchema.optional(),
  fromDate: dateStringSchema.optional(),
  toDate: dateStringSchema.optional(),
  status: z.enum(['scheduled', 'out_for_delivery', 'delivered', 'installed', 'failed', 'cancelled', 'all', 'open']).optional(),
  saleId: z.string().uuid().optional(),
})

export const createDeliverySchema = z.object({
  saleId: optionalUuid,
  installmentPlanId: optionalUuid,
  warehouseId: optionalUuid,
  customerId: optionalUuid,
  customerName: z.string().trim().min(1, 'Customer name is required').max(255),
  customerPhone: optText(50),
  address: z.string().trim().min(3, 'Enter the delivery address').max(1000),
  city: optText(100),
  scheduledDate: dateStringSchema,
  timeSlot: optText(30),
  vehicleNo: optText(30),
  driverId: optionalUuid,
  driverName: optText(255),
  installationRequired: z.boolean().default(false),
  technicianId: optionalUuid,
  technicianName: optText(255),
  items: z.array(agreementItemSchema).max(200).default([]),
  deliveryCharge: z.coerce.number().min(0).max(10_000_000).default(0),
  notes: optText(2000),
})

export const updateDeliverySchema = z.object({
  status: z.enum(deliveryStatusValues).optional(),
  customerPhone: optText(50),
  address: z.string().trim().min(3).max(1000).optional(),
  city: optText(100),
  scheduledDate: dateStringSchema.optional(),
  timeSlot: optText(30),
  vehicleNo: optText(30),
  driverId: optionalUuid,
  driverName: optText(255),
  installationRequired: z.boolean().optional(),
  technicianId: optionalUuid,
  technicianName: optText(255),
  deliveryCharge: z.coerce.number().min(0).max(10_000_000).optional(),
  recipientName: optText(255),
  recipientPhone: optText(50),
  proofNotes: optText(2000),
  proofPhotoUrl: z.preprocess((v) => (v === '' ? null : v), z.string().url().max(2000).nullish()),
  failureReason: optText(1000),
  notes: optText(2000),
})

// ==================== WARRANTY CLAIMS ====================

export const warrantyStatusValues = ['received', 'diagnosing', 'sent_to_supplier', 'repairing', 'ready', 'delivered', 'rejected'] as const

export const warrantyLookupSchema = z.object({
  q: z.string().trim().min(2, 'Enter a serial / IMEI, invoice number or phone').max(100),
})

export const warrantyClaimsListSchema = paginatedSearchSchema.extend({
  status: z.enum(['received', 'diagnosing', 'sent_to_supplier', 'repairing', 'ready', 'delivered', 'rejected', 'all', 'open']).optional(),
})

export const createWarrantyClaimSchema = z.object({
  saleId: optionalUuid,
  saleItemId: optionalUuid,
  itemId: optionalUuid,
  serialNumberId: optionalUuid,
  serialNumber: optText(255),
  itemName: z.string().trim().min(1, 'Item is required').max(255),
  customerId: optionalUuid,
  customerName: z.string().trim().min(1, 'Customer name is required').max(255),
  customerPhone: optText(50),
  warehouseId: optionalUuid,
  purchaseDate: dateStringSchema.nullish(),
  warrantyUntil: dateStringSchema.nullish(),
  complaint: z.string().trim().min(3, 'Describe the fault').max(5000),
  accessories: optText(1000),
  conditionNotes: optText(2000),
  technicianId: optionalUuid,
  estimatedCharge: z.coerce.number().min(0).max(100_000_000).default(0),
  expectedDate: dateStringSchema.nullish(),
  notes: optText(2000),
})

export const updateWarrantyClaimSchema = z.object({
  status: z.enum(warrantyStatusValues).optional(),
  statusNote: optText(1000),
  technicianId: optionalUuid,
  supplierId: optionalUuid,
  supplierRef: optText(100),
  diagnosis: optText(5000),
  resolution: z.enum(['repaired', 'replaced', 'refunded', 'no_fault', 'rejected']).nullish(),
  replacementSerial: optText(255),
  estimatedCharge: z.coerce.number().min(0).max(100_000_000).optional(),
  finalCharge: z.coerce.number().min(0).max(100_000_000).optional(),
  expectedDate: dateStringSchema.nullish(),
  accessories: optText(1000),
  conditionNotes: optText(2000),
  notes: optText(2000),
})
