import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema,
  shortTextSchema,
  optimisticLockSchema,
  estimateTypeSchema, insuranceEstimateStatusSchema,
  estimateItemTypeSchema,
} from './common'

// ==================== INSURANCE ASSESSORS ====================

// GET /api/insurance-assessors
export const insuranceAssessorsListSchema = z.object({
  insuranceCompanyId: z.string().uuid().optional(),
})

// POST /api/insurance-assessors
export const createInsuranceAssessorSchema = z.object({
  insuranceCompanyId: optionalUuid,
  name: shortTextSchema,
  phone: z.string().max(20).nullish(),
  email: z.string().email().max(255).nullish(),
})

// PUT /api/insurance-assessors/[id]
export const updateInsuranceAssessorSchema = z.object({
  insuranceCompanyId: optionalUuid,
  name: shortTextSchema,
  phone: z.string().max(20).nullish(),
  email: z.string().email().max(255).nullish(),
  isActive: z.boolean().optional(),
})

// ==================== INSURANCE COMPANIES ====================

// GET /api/insurance-companies
export const insuranceCompaniesListSchema = paginatedSearchSchema

// POST /api/insurance-companies
export const createInsuranceCompanySchema = z.object({
  name: shortTextSchema,
  shortName: z.string().max(50).nullish(),
  phone: z.string().max(20).nullish(),
  email: z.string().email().max(255).nullish(),
  claimHotline: z.string().max(20).nullish(),
  isPartnerGarage: z.boolean().optional().default(false),
  estimateThreshold: z.coerce.number().min(0).nullish().transform(v => v != null ? String(v) : null),
})

// PUT /api/insurance-companies/[id]
export const updateInsuranceCompanySchema = z.object({
  name: shortTextSchema,
  shortName: z.string().max(50).nullish(),
  phone: z.string().max(20).nullish(),
  email: z.string().email().max(255).nullish(),
  claimHotline: z.string().max(20).nullish(),
  isPartnerGarage: z.boolean().optional(),
  estimateThreshold: z.coerce.number().min(0).nullish().transform(v => v != null ? String(v) : null),
  isActive: z.boolean().optional(),
})

// ==================== INSURANCE ESTIMATES ====================

// GET /api/insurance-estimates
export const insuranceEstimatesListSchema = paginatedSearchSchema.extend({
  status: insuranceEstimateStatusSchema.optional(),
  insuranceCompanyId: z.string().uuid().optional(),
  workOrderId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
})

// Estimate item sub-schema (for POST create)
const estimateItemSchema = z.object({
  itemType: estimateItemTypeSchema,
  serviceTypeId: optionalUuid,
  description: z.string().max(1000).nullish(),
  hours: z.coerce.number().min(0).optional(),
  rate: z.coerce.number().min(0).optional(),
  itemId: optionalUuid,
  partName: z.string().max(255).nullish(),
  quantity: z.coerce.number().min(0).optional(),
  unitPrice: z.coerce.number().min(0).optional(),
})

// Flexible phone that allows international formatting (matches route logic)
const flexiblePhoneSchema = z.string().max(20).refine(
  (v) => {
    const cleaned = v.replace(/[-\s()]/g, '')
    return /^\+?[0-9]{7,15}$/.test(cleaned)
  },
  'Invalid phone format. Please enter a valid phone number.'
)

// POST /api/insurance-estimates
export const createInsuranceEstimateSchema = z.object({
  estimateType: estimateTypeSchema.optional().default('insurance'),
  customerId: uuidSchema,
  vehicleId: uuidSchema,
  warehouseId: uuidSchema,
  insuranceCompanyId: optionalUuid,
  policyNumber: z.string().max(100).nullish(),
  claimNumber: z.string().max(100).nullish(),
  assessorId: optionalUuid,
  assessorName: z.string().max(255).nullish(),
  assessorPhone: flexiblePhoneSchema.nullish(),
  assessorEmail: z.string().email('Invalid assessor email format').max(255).nullish(),
  incidentDate: z.string().nullish(),
  incidentDescription: z.string().trim().min(1, 'Incident Description is required').max(5000),
  odometerIn: z.coerce.number().int().positive('Odometer reading is required'),
  items: z.array(estimateItemSchema).max(500).optional().default([]),
  confirmCustomerMismatch: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.estimateType === 'insurance') {
      if (!data.insuranceCompanyId) return false
    }
    return true
  },
  { message: 'Insurance Company is required for insurance estimates', path: ['insuranceCompanyId'] }
).refine(
  (data) => {
    if (data.estimateType === 'insurance') {
      if (!data.claimNumber) return false
    }
    return true
  },
  { message: 'Claim Number is required for insurance estimates', path: ['claimNumber'] }
).refine(
  (data) => {
    if (data.estimateType === 'insurance') {
      if (!data.incidentDate) return false
    }
    return true
  },
  { message: 'Incident Date is required for insurance estimates', path: ['incidentDate'] }
).refine(
  (data) => {
    if (data.incidentDate) {
      const incidentDateObj = new Date(data.incidentDate)
      const today = new Date()
      today.setHours(23, 59, 59, 999)
      return incidentDateObj <= today
    }
    return true
  },
  { message: 'Incident date cannot be in the future', path: ['incidentDate'] }
)

// PUT /api/insurance-estimates/[id]
export const updateInsuranceEstimateSchema = optimisticLockSchema.extend({
  customerId: optionalUuid,
  vehicleId: optionalUuid,
  insuranceCompanyId: optionalUuid,
  policyNumber: z.string().max(100).nullish(),
  claimNumber: z.string().max(100).nullish(),
  assessorId: optionalUuid,
  assessorName: z.string().max(255).nullish(),
  assessorPhone: flexiblePhoneSchema.nullish(),
  assessorEmail: z.string().email('Invalid assessor email format').max(255).nullish(),
  incidentDate: z.string().nullish(),
  incidentDescription: z.string().max(5000).nullish(),
  odometerIn: z.coerce.number().int().positive().nullish(),
  status: insuranceEstimateStatusSchema.optional(),
  insuranceRemarks: z.string().max(5000).nullish(),
  cancellationReason: z.string().max(1000).nullish(),
  holdStock: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.incidentDate) {
      const incidentDateObj = new Date(data.incidentDate)
      const today = new Date()
      today.setHours(23, 59, 59, 999)
      return incidentDateObj <= today
    }
    return true
  },
  { message: 'Incident date cannot be in the future', path: ['incidentDate'] }
)

// POST /api/insurance-estimates/[id]/apply-template
export const applyTemplateSchema = z.object({
  templateId: uuidSchema,
})

// POST /api/insurance-estimates/[id]/attachments/link
export const linkAttachmentsSchema = z.object({
  attachmentIds: z.array(uuidSchema).min(1, 'No attachments selected').max(200),
})

// POST /api/insurance-estimates/[id]/convert
const itemAdjustmentSchema = z.object({
  itemId: uuidSchema,
  action: z.enum(['convert', 'skip', 'partial']),
  quantity: z.coerce.number().positive().optional(),
})

export const convertEstimateSchema = z.object({
  checkOnly: z.boolean().optional().default(false),
  itemAdjustments: z.array(itemAdjustmentSchema).max(500).optional().default([]),
})

// PUT /api/insurance-estimates/[id]/review
const reviewItemUpdateSchema = z.object({
  id: uuidSchema,
  status: z.enum(['pending', 'approved', 'price_adjusted', 'rejected', 'requires_reinspection']).optional(),
  approvedAmount: z.coerce.number().min(0).nullish(),
  rejectionReason: z.string().max(1000).nullish(),
  assessorNotes: z.string().max(2000).nullish(),
})

export const reviewEstimateSchema = z.object({
  status: z.enum(['under_review', 'approved', 'partially_approved', 'rejected']).optional(),
  insuranceRemarks: z.string().max(5000).nullish(),
  items: z.array(reviewItemUpdateSchema).max(500).optional(),
})

// POST /api/insurance-estimates/[id]/revise
export const reviseEstimateSchema = z.object({
  changeReason: z.string().max(1000).nullish(),
})

// GET /api/insurance-estimates/attachments/browse
export const browseAttachmentsSchema = z.object({
  excludeEstimateId: z.string().uuid().optional(),
})

// Accept both strings and numbers for numeric fields (frontend may send either)
const numericStringField = z.union([z.string(), z.number().transform(String)]).optional()

// POST /api/insurance-estimates/[id]/items
export const addEstimateItemSchema = z.object({
  itemType: estimateItemTypeSchema,
  serviceTypeId: optionalUuid,
  description: z.string().max(1000).optional(),
  hours: numericStringField,
  rate: numericStringField,
  itemId: optionalUuid,
  partName: z.string().max(255).optional(),
  quantity: numericStringField,
  unitPrice: numericStringField,
  expectedUpdatedAt: z.string().optional(),
})

// PUT /api/insurance-estimates/[id]/items
export const updateEstimateItemSchema = z.object({
  itemId: uuidSchema,
  description: z.string().max(1000).optional(),
  hours: numericStringField,
  rate: numericStringField,
  partName: z.string().max(255).optional(),
  quantity: numericStringField,
  unitPrice: numericStringField,
  status: z.enum(['pending', 'approved', 'price_adjusted', 'rejected', 'requires_reinspection']).optional(),
  approvedAmount: numericStringField,
  rejectionReason: z.string().max(1000).optional(),
  assessorNotes: z.string().max(2000).optional(),
  expectedUpdatedAt: z.string().optional(),
})

// ==================== ESTIMATE TEMPLATES ====================

// Estimate template item sub-schema
const templateItemSchema = z.object({
  itemType: estimateItemTypeSchema,
  serviceTypeId: optionalUuid,
  description: z.string().max(1000).nullish(),
  hours: z.coerce.number().min(0).nullish(),
  rate: z.coerce.number().min(0).nullish(),
  itemId: optionalUuid,
  partName: z.string().max(255).nullish(),
  quantity: z.coerce.number().min(0).nullish(),
  unitPrice: z.coerce.number().min(0).nullish(),
})

// POST /api/estimate-templates
export const createEstimateTemplateSchema = z.object({
  name: shortTextSchema,
  description: z.string().max(1000).nullish(),
  itemsTemplate: z.array(templateItemSchema).max(500).optional().default([]),
})

// PUT /api/estimate-templates/[id]
export const updateEstimateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(1000).nullish(),
  itemsTemplate: z.array(templateItemSchema).max(500).optional(),
  isActive: z.boolean().optional(),
})
