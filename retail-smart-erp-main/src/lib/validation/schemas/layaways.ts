import { z } from 'zod'
import { uuidSchema, optionalUuid, paginatedSearchSchema, paymentMethodSchema } from './common'

// GET /api/layaways
export const layawaysListSchema = paginatedSearchSchema.extend({
  status: z.enum(['active', 'completed', 'cancelled', 'forfeited', 'all']).optional(),
  customerId: z.string().uuid().optional(),
})

const layawayItemSchema = z.object({
  itemId: optionalUuid,
  itemName: z.string().max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
})

// POST /api/layaways
export const createLayawaySchema = z.object({
  customerId: uuidSchema,
  items: z.array(layawayItemSchema).min(1, 'At least one item is required').max(500),
  depositAmount: z.coerce.number().min(0).optional(),
  taxAmount: z.coerce.number().min(0).default(0),
  dueDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
})

// PUT /api/layaways/[id]
export const updateLayawaySchema = z.object({
  dueDate: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
  status: z.enum(['active', 'completed', 'cancelled', 'forfeited']).optional(),
  cancellationReason: z.string().max(1000).optional(),
  expectedUpdatedAt: z.string().optional(),
})

// POST /api/layaways/[id]/payments
export const layawayPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero'),
  paymentMethod: paymentMethodSchema.default('cash'),
  reference: z.string().max(500).optional(),
})

// POST /api/layaways/[id]/complete
export const layawayCompleteSchema = z.object({
  warehouseId: optionalUuid,
})

// POST /api/layaways/[id]/forfeit
export const layawayForfeitSchema = z.object({
  refundPercentage: z.coerce.number().min(0).max(100).default(0),
  refundAmount: z.coerce.number().min(0).optional(),
  refundToCredit: z.boolean().default(true),
  reason: z.string().max(1000).optional(),
})
