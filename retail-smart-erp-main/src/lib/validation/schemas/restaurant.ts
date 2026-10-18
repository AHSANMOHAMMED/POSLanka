import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema,
  shortTextSchema, mediumTextSchema, longTextSchema,
  currencyAmountSchema,
  kitchenOrderStatusSchema, orderTypeSchema, deliveryStatusSchema,
  reservationStatusSchema, tableStatusSchema,
  dateStringSchema, timeStringSchema,
} from './common'

// ==================== KITCHEN ORDERS ====================

// GET /api/kitchen-orders
export const kitchenOrdersListSchema = z.object({
  status: kitchenOrderStatusSchema.optional(),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  activeOnly: z.string().optional().transform(v => v === 'true'),
})

// PUT /api/kitchen-orders/[id]
export const updateKitchenOrderSchema = z.object({
  status: kitchenOrderStatusSchema,
})

// PUT /api/kitchen-orders/[id]/items/[itemId]
export const updateKitchenOrderItemSchema = z.object({
  status: kitchenOrderStatusSchema,
})

// ==================== RESTAURANT ORDERS ====================

// GET /api/restaurant-orders
export const restaurantOrdersListSchema = paginatedSearchSchema.extend({
  status: z.string().max(50).optional(),
  tableId: z.string().uuid().optional(),
  orderType: orderTypeSchema.optional(),
  createdBy: z.string().uuid().optional(),
  deliveryStatus: deliveryStatusSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// POST /api/restaurant-orders
export const createRestaurantOrderSchema = z.object({
  tableId: optionalUuid,
  customerId: optionalUuid,
  orderType: orderTypeSchema.default('dine_in'),
  customerCount: z.coerce.number().int().min(1).default(1),
  deliveryAddress: z.string().max(500).optional(),
  deliveryPhone: z.string().max(20).optional(),
  deliveryNotes: z.string().max(1000).optional(),
  deliveryFee: z.coerce.number().min(0).optional(),
}).refine(
  (data) => {
    if (data.orderType === 'dine_in' && !data.tableId) {
      return false
    }
    return true
  },
  { message: 'Table is required for dine-in orders', path: ['tableId'] }
).refine(
  (data) => {
    if (data.orderType === 'delivery' && !data.deliveryAddress) {
      return false
    }
    return true
  },
  { message: 'Delivery address is required for delivery orders', path: ['deliveryAddress'] }
)

// PUT /api/restaurant-orders/[id]
export const updateRestaurantOrderSchema = z.object({
  status: z.enum(['open', 'closed', 'completed', 'cancelled']).optional(),
  tipAmount: z.coerce.number().min(0, 'Tip amount must be a non-negative number').optional(),
  cancellationReason: z.string().trim().max(1000).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  deliveryStatus: deliveryStatusSchema.optional(),
  deliveryAddress: z.string().max(500).optional(),
  deliveryPhone: z.string().max(20).optional(),
  deliveryNotes: z.string().max(1000).optional(),
  driverName: z.string().max(255).optional(),
  driverPhone: z.string().max(20).optional(),
  estimatedDeliveryTime: z.string().optional().nullable(),
  deliveryFee: z.coerce.number().min(0).optional(),
  skipSaleCreation: z.boolean().optional(),
  saleId: optionalUuid,
})

// POST /api/restaurant-orders/[id]/items
export const addRestaurantOrderItemSchema = z.object({
  itemId: optionalUuid,
  itemName: shortTextSchema,
  quantity: z.coerce.number().int().positive('Quantity must be a positive integer'),
  unitPrice: currencyAmountSchema,
  modifiers: z.array(z.any()).optional(),
  notes: z.string().max(500).optional(),
})

// PUT /api/restaurant-orders/[id]/items/[itemId]
export const updateRestaurantOrderItemSchema = z.object({
  quantity: z.coerce.number().int().positive('Quantity must be a positive integer').optional(),
  modifiers: z.array(z.any()).optional(),
  notes: z.string().max(500).optional().nullable(),
  status: kitchenOrderStatusSchema.optional(),
})

// ==================== RESTAURANT TABLES ====================

// GET /api/restaurant-tables
export const restaurantTablesListSchema = paginatedSearchSchema.extend({
  status: tableStatusSchema.optional(),
  area: z.string().max(100).optional(),
})

const tableShapeSchema = z.enum(['rectangle', 'circle', 'square', 'oval']).optional()

// POST /api/restaurant-tables
export const createRestaurantTableSchema = z.object({
  name: shortTextSchema,
  area: z.string().max(100).optional(),
  capacity: z.coerce.number().int().min(1).default(4),
  positionX: z.coerce.number().optional().nullable(),
  positionY: z.coerce.number().optional().nullable(),
  width: z.coerce.number().optional().nullable(),
  height: z.coerce.number().optional().nullable(),
  shape: tableShapeSchema,
  rotation: z.coerce.number().min(0).max(360).default(0),
})

// PUT /api/restaurant-tables/[id]
export const updateRestaurantTableSchema = z.object({
  name: shortTextSchema.optional(),
  area: z.string().max(100).optional().nullable(),
  capacity: z.coerce.number().int().min(1).optional(),
  status: tableStatusSchema.optional(),
  positionX: z.coerce.number().optional().nullable(),
  positionY: z.coerce.number().optional().nullable(),
  width: z.coerce.number().optional().nullable(),
  height: z.coerce.number().optional().nullable(),
  shape: tableShapeSchema,
  rotation: z.coerce.number().min(0).max(360).optional(),
})

// PUT /api/restaurant-tables/[id]/assign-server
export const assignServerSchema = z.object({
  serverId: optionalUuid,
})

// PUT /api/restaurant-tables/layout
const tableLayoutItemSchema = z.object({
  id: uuidSchema,
  positionX: z.coerce.number(),
  positionY: z.coerce.number(),
  width: z.coerce.number(),
  height: z.coerce.number(),
  shape: z.string().max(50),
  rotation: z.coerce.number().min(0).max(360),
})

export const updateTableLayoutSchema = z.object({
  tables: z.array(tableLayoutItemSchema).min(1, 'At least one table is required'),
})

// POST /api/restaurant-tables/merge
export const mergeTablesSchema = z.object({
  tableIds: z.array(uuidSchema).min(2, 'At least 2 tables are required to merge'),
  name: z.string().max(255).optional(),
  serverId: optionalUuid,
  notes: z.string().max(1000).optional(),
})

// PUT /api/restaurant-tables/merge/[id]
export const updateTableGroupSchema = z.object({
  name: z.string().max(255).optional(),
  serverId: optionalUuid,
  notes: z.string().max(1000).optional().nullable(),
})

// ==================== RESERVATIONS ====================

const reservationSourceSchema = z.enum(['walk_in', 'phone', 'online', 'app'])

// GET /api/reservations
export const reservationsListSchema = paginatedSearchSchema.extend({
  status: reservationStatusSchema.optional(),
  tableId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// POST /api/reservations
export const createReservationSchema = z.object({
  customerId: optionalUuid,
  customerName: z.string().max(255).optional(),
  customerPhone: z.string().max(20).optional(),
  customerEmail: z.string().max(255).optional(),
  tableId: optionalUuid,
  reservationDate: dateStringSchema,
  reservationTime: timeStringSchema,
  partySize: z.coerce.number().int().min(1, 'Party size must be at least 1').default(2),
  estimatedDuration: z.coerce.number().int().min(1).default(60),
  notes: z.string().max(1000).optional(),
  specialRequests: z.string().max(1000).optional(),
  source: reservationSourceSchema.default('walk_in'),
}).refine(
  (data) => !!(data.customerName || data.customerId),
  { message: 'Customer name or customer is required', path: ['customerName'] }
)

// PUT /api/reservations/[id]
export const updateReservationSchema = z.object({
  customerName: z.string().max(255).optional().nullable(),
  customerPhone: z.string().max(20).optional().nullable(),
  customerEmail: z.string().max(255).optional().nullable(),
  tableId: optionalUuid,
  reservationDate: dateStringSchema.optional(),
  reservationTime: timeStringSchema.optional(),
  partySize: z.coerce.number().int().min(1).optional(),
  estimatedDuration: z.coerce.number().int().min(1).optional(),
  status: reservationStatusSchema.optional(),
  notes: z.string().max(1000).optional().nullable(),
  specialRequests: z.string().max(1000).optional().nullable(),
  source: reservationSourceSchema.optional(),
  cancellationReason: z.string().trim().max(1000).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
})

// DELETE /api/reservations/[id]
export const deleteReservationSchema = z.object({
  cancellationReason: z.string().max(1000).optional(),
}).optional()

// ==================== RECIPES ====================

// GET /api/recipes
export const recipesListSchema = paginatedSearchSchema

// POST /api/recipes
export const createRecipeSchema = z.object({
  name: shortTextSchema,
  description: z.string().max(1000).optional(),
  itemId: optionalUuid,
  yieldQuantity: z.coerce.number().positive().optional(),
  yieldUnit: z.string().max(50).optional(),
  preparationTime: z.coerce.number().int().min(0).optional().nullable(),
  instructions: longTextSchema.optional(),
})

// PUT /api/recipes/[id]
export const updateRecipeSchema = z.object({
  name: shortTextSchema,
  description: z.string().max(1000).optional().nullable(),
  itemId: optionalUuid,
  yieldQuantity: z.coerce.number().positive().optional(),
  yieldUnit: z.string().max(50).optional(),
  preparationTime: z.coerce.number().int().min(0).optional().nullable(),
  instructions: longTextSchema.optional().nullable(),
  isActive: z.boolean().optional(),
})

// POST /api/recipes/[id]/ingredients
export const addRecipeIngredientSchema = z.object({
  ingredientItemId: uuidSchema,
  quantity: z.coerce.number().positive('Quantity must be a positive number'),
  unit: z.string().max(50).optional(),
  wastePercentage: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

// PUT /api/recipes/[id]/ingredients/[ingredientId]
export const updateRecipeIngredientSchema = z.object({
  ingredientItemId: uuidSchema.optional(),
  quantity: z.coerce.number().positive('Quantity must be a positive number').optional(),
  unit: z.string().max(50).optional(),
  wastePercentage: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

// ==================== MODIFIER GROUPS ====================

// GET /api/modifier-groups
export const modifierGroupsListSchema = paginatedSearchSchema.extend({
  isActive: z.string().optional(),
})

// POST /api/modifier-groups
export const createModifierGroupSchema = z.object({
  name: shortTextSchema,
  description: mediumTextSchema.optional(),
  minSelections: z.coerce.number().int().min(0).default(0),
  maxSelections: z.coerce.number().int().min(0).optional().nullable(),
  isRequired: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

// PUT /api/modifier-groups/[id]
export const updateModifierGroupSchema = z.object({
  name: shortTextSchema,
  description: mediumTextSchema.optional(),
  minSelections: z.coerce.number().int().min(0).default(0),
  maxSelections: z.coerce.number().int().min(0).optional().nullable(),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

// POST /api/modifier-groups/[id]/modifiers
export const createModifierSchema = z.object({
  name: shortTextSchema,
  description: mediumTextSchema.optional(),
  price: z.coerce.number().min(0).default(0),
  sku: z.string().max(100).optional(),
  isDefault: z.boolean().default(false),
  allergens: z.array(z.string()).optional().nullable(),
  calories: z.coerce.number().int().min(0).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

// PUT /api/modifier-groups/[id]/modifiers/[modifierId]
export const updateModifierSchema = z.object({
  name: shortTextSchema,
  description: mediumTextSchema.optional(),
  price: z.coerce.number().min(0).default(0),
  sku: z.string().max(100).optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().optional(),
  allergens: z.array(z.string()).optional().nullable(),
  calories: z.coerce.number().int().min(0).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

// POST /api/modifier-groups/[id]/items
export const updateModifierGroupItemsSchema = z.object({
  itemIds: z.array(uuidSchema),
})
