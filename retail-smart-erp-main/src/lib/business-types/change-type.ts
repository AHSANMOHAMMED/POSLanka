/**
 * Changing a vendor's business type (super admin → vendor → Business type), e.g. supermarket →
 * mall [supermarket, textile, electronics, restaurant], retail → electronics, or mall → supermarket.
 *
 * The tenant row keeps its id, Business ID and every record; only business_type /
 * business_segments change. Feature switches are only ever turned ON, never off: a switch is turned
 * on when the newly added types' presets want it and either it did not apply to the old types or
 * the old types' presets had it off (so it was only off because of the old type). Seed data the
 * new types need is inserted where missing (ensure-seed.ts).
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import {
  FEATURE_FLAGS,
  defaultFeatureFlagsForBusinessType,
  featureAppliesTo,
  isTypeScopedFeature,
  normalizeFeatureFlags,
  type FeatureFlag,
  type FeatureFlagsMap,
} from '@/lib/features/flags'
import { getRolesForBusinessType } from '@/lib/auth/roles'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'
import { clearSessionValidation } from '@/lib/auth/session-validation-cache'
import { MALL, SEGMENT_TYPES, cleanSegments, scopeTypes, type BusinessScope } from './scope'
import { ensureBusinessTypeSeedData } from './ensure-seed'

export interface FeatureChangePlan {
  /** Switches to turn on (new types' presets want them; vendor had them off) */
  turnOn: FeatureFlag[]
  /** Switches still on that no longer apply to the new types (left as saved; they just stop showing) */
  inapplicableOn: FeatureFlag[]
}

/** Pure: which switches a type change turns on (never off). */
export function planFeatureChange(
  saved: Partial<Record<string, boolean>> | null | undefined,
  from: BusinessScope,
  to: BusinessScope,
): FeatureChangePlan {
  const current = normalizeFeatureFlags(saved)
  const oldTypes = scopeTypes(from)
  const added = scopeTypes(to).filter((t) => !oldTypes.includes(t))
  const turnOn: FeatureFlag[] = []
  if (added.length > 0) {
    const addedPreset = defaultFeatureFlagsForBusinessType(added)
    const oldPreset = oldTypes.length ? defaultFeatureFlagsForBusinessType(oldTypes) : null
    for (const key of FEATURE_FLAGS) {
      if (current[key] || !addedPreset[key]) continue
      const newlyApplies = !featureAppliesTo(key, from) && featureAppliesTo(key, to)
      const offOnlyByOldPreset = !!oldPreset && !oldPreset[key]
      if (newlyApplies || offOnlyByOldPreset) turnOn.push(key)
    }
  }
  const after = { ...current }
  for (const k of turnOn) after[k] = true
  const inapplicableOn = FEATURE_FLAGS.filter((k) => after[k] && isTypeScopedFeature(k) && !featureAppliesTo(k, to))
  return { turnOn, inapplicableOn }
}

export type TypeChangeInput = { businessType: string; businessSegments?: readonly unknown[] | null }

/** Validates the requested type / segments. Returns an error message or the clean values. */
export function validateTypeChange(input: TypeChangeInput, allowedTypes: readonly string[]):
  | { ok: true; businessType: string; businessSegments: string[] | null }
  | { ok: false; error: string; field: string } {
  if (!allowedTypes.includes(input.businessType)) return { ok: false, error: 'Unknown business type', field: 'businessType' }
  if (input.businessType !== MALL) return { ok: true, businessType: input.businessType, businessSegments: null }
  const raw = Array.isArray(input.businessSegments) ? input.businessSegments : []
  const unknown = raw.filter((s) => typeof s !== 'string' || !(SEGMENT_TYPES as readonly string[]).includes(s))
  if (unknown.length > 0) return { ok: false, error: `Unknown shop type: ${unknown.map(String).join(', ')}`, field: 'businessSegments' }
  const segments = cleanSegments(raw)
  if (segments.length === 0) return { ok: false, error: 'Tick at least one shop type the mall runs', field: 'businessSegments' }
  return { ok: true, businessType: MALL, businessSegments: segments }
}

export interface TypeChangeResult {
  vendor: { id: string; businessType: string; businessSegments: string[] | null }
  before: { businessType: string; businessSegments: string[] | null }
  changes: {
    featuresTurnedOn: string[]
    seeded: Record<string, number>
    rolesAdded: string[]
    /** Switches still on that do not apply to the new type(s); not turned off automatically */
    featuresNoLongerApplicable: string[]
  }
}

/**
 * Applies a (validated) type change in one transaction. Never deletes or rewrites business data.
 * Returns null when the tenant does not exist.
 */
export async function changeTenantBusinessType(
  tenantId: string,
  businessType: string,
  businessSegments: string[] | null,
): Promise<TypeChangeResult | null> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: tenants.id, businessType: tenants.businessType, businessSegments: tenants.businessSegments, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .for('update')
    if (!current) return null

    const from = { businessType: current.businessType, businessSegments: current.businessSegments }
    const to = { businessType, businessSegments }
    const settings = (current.settings || {}) as Record<string, unknown>
    const savedFlags = (settings.featureFlags || {}) as Partial<FeatureFlagsMap>
    const plan = planFeatureChange(savedFlags, from, to)

    const nextSettings = plan.turnOn.length
      ? { ...settings, featureFlags: { ...normalizeFeatureFlags(savedFlags), ...Object.fromEntries(plan.turnOn.map((k) => [k, true])) } }
      : settings

    await tx
      .update(tenants)
      .set({
        businessType: businessType as typeof tenants.$inferInsert['businessType'],
        businessSegments,
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))

    // RLS context for the tenant tables the seeding writes to
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`)
    const oldTypes = scopeTypes(from)
    const addedTypes = scopeTypes(to).filter((t) => !oldTypes.includes(t))
    const seeded = await ensureBusinessTypeSeedData(tx, tenantId, addedTypes)

    const oldRoles = new Set<string>(getRolesForBusinessType(from))
    const rolesAdded = getRolesForBusinessType(to).filter((r) => !oldRoles.has(r))

    return {
      vendor: { id: tenantId, businessType, businessSegments },
      before: { businessType: current.businessType, businessSegments: current.businessSegments ?? null },
      changes: {
        featuresTurnedOn: plan.turnOn,
        seeded,
        rolesAdded,
        featuresNoLongerApplicable: plan.inapplicableOn,
      },
    }
  })
  if (result) {
    // Signed-in staff (web + app) see the new type on their next request, not after the 20 s cache
    invalidatePermissionCache(tenantId)
    clearSessionValidation(tenantId)
  }
  return result
}
