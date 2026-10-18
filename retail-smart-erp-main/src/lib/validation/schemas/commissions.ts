import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema,
  commissionStatusSchema, payoutStatusSchema,
  dateStringSchema,
} from './common'

// ==================== COMMISSIONS ====================

// GET /api/commissions
export const commissionsListSchema = paginatedSearchSchema.extend({
  userId: z.string().uuid().optional(),
  status: commissionStatusSchema.optional(),
  saleId: z.string().uuid().optional(),
  workOrderId: z.string().uuid().optional(),
  dateFrom: dateStringSchema.optional(),
  dateTo: dateStringSchema.optional(),
  unpaidOnly: z.string().optional().transform(v => v === 'true'),
})

// ==================== COMMISSION CALCULATE ====================

// POST /api/commissions/calculate
export const calculateCommissionSchema = z.object({
  userId: uuidSchema,
  saleId: optionalUuid,
  workOrderId: optionalUuid,
}).refine(
  (data) => data.saleId || data.workOrderId,
  { message: 'Either saleId or workOrderId is required', path: ['saleId'] }
)

// ==================== COMMISSION RATES ====================

// GET /api/commission-rates
export const commissionRatesListSchema = paginatedSearchSchema.omit({ search: true }).extend({
  userId: z.string().uuid().optional(),
  serviceTypeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  activeOnly: z.string().optional().transform(v => v === 'true'),
})

// POST /api/commission-rates
export const createCommissionRateSchema = z.object({
  userId: optionalUuid,
  serviceTypeId: optionalUuid,
  categoryId: optionalUuid,
  rate: z.coerce.number().min(0, 'Rate must be a positive number'),
  rateType: z.enum(['percentage', 'fixed']).default('percentage'),
}).refine(
  (data) => {
    if (data.rateType === 'percentage' && data.rate > 100) {
      return false
    }
    return true
  },
  { message: 'Percentage rate cannot exceed 100%', path: ['rate'] }
)

// ==================== COMMISSION PAYOUTS ====================

// GET /api/commission-payouts
export const commissionPayoutsListSchema = paginatedSearchSchema.extend({
  userId: z.string().uuid().optional(),
  status: payoutStatusSchema.optional(),
  dateFrom: dateStringSchema.optional(),
  dateTo: dateStringSchema.optional(),
})

// POST /api/commission-payouts
export const createCommissionPayoutSchema = z.object({
  userId: uuidSchema,
  periodStart: dateStringSchema,
  periodEnd: dateStringSchema,
  notes: z.string().trim().max(5000).nullish(),
}).refine(
  (data) => data.periodStart <= data.periodEnd,
  { message: 'periodStart cannot be after periodEnd', path: ['periodEnd'] }
)

// ==================== DETAIL / ACTION SCHEMAS ====================

// PUT /api/commissions/[id]
export const updateCommissionSchema = z.object({
  status: z.enum(['approved', 'cancelled']),
})

// PUT /api/commission-rates/[id]
export const updateCommissionRateSchema = z.object({
  userId: optionalUuid,
  serviceTypeId: optionalUuid,
  categoryId: optionalUuid,
  rate: z.coerce.number().min(0, 'Rate must be a positive number').optional(),
  rateType: z.enum(['percentage', 'fixed']).optional(),
  isActive: z.boolean().optional(),
})

// GET /api/commission-rates/matrix
export const commissionRateMatrixGetSchema = z.object({
  userId: uuidSchema,
})

// PUT /api/commission-rates/matrix
const matrixRateEntrySchema = z.object({
  categoryId: optionalUuid,
  serviceTypeId: optionalUuid,
  rate: z.coerce.number().nullable(),
  rateType: z.enum(['percentage', 'fixed']).default('percentage'),
})
export const commissionRateMatrixUpdateSchema = z.object({
  userId: uuidSchema,
  rates: z.array(matrixRateEntrySchema).min(1, 'At least one rate entry is required').max(100),
})

// PUT /api/commission-payouts/[id]
export const updateCommissionPayoutSchema = z.object({
  status: payoutStatusSchema.optional(),
  paymentMethod: z.string().max(50).optional(),
  paymentReference: z.string().max(255).optional(),
  notes: z.string().trim().max(5000).nullish(),
})
