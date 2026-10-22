import { z } from 'zod'
import { paginationSchema, uuidSchema } from './common'
import { ADJUSTMENT_REASON_CODES } from '@/lib/inventory/adjustment-reasons'

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
  /** H3: structured reason code (default: derived from the reason text) */
  reasonCode: z.enum(ADJUSTMENT_REASON_CODES).optional(),
  notes: z.string().max(5000).nullish(),
  /** Warehouse the waste came out of (default: the tenant's default warehouse). */
  warehouseId: z.string().uuid().optional(),
  /** Batch-tracked items: the batch that was wasted (used first, then FEFO). */
  batchId: z.string().uuid().optional(),
})

// ==================== REFUNDS ====================

// GET /api/refunds
export const refundsListSchema = paginationSchema.extend({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  saleId: z.string().uuid().optional(),
})
