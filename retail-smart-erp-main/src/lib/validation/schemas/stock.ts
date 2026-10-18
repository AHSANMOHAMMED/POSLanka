import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema,
  stockMovementTypeSchema, stockTakeStatusSchema,
  nonNegativeNumberSchema, shortTextSchema, longTextSchema,
  optimisticLockSchema,
} from './common'

// ==================== STOCK ADJUSTMENTS ====================

// POST /api/stock-adjustments/bulk
const bulkAdjustmentItemSchema = z.object({
  itemId: uuidSchema,
  newQuantity: nonNegativeNumberSchema,
  reason: z.string().max(500).optional(),
})

export const bulkStockAdjustmentSchema = z.object({
  warehouseId: uuidSchema,
  adjustments: z.array(bulkAdjustmentItemSchema)
    .min(1, 'At least one adjustment is required')
    .max(500, 'Maximum 500 items per batch'),
})

// ==================== STOCK MOVEMENTS ====================

// GET /api/stock-movements
export const stockMovementsListSchema = paginatedSearchSchema.extend({
  type: stockMovementTypeSchema.optional(),
  warehouseId: z.string().uuid().optional(),
  referenceType: z.string().max(100).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// ==================== STOCK TAKES ====================

// GET /api/stock-takes
export const stockTakesListSchema = paginatedSearchSchema.extend({
  status: stockTakeStatusSchema.optional(),
  warehouseId: z.string().uuid().optional(),
})

// POST /api/stock-takes
export const createStockTakeSchema = z.object({
  warehouseId: uuidSchema,
  countType: z.enum(['full', 'partial', 'category']).optional().default('full'),
  categoryId: optionalUuid,
  notes: longTextSchema.optional(),
})

// ==================== STOCK TRANSFERS ====================

// GET /api/stock-transfers
export const stockTransfersListSchema = paginatedSearchSchema.extend({
  status: z.string().max(200).optional(),
  warehouseId: z.string().uuid().optional(),
})

// POST /api/stock-transfers
const stockTransferItemSchema = z.object({
  itemId: uuidSchema,
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  notes: z.string().max(500).optional(),
})

export const createStockTransferSchema = z.object({
  fromWarehouseId: uuidSchema,
  toWarehouseId: uuidSchema,
  items: z.array(stockTransferItemSchema)
    .min(1, 'At least one item is required')
    .max(200, 'Maximum 200 items per transfer'),
  notes: longTextSchema.optional(),
}).refine(
  (data) => data.fromWarehouseId !== data.toWarehouseId,
  { message: 'Source and destination warehouses must be different', path: ['toWarehouseId'] }
)

// ==================== WAREHOUSES ====================

// GET /api/warehouses
export const warehousesListSchema = paginatedSearchSchema.extend({
  userOnly: z.string().optional().transform(v => v === 'true'),
  activeOnly: z.string().optional().transform(v => v === 'true'),
})

// POST /api/warehouses
export const createWarehouseSchema = z.object({
  name: shortTextSchema,
  code: shortTextSchema,
  address: z.string().max(500).nullish(),
  phone: z.string().max(20).nullish(),
  email: z.string().max(255).nullish(),
  isDefault: z.boolean().optional().default(false),
})

// ==================== WAREHOUSE STOCK ====================

// GET /api/warehouses/[id]/stock
export const warehouseStockListSchema = paginatedSearchSchema.extend({
  lowStockOnly: z.string().optional().transform(v => v === 'true'),
})

// POST /api/warehouses/[id]/stock
export const adjustWarehouseStockSchema = z.object({
  itemId: uuidSchema,
  quantity: z.coerce.number().optional(),
  type: z.enum(['set', 'add', 'subtract']).optional(),
  notes: z.string().max(1000).optional(),
  binLocation: z.string().max(100).optional(),
  minStock: z.coerce.number().min(0).optional(),
  reorderQty: z.coerce.number().min(0).optional(),
  costCenterId: optionalUuid,
})

// ==================== DETAIL / ACTION SCHEMAS ====================

// PUT /api/stock-takes/[id]
export const updateStockTakeSchema = z.object({
  status: z.enum(['in_progress', 'pending_review', 'completed', 'cancelled']).optional(),
  notes: longTextSchema.optional(),
  cancellationReason: z.string().max(1000).optional(),
})

// PUT /api/stock-takes/[id]/items - bulk update counted quantities
const countUpdateItemSchema = z.object({
  itemId: uuidSchema,
  countedQuantity: z.coerce.number().min(0, 'Counted quantity cannot be negative'),
  notes: z.string().max(500).optional(),
})
export const updateStockTakeItemsSchema = z.object({
  items: z.array(countUpdateItemSchema).min(1, 'At least one item is required').max(500),
})

// PUT /api/stock-transfers/[id]
const transferActionValues = ['submit_for_approval', 'approve', 'reject', 'ship', 'receive', 'cancel', 'update'] as const
const receivedItemSchema = z.object({
  transferItemId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  receivedQuantity: z.coerce.number().min(0, 'Received quantity cannot be negative'),
})
const updatedTransferItemSchema = z.object({
  itemId: uuidSchema,
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  notes: z.string().max(500).optional(),
})
export const updateStockTransferSchema = z.object({
  action: z.enum(transferActionValues),
  notes: longTextSchema.optional(),
  cancellationReason: z.string().max(1000).optional(),
  items: z.array(updatedTransferItemSchema).optional(),
  receivedItems: z.array(receivedItemSchema).optional(),
}).merge(optimisticLockSchema)

// PUT /api/warehouses/[id]
export const updateWarehouseSchema = z.object({
  name: shortTextSchema,
  code: shortTextSchema,
  address: z.string().max(500).nullish(),
  phone: z.string().max(20).nullish(),
  email: z.string().max(255).nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).merge(optimisticLockSchema)

// POST /api/stock-adjustments/bulk/preview
export const bulkStockAdjustmentPreviewSchema = z.object({
  warehouseId: uuidSchema,
  adjustments: z.array(z.object({
    itemId: uuidSchema,
    newQuantity: nonNegativeNumberSchema,
    reason: z.string().max(500).optional(),
  })).min(1, 'At least one adjustment is required').max(500),
})
