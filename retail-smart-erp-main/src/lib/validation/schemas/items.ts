import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema,
  optionalDateString, shortTextSchema,
  partConditionSchema, batchStatusSchema, serialNumberStatusSchema,
  optimisticLockSchema, paginationSchema,
} from './common'

// ==================== ITEMS ====================

// GET /api/items
export const itemsListSchema = paginatedSearchSchema.extend({
  categoryId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  expiringBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  storageTemp: z.string().max(20).optional(),
  availableNow: z.string().optional().transform(v => v === 'true'),
  includeInactive: z.string().optional().transform(v => v === 'true'),
  inStockOnly: z.string().optional().transform(v => v === 'true'),
  ids: z.string().max(5000).optional(),
})

// POST /api/items
export const createItemSchema = z.object({
  // Required
  name: shortTextSchema,
  sellingPrice: z.coerce.number().min(0, 'Selling price cannot be negative'),

  // Identification
  sku: z.string().max(100).optional(),
  barcode: z.string().max(100).optional(),
  oemPartNumber: z.string().max(100).optional(),
  alternatePartNumbers: z.array(z.string()).max(50).optional(),
  supplierPartNumber: z.string().max(100).optional(),

  // Basic info
  categoryId: optionalUuid,
  brand: z.string().max(100).optional(),
  condition: partConditionSchema.optional(),

  // Pricing
  costPrice: z.coerce.number().min(0).optional(),

  // Inventory
  currentStock: z.coerce.number().min(0).optional(),
  minStock: z.coerce.number().min(0).optional(),
  unit: z.string().max(50).optional(),
  trackStock: z.boolean().optional(),
  trackBatches: z.boolean().optional(),
  trackSerialNumbers: z.boolean().optional(),

  // Supplier
  supplierId: optionalUuid,
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  reorderQty: z.coerce.number().min(0).optional(),
  binLocation: z.string().max(100).optional(),

  // Physical attributes
  weight: z.coerce.number().min(0).optional(),
  dimensions: z.string().max(50).optional(),

  // Additional
  warrantyMonths: z.coerce.number().int().min(0).optional(),
  imageUrl: z.string().max(2000).optional(),
  supersededBy: optionalUuid,

  // Restaurant fields
  preparationTime: z.coerce.number().int().min(0).optional(),
  allergens: z.array(z.string()).max(50).optional(),
  calories: z.coerce.number().int().min(0).optional(),
  isVegetarian: z.boolean().optional(),
  isVegan: z.boolean().optional(),
  isGlutenFree: z.boolean().optional(),
  spiceLevel: z.string().max(20).optional(),
  availableFrom: z.string().max(10).optional(), // HH:MM format
  availableTo: z.string().max(10).optional(),

  // Supermarket fields
  pluCode: z.string().max(20).optional(),
  shelfLifeDays: z.coerce.number().int().min(0).optional(),
  storageTemp: z.string().max(20).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  // Gift card flag
  isGiftCard: z.boolean().optional(),

  // Tax template
  taxTemplateId: optionalUuid,
})

// ==================== CATEGORIES ====================

// GET /api/categories
export const categoriesListSchema = paginatedSearchSchema

// POST /api/categories
export const createCategorySchema = z.object({
  name: shortTextSchema,
})

// ==================== BULK PRICE UPDATE ====================

// POST /api/items/bulk-price-update
const bulkPriceUpdateItemSchema = z.object({
  itemId: uuidSchema,
  costPrice: z.coerce.number().min(0, 'Cost price cannot be negative').optional(),
  sellingPrice: z.coerce.number().min(0, 'Selling price cannot be negative').optional(),
})

export const bulkPriceUpdateSchema = z.object({
  updates: z.array(bulkPriceUpdateItemSchema)
    .min(1, 'No updates provided')
    .max(500, 'Maximum 500 items per batch'),
})

// ==================== BULK PRICE UPDATE PREVIEW ====================

// POST /api/items/bulk-price-update/preview
export const bulkPriceUpdatePreviewSchema = z.object({
  updates: z.array(z.object({
    itemId: uuidSchema,
    costPrice: z.coerce.number().min(0).optional(),
    sellingPrice: z.coerce.number().min(0).optional(),
  })).min(1, 'No updates provided').max(500),
})

// ==================== ITEM BATCHES (per-item) ====================

// GET /api/items/[id]/batches
export const itemBatchesForItemListSchema = z.object({
  status: batchStatusSchema.optional(),
  warehouseId: z.string().uuid().optional(),
})

// POST /api/items/[id]/batches
export const createItemBatchForItemSchema = z.object({
  batchNumber: z.string().trim().min(1, 'Batch number is required').max(100),
  initialQuantity: z.coerce.number().positive('Initial quantity must be greater than zero'),
  warehouseId: optionalUuid,
  manufacturingDate: optionalDateString,
  expiryDate: optionalDateString,
  supplierBatchNumber: z.string().max(100).optional(),
  supplierId: optionalUuid,
  notes: z.string().max(5000).optional(),
})

// ==================== ITEM BATCHES (global) ====================

// GET /api/item-batches
export const itemBatchesListSchema = paginatedSearchSchema.extend({
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: batchStatusSchema.optional(),
  expiringBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
})

// ==================== SERIAL NUMBERS ====================

// GET /api/serial-numbers
export const serialNumbersListSchema = paginatedSearchSchema.extend({
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: serialNumberStatusSchema.optional(),
})

// ==================== DETAIL / ACTION SCHEMAS ====================

// PUT /api/items/[id]
export const updateItemSchema = createItemSchema.merge(optimisticLockSchema).extend({
  isActive: z.boolean().optional(),
})

// PUT /api/categories/[id]
export const updateCategorySchema = z.object({
  name: shortTextSchema,
})

// PUT /api/item-batches/[id]
export const updateItemBatchSchema = z.object({
  status: batchStatusSchema.optional(),
  notes: z.string().max(5000).nullish(),
  expiryDate: z.string().optional(),
})

// GET /api/items/[id]/serial-numbers
export const itemSerialNumbersListSchema = paginationSchema.extend({
  search: z.string().max(200).optional(),
  status: serialNumberStatusSchema.optional(),
  warehouseId: z.string().uuid().optional(),
  all: z.string().optional().transform(v => v === 'true'),
})

// POST /api/items/[id]/serial-numbers
export const createItemSerialNumbersSchema = z.object({
  serialNumbers: z.string().trim().min(1, 'Serial numbers are required'),
  warehouseId: z.string().uuid().optional(),
  warrantyStartDate: z.string().optional(),
  warrantyEndDate: z.string().optional(),
  warrantyNotes: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
})

// PUT /api/serial-numbers/[id]
export const updateSerialNumberSchema = z.object({
  status: serialNumberStatusSchema.optional(),
  warehouseId: z.string().uuid().nullish(),
  warrantyStartDate: z.string().nullish(),
  warrantyEndDate: z.string().nullish(),
  warrantyNotes: z.string().max(5000).nullish(),
  notes: z.string().max(5000).nullish(),
})

// GET /api/items/barcode-lookup
export const barcodeLookupSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required').max(200),
  warehouseId: z.string().uuid().optional(),
})

// GET /api/serial-numbers/search
export const serialNumberSearchSchema = paginationSchema.extend({
  search: z.string().trim().min(1, 'Search parameter is required').max(200),
  status: serialNumberStatusSchema.optional(),
})

// GET /api/serial-numbers/[id]/movements
export const serialNumberMovementsListSchema = paginationSchema
