/**
 * Shared helper for activating a pending company into a real tenant.
 *
 * Called from:
 *  - Admin bank deposit approval (sys-control/payments/[id])
 *  - PayHere webhook on successful payment (payhere/notify)
 *
 * Creates in a single transaction (with FOR UPDATE lock on pending company):
 *  - tenants record (active, with correct plan + planExpiresAt)
 *  - RLS context
 *  - subscriptions record (active, with price locking + proper period dates)
 *  - accountTenants membership (owner)
 *  - users record (owner)
 *  - tenantUsage initialization
 *  - pendingCompanies status → approved
 *
 * Also sends: accountNotification + broadcastAccountChange
 */

import { db } from '@/lib/db'
import {
  tenants,
  subscriptions,
  accountTenants,
  users,
  tenantUsage,
  pendingCompanies,
  pricingTiers,
  accounts,
  accountNotifications,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getCurrencyByCountry } from '@/lib/utils/countries'
import { getNextPeriodDates } from '@/lib/billing/proration'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { BUSINESS_TYPE_FEATURE_PRESETS } from '@/lib/features/flags'

// Valid plan enum values from schema
const VALID_PLANS = ['trial', 'basic', 'standard', 'premium'] as const
type PlanName = (typeof VALID_PLANS)[number]

export function tierNameToPlan(tierName: string | null | undefined): PlanName {
  if (!tierName) return 'standard'
  const lower = tierName.toLowerCase()
  if (VALID_PLANS.includes(lower as PlanName)) return lower as PlanName
  // Map common tier names to plan values
  if (lower === 'starter' || lower === 'free') return 'basic'
  if (lower === 'professional' || lower === 'business') return 'standard'
  if (lower === 'enterprise') return 'premium'
  return 'standard'
}

export interface PendingCompanyData {
  id: string
  accountId: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  address: string | null
  businessType: 'retail' | 'restaurant' | 'supermarket' | 'auto_service' | 'dealership' | 'pharmacy' | 'electronics' | 'hardware' | 'print_studio' | 'office'
  country: string
  dateFormat: string
  timeFormat: string
  tierId: string
  billingCycle: string
  expiresAt?: Date | null
}

export interface ActivationResult {
  tenantId: string
  tenantSlug: string
  tenantName: string
}

export class ActivationError extends Error {
  public code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'ActivationError'
    this.code = code
  }
}

/**
 * Activate a pending company: create the tenant, subscription, user, etc.
 *
 * Uses FOR UPDATE lock on the pending company row to prevent double activation
 * from concurrent PayHere webhooks or admin approval racing each other.
 *
 * Throws ActivationError with a specific code on failure.
 */
export async function activateCompanyFromPending(
  pending: PendingCompanyData,
  billingCycle: 'monthly' | 'yearly',
): Promise<ActivationResult> {
  const now = new Date()
  const currency = getCurrencyByCountry(pending.country)

  const result = await db.transaction(async (tx) => {
    // 1. Lock the pending company row and re-check status (prevents double activation)
    const [lockedPending] = await tx
      .select()
      .from(pendingCompanies)
      .where(eq(pendingCompanies.id, pending.id))
      .for('update')

    if (!lockedPending) {
      throw new ActivationError('Pending company not found', 'NOT_FOUND')
    }

    // Only activate from valid pre-activation statuses
    if (lockedPending.status !== 'pending_payment' && lockedPending.status !== 'pending_approval') {
      throw new ActivationError(
        `Pending company already processed (status: ${lockedPending.status})`,
        'ALREADY_PROCESSED',
      )
    }

    // Check expiration
    if (lockedPending.expiresAt && lockedPending.expiresAt < now) {
      // Mark as expired inside transaction
      await tx.update(pendingCompanies)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(pendingCompanies.id, pending.id))
      throw new ActivationError('Pending company has expired', 'EXPIRED')
    }

    // Re-validate slug availability (TOCTOU protection)
    const existingTenant = await tx.query.tenants.findFirst({
      where: eq(tenants.slug, pending.slug),
      columns: { id: true },
    })
    if (existingTenant) {
      throw new ActivationError(
        `Slug "${pending.slug}" is already taken by another company`,
        'SLUG_TAKEN',
      )
    }

    // Look up tier to lock in current pricing and determine plan name
    const tier = await tx.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, pending.tierId),
    })

    const planName = tierNameToPlan(tier?.name)
    const { periodStart, periodEnd } = getNextPeriodDates(now, billingCycle)

    // Create tenant with correct plan and planExpiresAt
    const [tenant] = await tx.insert(tenants).values({
      name: pending.name,
      slug: pending.slug,
      email: pending.email || '',
      phone: pending.phone,
      address: pending.address,
      businessType: pending.businessType,
      country: pending.country || 'LK',
      currency: currency || 'LKR',
      dateFormat: pending.dateFormat,
      timeFormat: pending.timeFormat,
      timezone: 'Asia/Colombo',
      primaryOwnerId: pending.accountId,
      plan: planName,
      planExpiresAt: periodEnd,
      status: 'active',
      settings: {
        featureFlags: {
          // the business type's preset (electronics: installments, deliveries …; office: HR)
          ...(BUSINESS_TYPE_FEATURE_PRESETS[pending.businessType] || {}),
          accounting: true,
          purchase: true,
          credit_customer: true,
          loyalty: BUSINESS_TYPE_FEATURE_PRESETS[pending.businessType]?.loyalty ?? true,
          multi_warehouse: false,
          advanced_reports: true,
          whatsapp: true,
          quotation: true,
        },
        locale: 'en',
        receiptLanguage: 'en',
      },
    }).returning()

    // Set RLS context (required for users table insert)
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`)

    // Create subscription with proper period dates + price locking
    await tx.insert(subscriptions).values({
      tenantId: tenant.id,
      billingAccountId: pending.accountId,
      tierId: pending.tierId,
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      billingCycle,
      lastPaymentAt: now,
      subscribedPriceMonthly: tier?.priceMonthly,
      subscribedPriceYearly: tier?.priceYearly,
      priceLockedAt: now,
    })

    // Create account-tenant membership
    await tx.insert(accountTenants).values({
      accountId: pending.accountId,
      tenantId: tenant.id,
      role: 'owner',
      isOwner: true,
      acceptedAt: now,
    })

    // Get account details for user creation
    const account = await tx.query.accounts.findFirst({
      where: eq(accounts.id, pending.accountId),
    })

    if (account) {
      await tx.insert(users).values({
        tenantId: tenant.id,
        accountId: pending.accountId,
        email: account.email,
        fullName: account.fullName,
        passwordHash: account.passwordHash,
        role: 'owner',
      })
    }

    // Initialize tenant usage
    await tx.insert(tenantUsage).values({
      tenantId: tenant.id,
    }).onConflictDoNothing()

    // Mark pending company as approved
    await tx.update(pendingCompanies)
      .set({ status: 'approved', updatedAt: now })
      .where(eq(pendingCompanies.id, pending.id))

    // Send approval notification
    const tierName = tier?.displayName || tier?.name || 'Paid'
    await tx.insert(accountNotifications).values({
      accountId: pending.accountId,
      type: 'subscription',
      title: 'Company Activated',
      message: `Your company "${pending.name}" has been activated on the ${tierName} plan.`,
      link: `/account`,
      metadata: { tenantId: tenant.id, tierId: pending.tierId },
    })

    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantName: tenant.name }
  })

  // Broadcast outside transaction (fire-and-forget)
  broadcastAccountChange(pending.accountId, 'account-site', 'created', result.tenantId)
  broadcastAccountChange(pending.accountId, 'account-notification', 'created', result.tenantId)

  return result
}

/**
 * Send a rejection notification for a pending company.
 */
export async function notifyPendingCompanyRejected(
  accountId: string,
  companyName: string,
  reason: string,
) {
  await db.insert(accountNotifications).values({
    accountId,
    type: 'billing',
    title: 'Company Application Rejected',
    message: `Your company "${companyName}" was not approved. Reason: ${reason}`,
    link: `/account`,
    metadata: { reason },
  })

  broadcastAccountChange(accountId, 'account-notification', 'created', accountId)
  broadcastAccountChange(accountId, 'account-site', 'updated', accountId)
}
