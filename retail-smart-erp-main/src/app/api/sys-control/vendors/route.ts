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
import { desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { validateAdminSession, adminAudit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { escapeLikePattern } from '@/lib/utils/sql'
import { createMinimalDefaults } from '@/lib/setup/create-seed-data'
import { sendStaffInviteEmail } from '@/lib/email/system-email'
import {
  DEFAULT_VENDOR_FEATURE_FLAGS,
  normalizeFeatureFlags,
  type FeatureFlagsMap,
} from '@/lib/features/flags'
import { setTenantFeatureFlags } from '@/lib/features/check'

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, listSchema)
    if (!parsed.success) return parsed.response
    const { q, page, pageSize } = parsed.data

    let whereClause: SQL | undefined
    if (q) {
      const pattern = `%${escapeLikePattern(q)}%`
      whereClause = or(
        ilike(tenants.name, pattern),
        ilike(tenants.slug, pattern),
        ilike(tenants.email, pattern)
      )
    }

    const [[countRow], pageTenants] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(tenants).where(whereClause),
      db.query.tenants.findMany({
        where: whereClause,
        orderBy: [desc(tenants.createdAt)],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        columns: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          businessType: true,
          country: true,
          currency: true,
          status: true,
          plan: true,
          settings: true,
          createdAt: true,
          setupCompletedAt: true,
        },
      }),
    ])

    const tenantIds = pageTenants.map((t) => t.id)

    const [userCounts, subs] = tenantIds.length
      ? await Promise.all([
          db
            .select({ tenantId: users.tenantId, count: sql<number>`count(*)::int` })
            .from(users)
            .where(inArray(users.tenantId, tenantIds))
            .groupBy(users.tenantId),
          db
            .select({
              tenantId: subscriptions.tenantId,
              status: subscriptions.status,
              currentPeriodEnd: subscriptions.currentPeriodEnd,
            })
            .from(subscriptions)
            .where(inArray(subscriptions.tenantId, tenantIds)),
        ])
      : [[], []]

    const userCountMap = new Map(userCounts.map((r) => [r.tenantId, r.count]))
    const subMap = new Map(subs.map((s) => [s.tenantId, s]))

    const vendors = pageTenants.map((t) => {
      const settings = (t.settings || {}) as { featureFlags?: Partial<FeatureFlagsMap> }
      const sub = subMap.get(t.id)
      return {
        ...t,
        featureFlags: normalizeFeatureFlags(settings.featureFlags),
        userCount: userCountMap.get(t.id) ?? 0,
        subscriptionStatus: sub?.status ?? null,
        subscriptionPeriodEnd: sub?.currentPeriodEnd ?? null,
      }
    })

    return NextResponse.json({
      vendors,
      defaults: DEFAULT_VENDOR_FEATURE_FLAGS,
      pagination: { page, pageSize, total: countRow?.total ?? 0 },
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
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

const createVendorSchema = z
  .object({
    name: z.string().trim().min(2).max(255),
    slug: z.string().regex(/^[a-z0-9-]{3,50}$/, 'Slug must be 3-50 chars: a-z, 0-9, hyphen'),
    email: z.string().trim().email().max(255),
    phone: z.string().trim().max(50).optional(),
    address: z.string().trim().max(1000).optional(),
    businessType: z.enum(businessTypeEnum.enumValues).default('retail'),
    plan: z.enum(planEnum.enumValues).default('trial'),
    country: z.string().trim().length(2).toUpperCase().default('LK'),
    currency: z.string().trim().length(3).toUpperCase().default('LKR'),
    tin: z.string().trim().max(50).optional(),
    brn: z.string().trim().max(50).optional(),
    vatRegistered: z.boolean().optional(),
    featureFlags: z.record(z.string(), z.boolean()).optional(),
    limits: z
      .object({
        countersQuota: z.coerce.number().int().min(1).max(500).optional(),
        storageGb: z.coerce.number().int().min(1).max(10000).optional(),
      })
      .optional(),
    location: z
      .object({
        province: z.string().trim().max(100).optional(),
        city: z.string().trim().max(100).optional(),
      })
      .optional(),
    ownerName: z.string().trim().min(2).max(255),
    ownerEmail: z.string().trim().email().max(255).optional(),
    ownerPassword: z.string().min(8).max(128).optional(),
    sendInvite: z.boolean().optional(),
  })
  .refine((d) => !!d.ownerPassword || d.sendInvite === true, {
    message: 'Provide ownerPassword (min 8 characters) or set sendInvite to true',
    path: ['ownerPassword'],
  })

export async function POST(request: NextRequest) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, createVendorSchema)
    if (!parsed.success) return parsed.response
    const {
      name, slug, email, phone, address, businessType, plan, country, currency,
      tin, brn, vatRegistered, featureFlags, limits, location,
      ownerName, ownerEmail, ownerPassword, sendInvite,
    } = parsed.data

    const ownerLoginEmail = (ownerEmail || email).toLowerCase()

    // Pre-check slug (the transaction re-checks to avoid races)
    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.slug, slug),
      columns: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: `Slug "${slug}" is already taken.` }, { status: 409 })
    }

    const mergedFlags = featureFlags
      ? normalizeFeatureFlags(featureFlags as Partial<FeatureFlagsMap>)
      : DEFAULT_VENDOR_FEATURE_FLAGS

    const newSettings = {
      tin: tin || null,
      brn: brn || null,
      vatRegistered: vatRegistered ?? null,
      featureFlags: mergedFlags,
      limits: limits || {},
      location: location || {},
    }

    // Password: provided, or random (invite flow — owner sets their own on accept)
    const effectivePassword = ownerPassword || randomBytes(24).toString('base64url')
    const passwordHash = await bcrypt.hash(effectivePassword, 12)

    const result = await db.transaction(async (tx) => {
      const [conflict] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
      if (conflict) throw new Error('SLUG_TAKEN')

      const now = new Date()

      // Billing account for the owner (same model as self-registration): reuse an
      // existing POSLanka account with this email, otherwise create one. Subscriptions,
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

      // Pricing tier matching the chosen plan (tier names mirror the plan enum)
      const tier = await tx.query.pricingTiers.findFirst({
        where: eq(pricingTiers.name, plan),
        columns: { id: true, priceMonthly: true, priceYearly: true },
      }) || await tx.query.pricingTiers.findFirst({
        where: eq(pricingTiers.name, 'trial'),
        columns: { id: true, priceMonthly: true, priceYearly: true },
      })
      if (!tier) throw new Error('NO_PRICING_TIER')

      const [tenant] = await tx
        .insert(tenants)
        .values({
          name,
          slug,
          email,
          phone: phone || null,
          address: address || null,
          businessType,
          plan,
          country,
          currency,
          status: 'active',
          settings: newSettings,
          primaryOwnerId: ownerAccount.id,
        })
        .returning()

      // RLS context for tenant-scoped tables (users, warehouses, pos profiles, ...)
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`)

      // Subscription: free plan never expires (same as self-registration);
      // a paid plan starts a one-month period the super admin can extend.
      const periodEnd = new Date(now)
      periodEnd.setMonth(periodEnd.getMonth() + 1)
      await tx.insert(subscriptions).values({
        tenantId: tenant.id,
        billingAccountId: ownerAccount.id,
        tierId: tier.id,
        status: plan === 'trial' ? 'trial' : 'active',
        trialEndsAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: plan === 'trial' ? new Date('2099-12-31') : periodEnd,
        billingCycle: 'monthly',
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

      return { tenant, owner, defaults, inviteToken }
    })

    const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin
    const loginUrl = `${baseUrl}/c/${result.tenant.slug}/login`

    if (result.inviteToken) {
      try {
        await sendStaffInviteEmail({
          email: result.owner.email,
          inviterName: 'POSLanka Platform Team',
          companyName: result.tenant.name,
          role: 'owner',
          inviteUrl: `${baseUrl}/invite/${result.inviteToken}`,
        })
      } catch (emailError) {
        logError('api/sys-control/vendors POST invite-email', emailError)
      }
    }

    await adminAudit.create(session.superAdminId, 'tenant', result.tenant.id, {
      name: result.tenant.name,
      slug: result.tenant.slug,
      businessType,
      plan,
      ownerUserId: result.owner.id,
      ownerEmail: result.owner.email,
      warehouseId: result.defaults.warehouseId,
      posProfileId: result.defaults.posProfileId,
      invited: !!result.inviteToken,
    })

    return NextResponse.json({
      success: true,
      vendor: result.tenant,
      owner: { id: result.owner.id, email: result.owner.email },
      loginUrl,
      inviteSent: !!result.inviteToken,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'SLUG_TAKEN') {
      return NextResponse.json({ error: 'Slug is already taken.' }, { status: 409 })
    }
    logError('api/sys-control/vendors POST', error)
    return NextResponse.json({ error: 'Failed to create vendor' }, { status: 500 })
  }
}
