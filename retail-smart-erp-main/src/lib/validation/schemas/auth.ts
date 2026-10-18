import { z } from 'zod'
import { emailSchema, phoneSchema, passwordSchema, shortTextSchema } from './common'

// POST /api/auth/forgot-password
export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

// POST /api/register/check-email
export const checkEmailSchema = z.object({
  email: emailSchema,
})

// POST /api/register/send-otp
export const sendOtpSchema = z.object({
  email: emailSchema,
  type: z.enum(['registration', 'password_reset']).default('registration'),
})

// POST /api/register/verify-otp
export const verifyOtpSchema = z.object({
  email: emailSchema,
  otp: z.string().min(1, 'Verification code is required'),
  type: z.enum(['registration', 'password_reset']).default('registration'),
})

// POST /api/lookup-tenant
export const lookupTenantSchema = z.object({
  email: emailSchema,
})

// POST /api/register
export const registerSchema = z.object({
  fullName: shortTextSchema,
  email: emailSchema,
  password: passwordSchema,
  country: z.string().min(2).max(2, 'Country must be a 2-letter code'),
  phone: phoneSchema,
  verificationToken: z.string().optional(),
  tosAcceptedAt: z.string().min(1, 'Terms of Service acceptance is required'),
})

// POST /api/auth/reset-password
export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: passwordSchema,
})

// POST /api/invites/[token]/accept
export const acceptInviteSchema = z.object({
  fullName: z.string().trim().min(1).max(255).optional(),
  password: passwordSchema.optional(),
  phone: phoneSchema.optional(),
})

// POST /api/auth/staff-forgot-password
export const staffForgotPasswordSchema = z.object({
  email: emailSchema,
  tenantSlug: z.string().min(1, 'Company slug is required'),
})

// POST /api/auth/staff-reset-password
export const staffResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: passwordSchema,
})

// PUT /api/account/password
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
})

// PUT /api/account/profile
export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(255).optional(),
  phone: phoneSchema.optional(),
  country: z.string().min(2).max(2).optional(),
})

// POST /api/account/messages
export const createMessageSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(255),
  message: z.string().trim().min(1, 'Message is required').max(5000),
  category: z.enum(['general', 'billing', 'technical', 'feature_request', 'bug_report']).default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
})

// GET /api/account/messages
export const messagesListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().max(50).optional(),
})
