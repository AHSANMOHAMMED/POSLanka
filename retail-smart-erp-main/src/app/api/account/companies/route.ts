import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import {
  accounts, tenants, accountTenants, subscriptions, pricingTiers, users, tenantUsage, accountSubscriptionCredits,
  pendingCompanies,
} from '@/lib/db/schema'
import { eq, and, sql, gt, isNull, desc } from 'drizzle-orm'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { getCountryByCode, getCurrencyByCountry } from '@/lib/utils/countries'
import { logError } from '@/lib/ai/error-logger'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { deleteTenantFiles } from '@/lib/files/storage'
import { validateBody } from '@/lib/validation/helpers'
import { createCompanySchema, deleteCompanySchema } from '@/lib/validation/schemas/account'
import { RESERVED_SLUGS } from '@/lib/utils/reserved-slugs'

// Admin pool for destructive operations (needs superuser for FK bypass)
let adminPool: Pool | null = null
function getAdminPool(): Pool {
  if (!adminPool) {
    const adminUrl = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL
    if (!adminUrl) throw new Error('DATABASE_URL_ADMIN not configured')
    adminPool = new Pool({
      connectionString: adminUrl,
      max: 2,
      idleTimeoutMillis: 10000, // Close idle connections faster (10s)
      connectionTimeoutMillis: 10000,
    })
    // Auto-close pool when all clients are released and idle timeout expires
    adminPool.on('error', (err) => {
      console.error('[AdminPool] Unexpected error:', err.message)
    })
  }
  return adminPool
}

// GET /api/account/companies - List user's companies with usage data
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all tenant memberships for this account with usage data
    // Using a try-catch to handle potential missing tables gracefully
    let memberships
    try {
      memberships = await db
        .select({
          membership: accountTenants,
          tenant: tenants,
          subscription: subscriptions,
          tier: pricingTiers,
          usage: tenantUsage,
        })
        .from(accountTenants)
        .innerJoin(tenants, eq(accountTenants.tenantId, tenants.id))
        .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
        .leftJoin(pricingTiers, eq(pricingTiers.id, subscriptions.tierId))
        .leftJoin(tenantUsage, eq(tenantUsage.tenantId, tenants.id))
        .where(
          and(
            eq(accountTenants.accountId, session.user.accountId),
            eq(accountTenants.isActive, true)
          )
        )
    } catch (dbError) {
      // If tables don't exist, try a simpler query without usage/subscription data
      logError('api/account/companies', dbError)
      const simpleMemberships = await db
        .select({
          membership: accountTenants,
          tenant: tenants,
        })
        .from(accountTenants)
        .innerJoin(tenants, eq(accountTenants.tenantId, tenants.id))
        .where(
          and(
            eq(accountTenants.accountId, session.user.accountId),
            eq(accountTenants.isActive, true)
          )
        )

      // Return simplified data
      const companies = simpleMemberships.map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        businessType: m.tenant.businessType,
        logoUrl: m.tenant.logoUrl,
        status: m.tenant.status,
        phone: m.tenant.phone,
        address: m.tenant.address,
        email: m.tenant.email,
        currency: m.tenant.currency,
        role: m.membership.role,
        isOwner: m.membership.isOwner,
        createdAt: m.tenant.createdAt,
        setupCompletedAt: m.tenant.setupCompletedAt,
        subscription: null,
        usage: null,
        limits: {
          maxDatabaseBytes: null,
          maxFileStorageBytes: null,
        },
      }))

      return NextResponse.json(companies)
    }

    // Map memberships to company objects with storage data
    const companies = memberships.map((m) => {
      return {
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        businessType: m.tenant.businessType,
        logoUrl: m.tenant.logoUrl,
        status: m.tenant.status,
        phone: m.tenant.phone,
        address: m.tenant.address,
        email: m.tenant.email,
        currency: m.tenant.currency,
        role: m.membership.role,
        isOwner: m.membership.isOwner,
        createdAt: m.tenant.createdAt,
        setupCompletedAt: m.tenant.setupCompletedAt,
        subscription: m.subscription ? {
          status: m.subscription.status,
          tierName: m.tier?.displayName || m.tier?.name || null,
          trialEndsAt: m.subscription.trialEndsAt,
          currentPeriodEnd: m.subscription.currentPeriodEnd,
        } : null,
        // Storage usage (in bytes)
        usage: m.usage ? {
          databaseBytes: m.usage.storageBytes || 0,
          fileStorageBytes: m.usage.fileStorageBytes || 0,
          updatedAt: m.usage.updatedAt,
        } : null,
        // Storage limits from pricing tier columns (in bytes)
        limits: {
          maxDatabaseBytes: m.tier?.maxDatabaseBytes || null,
          maxFileStorageBytes: m.tier?.maxFileStorageBytes || null,
        },
      }
    })

    return NextResponse.json(companies)
  } catch (error) {
    logError('api/account/companies', error)
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 })
  }
}

// POST /api/account/companies - Create a new company
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = session.user.accountId!

    // Super admins cannot create companies
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    if (account.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Super admins cannot create companies. Use a regular account.' },
        { status: 403 }
      )
    }

    const parsed = await validateBody(request, createCompanySchema)
    if (!parsed.success) return parsed.response
    const { name, slug, businessType, email, phone, address, country, dateFormat, timeFormat, tierId, billingCycle, aiEnabled } = parsed.data

    // Validate country
    const countryData = getCountryByCode(country)
    if (!countryData) {
      return NextResponse.json({ error: 'Invalid country selected' }, { status: 400 })
    }

    // Check if slug is reserved
    if (RESERVED_SLUGS.has(slug)) {
      return NextResponse.json({ error: 'This business code is reserved' }, { status: 400 })
    }

    // Check if slug is already taken
    const existingTenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, slug),
    })
    if (existingTenant) {
      return NextResponse.json({ error: 'Business code is already taken' }, { status: 400 })
    }

    // Check if slug is reserved by a pending company
    const existingPending = await db.query.pendingCompanies.findFirst({
      where: and(
        eq(pendingCompanies.slug, slug),
        gt(pendingCompanies.expiresAt, new Date()),
        sql`${pendingCompanies.status} NOT IN ('approved', 'rejected', 'expired')`
      ),
    })
    if (existingPending) {
      return NextResponse.json({ error: 'Business code is reserved by a pending company' }, { status: 400 })
    }

    // Check if user has existing companies
    const existingMemberships = await db
      .select({ id: accountTenants.id })
      .from(accountTenants)
      .where(
        and(
          eq(accountTenants.accountId, accountId),
          eq(accountTenants.isActive, true)
        )
      )
      .limit(1)

    const hasExistingCompanies = existingMemberships.length > 0

    // Flow B: User already has companies → require payment (create pending company)
    if (hasExistingCompanies) {
      if (!tierId) {
        return NextResponse.json({ error: 'Pricing tier is required for additional companies' }, { status: 400 })
      }

      // Validate tier exists and is not trial/free
      const tier = await db.query.pricingTiers.findFirst({
        where: and(eq(pricingTiers.id, tierId), eq(pricingTiers.isActive, true)),
      })
      if (!tier) {
        return NextResponse.json({ error: 'Invalid pricing tier' }, { status: 400 })
      }
      if (tier.name === 'trial' || tier.name === 'free') {
        return NextResponse.json({ error: 'Cannot select trial or free tier for additional companies' }, { status: 400 })
      }

      // Create pending company
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 7)

      const [pending] = await db.insert(pendingCompanies).values({
        accountId,
        name: name.trim(),
        slug: slug.toLowerCase(),
        email: email?.trim() || account.email,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        businessType,
        country,
        dateFormat,
        timeFormat,
        tierId,
        billingCycle: billingCycle || 'monthly',
        status: 'pending_payment',
        expiresAt,
      }).returning()

      return NextResponse.json({
        id: pending.id,
        slug: pending.slug,
        isPending: true,
      }, { status: 201 })
    }

    // Flow A: First company → create immediately (free forever, or apply credit)
    // All critical checks (membership re-check, credit locking, slug uniqueness)
    // are performed inside the transaction to prevent race conditions.
    const currency = getCurrencyByCountry(country)
    const now = new Date()

    // Pre-fetch trial tier outside transaction (read-only, immutable)
    const trialTier = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.name, 'trial'),
    })
    if (!trialTier) {
      return NextResponse.json({ error: 'System configuration error: trial tier not found. Please contact support.' }, { status: 500 })
    }

    const result = await db.transaction(async (tx) => {
      // Re-check membership inside transaction with FOR UPDATE to prevent
      // concurrent requests from both creating free first companies
      const membershipCheck = await tx
        .select({ id: accountTenants.id })
        .from(accountTenants)
        .where(
          and(
            eq(accountTenants.accountId, accountId),
            eq(accountTenants.isActive, true)
          )
        )
        .for('update')
        .limit(1)

      if (membershipCheck.length > 0) {
        throw new Error('ALREADY_HAS_COMPANY')
      }

      // Re-validate slug uniqueness inside transaction (TOCTOU protection)
      const existingSlug = await tx.query.tenants.findFirst({
        where: eq(tenants.slug, slug.toLowerCase()),
        columns: { id: true },
      })
      if (existingSlug) {
        throw new Error('SLUG_TAKEN')
      }

      // Lock and check for unused subscription credits (FOR UPDATE prevents double-spend)
      const [unusedCredit] = await tx
        .select()
        .from(accountSubscriptionCredits)
        .where(
          and(
            eq(accountSubscriptionCredits.accountId, accountId),
            isNull(accountSubscriptionCredits.usedAt)
          )
        )
        .orderBy(desc(accountSubscriptionCredits.createdAt))
        .for('update')
        .limit(1)

      // Determine subscription parameters based on credit or default free plan
      let subscriptionTierId: string
      let subscriptionStatus: 'trial' | 'active'
      let subscriptionBillingCycle: string
      let periodEnd: Date
      let tenantPlan: 'trial' | 'basic' | 'standard' | 'premium'
      let isFreeFirstCompany = false

      if (unusedCredit) {
        subscriptionTierId = unusedCredit.tierId
        subscriptionBillingCycle = unusedCredit.billingCycle
        periodEnd = new Date()
        periodEnd.setDate(periodEnd.getDate() + unusedCredit.remainingDays)

        if (unusedCredit.type === 'paid') {
          const creditTier = await tx.query.pricingTiers.findFirst({
            where: eq(pricingTiers.id, unusedCredit.tierId),
          })
          subscriptionStatus = 'active'
          tenantPlan = (creditTier?.name as typeof tenantPlan) || 'standard'
        } else {
          subscriptionStatus = 'active'
          tenantPlan = 'trial'  // enum value; display name is "Free"
        }
      } else {
        isFreeFirstCompany = true
        periodEnd = new Date('2099-12-31')
        subscriptionStatus = 'active'
        tenantPlan = 'trial'  // enum value; display name is "Free"
        subscriptionBillingCycle = 'monthly'
        subscriptionTierId = trialTier.id
      }

      // Create tenant
      const [tenant] = await tx.insert(tenants).values({
        name: name.trim(),
        slug: slug.toLowerCase(),
        email: email?.trim() || account.email,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        businessType,
        country,
        currency,
        dateFormat,
        timeFormat,
        primaryOwnerId: accountId,
        plan: tenantPlan,
        planExpiresAt: isFreeFirstCompany ? null : periodEnd,
        status: 'active',
        aiEnabled: !!aiEnabled,
        aiConsentAcceptedAt: aiEnabled ? new Date() : null,
      }).returning()

      // Set tenant context for RLS
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`)

      // Create subscription
      await tx.insert(subscriptions).values({
        tenantId: tenant.id,
        billingAccountId: accountId,
        tierId: subscriptionTierId,
        status: subscriptionStatus,
        trialEndsAt: null,  // No trial concept — free-forever companies are always active
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        billingCycle: subscriptionBillingCycle,
      })

      // Mark credit as used
      if (unusedCredit) {
        await tx.update(accountSubscriptionCredits)
          .set({ usedAt: now, usedTenantId: tenant.id })
          .where(eq(accountSubscriptionCredits.id, unusedCredit.id))
      }

      // Create account-tenant membership
      await tx.insert(accountTenants).values({
        accountId,
        tenantId: tenant.id,
        role: 'owner',
        isOwner: true,
        acceptedAt: now,
      })

      // Create user in tenant
      await tx.insert(users).values({
        tenantId: tenant.id,
        accountId,
        email: account.email,
        fullName: account.fullName,
        passwordHash: account.passwordHash,
        role: 'owner',
      })

      // Initialize tenant usage
      await tx.insert(tenantUsage).values({
        tenantId: tenant.id,
      }).onConflictDoNothing()

      return { tenant, unusedCredit }
    })

    broadcastAccountChange(accountId, 'account-site', 'created', result.tenant.id)

    return NextResponse.json({
      id: result.tenant.id,
      slug: result.tenant.slug,
      name: result.tenant.name,
      isPending: false,
      creditApplied: result.unusedCredit ? {
        type: result.unusedCredit.type,
        remainingDays: result.unusedCredit.remainingDays,
      } : null,
    }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'ALREADY_HAS_COMPANY') {
      return NextResponse.json({ error: 'You already have a company. Additional companies require a paid plan.' }, { status: 400 })
    }
    if (message === 'SLUG_TAKEN') {
      return NextResponse.json({ error: 'Business code is already taken' }, { status: 400 })
    }
    logError('api/account/companies', error)
    return NextResponse.json({ error: 'Failed to create company. Please try again.' }, { status: 500 })
  }
}

// DELETE /api/account/companies - Delete a company (owner only)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }

    const accountId = session.user.accountId!

    const parsed = await validateBody(request, deleteCompanySchema)
    if (!parsed.success) return parsed.response
    const { tenantId, password } = parsed.data

    // Verify password
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found', code: 'ACCOUNT_NOT_FOUND' }, { status: 404 })
    }

    const passwordValid = await bcrypt.compare(password, account.passwordHash)
    if (!passwordValid) {
      return NextResponse.json({ error: 'Incorrect password', code: 'INCORRECT_PASSWORD' }, { status: 403 })
    }

    // Verify the user is the owner of this tenant
    const membership = await db.query.accountTenants.findFirst({
      where: and(
        eq(accountTenants.accountId, accountId),
        eq(accountTenants.tenantId, tenantId),
        eq(accountTenants.isOwner, true),
        eq(accountTenants.isActive, true)
      ),
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only the owner can delete a company', code: 'NOT_OWNER' }, { status: 403 })
    }

    // Verify the tenant exists
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    })
    if (!tenant) {
      return NextResponse.json({ error: 'Company not found', code: 'COMPANY_NOT_FOUND' }, { status: 404 })
    }

    // Fetch subscription before deletion (needed for credit calculation + FK cleanup)
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, tenantId),
    })

    // Save remaining subscription/trial time as account credit
    if (subscription && ['trial', 'active', 'past_due'].includes(subscription.status)) {
      const now = new Date()
      let endDate: Date | null = null
      let creditType: 'trial' | 'paid' = 'trial'

      if (subscription.status === 'trial' && subscription.trialEndsAt) {
        endDate = new Date(subscription.trialEndsAt)
        creditType = 'trial'
      } else if (['active', 'past_due'].includes(subscription.status) && subscription.currentPeriodEnd) {
        endDate = new Date(subscription.currentPeriodEnd)
        creditType = 'paid'
      }

      if (endDate) {
        const remainingDays = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        if (remainingDays > 0 && subscription.tierId) {
          await db.insert(accountSubscriptionCredits).values({
            accountId,
            tierId: subscription.tierId,
            billingCycle: subscription.billingCycle || 'monthly',
            type: creditType,
            remainingDays,
            originalEnd: endDate,
          })
        }
      }
    }

    const subscriptionRecord = subscription

    // Clean up R2 storage BEFORE deleting DB records (need tenant slug for key prefix)
    try {
      const deletedCount = await deleteTenantFiles(tenant.slug, tenantId)
      if (deletedCount > 0) {
        console.log(`[DELETE company] Cleaned up ${deletedCount} R2 files for tenant ${tenant.slug}`)
      }
    } catch (r2Error) {
      console.error(`[DELETE company] R2 cleanup failed for tenant ${tenant.slug}:`, r2Error)
      // Continue with DB deletion even if R2 cleanup fails
    }

    // Use admin connection with FK constraint bypass for reliable deletion
    const adminClient = await getAdminPool().connect()
    try {
      await adminClient.query('BEGIN')

      // Bypass ALL FK constraint triggers (superuser only, transaction-scoped)
      await adminClient.query("SET LOCAL session_replication_role = 'replica'")

      // ── Step 1: Clean up account-level tables that reference subscriptions.id ──
      if (subscriptionRecord) {
        await adminClient.query('DELETE FROM credit_transactions WHERE subscription_id = $1', [subscriptionRecord.id])
        await adminClient.query('DELETE FROM payment_deposits WHERE subscription_id = $1', [subscriptionRecord.id])
        await adminClient.query('DELETE FROM payhere_transactions WHERE subscription_id = $1', [subscriptionRecord.id])
      }

      // ── Step 2: Remove account-tenant memberships and subscriptions ──
      await adminClient.query('DELETE FROM account_tenants WHERE tenant_id = $1', [tenantId])
      await adminClient.query('DELETE FROM subscriptions WHERE tenant_id = $1', [tenantId])

      // ── Step 3: Delete non-tenant child tables that FK-reference tenant parents ──
      const childFKRes = await adminClient.query(`
        SELECT DISTINCT kcu.table_name AS child_table, kcu.column_name AS child_column, ccu.table_name AS parent_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
          AND kcu.table_name NOT IN (
            SELECT c2.table_name FROM information_schema.columns c2 WHERE c2.column_name = 'tenant_id' AND c2.table_schema = 'public'
          )
          AND ccu.table_name IN (
            SELECT c2.table_name FROM information_schema.columns c2 WHERE c2.column_name = 'tenant_id' AND c2.table_schema = 'public'
          )
          AND kcu.table_name NOT IN ('account_tenants', 'subscriptions')
      `)
      for (const child of childFKRes.rows) {
        await adminClient.query(
          `DELETE FROM "${child.child_table}" WHERE "${child.child_column}" IN (SELECT id FROM "${child.parent_table}" WHERE tenant_id = $1)`,
          [tenantId]
        )
      }

      // ── Step 4: Delete all tenant-scoped tables ──
      const tablesRes = await adminClient.query(`
        SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables t ON c.table_name = t.table_name AND c.table_schema = t.table_schema
        WHERE c.column_name = 'tenant_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND c.table_name NOT IN ('tenants', 'account_tenants', 'subscriptions')
        ORDER BY c.table_name
      `)
      for (const row of tablesRes.rows) {
        await adminClient.query(`DELETE FROM "${row.table_name}" WHERE tenant_id = $1`, [tenantId])
      }

      // ── Step 5: Delete tenant_usage (triggers may have recreated rows) ──
      await adminClient.query('DELETE FROM tenant_usage WHERE tenant_id = $1', [tenantId])

      // ── Step 6: Delete the tenant record itself ──
      await adminClient.query('DELETE FROM tenants WHERE id = $1', [tenantId])

      await adminClient.query('COMMIT')
    } catch (txError) {
      await adminClient.query('ROLLBACK')
      throw txError
    } finally {
      adminClient.release()
    }

    broadcastAccountChange(accountId, 'account-site', 'deleted', tenantId)

    return NextResponse.json({ success: true })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logError('api/account/companies DELETE', error)
    console.error('[DELETE /api/account/companies] Error:', errorMessage)
    if (error instanceof Error && error.stack) {
      console.error('[DELETE /api/account/companies] Stack:', error.stack)
    }

    // Handle FK violations with a user-friendly message (no raw DB details)
    if (errorMessage.includes('foreign_key_violation') || errorMessage.includes('violates foreign key')) {
      return NextResponse.json({
        error: 'Failed to delete company: related data could not be removed. Please contact support.',
        code: 'FK_VIOLATION',
      }, { status: 500 })
    }

    return NextResponse.json({ error: 'Failed to delete company. Please try again.', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
