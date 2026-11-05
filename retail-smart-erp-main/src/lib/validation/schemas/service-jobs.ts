import { z } from 'zod'
import { optionalUuid, paginationSchema } from './common'

// Service jobs: repair jobs / tailoring orders / service tickets (drizzle/0193).
// validateBody strips null and '' before parsing, so optional fields are .nullish().

export const SERVICE_JOB_STATUS_VALUES = ['received', 'diagnosing', 'awaiting_approval', 'in_progress', 'ready', 'delivered', 'cancelled'] as const

// GET /api/service-jobs
export const serviceJobsListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional().default(''),
  status: z.union([z.enum(SERVICE_JOB_STATUS_VALUES), z.enum(['open', 'all'])]).optional(),
  due: z.enum(['today', 'overdue', 'urgent']).optional(),
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  mine: z.string().optional().transform((v) => v === 'true'),
})

export const serviceJobLineSchema = z.object({
  lineType: z.enum(['part', 'labour', 'other']).default('labour'),
  itemId: optionalUuid,
  description: z.string().trim().min(1, 'Describe the line').max(255),
  // fabric by the metre / parts by the unit: up to 4 decimals (0189)
  quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1_000_000),
  unitPrice: z.coerce.number().min(0).max(100_000_000),
  notes: z.string().trim().max(1000).nullish(),
})

const dateTimeInput = z.string().trim().max(40).refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date / time')
const dateInput = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')

const conditionItemSchema = z.object({
  label: z.string().trim().min(1).max(100),
  ok: z.boolean().nullish(),
  note: z.string().trim().max(255).nullish(),
})

const jobHeaderShape = {
  jobType: z.enum(['repair', 'tailoring', 'service']).optional(),
  customerId: optionalUuid,
  customerName: z.string().trim().min(1, 'Customer name is required').max(255),
  customerPhone: z.string().trim().max(50).nullish(),
  title: z.string().trim().min(1, 'Describe the job').max(255),
  warehouseId: optionalUuid,
  receivedAt: dateTimeInput.nullish(),
  promisedAt: dateTimeInput.nullish(),
  isUrgent: z.boolean().optional(),
  assignedTo: optionalUuid,
  // repairs
  deviceType: z.string().trim().max(100).nullish(),
  brand: z.string().trim().max(100).nullish(),
  model: z.string().trim().max(150).nullish(),
  serialNumber: z.string().trim().max(255).nullish(),
  imei: z.string().trim().max(20).nullish(),
  imei2: z.string().trim().max(20).nullish(),
  passcode: z.string().max(100).nullish(),
  faultReported: z.string().trim().max(5000).nullish(),
  accessoriesReceived: z.string().trim().max(2000).nullish(),
  conditionChecklist: z.array(conditionItemSchema).max(50).optional(),
  conditionNotes: z.string().trim().max(5000).nullish(),
  diagnosis: z.string().trim().max(5000).nullish(),
  workDone: z.string().trim().max(5000).nullish(),
  // tailoring
  garment: z.string().trim().max(150).nullish(),
  measurements: z.record(z.string().trim().max(60), z.string().trim().max(60)).optional(),
  fabricSupplied: z.boolean().optional(),
  fittingDate: dateInput.nullish(),
  // estimate
  estimateAmount: z.coerce.number().min(0).max(100_000_000).nullish(),
  repairWarrantyDays: z.coerce.number().int().min(0).max(3650).nullish(),
  discountAmount: z.coerce.number().min(0).max(100_000_000).default(0),
  notes: z.string().trim().max(5000).nullish(),
}

// POST /api/service-jobs
export const createServiceJobSchema = z.object({
  ...jobHeaderShape,
  lines: z.array(serviceJobLineSchema).max(200).default([]),
  saveCustomer: z.boolean().default(true),
  advance: z.object({
    amount: z.coerce.number().positive().max(100_000_000),
    paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque']).default('cash'),
    reference: z.string().trim().max(255).nullish(),
  }).nullish(),
})

// PUT /api/service-jobs/[id] — header replaced; lines replaced when sent (until invoiced).
// The passcode is kept when left out (staff who cannot see it can still edit the job).
export const updateServiceJobSchema = z.object({
  ...jobHeaderShape,
  clearPasscode: z.boolean().optional(),
  lines: z.array(serviceJobLineSchema).max(200).optional(),
  expectedUpdatedAt: z.string().optional(),
})

// POST /api/service-jobs/[id]/status
export const serviceJobStatusSchema = z.object({
  status: z.enum(SERVICE_JOB_STATUS_VALUES).exclude(['delivered']),
  note: z.string().trim().max(2000).nullish(),
  // estimate response recorded with the move (approved → in progress, declined → ready to return)
  estimateStatus: z.enum(['pending', 'approved', 'declined']).optional(),
  cancellationReason: z.string().trim().max(1000).nullish(),
  refundAdvances: z.boolean().optional(),
})

// POST /api/service-jobs/[id]/payments
export const serviceJobPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero').max(100_000_000),
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque'], {
    message: 'Advances can be paid by cash, card, bank transfer or cheque',
  }).default('cash'),
  reference: z.string().trim().max(255).nullish(),
})

// POST /api/service-jobs/[id]/invoice
export const serviceJobInvoiceSchema = z.object({
  expectedUpdatedAt: z.string().optional(),
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'credit']).default('cash'),
  paidAmount: z.coerce.number().min(0).max(100_000_000).default(0),
  reference: z.string().trim().max(255).nullish(),
  repairWarrantyDays: z.coerce.number().int().min(0).max(3650).nullish(),
})

// POST /api/service-jobs/[id]/notify
export const serviceJobNotifySchema = z.object({
  channel: z.enum(['sms', 'whatsapp']).default('sms'),
  phone: z.string().trim().max(50).nullish(),
  text: z.string().trim().max(640).nullish(),
})

// GET /api/service-jobs/warranty-check?q=
export const serviceJobWarrantyCheckSchema = z.object({
  q: z.string().trim().min(3, 'Enter a serial / IMEI, invoice number or phone').max(100),
})

export type ServiceJobLineInput = z.infer<typeof serviceJobLineSchema>
