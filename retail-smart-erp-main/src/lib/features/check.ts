import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  FeatureFlag,
  FeatureFlagsMap,
  effectiveFeatureFlags,
  isFeatureEnabled,
  normalizeFeatureFlags,
} from './flags'

type TenantSettings = {
  featureFlags?: Partial<FeatureFlagsMap>
  [key: string]: unknown
}

export async function getTenantFeatureFlags(
  tenantId: string
): Promise<FeatureFlagsMap> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  })
  const settings = (tenant?.settings || {}) as TenantSettings
  return normalizeFeatureFlags(settings.featureFlags)
}

/**
 * The switches the business really gets (what menus, pages, the API and the POS go by): saved
 * switches, missing keys at the global default, industry switches off for other business types.
 */
export async function getTenantEffectiveFeatureFlags(
  tenantId: string
): Promise<FeatureFlagsMap> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true, businessType: true, businessSegments: true },
  })
  const settings = (tenant?.settings || {}) as TenantSettings
  return effectiveFeatureFlags(settings.featureFlags, tenant ? { businessType: tenant.businessType, businessSegments: tenant.businessSegments } : null)
}

export async function requireTenantFeature(
  tenantId: string,
  flag: FeatureFlag
): Promise<{ ok: true; flags: FeatureFlagsMap } | { ok: false; flags: FeatureFlagsMap }> {
  const flags = await getTenantFeatureFlags(tenantId)
  if (!isFeatureEnabled(flags, flag)) {
    return { ok: false, flags }
  }
  return { ok: true, flags }
}

export async function setTenantFeatureFlags(
  tenantId: string,
  flags: Partial<FeatureFlagsMap>
): Promise<FeatureFlagsMap> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  })
  const current = (tenant?.settings || {}) as TenantSettings
  const nextFlags = normalizeFeatureFlags({
    ...normalizeFeatureFlags(current.featureFlags),
    ...flags,
  })
  const nextSettings = { ...current, featureFlags: nextFlags }
  await db
    .update(tenants)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
  return nextFlags
}

export { isFeatureEnabled, normalizeFeatureFlags }
export type { FeatureFlag, FeatureFlagsMap }
