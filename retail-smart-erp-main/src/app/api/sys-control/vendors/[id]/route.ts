import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  tenants,
  users,
  subscriptions,
  warehouses,
  posProfiles,
  tenantUsage,
  sales,
  pricingTiers,
  accountTenants,
  paymentDeposits,
  payhereTransactions,
  adminAuditLogs,
  superAdmins,
  tenantStatusEnum,
  planEnum,
} from '@/lib/db/schema'
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { adminAuthError, validateAdminSession, adminAudit, requireAdminPermission, type AdminPermission } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { FEATURE_DEFS, FEATURE_FLAG_LABELS, featureAppliesTo, normalizeFeatureFlags, type FeatureFlagsMap } from '@/lib/features/flags'
import { foldTenantUsage } from '@/lib/db/storage-quota'
import { neverExpires } from '@/lib/billing/subscription-state'
import { getRolesForBusinessType } from '@/lib/auth/roles'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const vendor = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    await foldTenantUsage(vendor.id)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [staff, sub, vendorBranches, vendorCounters, usage, [salesMonth], tiers, ownerMembership] = await Promise.all([
      db.select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        accountId: users.accountId,
        lastLoginAt: users.lastLoginAt,
        lastActiveAt: users.lastActiveAt,
        createdAt: users.createdAt,
      })
        .from(users)
        .where(eq(users.tenantId, vendor.id))
        .orderBy(sql`case ${users.role} when 'owner' then 0 when 'manager' then 1 else 2 end`, asc(users.fullName))
        .limit(200),
      db.query.subscriptions.findFirst({
        where: eq(subscriptions.tenantId, vendor.id),
        with: {
          tier: {
            columns: {
              id: true, name: true, displayName: true, priceMonthly: true, priceYearly: true,
              maxUsers: true, maxSalesMonthly: true, maxDatabaseBytes: true, maxFileStorageBytes: true,
            },
          },
        },
      }),
      db.query.warehouses.findMany({
        where: eq(warehouses.tenantId, vendor.id),
        columns: { id: true, name: true, code: true, isActive: true, isDefault: true },
        limit: 50,
      }),
      db.query.posProfiles.findMany({
        where: eq(posProfiles.tenantId, vendor.id),
        columns: { id: true, name: true, code: true, status: true, isDefault: true },
        limit: 50,
      }),
      db.query.tenantUsage.findFirst({ where: eq(tenantUsage.tenantId, vendor.id) }),
      db.select({ count: sql<number>`count(*)::int` })
        .from(sales)
        .where(and(eq(sales.tenantId, vendor.id), gte(sales.createdAt, monthStart))),
      db.select({
        id: pricingTiers.id, name: pricingTiers.name, displayName: pricingTiers.displayName,
        priceMonthly: pricingTiers.priceMonthly, priceYearly: pricingTiers.priceYearly,
        maxUsers: pricingTiers.maxUsers, isActive: pricingTiers.isActive,
      })
        .from(pricingTiers)
        .orderBy(asc(pricingTiers.sortOrder), asc(pricingTiers.priceMonthly)),
      db.query.accountTenants.findFirst({
        where: and(eq(accountTenants.tenantId, vendor.id), eq(accountTenants.isOwner, true)),
        columns: { accountId: true, acceptedAt: true },
      }),
    ])

    // Billing history + admin activity need the subscription id
    const resourceIds = [vendor.id, ...(sub ? [sub.id] : [])]
    const [deposits, payhere, activity] = await Promise.all([
      sub
        ? db.select({
            id: paymentDeposits.id,
            amount: paymentDeposits.amount,
            currency: paymentDeposits.currency,
            status: paymentDeposits.status,
            reference: paymentDeposits.bankReference,
            periodMonths: paymentDeposits.periodMonths,
            depositDate: paymentDeposits.depositDate,
            reviewedAt: paymentDeposits.reviewedAt,
            createdAt: paymentDeposits.createdAt,
          })
            .from(paymentDeposits)
            .where(eq(paymentDeposits.subscriptionId, sub.id))
            .orderBy(desc(paymentDeposits.createdAt))
            .limit(25)
        : Promise.resolve([]),
      sub
        ? db.select({
            id: payhereTransactions.id,
            amount: payhereTransactions.amount,
            currency: payhereTransactions.currency,
            status: payhereTransactions.status,
            reference: payhereTransactions.orderId,
            periodMonths: payhereTransactions.periodMonths,
            paymentMethod: payhereTransactions.paymentMethod,
            paidAt: payhereTransactions.paidAt,
            createdAt: payhereTransactions.createdAt,
          })
            .from(payhereTransactions)
            .where(eq(payhereTransactions.subscriptionId, sub.id))
            .orderBy(desc(payhereTransactions.createdAt))
            .limit(25)
        : Promise.resolve([]),
      db.select({
        id: adminAuditLogs.id,
        action: adminAuditLogs.action,
        resource: adminAuditLogs.resource,
        details: adminAuditLogs.details,
        createdAt: adminAuditLogs.createdAt,
        adminName: superAdmins.fullName,
      })
        .from(adminAuditLogs)
        .leftJoin(superAdmins, eq(superAdmins.id, adminAuditLogs.superAdminId))
        .where(inArray(adminAuditLogs.resourceId, resourceIds))
        .orderBy(desc(adminAuditLogs.createdAt))
        .limit(40),
    ])

    const settings = (vendor.settings || {}) as Record<string, unknown>
    const flags = normalizeFeatureFlags(settings.featureFlags as Partial<FeatureFlagsMap>)
    const owner = staff.find((u) => u.role === 'owner' && u.isActive) || staff.find((u) => u.role === 'owner') || null
    const tier = sub?.tier && !Array.isArray(sub.tier) ? sub.tier : null

    const payments = [
      ...deposits.map((d) => ({ ...d, kind: 'bank_transfer' as const, paidAt: d.reviewedAt })),
      ...payhere.map((p) => ({ ...p, kind: 'payhere' as const })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return NextResponse.json({
      /** Roles the super admin may give new staff of this vendor (by business type, owner excluded) */
      assignableRoles: getRolesForBusinessType(vendor.businessType).filter((r) => r !== 'owner'),
      vendor: {
        ...vendor,
        vatRegistered: settings.vatRegistered === true,
        featureFlags: flags,
        userCount: staff.length,
        subscription: sub || null,
        branches: vendorBranches || [],
        counters: vendorCounters || [],
      },
      owner: owner
        ? { ...owner, inviteAccepted: !!ownerMembership?.acceptedAt || !!owner.lastLoginAt }
        : null,
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            billingCycle: sub.billingCycle,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            trialEndsAt: sub.trialEndsAt,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            subscribedPriceMonthly: sub.subscribedPriceMonthly,
            subscribedPriceYearly: sub.subscribedPriceYearly,
            lastPaymentAt: sub.lastPaymentAt,
            neverExpires: neverExpires(sub),
            tier,
          }
        : null,
      usage: {
        activeUsers: staff.filter((u) => u.isActive).length,
        totalUsers: staff.length,
        itemsCount: usage?.itemsCount ?? 0,
        customersCount: usage?.customersCount ?? 0,
        salesCount: usage?.salesCount ?? 0,
        salesThisMonth: salesMonth?.count ?? 0,
        storageBytes: Number(usage?.storageBytes ?? 0),
        fileStorageBytes: Number(usage?.fileStorageBytes ?? 0),
        warehouses: vendorBranches.length,
        posProfiles: vendorCounters.length,
      },
      limits: {
        maxUsers: tier?.maxUsers ?? null,
        maxSalesMonthly: tier?.maxSalesMonthly ?? null,
        maxDatabaseBytes: sub?.overrideDatabaseBytes ?? tier?.maxDatabaseBytes ?? null,
        maxFileStorageBytes: sub?.overrideFileStorageBytes ?? tier?.maxFileStorageBytes ?? null,
      },
      staff,
      payments,
      activity,
      tiers,
      featureFlagLabels: FEATURE_FLAG_LABELS,
      /** Feature catalogue for clients that cannot import it (mobile admin) */
      featureDefs: FEATURE_DEFS.map((d) => ({ key: d.key, label: d.label, description: d.description, group: d.group, applies: featureAppliesTo(d.key, vendor.businessType) })),
    })
  } catch (error) {
    logError('api/sys-control/vendors/[id] GET', error)
    return NextResponse.json({ error: 'Failed to fetch vendor' }, { status: 500 })
  }
}

const limitValueSchema = z.union([z.number(), z.string().max(100), z.boolean()])

const updateVendorSchema = z
  .object({
    status: z.enum(tenantStatusEnum.enumValues).optional(),
    plan: z.enum(planEnum.enumValues).optional(),
    settings: z
      .object({
        featureFlags: z.record(z.string(), z.boolean()).optional(),
        limits: z.record(z.string().max(50), limitValueSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (d) => d.status !== undefined || d.plan !== undefined || d.settings !== undefined,
    { message: 'Nothing to update' }
  )

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Permission per changed field, checked after parsing (below)
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const parsed = await validateBody(request, updateVendorSchema)
    if (!parsed.success) return parsed.response
    const { status, plan, settings } = parsed.data
    // Status / feature flags / limits are vendor management; the plan is billing
    const needs: AdminPermission[] = []
    if (status !== undefined || settings !== undefined) needs.push('vendors.manage')
    if (plan !== undefined) needs.push('billing')
    const denied = requireAdminPermission(session, ...needs)
    if (denied) return denied

    const current = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
      columns: { id: true, status: true, plan: true, settings: true, lockedAt: true, lockedReason: true },
    })
    if (!current) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    const currentSettings = (current.settings || {}) as Record<string, unknown>
    const currentFlags = (currentSettings.featureFlags || {}) as Partial<FeatureFlagsMap>
    const currentLimits = (currentSettings.limits || {}) as Record<string, unknown>

    const updateData: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() }
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}

    if (status !== undefined && status !== current.status) {
      updateData.status = status
      before.status = current.status
      after.status = status
      if (status === 'locked') {
        updateData.lockedAt = new Date()
        updateData.lockedReason = 'admin_locked'
      } else if (current.status === 'locked') {
        updateData.lockedAt = null
        updateData.lockedReason = null
      }
    }

    if (plan !== undefined && plan !== current.plan) {
      updateData.plan = plan
      before.plan = current.plan
      after.plan = plan
    }

    if (settings) {
      // Only featureFlags and limits may be merged; the rest of settings is preserved as-is.
      const nextSettings: Record<string, unknown> = { ...currentSettings }
      if (settings.featureFlags) {
        const mergedFlags = normalizeFeatureFlags({ ...currentFlags, ...settings.featureFlags } as Partial<FeatureFlagsMap>)
        nextSettings.featureFlags = mergedFlags
        before.featureFlags = normalizeFeatureFlags(currentFlags)
        after.featureFlags = mergedFlags
      }
      if (settings.limits) {
        const mergedLimits = { ...currentLimits, ...settings.limits }
        nextSettings.limits = mergedLimits
        before.limits = currentLimits
        after.limits = mergedLimits
      }
      updateData.settings = nextSettings
    }

    const [updated] = await db
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.id, id))
      .returning()

    await adminAudit.update(session.superAdminId, 'tenant', id, { before, after })

    return NextResponse.json({ success: true, vendor: updated })
  } catch (error) {
    logError('api/sys-control/vendors/[id] PUT', error)
    return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 })
  }
}
