import { z } from 'zod'
import {
  paginatedSearchSchema,
  optionalUuid,
  dateStringSchema,
} from './common'

// ==================== SUPPLIERS ====================

// GET /api/suppliers
export const suppliersListSchema = paginatedSearchSchema

// POST /api/suppliers
export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email format').max(255).nullish(),
  phone: z.string().max(50).nullish(),
  address: z.string().max(2000).nullish(),
  taxId: z.string().max(50).nullish(),
  taxInclusive: z.boolean().default(false),
  paymentTermsTemplateId: optionalUuid,
})

// ==================== SUPPLIER BALANCE HISTORY ====================

// GET /api/suppliers/[id]/balance-history
export const supplierBalanceHistorySchema = paginatedSearchSchema

// ==================== DETAIL / ACTION SCHEMAS ====================

// PUT /api/suppliers/[id]
export const updateSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email format').max(255).nullish(),
  phone: z.string().max(50).nullish(),
  address: z.string().max(2000).nullish(),
  taxId: z.string().max(50).nullish(),
  taxInclusive: z.boolean().optional(),
  isActive: z.boolean().optional(),
  paymentTermsTemplateId: optionalUuid,
})

// GET /api/suppliers/[id]/performance
export const supplierPerformanceSchema = z.object({
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
})
