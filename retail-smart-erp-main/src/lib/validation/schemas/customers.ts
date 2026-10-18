import { z } from 'zod'
import {
  paginatedSearchSchema,
  phoneSchema,
  emailSchema,
  customerBusinessTypeSchema,
  customerTypeSchema,
  optionalUuid,
  optimisticLockSchema,
} from './common'

// ==================== CUSTOMERS ====================

// GET /api/customers
export const customersListSchema = paginatedSearchSchema

// POST /api/customers
export const createCustomerSchema = z.object({
  // Basic Information
  name: z.string().trim().min(1, 'Name is required').max(255),
  firstName: z.string().trim().max(100).nullish(),
  lastName: z.string().trim().max(100).nullish(),
  companyName: z.string().trim().max(255).nullish(),
  email: emailSchema.nullish(),
  phone: phoneSchema.nullish(),
  mobilePhone: phoneSchema.nullish(),
  alternatePhone: phoneSchema.nullish(),

  // Primary Address
  addressLine1: z.string().max(255).nullish(),
  addressLine2: z.string().max(255).nullish(),
  city: z.string().max(100).nullish(),
  state: z.string().max(100).nullish(),
  postalCode: z.string().max(20).nullish(),
  country: z.string().max(100).nullish(),

  // Billing Address
  useSameBillingAddress: z.boolean().default(true),
  billingAddressLine1: z.string().max(255).nullish(),
  billingAddressLine2: z.string().max(255).nullish(),
  billingCity: z.string().max(100).nullish(),
  billingState: z.string().max(100).nullish(),
  billingPostalCode: z.string().max(20).nullish(),
  billingCountry: z.string().max(100).nullish(),

  // Business/Tax
  taxId: z.string().max(50).nullish(),
  taxExempt: z.boolean().default(false),
  businessType: customerBusinessTypeSchema.default('individual'),

  // Financial
  creditLimit: z.coerce.number().min(0).nullish(),
  paymentTerms: z.string().max(50).nullish(),
  defaultPaymentMethod: z.string().max(50).nullish(),
  paymentTermsTemplateId: optionalUuid,

  // Marketing
  customerType: customerTypeSchema.default('retail'),
  referralSource: z.string().max(100).nullish(),
  marketingOptIn: z.boolean().default(false),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Birthday must be in YYYY-MM-DD format').nullish(),

  // Notes
  notes: z.string().max(5000).nullish(),
  specialInstructions: z.string().max(5000).nullish(),

  // Auto Service
  driverLicenseNumber: z.string().max(50).nullish(),
})

// ==================== DETAIL / ACTION SCHEMAS ====================

// PUT /api/customers/[id]
export const updateCustomerSchema = createCustomerSchema.merge(optimisticLockSchema)

// POST /api/customers/[id]/credit
const creditTransactionTypeValues = ['add', 'refund', 'overpayment', 'use', 'adjustment'] as const
export const customerCreditSchema = z.object({
  amount: z.coerce.number().refine(v => v !== 0, 'Amount cannot be zero'),
  type: z.enum(creditTransactionTypeValues).default('add'),
  notes: z.string().max(5000).nullish(),
  referenceType: z.string().max(100).default('manual'),
  referenceId: z.string().uuid().optional(),
})
