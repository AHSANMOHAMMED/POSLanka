import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import {
  tenants,
  users,
  subscriptions,
  accounts,
  accountTenants,
  pricingTiers,
  tenantUsage,
  staffInvites,
  businessTypeEnum,
  planEnum,
} from '@/lib/db/schema'
import { asc, eq, sql } from 'drizzle-orm'
import { adminAuthError, validateAdminSession, adminAudit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { createMinimalDefaults } from '@/lib/setup/create-seed-data'
import { sendStaffInviteEmail } from '@/lib/email/system-email'
import {
  DEFAULT_VENDOR_FEATURE_FLAGS,
  normalizeFeatureFlags,
  type FeatureFlagsMap,
} from '@/lib/features/flags'
import { setTenantFeatureFlags } from '@/lib/features/check'
import { seedCountryTaxTemplates } from '@/lib/setup/seed-tax-templates'
import { getNextPeriodDates } from '@/lib/billing/proration'
import { tierNameToPlan } from '@/lib/billing/activate-company'
import { NEVER_EXPIRES, isFreeTier, planExpiryFor } from '@/lib/billing/subscription-state'
import { vendorFilterSchema, queryVendors } from '@/lib/admin/vendor-query'
import { SLUG_RE, checkSlugAvailability, suggestAvailableSlug } from '@/lib/admin/vendor-slug'
import { generateReadablePassword, placeholderLogin } from '@/lib/users/generated-login'
import { staffLoginSchema } from '@/lib/validation/schemas/common'

const listSchema = vendorFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
})

export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const parsed = validateSearchParams(request, listSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, ...filters } = parsed.data

    const [{ rows, total }, statusCounts, tiers] = await Promise.all([
      queryVendors(filters, pageSize, (page - 1) * pageSize),
      db.select({ status: tenants.status, count: sql<number>`count(*)::int` }).from(tenants).groupBy(tenants.status),
      db.select({ id: pricingTiers.id, name: pricingTiers.name, displayName: pricingTiers.displayName, isActive: pricingTiers.isActive })
        .from(pricingTiers)
        .orderBy(asc(pricingTiers.sortOrder), asc(pricingTiers.priceMonthly)),
    ])

    const vendors = rows.map((r) => ({
      ...r,
      // Older clients (mobile admin) read these names
      subscriptionPeriodEnd: r.currentPeriodEnd,
    }))

    return NextResponse.json({
      vendors,
      pagination: { page, pageSize, total },
      statusCounts: Object.fromEntries(statusCounts.map((c) => [c.status, c.count])),
      tiers,
      defaults: DEFAULT_VENDOR_FEATURE_FLAGS,
    })
  } catch (error) {
    logError('api/sys-control/vendors', error)
    return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 })
  }
}

const bulkFlagsSchema = z.object({
  tenantIds: z.array(z.string().uuid()).min(1, 'tenantIds required').max(100),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  applyDefaults: z.boolean().optional(),
})

export async function PATCH(request: NextRequest) {
  try {
    const session = await validateAdminSession('vendors.manage')
    if (!session) {
      return adminAuthError()
    }

    const parsed = await validateBody(request, bulkFlagsSchema)
    if (!parsed.success) return parsed.response
    const { tenantIds, featureFlags, applyDefaults } = parsed.data

    const flags = applyDefaults
      ? DEFAULT_VENDOR_FEATURE_FLAGS
      : normalizeFeatureFlags(featureFlags as Partial<FeatureFlagsMap>)

    const results = []
    for (const tenantId of tenantIds) {
      const next = await setTenantFeatureFlags(tenantId, flags)
      results.push({ tenantId, featureFlags: next })
    }

    await adminAudit.update(session.superAdminId, 'tenant_feature_flags_bulk', tenantIds[0], {
      tenantIds,
      featureFlags: flags,
      applyDefaults: !!applyDefaults,
    })

    return NextResponse.json({ updated: results.length, results })
  } catch (error) {
    logError('api/sys-control/vendors PATCH', error)
    return NextResponse.json({ error: 'Failed to update vendors' }, { status: 500 })
  }
}

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional())

const createVendorSchema = z
  .object({
    // Required: name, phone, address. Everything else is optional — the web address comes from
    // the name, the owner name from the business name, the owner login from the email(s) or the
    // web address, and the owner password is generated (returned once) when none is given.
    name: z.string().trim().min(2, 'Enter the business name').max(255),
    phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,24}$/, 'Enter a valid phone number'),
    address: z.string().trim().min(3, 'Enter the business address').max(1000),
    legalName: optText(255),
    slug: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().trim().toLowerCase().regex(SLUG_RE, 'Use 3–50 characters: lowercase letters, numbers and single hyphens').optional(),
    ),
    email: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().email().max(255).optional()),
    businessType: z.enum(businessTypeEnum.enumValues).default('retail'),
    /** Pricing tier to start on (pricing_tiers.id). Falls back to `plan` (legacy) or the free tier. */
    tierId: z.string().uuid().optional(),
    billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
    /** Legacy: plan enum name; prefer tierId. */
    plan: z.enum(planEnum.enumValues).optional(),
    country: z.string().trim().length(2).toUpperCase().default('LK'),
    currency: z.string().trim().length(3).toUpperCase().default('LKR'),
    taxId: optText(50),
    /** Legacy alias of taxId */
    tin: optText(50),
    brn: optText(50),
    vatRegistered: z.boolean().default(false),
    featureFlags: z.record(z.string(), z.boolean()).optional(),
    ownerName: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().min(2).max(255).optional()),
    ownerEmail: z.preprocess((v) => (v === '' ? undefined : v), staffLoginSchema.optional()),
    ownerPassword: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(4).max(128).optional()),
    sendInvite: z.boolean().optional(),
  })
  .refine((d) => d.sendInvite !== true || !!(d.ownerEmail || d.email), {
    message: 'An email invitation needs the owner or business email',
    path: ['ownerEmail'],
  })
  .refine((d) => !d.vatRegistered || !!(d.taxId || d.tin), {
    message: 'A VAT-registered business needs its TIN / VAT number',
    path: ['taxId'],
  })

export async function POST(request: NextRequest) {
  try {
    const session = await validateAdminSession('vendors.manage')
    if (!session) {
      return adminAuthError()
    }

    const parsed = await validateBody(request, createVendorSchema)
    if (!parsed.success) return parsed.response
    const {
      name, legalName, phone, address, businessType, tierId, billingCycle, plan, country, currency,
      brn, vatRegistered, featureFlags, ownerPassword, sendInvite,
    } = parsed.data
    const taxId = parsed.data.taxId || parsed.data.tin || null
    // tenants.email is NOT NULL: the business email, else the owner's, else empty
    const email = parsed.data.email || parsed.data.ownerEmail || ''
    const ownerName = parsed.data.ownerName || name

    // Same checks as self-registration (reserved words, taken, held by a pending sign-up);
    // the transaction re-checks the tenants table to avoid races. No address given → one from the name.
    if (parsed.data.slug) {
      const slugCheck = await checkSlugAvailability(parsed.data.slug)
      if (!slugCheck.available) {
        return NextResponse.json({ error: slugCheck.reason, field: 'slug' }, { status: 409 })
      }
    }
    const slug = parsed.data.slug || (await suggestAvailableSlug(name))

    // Owner login: owner email/username, else business email, else one made from the web address
    // (the owner signs in with Business ID + this login + password and can change it later)
    const ownerLoginEmail = (
      parsed.data.ownerEmail
        ? (parsed.data.ownerEmail.includes('@') ? parsed.data.ownerEmail : placeholderLogin(parsed.data.ownerEmail, slug))
        : email || placeholderLogin('owner', slug)
    ).toLowerCase()

    // Pricing tier: explicit id, else legacy plan name, else the free tier
    const allTiers = await db.query.pricingTiers.findMany({
      columns: { id: true, name: true, displayName: true, priceMonthly: true, priceYearly: true, isActive: true },
    })
    const freeTier = allTiers.find((t) => t.name === 'trial') || allTiers.find((t) => t.isActive && isFreeTier(t))
    const tier = tierId
      ? allTiers.find((t) => t.id === tierId)
      : (plan && allTiers.find((t) => t.name === plan)) || freeTier
    if (!tier) {
      return NextResponse.json({ error: tierId ? 'Selected plan was not found' : 'No free plan is configured' }, { status: 400 })
    }
    if (tierId && !tier.isActive) {
      return NextResponse.json({ error: 'Selected plan is no longer offered' }, { status: 400 })
    }
    const free = isFreeTier(tier)

    const mergedFlags = featureFlags
      ? normalizeFeatureFlags(featureFlags as Partial<FeatureFlagsMap>)
      : DEFAULT_VENDOR_FEATURE_FLAGS

    // Another business for an owner who already has a skyERPOS account: it is added to that
    // account and the owner keeps signing in with their current password (no new password)
    const existingOwner = await db.query.accounts.findFirst({
      where: eq(accounts.email, ownerLoginEmail),
      columns: { id: true, passwordHash: true },
    })

    // Password: provided; random for an invite (the owner sets their own on accept); otherwise a
    // generated one that is returned once so the admin can hand it over
    const generatedPassword = !existingOwner && !ownerPassword && !sendInvite ? generateReadablePassword() : null
    const effectivePassword = ownerPassword || generatedPassword || randomBytes(24).toString('base64url')
    const passwordHash = existingOwner && !ownerPassword ? existingOwner.passwordHash : await bcrypt.hash(effectivePassword, 12)

    const result = await db.transaction(async (tx) => {
      const [conflict] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
      if (conflict) throw new Error('SLUG_TAKEN')

      const now = new Date()

      // Billing account for the owner (same model as self-registration): reuse an
      // existing skyERPOS account with this email, otherwise create one. Subscriptions,
      // wallet, invoices and the account dashboard all hang off this account.
      let ownerAccount = await tx.query.accounts.findFirst({
        where: eq(accounts.email, ownerLoginEmail),
        columns: { id: true },
      })
      if (!ownerAccount) {
        const accountPhone = phone?.trim() || null
        const phoneTaken = accountPhone
          ? await tx.query.accounts.findFirst({ where: eq(accounts.phone, accountPhone), columns: { id: true } })
          : null
        const [created] = await tx
          .insert(accounts)
          .values({
            email: ownerLoginEmail,
            passwordHash,
            fullName: ownerName,
            // accounts.phone is NOT NULL UNIQUE; the owner can set the real number later
            phone: accountPhone && !phoneTaken ? accountPhone : `unset-${slug}-${randomBytes(4).toString('hex')}`,
            country,
            currency,
            emailVerified: true,
            isActive: true,
          })
          .returning({ id: accounts.id })
        ownerAccount = created
      }

      // Free plan never expires (same as self-registration); a paid plan starts a
      // complimentary first period the super admin can extend.
      const { periodEnd } = getNextPeriodDates(now, billingCycle)

      const [tenant] = await tx
        .insert(tenants)
        .values({
          name,
          legalName: legalName || null,
          slug,
          email,
          phone: phone || null,
          address: address || null,
          taxId,
          brn: brn || null,
          businessType,
          plan: tierNameToPlan(tier.name),
          planExpiresAt: free ? null : planExpiryFor({ status: 'active', trialEndsAt: null, currentPeriodEnd: periodEnd }),
          country,
          currency,
          status: 'active',
          settings: { vatRegistered, featureFlags: mergedFlags },
          primaryOwnerId: ownerAccount.id,
        })
        .returning()

      // RLS context for tenant-scoped tables (users, warehouses, pos profiles, ...)
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`)

      await tx.insert(subscriptions).values({
        tenantId: tenant.id,
        billingAccountId: ownerAccount.id,
        tierId: tier.id,
        status: free ? 'trial' : 'active',
        trialEndsAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: free ? NEVER_EXPIRES : periodEnd,
        billingCycle,
        subscribedPriceMonthly: tier.priceMonthly,
        subscribedPriceYearly: tier.priceYearly,
        priceLockedAt: now,
      })

      await tx.insert(accountTenants).values({
        accountId: ownerAccount.id,
        tenantId: tenant.id,
        role: 'owner',
        isOwner: true,
        acceptedAt: sendInvite ? null : now,
      })

      await tx.insert(tenantUsage).values({ tenantId: tenant.id }).onConflictDoNothing()

      const [owner] = await tx
        .insert(users)
        .values({
          tenantId: tenant.id,
          accountId: ownerAccount.id,
          email: ownerLoginEmail,
          passwordHash,
          fullName: ownerName,
          role: 'owner',
          isActive: true,
          passwordChangedAt: new Date(),
        })
        .returning({ id: users.id, email: users.email })

      // Default warehouse (MAIN, default) + default POS profile linked to it,
      // with the owner assigned via pos_profile_users. Also marks setup complete.
      const defaults = await createMinimalDefaults(tx, tenant.id, businessType, currency, owner.id)

      // VAT-registered → the country's standard VAT template becomes the default sales tax.
      // Not registered → no default tax (prices are charged without VAT).
      let defaultTaxTemplateId: string | null = null
      if (vatRegistered) {
        const seeded = await seedCountryTaxTemplates(tx, tenant.id, country, { setDefault: true })
        defaultTaxTemplateId = seeded.defaultTemplateId
      }

      let inviteToken: string | null = null
      if (sendInvite) {
        inviteToken = randomBytes(32).toString('hex')
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 7)
        await tx.insert(staffInvites).values({
          email: ownerLoginEmail,
          token: inviteToken,
          tenantAssignments: [{ tenantId: tenant.id, role: 'owner' }],
          invitedBy: null,
          expiresAt,
        })
      }

      return { tenant, owner, defaults, inviteToken, defaultTaxTemplateId }
    })

    const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin
    const loginUrl = `${baseUrl}/login`
    const companyLoginUrl = `${baseUrl}/c/${result.tenant.slug}/login`

    let inviteEmailFailed = false
    if (result.inviteToken) {
      try {
        await sendStaffInviteEmail({
          email: result.owner.email,
          inviterName: 'skyERPOS Platform Team',
          companyName: result.tenant.name,
          role: 'owner',
          inviteUrl: `${baseUrl}/invite/${result.inviteToken}`,
        })
      } catch (emailError) {
        inviteEmailFailed = true
        logError('api/sys-control/vendors POST invite-email', emailError)
      }
    }

    await adminAudit.create(session.superAdminId, 'tenant', result.tenant.id, {
      name: result.tenant.name,
      slug: result.tenant.slug,
      businessId: result.tenant.businessId,
      businessType,
      tierId: tier.id,
      tier: tier.name,
      billingCycle,
      vatRegistered,
      ownerUserId: result.owner.id,
      ownerEmail: result.owner.email,
      warehouseId: result.defaults.warehouseId,
      posProfileId: result.defaults.posProfileId,
      invited: !!result.inviteToken,
    })

    return NextResponse.json({
      success: true,
      vendor: result.tenant,
      businessId: result.tenant.businessId,
      owner: { id: result.owner.id, email: result.owner.email },
      /** Only when the admin gave no password and sent no invite — shown once */
      generatedPassword,
      /** Added to an owner who already has an account: they sign in with their current password */
      existingOwner: !!existingOwner,
      plan: { id: tier.id, name: tier.displayName },
      loginUrl: companyLoginUrl,
      signInUrl: loginUrl,
      inviteSent: !!result.inviteToken && !inviteEmailFailed,
      inviteEmailFailed,
      vatDefaultTemplateId: result.defaultTaxTemplateId,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'SLUG_TAKEN') {
      return NextResponse.json({ error: 'That web address is already taken.' }, { status: 409 })
    }
    logError('api/sys-control/vendors POST', error)
    return NextResponse.json({ error: 'Failed to create vendor' }, { status: 500 })
  }
}
