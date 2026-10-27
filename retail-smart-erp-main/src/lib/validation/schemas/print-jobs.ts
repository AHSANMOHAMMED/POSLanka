import { z } from 'zod'
import { optionalUuid, paginationSchema } from './common'

// Print & photo studio job orders (drizzle/0182)

export const PRINT_JOB_STATUSES = ['received', 'designing', 'proof_sent', 'approved', 'printing', 'finishing', 'ready', 'delivered', 'cancelled'] as const
export const PRINT_PROOF_STATUSES = ['not_needed', 'pending', 'sent', 'approved', 'changes_requested'] as const

// GET /api/print-jobs
export const printJobsListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional().default(''),
  status: z.union([z.enum(PRINT_JOB_STATUSES), z.enum(['open', 'all'])]).optional(),
  due: z.enum(['today', 'overdue', 'urgent']).optional(),
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
})

const finishingSchema = z.object({
  code: z.string().trim().min(1).max(30),
  label: z.string().trim().max(100).nullish(),
  rate: z.coerce.number().min(0).max(10_000_000),
  count: z.coerce.number().min(0).max(100_000).nullish(),
})

export const printJobLineSchema = z.object({
  itemId: optionalUuid,
  description: z.string().trim().min(1, 'Describe the line').max(255),
  pricingMode: z.enum(['unit', 'area', 'length']).default('unit'),
  width: z.coerce.number().min(0).max(100_000).nullish(),
  height: z.coerce.number().min(0).max(100_000).nullish(),
  sizeUnit: z.enum(['inch', 'ft', 'cm', 'mm', 'm']).nullish(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1_000_000),
  material: z.string().trim().max(255).nullish(),
  sides: z.coerce.number().int().min(1).max(2).default(1),
  areaUnit: z.enum(['sqft', 'sqm']).nullish(),
  minChargeArea: z.coerce.number().min(0).max(100_000).nullish(),
  rate: z.coerce.number().min(0).max(100_000_000),
  finishing: z.array(finishingSchema).max(20).default([]),
  notes: z.string().trim().max(1000).nullish(),
})

const dateTimeInput = z.string().trim().max(40).refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date / time')

const proofFileSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(255).nullish(),
  fileId: z.string().uuid().nullish(),
  addedAt: z.string().max(40).nullish(),
})

const jobHeaderShape = {
  customerId: optionalUuid,
  customerName: z.string().trim().min(1, 'Customer name is required').max(255),
  customerPhone: z.string().trim().max(50).nullish(),
  title: z.string().trim().min(1, 'Job title is required').max(255),
  warehouseId: optionalUuid,
  receivedAt: dateTimeInput.nullish(),
  dueAt: dateTimeInput.nullish(),
  isUrgent: z.boolean().optional(),
  assignedTo: optionalUuid,
  discountAmount: z.coerce.number().min(0).max(100_000_000).default(0),
  notes: z.string().trim().max(5000).nullish(),
  proofStatus: z.enum(PRINT_PROOF_STATUSES).optional(),
  proofFiles: z.array(proofFileSchema).max(50).optional(),
  proofNote: z.string().trim().max(2000).nullish(),
}

// POST /api/print-jobs
export const createPrintJobSchema = z.object({
  ...jobHeaderShape,
  lines: z.array(printJobLineSchema).min(1, 'Add at least one line').max(200),
  // Walk-in (name + phone, no customerId): link the customer with that phone, or create one
  saveCustomer: z.boolean().default(true),
  // Advance taken when the job is booked (optional)
  advance: z.object({
    amount: z.coerce.number().positive().max(100_000_000),
    paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque']).default('cash'),
    reference: z.string().trim().max(255).nullish(),
  }).nullish(),
})

// PUT /api/print-jobs/[id] — full header replace (a header field left out is cleared; JSON nulls
// are stripped before validation so they cannot be told apart) and, until the job is invoiced,
// the lines (left out = unchanged)
export const updatePrintJobSchema = z.object({
  ...jobHeaderShape,
  lines: z.array(printJobLineSchema).min(1, 'Add at least one line').max(200).optional(),
  expectedUpdatedAt: z.string().optional(),
})

// POST /api/print-jobs/[id]/status
export const printJobStatusSchema = z.object({
  status: z.enum(PRINT_JOB_STATUSES).exclude(['delivered']),
  // proof response recorded together with the move (approved / changes_requested)
  proofStatus: z.enum(PRINT_PROOF_STATUSES).optional(),
  proofNote: z.string().trim().max(2000).nullish(),
  cancellationReason: z.string().trim().max(1000).nullish(),
  // cancelling a job with advances: refund them (reverses their GL posting)
  refundAdvances: z.boolean().optional(),
})

// POST /api/print-jobs/[id]/payments — advance / part payment
export const printJobPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero').max(100_000_000),
  // Only money actually received (same rule as layaway payments)
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque'], {
    message: 'Advances can be paid by cash, card, bank transfer or cheque',
  }).default('cash'),
  reference: z.string().trim().max(255).nullish(),
})

// POST /api/print-jobs/[id]/invoice — mark delivered & invoice the balance
export const printJobInvoiceSchema = z.object({
  expectedUpdatedAt: z.string().optional(),
  // 'credit' = balance on the customer's account (customer required)
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'credit']).default('cash'),
  paidAmount: z.coerce.number().min(0).max(100_000_000).default(0),
  reference: z.string().trim().max(255).nullish(),
})

// POST /api/print-jobs/[id]/notify
export const printJobNotifySchema = z.object({
  channel: z.enum(['sms', 'whatsapp']).default('sms'),
  phone: z.string().trim().max(50).nullish(),
  text: z.string().trim().max(640).nullish(),
})

export type PrintJobLineInput = z.infer<typeof printJobLineSchema>
