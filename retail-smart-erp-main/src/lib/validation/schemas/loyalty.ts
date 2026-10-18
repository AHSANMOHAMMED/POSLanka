import { z } from 'zod'
import {
  uuidSchema,
  shortTextSchema,
  loyaltyTierSchema,
} from './common'

// ==================== LOYALTY PROGRAMS ====================

// Tier entry
const loyaltyTierInputSchema = z.object({
  name: shortTextSchema,
  tier: loyaltyTierSchema,
  minPoints: z.coerce.number().int().min(0).default(0),
  earnRate: z.coerce.number().min(0).default(1),
  redeemRate: z.coerce.number().min(0).default(1),
  isActive: z.boolean().default(true),
})

// POST /api/loyalty-programs (create or update)
export const upsertLoyaltyProgramSchema = z.object({
  name: shortTextSchema,
  collectionFactor: z.coerce.number().min(0).default(1),
  conversionFactor: z.coerce.number().min(0).default(0.01),
  minRedemptionPoints: z.coerce.number().int().min(0).default(100),
  pointsExpire: z.boolean().default(false),
  expiryDays: z.coerce.number().int().min(1).default(365),
  tiers: z.array(loyaltyTierInputSchema).max(20).optional(),
})

// PUT /api/loyalty-programs/[id]
export const updateLoyaltyProgramSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
})

// GET /api/loyalty-transactions
export const loyaltyTransactionsListSchema = z.object({
  customerId: uuidSchema,
})
