import { z } from 'zod'
import { uuidSchema } from './common'

// ==================== COUPON VALIDATION ====================

// POST /api/public/coupons/validate
export const validateCouponSchema = z.object({
  code: z.string().trim().min(1, 'Coupon code is required').max(100),
  tierId: z.string().max(100).optional(),
  billingCycle: z.string().max(50).optional(),
})

// ==================== CONTACT FORM ====================

// POST /api/contact
export const contactFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().min(1, 'Email is required').max(255).email('Please provide a valid email address'),
  message: z.string().trim().min(1, 'Message is required').max(5000),
  company: z.string().max(200).optional(),
  businessType: z.string().max(100).optional(),
})

// ==================== BUG REPORTS ====================

// POST /api/bug-reports
export const bugReportSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
  description: z.string().max(5000).optional(),
  severity: z.string().max(50).optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(1000).optional(),
})

// ==================== CLIENT ERRORS ====================

const clientErrorItemSchema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(10000).optional(),
  url: z.string().max(2000).optional(),
  componentStack: z.string().max(10000).optional(),
  timestamp: z.number().optional(),
})

// POST /api/client-errors
export const clientErrorsSchema = z.object({
  errors: z.array(clientErrorItemSchema).min(1, 'No errors provided').max(10),
  userAgent: z.string().max(1000).optional(),
  browserInfo: z.any().optional(),
})

// ==================== PAYHERE CHECKOUT ====================

// POST /api/payhere/checkout
export const payhereCheckoutSchema = z.object({
  subscriptionId: z.string().uuid().optional(),
  pendingCompanyId: z.string().uuid().optional(),
  tierId: uuidSchema,
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  newTierId: z.string().uuid().optional(),
  walletCreditApplied: z.coerce.number().min(0).optional(),
  amount: z.coerce.number().positive().optional(),
})
