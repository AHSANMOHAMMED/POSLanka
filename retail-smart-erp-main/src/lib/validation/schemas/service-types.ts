import { z } from 'zod'
import {
  paginatedSearchSchema, paginationSchema,
  uuidSchema, optionalUuid, shortTextSchema,
} from './common'

// ==================== SERVICE TYPES ====================

// GET /api/service-types
export const serviceTypesListSchema = paginatedSearchSchema

// POST /api/service-types
export const createServiceTypeSchema = z.object({
  name: shortTextSchema,
  description: z.string().max(1000).nullish(),
  defaultHours: z.coerce.number().min(0).nullish(),
  defaultRate: z.coerce.number().min(0).nullish(),
  groupId: optionalUuid,
})

// PUT /api/service-types/[id]
export const updateServiceTypeSchema = z.object({
  name: shortTextSchema,
  description: z.string().max(1000).nullish(),
  defaultHours: z.coerce.number().min(0).nullish(),
  defaultRate: z.coerce.number().min(0).nullish(),
  isActive: z.boolean().optional(),
  groupId: optionalUuid,
})

// ==================== SERVICE TYPE GROUPS ====================

// POST /api/service-type-groups
export const createServiceTypeGroupSchema = z.object({
  name: shortTextSchema,
  description: z.string().max(1000).nullish(),
})

// PUT /api/service-type-groups/[id]
export const updateServiceTypeGroupSchema = z.object({
  name: shortTextSchema.optional(),
  description: z.string().max(1000).nullish(),
  isActive: z.boolean().optional(),
})

// ==================== LABOR GUIDES ====================

// GET /api/labor-guides
export const laborGuidesListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  serviceTypeId: z.string().uuid().optional(),
  makeId: z.string().uuid().optional(),
})

// POST /api/labor-guides
export const createLaborGuideSchema = z.object({
  serviceTypeId: uuidSchema,
  makeId: optionalUuid,
  modelId: optionalUuid,
  yearFrom: z.coerce.number().int().min(1900).max(2100).nullish(),
  yearTo: z.coerce.number().int().min(1900).max(2100).nullish(),
  hours: z.coerce.number().positive('Hours must be a positive number'),
})

// PUT /api/labor-guides/[id]
export const updateLaborGuideSchema = z.object({
  serviceTypeId: z.string().uuid().optional(),
  makeId: optionalUuid,
  modelId: optionalUuid,
  yearFrom: z.coerce.number().int().min(1900).max(2100).nullish(),
  yearTo: z.coerce.number().int().min(1900).max(2100).nullish(),
  hours: z.coerce.number().positive('Hours must be a positive number'),
})

// ==================== INSPECTION TEMPLATES (list/create) ====================

// GET /api/inspection-templates
export const inspectionTemplatesListSchema = z.object({
  vehicleTypeId: z.string().uuid().optional(),
  inspectionType: z.enum(['check_in', 'check_out']).optional(),
  includeInactive: z.string().optional().transform(v => v === 'true'),
})

// POST /api/inspection-templates
export const createInspectionTemplateSchema = z.object({
  name: shortTextSchema,
  description: z.string().max(1000).nullish(),
  vehicleTypeId: optionalUuid,
  inspectionType: z.enum(['check_in', 'check_out']).default('check_in'),
  cloneFromId: optionalUuid,
})

// PUT /api/inspection-templates/[id]
export const updateInspectionTemplateSchema = z.object({
  name: shortTextSchema.optional(),
  description: z.string().max(1000).nullish(),
  vehicleTypeId: optionalUuid,
  inspectionType: z.enum(['check_in', 'check_out']).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})
