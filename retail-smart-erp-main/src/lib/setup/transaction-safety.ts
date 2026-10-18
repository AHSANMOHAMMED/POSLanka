// Transaction safety utilities for company setup wizard
// Inspired by ERPNext's setup wizard with atomic operations and rollback safety

import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { getTaxSuggestionForCountryCode } from './country-wise-tax'
import { getCountryByCode } from '@/lib/utils/countries'
import * as schema from '@/lib/db/schema'

/**
 * Retry a transaction with exponential backoff for concurrency safety
 * Similar to ERPNext's approach for handling concurrent setup operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 100
): Promise<T> {
  let lastError: Error = new Error('Unknown error')
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      
      // Check if error is retryable (deadlock, serialization failure, unique constraint)
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isRetryable = errorMessage.includes('deadlock') ||
                         errorMessage.includes('serialization') ||
                         errorMessage.includes('unique constraint') ||
                         errorMessage.includes('could not serialize')
      
      if (!isRetryable || attempt === maxRetries) {
        throw error
      }
      
      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      const jitter = Math.random() * delay * 0.1 // ±10% jitter
      const totalDelay = delay + jitter
      
      await new Promise(resolve => setTimeout(resolve, totalDelay))
    }
  }
  
  throw lastError
}

/**
 * Execute a critical operation with transaction isolation
 * Ensures proper cleanup on failure
 */
export async function withTransactionIsolation<T>(
  operation: (tx: typeof db) => Promise<T>,
  isolationLevel: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' = 'SERIALIZABLE'
): Promise<T> {
  return db.transaction(async (tx) => {
    // Set transaction isolation level
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL ${sql.raw(isolationLevel)}`)

    // Execute the operation
    return await operation(tx as unknown as typeof db)
  })
}

/**
 * Check for slug availability with lock to prevent race conditions
 * Similar to ERPNext's company code reservation
 */
export async function checkAndReserveSlug(
  slug: string,
  accountId: string,
  _timeoutSeconds = 10
): Promise<{ available: boolean; reserved: boolean; reason?: string }> {
  try {
    return await withTransactionIsolation(async (tx) => {
      // Check existing tenants with lock
      const existingTenant = await tx.query.tenants.findFirst({
        where: (tenants, { eq }) => eq(tenants.slug, slug),
      })
      
      if (existingTenant) {
        return { available: false, reserved: false, reason: 'Business code is already taken' }
      }
      
      // Check pending companies with lock
      const existingPending = await tx.query.pendingCompanies.findFirst({
        where: (pendingCompanies, { and, eq, gt }) => and(
          eq(pendingCompanies.slug, slug),
          gt(pendingCompanies.expiresAt, new Date())
        ),
      })
      
      if (existingPending) {
        return { 
          available: false, 
          reserved: true, 
          reason: 'Business code is reserved by a pending company' 
        }
      }
      
      return { available: true, reserved: false }
    })
  } catch (error) {
    logError('checkAndReserveSlug', error)
    throw new Error('Failed to verify business code availability')
  }
}

/**
 * Create a company with comprehensive safety checks
 * Similar to ERPNext's company creation with all-or-nothing semantics
 */
export interface CompanyCreationOptions {
  name: string
  slug: string
  businessType: string
  email?: string
  phone?: string
  address?: string
  country: string
  dateFormat: string
  timeFormat: string
  accountId: string
  accountEmail: string
  accountFullName: string
  accountPasswordHash: string
  tierId?: string
  billingCycle?: string
}

/**
 * Enhanced company creation with ERPNext-like safety features
 */
export async function createCompanySafely(options: CompanyCreationOptions): Promise<{
  success: boolean
  tenantId?: string
  slug: string
  isPending?: boolean
  pendingId?: string
  error?: string
  code?: string
}> {
  try {
    // Validate required fields
    if (!options.name || !options.slug || !options.businessType || !options.country || 
        !options.dateFormat || !options.timeFormat) {
      return {
        success: false,
        slug: options.slug,
        error: 'Name, slug, business type, country, date format, and time format are required',
        code: 'MISSING_FIELDS'
      }
    }

    // Check if user has existing companies to determine flow
    const existingMemberships = await db.query.accountTenants.findFirst({
      where: (accountTenants, { and, eq }) => and(
        eq(accountTenants.accountId, options.accountId),
        eq(accountTenants.isActive, true)
      ),
    })

    const hasExistingCompanies = !!existingMemberships

    // Flow B: User already has companies → require payment (create pending company)
    if (hasExistingCompanies) {
      if (!options.tierId) {
        return {
          success: false,
          slug: options.slug,
          error: 'Pricing tier is required for additional companies',
          code: 'TIER_REQUIRED'
        }
      }

      return await withRetry(async () => {
        return await withTransactionIsolation(async (tx) => {
          // Validate tier exists and is not trial/free
          const tier = await tx.query.pricingTiers.findFirst({
            where: (pricingTiers, { and, eq }) => and(
              eq(pricingTiers.id, options.tierId!),
              eq(pricingTiers.isActive, true)
            ),
          })

          if (!tier) {
            return {
              success: false,
              slug: options.slug,
              error: 'Invalid pricing tier',
              code: 'INVALID_TIER'
            }
          }

          if (tier.name === 'trial' || tier.name === 'free') {
            return {
              success: false,
              slug: options.slug,
              error: 'Cannot select trial or free tier for additional companies',
              code: 'INVALID_TIER_TYPE'
            }
          }

          // Check slug availability with lock
          const slugCheck = await checkAndReserveSlug(options.slug, options.accountId)
          if (!slugCheck.available) {
            return {
              success: false,
              slug: options.slug,
              error: slugCheck.reason || 'Business code unavailable',
              code: slugCheck.reserved ? 'SLUG_RESERVED' : 'SLUG_TAKEN'
            }
          }

          // Create pending company
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + 7) // 7-day reservation

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const [pending] = await (tx as any).insert(schema.pendingCompanies).values({
            accountId: options.accountId,
            name: options.name.trim(),
            slug: options.slug.toLowerCase(),
            email: options.email?.trim() || options.accountEmail,
            phone: options.phone?.trim() || null,
            address: options.address?.trim() || null,
            businessType: options.businessType,
            country: options.country,
            dateFormat: options.dateFormat,
            timeFormat: options.timeFormat,
            tierId: options.tierId,
            billingCycle: options.billingCycle || 'monthly',
            status: 'pending_payment',
            expiresAt,
          }).returning()

          return {
            success: true,
            pendingId: pending.id,
            slug: pending.slug,
            isPending: true
          }
        })
      })
    }

    // Flow A: First company → create immediately (free forever, no expiry)
    return await withRetry(async () => {
      return await withTransactionIsolation(async (tx) => {
        // Check slug availability with lock
        const slugCheck = await checkAndReserveSlug(options.slug, options.accountId)
        if (!slugCheck.available) {
          return {
            success: false,
            slug: options.slug,
            error: slugCheck.reason || 'Business code unavailable',
            code: slugCheck.reserved ? 'SLUG_RESERVED' : 'SLUG_TAKEN'
          }
        }

        // Get trial tier (used internally for free plan - DB enum is 'trial')
        const trialTier = await tx.query.pricingTiers.findFirst({
          where: (pricingTiers, { eq }) => eq(pricingTiers.name, 'trial'),
        })

        const countryInfo = getCountryByCode(options.country)
        const currency = countryInfo?.currency || 'LKR'
        const now = new Date()

        // Create tenant - first company is free forever (no expiry)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [tenant] = await (tx as any).insert(schema.tenants).values({
          name: options.name.trim(),
          slug: options.slug.toLowerCase(),
          email: options.email?.trim() || options.accountEmail,
          phone: options.phone?.trim() || null,
          address: options.address?.trim() || null,
          businessType: options.businessType,
          country: options.country,
          currency,
          dateFormat: options.dateFormat,
          timeFormat: options.timeFormat,
          primaryOwnerId: options.accountId,
          plan: 'trial',
          planExpiresAt: null,
          status: 'active',
        }).returning()

        // Set tenant context for RLS
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`)

        // Create subscription (free forever - no trial end date)
        if (trialTier) {
          await tx.insert(schema.subscriptions).values({
            tenantId: tenant.id,
            billingAccountId: options.accountId,
            tierId: trialTier.id,
            status: 'trial',
            trialEndsAt: null,
            currentPeriodStart: now,
            currentPeriodEnd: new Date('2099-12-31'),
            billingCycle: 'monthly',
          })
        }

        // Create account-tenant membership
        await tx.insert(schema.accountTenants).values({
          accountId: options.accountId,
          tenantId: tenant.id,
          role: 'owner',
          isOwner: true,
          acceptedAt: now,
        })

        // Create user in tenant
        await tx.insert(schema.users).values({
          tenantId: tenant.id,
          accountId: options.accountId,
          email: options.accountEmail,
          fullName: options.accountFullName,
          passwordHash: options.accountPasswordHash,
          role: 'owner',
        })

        // Initialize tenant usage
        await tx.insert(schema.tenantUsage).values({
          tenantId: tenant.id,
        }).onConflictDoNothing()

        return {
          success: true,
          tenantId: tenant.id,
          slug: tenant.slug,
          isPending: false
        }
      })
    })
  } catch (error) {
    logError('createCompanySafely', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    // Provide more specific error codes for client handling
    if (errorMessage.includes('unique constraint') || errorMessage.includes('duplicate key')) {
      return {
        success: false,
        slug: options.slug,
        error: 'Business code already exists. Please try a different code.',
        code: 'DUPLICATE_SLUG'
      }
    }
    
    if (errorMessage.includes('deadlock') || errorMessage.includes('serialization')) {
      return {
        success: false,
        slug: options.slug,
        error: 'System busy. Please try again in a moment.',
        code: 'CONCURRENCY_ERROR'
      }
    }
    
    return {
      success: false,
      slug: options.slug,
      error: 'Failed to create company. Please try again.',
      code: 'INTERNAL_ERROR'
    }
  }
}

/**
 * Validate company setup data with comprehensive checks
 * Similar to ERPNext's validation in setup wizard
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateCompanySetup(data: Partial<CompanyCreationOptions>): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required field validation
  if (!data.name?.trim()) {
    errors.push('Company name is required')
  } else if (data.name.trim().length < 2) {
    errors.push('Company name must be at least 2 characters')
  }

  if (!data.slug?.trim()) {
    errors.push('Business code is required')
  } else {
    const slugRegex = /^[a-z0-9-]+$/
    if (!slugRegex.test(data.slug)) {
      errors.push('Business code can only contain lowercase letters, numbers, and hyphens')
    }
    if (data.slug.length < 3) {
      errors.push('Business code must be at least 3 characters')
    }
    if (data.slug.length > 32) {
      errors.push('Business code must be 32 characters or less')
    }
  }

  if (!data.businessType) {
    errors.push('Business type is required')
  }

  if (!data.country) {
    errors.push('Country is required')
  }

  if (!data.dateFormat) {
    errors.push('Date format is required')
  }

  if (!data.timeFormat) {
    errors.push('Time format is required')
  }

  // Email validation (optional but if provided, should be valid)
  if (data.email && data.email.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(data.email.trim())) {
      warnings.push('Email address appears to be invalid')
    }
  }

  // Phone validation (optional)
  if (data.phone && data.phone.trim()) {
    const phoneRegex = /^[\d\s\-\+\(\)]+$/
    if (!phoneRegex.test(data.phone.trim())) {
      warnings.push('Phone number contains invalid characters')
    }
  }

  // Business type specific warnings
  if (data.businessType === 'restaurant' && !data.address?.trim()) {
    warnings.push('Restaurants should have an address for delivery purposes')
  }

  if (data.businessType === 'auto_service' && !data.phone?.trim()) {
    warnings.push('Auto service businesses should have a phone number for customer contact')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Get default settings based on country and business type
 * Similar to ERPNext's country-wise defaults
 */
export interface DefaultSettings {
  currency: string
  currencySymbol: string
  dateFormat: string
  timeFormat: string
  taxRate: number
  taxInclusive: boolean
  fiscalYearStart: string
  fiscalYearEnd: string
}

export function getCountryBusinessDefaults(
  countryCode: string,
  businessType: string
): Partial<DefaultSettings> {
  const defaults: Partial<DefaultSettings> = {}
  
  // Currency defaults from country mapping
  const countryInfo = getCountryByCode(countryCode)
  defaults.currency = countryInfo?.currency || 'LKR'
  defaults.currencySymbol = countryInfo?.currencySymbol || 'Rs'
  
  // Get tax suggestions
  const taxSuggestion = getTaxSuggestionForCountryCode(countryCode, businessType)
  defaults.taxRate = taxSuggestion.taxRate
  defaults.taxInclusive = taxSuggestion.taxInclusive
  
  // Date/time format defaults (simplified - could be expanded)
  defaults.dateFormat = 'DD/MM/YYYY'
  defaults.timeFormat = '12h'
  
  // Fiscal year defaults (simplified - could be expanded per country)
  defaults.fiscalYearStart = '01-01'
  defaults.fiscalYearEnd = '12-31'
  
  return defaults
}
