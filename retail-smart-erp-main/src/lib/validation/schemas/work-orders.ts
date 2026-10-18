import { z } from 'zod'
import {
  paginatedSearchSchema,
  uuidSchema,
  optionalUuid,
  nonNegativeIntSchema,
  currencyAmountSchema,
  shortTextSchema,
  workOrderStatusSchema,
  inspectionTypeSchema,
  inspectionStatusSchema,
  damageTypeSchema,
  damageSeveritySchema,
  checklistResponseSchema,
  checklistItemTypeSchema,
} from './common'

// ==================== WORK ORDERS ====================

// GET /api/work-orders
export const workOrdersListSchema = paginatedSearchSchema.extend({
  status: workOrderStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
})

// Work order service line item
const workOrderServiceSchema = z.object({
  serviceTypeId: z.string().uuid().nullish(),
  description: z.string().max(500).nullish(),
  hours: z.coerce.number().positive('Hours must be greater than zero'),
  rate: z.coerce.number().min(0, 'Rate cannot be negative'),
})

// Work order part line item
const workOrderPartSchema = z.object({
  itemId: uuidSchema,
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: currencyAmountSchema,
  discount: currencyAmountSchema.default(0),
})

// POST /api/work-orders
export const createWorkOrderSchema = z.object({
  customerId: uuidSchema,
  vehicleId: uuidSchema,
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  odometerIn: z.coerce.number().int().positive('Odometer reading must be greater than zero'),
  customerComplaint: z.string().max(5000).nullish(),
  assignedTo: optionalUuid,
  warehouseId: uuidSchema,
  costCenterId: optionalUuid,
  services: z.array(workOrderServiceSchema).default([]),
  parts: z.array(workOrderPartSchema).default([]),
  confirmCustomerMismatch: z.boolean().optional(),
})

// ==================== WORK ORDER DETAIL ====================

// PUT /api/work-orders/[id]
export const updateWorkOrderSchema = z.object({
  customerId: optionalUuid,
  vehicleId: optionalUuid,
  status: z.enum(['draft', 'confirmed', 'in_progress', 'completed', 'invoiced', 'cancelled']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  odometerIn: z.coerce.number().int().min(0, 'Odometer must be a non-negative number').nullish(),
  customerComplaint: z.string().max(5000).nullish(),
  diagnosis: z.string().max(5000).nullish(),
  assignedTo: optionalUuid,
  warehouseId: optionalUuid,
  costCenterId: optionalUuid,
  cancellationReason: z.string().max(5000).nullish(),
  expectedUpdatedAt: z.string().optional(),
  estimateAction: z.enum(['cancel', 'revert', 'keep']).optional(),
  appointmentAction: z.enum(['cancel', 'revert', 'keep']).optional(),
  assignmentReason: z.string().max(1000).nullish(),
  changesSummary: z.string().max(2000).optional(),
})

// POST /api/work-orders/[id]/parts
export const addWorkOrderPartSchema = z.object({
  itemId: uuidSchema,
  quantity: z.coerce.number().positive('Quantity must be a positive number'),
  unitPrice: z.coerce.number().min(0).optional(),
})

// PUT /api/work-orders/[id]/parts
export const updateWorkOrderPartSchema = z.object({
  partId: uuidSchema,
  quantity: z.coerce.number().positive('Quantity must be a positive number'),
  unitPrice: z.coerce.number().min(0, 'Unit price must be a non-negative number'),
  expectedUpdatedAt: z.string().optional(),
})

// POST /api/work-orders/[id]/services
export const addWorkOrderServiceSchema = z.object({
  serviceTypeId: optionalUuid,
  description: z.string().max(500).nullish(),
  hours: z.coerce.number().positive('Hours must be a positive number'),
  rate: z.coerce.number().min(0, 'Rate must be a non-negative number'),
  technicianId: optionalUuid,
})

// PUT /api/work-orders/[id]/services
export const updateWorkOrderServiceSchema = z.object({
  serviceId: uuidSchema,
  hours: z.coerce.number().positive('Hours must be a positive number'),
  rate: z.coerce.number().min(0, 'Rate must be a non-negative number'),
  technicianId: optionalUuid,
  expectedUpdatedAt: z.string().optional(),
})

// POST /api/work-orders/[id]/invoice
export const createWorkOrderInvoiceSchema = z.object({
  expectedUpdatedAt: z.string().optional(),
  paymentMethod: z.string().max(50).optional(),
  paidAmount: z.coerce.number().min(0).default(0),
  creditAmount: z.coerce.number().min(0).default(0),
  reference: z.string().max(500).nullish(),
  addOverpaymentToCredit: z.boolean().optional(),
})

// ==================== APPOINTMENTS ====================

// POST /api/appointments
export const createAppointmentSchema = z.object({
  customerId: uuidSchema,
  vehicleId: uuidSchema,
  serviceTypeId: uuidSchema,
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  durationMinutes: z.coerce.number().int().min(1, 'Duration must be at least 1 minute').max(480, 'Duration must be at most 480 minutes').default(60),
  notes: z.string().trim().max(5000).nullish(),
  recurrencePattern: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).default('none'),
  recurrenceEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  confirmCustomerMismatch: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.recurrencePattern !== 'none' && !data.recurrenceEndDate) {
      return false
    }
    return true
  },
  { message: 'Recurrence end date is required for recurring appointments', path: ['recurrenceEndDate'] }
)

// PUT /api/appointments/[id]
export const updateAppointmentSchema = z.object({
  customerId: optionalUuid,
  vehicleId: optionalUuid,
  serviceTypeId: optionalUuid,
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(480).optional(),
  status: z.enum(['scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show']).optional(),
  notes: z.string().trim().max(5000).nullish(),
  createWorkOrder: z.boolean().optional(),
  warehouseId: optionalUuid,
  workOrderId: optionalUuid,
  cancellationReason: z.string().trim().max(5000).nullish(),
  expectedUpdatedAt: z.string().optional(),
})

// ==================== INSPECTIONS ====================

// POST /api/work-orders/[id]/inspections
export const createInspectionSchema = z.object({
  inspectionType: inspectionTypeSchema.default('check_in'),
  templateId: optionalUuid,
  fuelLevel: z.coerce.number().min(0).max(100).nullish(),
  odometerReading: z.coerce.number().int().min(0).nullish(),
  notes: z.string().max(5000).nullish(),
})

// PUT /api/work-orders/[id]/inspections/[inspectionId]
export const updateInspectionSchema = z.object({
  status: inspectionStatusSchema.optional(),
  fuelLevel: z.coerce.number().min(0).max(100).optional(),
  odometerReading: z.coerce.number().int().min(0).optional(),
  customerSignature: z.string().max(50000).optional(), // Base64 signature data
  notes: z.string().max(5000).optional(),
})

// ==================== DAMAGE MARKS ====================

// POST /api/work-orders/[id]/inspections/[inspectionId]/damage-marks
export const createDamageMarkSchema = z.object({
  diagramViewId: optionalUuid,
  positionX: z.coerce.number().min(0, 'Position X must be between 0 and 100').max(100, 'Position X must be between 0 and 100'),
  positionY: z.coerce.number().min(0, 'Position Y must be between 0 and 100').max(100, 'Position Y must be between 0 and 100'),
  damageType: damageTypeSchema,
  severity: damageSeveritySchema.default('minor'),
  description: z.string().max(1000).nullish(),
  isPreExisting: z.boolean().default(false),
})

// PUT /api/work-orders/[id]/inspections/[inspectionId]/damage-marks
export const updateDamageMarkSchema = z.object({
  markId: uuidSchema,
  damageType: damageTypeSchema.optional(),
  severity: damageSeveritySchema.optional(),
  description: z.string().max(1000).optional(),
  isPreExisting: z.boolean().optional(),
})

// ==================== INSPECTION RESPONSES ====================

// Single response item
const inspectionResponseItemSchema = z.object({
  checklistItemId: uuidSchema,
  response: checklistResponseSchema.nullish(),
  value: z.string().max(1000).nullish(),
  notes: z.string().max(2000).nullish(),
})

// POST /api/work-orders/[id]/inspections/[inspectionId]/responses
// Supports two modes: single response OR bulk responses
export const upsertInspectionResponseSchema = z.union([
  // Single response mode
  inspectionResponseItemSchema,
  // Bulk response mode
  z.object({
    responses: z.array(inspectionResponseItemSchema).min(1, 'At least one response is required'),
  }),
])

// ==================== INSPECTION TEMPLATE CATEGORIES ====================

// Checklist item within a category
const checklistItemInputSchema = z.object({
  itemName: shortTextSchema,
  itemType: checklistItemTypeSchema.default('checkbox'),
  options: z.array(z.string().max(255)).optional(),
  isRequired: z.boolean().default(false),
  sortOrder: nonNegativeIntSchema.optional(),
})

// POST /api/inspection-templates/[id]/categories
export const createInspectionCategorySchema = z.object({
  name: shortTextSchema,
  sortOrder: nonNegativeIntSchema.optional(),
  items: z.array(checklistItemInputSchema).optional(),
})

// PUT /api/inspection-templates/[id]/categories (bulk sort order update)
export const updateInspectionCategoriesOrderSchema = z.object({
  categories: z.array(z.object({
    id: uuidSchema,
    sortOrder: nonNegativeIntSchema,
  })).min(1, 'At least one category is required'),
})

// ==================== INSPECTION TEMPLATE ITEMS ====================

// POST /api/inspection-templates/[id]/items
export const createChecklistItemSchema = z.object({
  categoryId: uuidSchema,
  itemName: shortTextSchema,
  itemType: checklistItemTypeSchema.default('checkbox'),
  options: z.array(z.string().max(255)).optional(),
  isRequired: z.boolean().default(false),
  sortOrder: nonNegativeIntSchema.optional(),
})

// PUT /api/inspection-templates/[id]/items (single item update)
export const updateChecklistItemSchema = z.object({
  itemId: uuidSchema,
  itemName: shortTextSchema.optional(),
  itemType: checklistItemTypeSchema.optional(),
  options: z.array(z.string().max(255)).optional(),
  isRequired: z.boolean().optional(),
  sortOrder: nonNegativeIntSchema.optional(),
  categoryId: optionalUuid,
})

// PUT /api/inspection-templates/[id]/items (bulk sort order update)
export const updateChecklistItemsOrderSchema = z.object({
  items: z.array(z.object({
    id: uuidSchema,
    sortOrder: nonNegativeIntSchema,
    categoryId: optionalUuid,
  })).min(1, 'At least one item is required'),
})
