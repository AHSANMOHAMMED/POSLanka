/**
 * Vendor (tenant) directory query for the super-admin console — shared by the paginated
 * list endpoint and the CSV export so both apply exactly the same filters.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { businessTypeEnum, pricingTiers, subscriptions, subscriptionStatusEnum, tenants, tenantStatusEnum, users } from '@/lib/db/schema'
import { escapeLikePattern } from '@/lib/utils/sql'
import { normalizeBusinessId } from '@/lib/tenant/business-id'

/** Empty query-string values ("?status=") mean "no filter". */
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v)

export const vendorFilterSchema = z.object({
  q: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  businessType: z.preprocess(blankToUndefined, z.enum(businessTypeEnum.enumValues).optional()),
  status: z.preprocess(blankToUndefined, z.enum(tenantStatusEnum.enumValues).optional()),
  subscriptionStatus: z.preprocess(blankToUndefined, z.enum(subscriptionStatusEnum.enumValues).optional()),
  tierId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  sort: z.preprocess(blankToUndefined, z.enum(['newest', 'oldest', 'name']).default('newest')),
})

export type VendorFilters = z.infer<typeof vendorFilterSchema>

/** WHERE clause for the filters. Search matches name, legal name, slug, email, Business ID and owner email. */
export function vendorWhere(f: VendorFilters): SQL | undefined {
  const conds: SQL[] = []
  if (f.q) {
    const pattern = `%${escapeLikePattern(f.q)}%`
    const bid = normalizeBusinessId(f.q)
    // "985633", "PL-9856" → partial Business ID match on the compact form
    const compact = f.q.toUpperCase().replace(/[\s-]/g, '')
    const parts: SQL[] = [
      ilike(tenants.name, pattern),
      ilike(tenants.legalName, pattern),
      ilike(tenants.slug, pattern),
      ilike(tenants.email, pattern),
      sql`exists (select 1 from ${users} u where u.tenant_id = ${tenants.id} and u.role = 'owner' and u.email ilike ${pattern})`,
    ]
    if (bid) parts.unshift(eq(tenants.businessId, bid))
    else if (/^(PL)?\d{2,6}$/.test(compact)) parts.push(ilike(tenants.businessId, `%${escapeLikePattern(compact)}%`))
    conds.push(or(...parts)!)
  }
  if (f.businessType) conds.push(eq(tenants.businessType, f.businessType))
  if (f.status) conds.push(eq(tenants.status, f.status))
  if (f.subscriptionStatus) conds.push(eq(subscriptions.status, f.subscriptionStatus))
  if (f.tierId) conds.push(eq(subscriptions.tierId, f.tierId))
  return conds.length ? and(...conds) : undefined
}

const rowColumns = {
  id: tenants.id,
  name: tenants.name,
  legalName: tenants.legalName,
  slug: tenants.slug,
  businessId: tenants.businessId,
  email: tenants.email,
  phone: tenants.phone,
  businessType: tenants.businessType,
  status: tenants.status,
  plan: tenants.plan,
  country: tenants.country,
  currency: tenants.currency,
  lockedReason: tenants.lockedReason,
  createdAt: tenants.createdAt,
  setupCompletedAt: tenants.setupCompletedAt,
  subscriptionStatus: subscriptions.status,
  currentPeriodEnd: subscriptions.currentPeriodEnd,
  trialEndsAt: subscriptions.trialEndsAt,
  tierId: pricingTiers.id,
  tierName: pricingTiers.name,
  tierDisplayName: pricingTiers.displayName,
  tierMaxUsers: pricingTiers.maxUsers,
}

export interface VendorRow {
  id: string
  name: string
  legalName: string | null
  slug: string
  businessId: string
  email: string
  phone: string | null
  businessType: string
  status: string
  plan: string
  country: string
  currency: string
  lockedReason: string | null
  createdAt: Date
  setupCompletedAt: Date | null
  subscriptionStatus: string | null
  currentPeriodEnd: Date | null
  trialEndsAt: Date | null
  tierId: string | null
  tierName: string | null
  tierDisplayName: string | null
  tierMaxUsers: number | null
  owner: { name: string; email: string } | null
  userCount: number
  activeUserCount: number
  lastActivityAt: Date | null
}

/** One page of vendors (plus the total) with owner, user counts and last activity attached. */
export async function queryVendors(f: VendorFilters, limit: number, offset: number): Promise<{ rows: VendorRow[]; total: number }> {
  const where = vendorWhere(f)
  const order = f.sort === 'name' ? [asc(tenants.name)] : f.sort === 'oldest' ? [asc(tenants.createdAt)] : [desc(tenants.createdAt)]

  const [[countRow], base] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` })
      .from(tenants)
      .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
      .where(where),
    db.select(rowColumns)
      .from(tenants)
      .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
      .leftJoin(pricingTiers, eq(pricingTiers.id, subscriptions.tierId))
      .where(where)
      .orderBy(...order, asc(tenants.id))
      .limit(limit)
      .offset(offset),
  ])

  const ids = base.map((r) => r.id)
  const [agg, owners] = ids.length
    ? await Promise.all([
        db.select({
          tenantId: users.tenantId,
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${users.isActive})::int`,
          lastActivityAt: sql<Date | null>`max(greatest(${users.lastActiveAt}, ${users.lastLoginAt}))`,
        })
          .from(users)
          .where(inArray(users.tenantId, ids))
          .groupBy(users.tenantId),
        db.selectDistinctOn([users.tenantId], { tenantId: users.tenantId, name: users.fullName, email: users.email })
          .from(users)
          .where(and(inArray(users.tenantId, ids), eq(users.role, 'owner')))
          .orderBy(users.tenantId, desc(users.isActive), asc(users.createdAt)),
      ])
    : [[], []]

  const aggMap = new Map(agg.map((a) => [a.tenantId, a]))
  const ownerMap = new Map(owners.map((o) => [o.tenantId, o]))
  const rows: VendorRow[] = base.map((r) => {
    const a = aggMap.get(r.id)
    const o = ownerMap.get(r.id)
    const last = a?.lastActivityAt ? new Date(a.lastActivityAt) : null
    return {
      ...r,
      owner: o ? { name: o.name, email: o.email } : null,
      userCount: a?.total ?? 0,
      activeUserCount: a?.active ?? 0,
      lastActivityAt: last && !Number.isNaN(last.getTime()) ? last : null,
    }
  })
  return { rows, total: countRow?.total ?? 0 }
}
