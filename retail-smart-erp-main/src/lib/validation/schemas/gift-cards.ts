import { z } from 'zod'
import {
  paginatedSearchSchema,
  optionalUuid,
  giftCardStatusSchema,
  positiveCurrencySchema,
} from './common'

// ==================== GIFT CARDS ====================

// GET /api/gift-cards
export const giftCardsListSchema = paginatedSearchSchema.extend({
  status: giftCardStatusSchema.optional(),
})

// POST /api/gift-cards
export const createGiftCardSchema = z.object({
  cardNumber: z.string().trim().min(1, 'Card number is required').max(100),
  initialBalance: positiveCurrencySchema,
  pin: z.string().max(20).nullish(),
  expiryDate: z.string().nullish(),
  issuedTo: optionalUuid,
})

// PUT /api/gift-cards/[id]
export const updateGiftCardSchema = z.object({
  status: giftCardStatusSchema.optional(),
  expiryDate: z.string().nullish(),
  pin: z.string().max(20).nullish(),
})

// POST /api/gift-cards/[id]/redeem
export const redeemGiftCardSchema = z.object({
  amount: positiveCurrencySchema,
  saleId: optionalUuid,
})

// POST /api/gift-cards/[id]/reload
export const reloadGiftCardSchema = z.object({
  amount: positiveCurrencySchema,
})

// GET /api/gift-cards/lookup?cardNumber=XXX
export const lookupGiftCardSchema = z.object({
  cardNumber: z.string().trim().min(1, 'Card number is required').max(100),
})
