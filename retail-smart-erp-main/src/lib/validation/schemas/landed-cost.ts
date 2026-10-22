import { z } from 'zod'
import { LANDED_COST_CHARGE_TYPES } from '@/lib/purchasing/landed-cost'

// ==================== LANDED COST VOUCHERS (H3) ====================

const landedCostChargeSchema = z.object({
  chargeType: z.enum(LANDED_COST_CHARGE_TYPES),
  description: z.string().max(255).nullish(),
  amount: z.coerce.number().positive('Charge amount must be greater than zero').max(1_000_000_000),
  /** charge billed by a supplier → credited to Accounts Payable (+ supplier balance) */
  supplierId: z.string().uuid().nullish(),
  /** else the account credited (e.g. customs payable, cash) */
  creditAccountId: z.string().uuid().nullish(),
}).refine(c => !!c.supplierId || !!c.creditAccountId, { message: 'Each charge needs a supplier or a credit account', path: ['supplierId'] })

const landedCostSourceSchema = z.object({
  type: z.enum(['grn', 'purchase']),
  id: z.string().uuid(),
})

export const saveLandedCostVoucherSchema = z.object({
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  allocationMethod: z.enum(['value', 'quantity']).default('value'),
  notes: z.string().max(5000).nullish(),
  sources: z.array(landedCostSourceSchema).min(1, 'Select at least one goods receipt or purchase invoice').max(50),
  charges: z.array(landedCostChargeSchema).min(1, 'Add at least one charge').max(50),
  /** create and submit in one call */
  submit: z.boolean().optional(),
})

export const cancelLandedCostVoucherSchema = z.object({
  cancellationReason: z.string().max(1000).optional(),
})

export const landedCostListSchema = z.object({
  status: z.enum(['draft', 'submitted', 'cancelled']).optional(),
  sourceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
