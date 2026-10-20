import { z } from 'zod'
import { uuidSchema } from './common'

// ==================== W3 STOCK INTAKE ====================

const qtySchema = z.coerce.number().min(0, 'Quantity cannot be negative').max(1_000_000_000)
const priceSchema = z.coerce.number().min(0, 'Price cannot be negative').max(10_000_000_000)
const codeSchema = z.string().trim().max(100)

export const intakeBatchStatusSchema = z.enum(['draft', 'submitted', 'syncing', 'posted', 'partially_posted', 'cancelled'])

// GET /api/stock-intake
export const stockIntakeListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  status: intakeBatchStatusSchema.optional(),
  warehouseId: uuidSchema.optional(),
  mine: z.string().optional().transform((v) => v === 'true' || v === '1'),
})

// POST /api/stock-intake
export const createStockIntakeSchema = z.object({
  warehouseId: uuidSchema,
  notes: z.string().trim().max(2000).optional(),
  clientBatchId: uuidSchema.optional(),
  updateCost: z.boolean().optional(),
  supplierId: uuidSchema.optional(),
  source: z.enum(['web', 'mobile']).optional(),
})

// PATCH /api/stock-intake/[id]
export const updateStockIntakeSchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  notes: z.string().trim().max(2000).optional(),
  warehouseId: uuidSchema.optional(),
  status: z.enum(['draft', 'submitted', 'cancelled']).optional(),
  updateCost: z.boolean().optional(),
  supplierId: uuidSchema.optional(),
})

const lineFields = {
  mode: z.enum(['receive', 'count']).optional(),
  barcode: codeSchema.optional(),
  sku: codeSchema.optional(),
  itemId: uuidSchema.optional(),
  name: z.string().trim().max(255).optional(),
  categoryId: uuidSchema.optional(),
  unit: z.string().trim().max(50).optional(),
  costPrice: priceSchema.optional(),
  sellingPrice: priceSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
}

export const stockIntakeLineSchema = z.object({
  clientLineId: uuidSchema.optional(),
  quantity: qtySchema,
  ...lineFields,
}).refine((l) => !!(l.barcode || l.sku || l.itemId), { message: 'barcode, sku or itemId is required', path: ['barcode'] })

// POST /api/stock-intake/[id]/lines
export const addStockIntakeLinesSchema = z.object({
  lines: z.array(stockIntakeLineSchema).min(1, 'At least one line').max(500, 'Maximum 500 lines per request'),
})

// PATCH /api/stock-intake/[id]/lines/[lineId]
export const updateStockIntakeLineSchema = z.object({
  quantity: qtySchema.optional(),
  ...lineFields,
})

export const intakeLineParamsSchema = z.object({
  id: uuidSchema,
  lineId: uuidSchema,
})
