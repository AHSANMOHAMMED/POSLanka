import { z } from 'zod'
import { paginationSchema, uuidSchema } from './common'

// ==================== WASTE LOG ====================

// GET /api/waste-log
export const wasteLogListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// POST /api/waste-log
export const createWasteLogSchema = z.object({
  itemId: uuidSchema,
  quantity: z.coerce.number().positive('Quantity must be a positive number'),
  unit: z.string().max(50).default('pcs'),
  reason: z.string().trim().min(1, 'Reason is required').max(500),
  notes: z.string().max(5000).nullish(),
})

// ==================== REFUNDS ====================

// GET /api/refunds
export const refundsListSchema = paginationSchema.extend({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  saleId: z.string().uuid().optional(),
})
