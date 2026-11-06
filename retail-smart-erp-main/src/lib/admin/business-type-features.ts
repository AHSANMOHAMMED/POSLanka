/**
 * Super admin → Business types: every business type with its vendors, which feature switches they
 * have on, which features they actually USE (activity in the last 30 days), and bulk on / off per
 * business type (for the existing vendors of that type and/or the preset new vendors start with).
 *
 * Server-only. Cross-tenant reads use the platform `db` handle (no tenant context), like the rest
 * of /api/sys-control.
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { systemSettings, tenants } from '@/lib/db/schema'
import { BUSINESS_TYPE_LABELS } from '@/lib/business-types/labels'
import {
  BUSINESS_TYPE_FEATURE_PRESETS,
  FEATURE_DEFS,
  FEATURE_FLAGS,
  FEATURE_GROUPS,
  defaultFeatureFlagsForBusinessType,
  effectiveFeatureFlags,
  featureAppliesTo,
  mergedTypePresets,
  type FeatureFlag,
  type FeatureFlagsMap,
  type TypePresetOverrides,
} from '@/lib/features/flags'

export const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_LABELS)
export const PRESET_SETTINGS_KEY = 'business_type_feature_presets'
const USAGE_DAYS = 30
const MAX_TENANTS = 2000

export function isBusinessType(type: string): boolean {
  return BUSINESS_TYPES.includes(type)
}

// ------------------------------------------------------------------ preset overrides (new vendors)

/** Saved super-admin edits of the "new vendors start with" presets. Never throws (empty on error). */
export async function loadTypePresetOverrides(): Promise<TypePresetOverrides> {
  try {
    const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, PRESET_SETTINGS_KEY), columns: { value: true } })
    const value = (row?.value || {}) as Record<string, Record<string, unknown>>
    const out: TypePresetOverrides = {}
    for (const [type, flags] of Object.entries(value)) {
      if (!isBusinessType(type) || !flags || typeof flags !== 'object') continue
      const clean: Partial<FeatureFlagsMap> = {}
      for (const k of FEATURE_FLAGS) if (typeof flags[k] === 'boolean') clean[k] = flags[k] as boolean
      out[type] = clean
    }
    return out
  } catch {
    return {}
  }
}

async function saveTypePresetOverride(type: string, changes: Partial<FeatureFlagsMap>): Promise<TypePresetOverrides> {
  const all = await loadTypePresetOverrides()
  const code = defaultFeatureFlagsForBusinessType(type)
  const next: Partial<FeatureFlagsMap> = { ...(all[type] || {}) }
  for (const [k, v] of Object.entries(changes) as Array<[FeatureFlag, boolean]>) {
    // Only store real differences from the code preset, so later code changes still flow through
    if (code[k] === v) delete next[k]
    else next[k] = v
  }
  if (Object.keys(next).length) all[type] = next
  else delete all[type]
  await db.insert(systemSettings)
    .values({ key: PRESET_SETTINGS_KEY, value: all, description: 'Super admin: feature switches new vendors of each business type start with' })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: all, updatedAt: new Date() } })
  return all
}

/** `typeDefaults` for the create-vendor forms: code presets with the saved overrides. */
export async function currentTypePresets(): Promise<Record<string, Partial<FeatureFlagsMap>>> {
  return mergedTypePresets(await loadTypePresetOverrides())
}

// ------------------------------------------------------------------ usage (activity in 30 days)

/**
 * How we know a vendor really uses a switch: rows in the feature's own table in the last 30 days
 * (or, for set-up style features, rows that exist at all). Features missing here have no reliable
 * signal (`usageTracked: false`).
 */
const USAGE_SQL: Partial<Record<FeatureFlag, (since: Date) => ReturnType<typeof sql>>> = {
  credit_customer: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM sales WHERE payment_method = 'credit' AND created_at >= ${s} GROUP BY tenant_id`,
  loyalty: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM loyalty_transactions WHERE created_at >= ${s} GROUP BY tenant_id`,
  gift_cards: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM gift_card_transactions WHERE created_at >= ${s} GROUP BY tenant_id`,
  promotions: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM promotion_redemptions WHERE created_at >= ${s} GROUP BY tenant_id`,
  price_lists: () => sql`SELECT tenant_id, count(*)::int AS n FROM price_lists WHERE is_active GROUP BY tenant_id`,
  quotation: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM quotations WHERE created_at >= ${s} GROUP BY tenant_id`,
  sales_orders: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM sales_orders WHERE created_at >= ${s} GROUP BY tenant_id`,
  layaways: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM layaways WHERE created_at >= ${s} GROUP BY tenant_id`,
  commissions: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM commissions WHERE created_at >= ${s} GROUP BY tenant_id`,
  cheques: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM cheques WHERE created_at >= ${s} GROUP BY tenant_id`,
  recurring_invoices: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM recurring_invoice_runs WHERE created_at >= ${s} GROUP BY tenant_id`,
  projects: () => sql`SELECT tenant_id, count(*)::int AS n FROM projects WHERE is_active GROUP BY tenant_id`,
  multi_warehouse: () => sql`SELECT tenant_id, count(*)::int AS n FROM warehouses WHERE is_active GROUP BY tenant_id HAVING count(*) > 1`,
  stock_takes: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM stock_takes WHERE created_at >= ${s} GROUP BY tenant_id`,
  batches_expiry: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM item_batches WHERE created_at >= ${s} GROUP BY tenant_id`,
  serial_numbers: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM item_serial_numbers WHERE created_at >= ${s} GROUP BY tenant_id`,
  purchase: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM purchases WHERE created_at >= ${s} GROUP BY tenant_id`,
  accounting: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM journal_entries WHERE created_at >= ${s} GROUP BY tenant_id`,
  einvoice: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM einvoice_outbox WHERE created_at >= ${s} GROUP BY tenant_id`,
  hr_payroll: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM payroll_runs WHERE created_at >= ${s} GROUP BY tenant_id`,
  pharmacy: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM prescriptions WHERE created_at >= ${s} GROUP BY tenant_id`,
  appointments: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM appointments WHERE created_at >= ${s} GROUP BY tenant_id`,
  installments: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM installment_plans WHERE created_at >= ${s} GROUP BY tenant_id`,
  deliveries: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM deliveries WHERE created_at >= ${s} GROUP BY tenant_id`,
  warranty_claims: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM warranty_claims WHERE created_at >= ${s} GROUP BY tenant_id`,
  print_jobs: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM print_jobs WHERE created_at >= ${s} GROUP BY tenant_id`,
  service_jobs: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM service_jobs WHERE created_at >= ${s} GROUP BY tenant_id`,
  hr_attendance: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM attendance_punches WHERE created_at >= ${s} GROUP BY tenant_id`,
  whatsapp: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM notification_logs WHERE channel = 'whatsapp' AND created_at >= ${s} GROUP BY tenant_id`,
  sms: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM notification_logs WHERE channel = 'sms' AND created_at >= ${s} GROUP BY tenant_id`,
  staff_chat: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM staff_chat_messages WHERE created_at >= ${s} GROUP BY tenant_id`,
  api_access: (s) => sql`SELECT tenant_id, count(*)::int AS n FROM api_keys WHERE last_used_at >= ${s} GROUP BY tenant_id`,
}

function rowsOf<T>(res: unknown): T[] {
  const r = res as { rows?: T[] } | T[]
  return Array.isArray(r) ? r : r?.rows ?? []
}

/** flag → (tenantId → activity count). One small grouped query per tracked feature. */
async function loadUsage(tenantIds: Set<string>, since: Date): Promise<Map<FeatureFlag, Map<string, number>>> {
  const out = new Map<FeatureFlag, Map<string, number>>()
  const entries = Object.entries(USAGE_SQL) as Array<[FeatureFlag, (s: Date) => ReturnType<typeof sql>]>
  await Promise.all(entries.map(async ([flag, q]) => {
    const m = new Map<string, number>()
    try {
      for (const r of rowsOf<{ tenant_id: string; n: number }>(await db.execute(q(since)))) {
        if (tenantIds.has(r.tenant_id)) m.set(r.tenant_id, Number(r.n) || 0)
      }
    } catch {
      // A missing table on an old database must not break the page: no usage for this feature
    }
    out.set(flag, m)
  }))
  return out
}

// ------------------------------------------------------------------ shared reads

interface TenantRow {
  id: string
  name: string
  slug: string
  businessId: string | null
  businessType: string
  businessSegments: string[] | null
  status: string
  plan: string | null
  createdAt: Date
  settings: Record<string, unknown> | null
}

async function tenantsOfType(type?: string): Promise<TenantRow[]> {
  const rows = await db.select({
    id: tenants.id, name: tenants.name, slug: tenants.slug, businessId: tenants.businessId,
    businessType: tenants.businessType, businessSegments: tenants.businessSegments,
    status: tenants.status, plan: tenants.plan, createdAt: tenants.createdAt, settings: tenants.settings,
  })
    .from(tenants)
    .where(type ? sql`${tenants.businessType} = ${type}` : undefined)
    .orderBy(tenants.name)
    .limit(MAX_TENANTS)
  return rows as unknown as TenantRow[]
}

function flagsOf(t: TenantRow): FeatureFlagsMap {
  const saved = ((t.settings || {}) as { featureFlags?: Partial<FeatureFlagsMap> }).featureFlags
  return effectiveFeatureFlags(saved, { businessType: t.businessType, businessSegments: t.businessSegments })
}

/** Net sales + receipts per tenant since `since` (void excluded, returns subtracted). */
async function salesByTenant(since: Date, type?: string): Promise<Map<string, { net: number; receipts: number; lastSaleAt: string | null }>> {
  const res = await db.execute(sql`
    SELECT s.tenant_id,
      COALESCE(SUM(CASE WHEN s.is_return THEN -ABS(s.total) ELSE s.total END), 0) AS net,
      COUNT(*) FILTER (WHERE NOT s.is_return)::int AS receipts,
      MAX(s.created_at) AS last_sale_at
    FROM sales s
    ${type ? sql`JOIN tenants t ON t.id = s.tenant_id AND t.business_type = ${type}` : sql``}
    WHERE s.status <> 'void' AND s.created_at >= ${since}
    GROUP BY s.tenant_id`)
  const m = new Map<string, { net: number; receipts: number; lastSaleAt: string | null }>()
  for (const r of rowsOf<{ tenant_id: string; net: string; receipts: number; last_sale_at: Date | string | null }>(res)) {
    m.set(r.tenant_id, {
      net: Number(r.net) || 0,
      receipts: Number(r.receipts) || 0,
      lastSaleAt: r.last_sale_at ? new Date(r.last_sale_at).toISOString() : null,
    })
  }
  return m
}

function sinceDays(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

function featureCatalog(type: string) {
  return FEATURE_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    group: d.group,
    offEffect: d.offEffect ?? null,
    /** Does this switch matter to this business type at all (industry switches are type-scoped) */
    applies: featureAppliesTo(d.key, type),
    usageTracked: !!USAGE_SQL[d.key],
  }))
}

// ------------------------------------------------------------------ overview: all types

export interface BusinessTypeSummary {
  type: string
  label: string
  tenantCount: number
  statusCounts: Record<string, number>
  /** Vendors with at least one sale in the last 30 days */
  activeTenants30d: number
  netSales30d: number
  receipts30d: number
  /** flag → vendors of this type that have it ON (effective) */
  enabledCounts: Record<FeatureFlag, number>
  /** The switches a NEW vendor of this type starts with (code preset + saved overrides) */
  preset: FeatureFlagsMap
  /** Flags whose preset the super admin changed from the code default */
  presetOverridden: FeatureFlag[]
}

export async function getBusinessTypeOverview() {
  const [all, sales30, overrides] = await Promise.all([tenantsOfType(), salesByTenant(sinceDays(USAGE_DAYS)), loadTypePresetOverrides()])
  const byType = new Map<string, TenantRow[]>()
  for (const t of all) {
    const list = byType.get(t.businessType) || []
    list.push(t)
    byType.set(t.businessType, list)
  }
  const types: BusinessTypeSummary[] = BUSINESS_TYPES.map((type) => {
    const list = byType.get(type) || []
    const enabledCounts = Object.fromEntries(FEATURE_FLAGS.map((k) => [k, 0])) as Record<FeatureFlag, number>
    const statusCounts: Record<string, number> = {}
    let active = 0, net = 0, receipts = 0
    for (const t of list) {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1
      const f = flagsOf(t)
      for (const k of FEATURE_FLAGS) if (f[k]) enabledCounts[k]++
      const s = sales30.get(t.id)
      if (s) { active++; net += s.net; receipts += s.receipts }
    }
    return {
      type,
      label: BUSINESS_TYPE_LABELS[type] || type,
      tenantCount: list.length,
      statusCounts,
      activeTenants30d: active,
      netSales30d: Math.round(net * 100) / 100,
      receipts30d: receipts,
      enabledCounts,
      preset: defaultFeatureFlagsForBusinessType(type, overrides),
      presetOverridden: Object.keys(overrides[type] || {}) as FeatureFlag[],
    }
  })
  return {
    types,
    totals: {
      tenants: all.length,
      activeTenants30d: types.reduce((a, t) => a + t.activeTenants30d, 0),
      netSales30d: Math.round(types.reduce((a, t) => a + t.netSales30d, 0) * 100) / 100,
    },
    features: FEATURE_DEFS.map((d) => ({ key: d.key, label: d.label, group: d.group, businessTypes: d.businessTypes ?? null })),
    groups: FEATURE_GROUPS,
    usageDays: USAGE_DAYS,
  }
}

// ------------------------------------------------------------------ one type: vendors × features

export async function getBusinessTypeDetail(type: string) {
  const [list, sales30, overrides] = await Promise.all([tenantsOfType(type), salesByTenant(sinceDays(USAGE_DAYS), type), loadTypePresetOverrides()])
  const ids = new Set(list.map((t) => t.id))
  const usage = await loadUsage(ids, sinceDays(USAGE_DAYS))

  const tenantsOut = list.map((t) => {
    const flags = flagsOf(t)
    const used = FEATURE_FLAGS.filter((k) => (usage.get(k)?.get(t.id) || 0) > 0)
    const s = sales30.get(t.id)
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      businessId: t.businessId,
      businessSegments: t.businessSegments,
      status: t.status,
      plan: t.plan,
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
      netSales30d: Math.round((s?.net || 0) * 100) / 100,
      receipts30d: s?.receipts || 0,
      lastSaleAt: s?.lastSaleAt ?? null,
      featureFlags: flags,
      enabledCount: FEATURE_FLAGS.filter((k) => flags[k]).length,
      /** Features with activity in the last 30 days */
      usedFeatures: used,
      /** ON but never used in 30 days (only tracked features) — candidates to switch off */
      unusedEnabled: FEATURE_FLAGS.filter((k) => flags[k] && USAGE_SQL[k] && !used.includes(k)),
    }
  })

  const features = featureCatalog(type).map((f) => {
    const usageMap = usage.get(f.key)
    return {
      ...f,
      enabledCount: tenantsOut.filter((t) => t.featureFlags[f.key]).length,
      /** Vendors of this type with activity for this feature in the window (null = not tracked) */
      usedCount: f.usageTracked ? tenantsOut.filter((t) => (usageMap?.get(t.id) || 0) > 0).length : null,
      /** Total activity rows in the window (receipts on credit, loyalty transactions, …) */
      activity: f.usageTracked ? [...(usageMap?.values() || [])].reduce((a, n) => a + n, 0) : null,
    }
  })

  return {
    type,
    label: BUSINESS_TYPE_LABELS[type] || type,
    usageDays: USAGE_DAYS,
    tenantCount: tenantsOut.length,
    activeTenants30d: tenantsOut.filter((t) => t.receipts30d > 0).length,
    netSales30d: Math.round(tenantsOut.reduce((a, t) => a + t.netSales30d, 0) * 100) / 100,
    preset: defaultFeatureFlagsForBusinessType(type, overrides),
    codePreset: defaultFeatureFlagsForBusinessType(type),
    presetOverridden: Object.keys(overrides[type] || {}) as FeatureFlag[],
    groups: FEATURE_GROUPS,
    features,
    tenants: tenantsOut,
  }
}

// ------------------------------------------------------------------ bulk on / off per type

export interface ApplyTypeFeaturesInput {
  changes: Partial<FeatureFlagsMap>
  /** Change the switches of the vendors of this type (all of them, or only `tenantIds`) */
  applyToExisting: boolean
  /** Change the preset new vendors of this type start with */
  applyToNew: boolean
  tenantIds?: string[]
}

/**
 * Sets the given switches on every vendor of `type` (or the listed ones) in one statement: the
 * saved featureFlags map is merged with the changes, other switches and settings are untouched.
 */
export async function applyBusinessTypeFeatures(type: string, input: ApplyTypeFeaturesInput) {
  const changes: Partial<FeatureFlagsMap> = {}
  for (const k of FEATURE_FLAGS) if (typeof input.changes[k] === 'boolean') changes[k] = input.changes[k]
  if (Object.keys(changes).length === 0) throw new Error('NO_CHANGES')

  let updatedTenantIds: string[] = []
  if (input.applyToExisting) {
    const json = JSON.stringify(changes)
    const subset = input.tenantIds?.length ? sql`AND id = ANY(${`{${input.tenantIds.join(',')}}`}::uuid[])` : sql``
    const res = await db.execute(sql`
      UPDATE tenants
      SET settings = jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{featureFlags}',
            COALESCE(settings->'featureFlags', '{}'::jsonb) || ${json}::jsonb,
            true),
          updated_at = now()
      WHERE business_type = ${type} ${subset}
      RETURNING id`)
    updatedTenantIds = rowsOf<{ id: string }>(res).map((r) => r.id)
  }

  const presets = input.applyToNew ? await saveTypePresetOverride(type, changes) : await loadTypePresetOverrides()
  return {
    changes,
    updatedTenants: updatedTenantIds.length,
    updatedTenantIds,
    preset: defaultFeatureFlagsForBusinessType(type, presets),
    presetOverridden: Object.keys(presets[type] || {}) as FeatureFlag[],
  }
}

/** Put the preset of a type back to the code default (drops all saved overrides for it). */
export async function resetTypePreset(type: string) {
  const all = await loadTypePresetOverrides()
  delete all[type]
  await db.insert(systemSettings)
    .values({ key: PRESET_SETTINGS_KEY, value: all })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: all, updatedAt: new Date() } })
  return { preset: defaultFeatureFlagsForBusinessType(type), presetOverridden: [] as FeatureFlag[] }
}

export { BUSINESS_TYPE_FEATURE_PRESETS }
