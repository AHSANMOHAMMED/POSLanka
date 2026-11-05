/**
 * Pharmacy settings in tenants.settings.pharmacy (no column of their own):
 *   expiryAlertDays — the dashboard expiry alert and expiry report window (default 90 days)
 */
import { eq, sql } from 'drizzle-orm'
import { tenants } from '@/lib/db/schema'
import type { TenantDb } from '@/lib/db'

export interface PharmacySettings {
  expiryAlertDays: number
}

export const DEFAULT_PHARMACY_SETTINGS: PharmacySettings = { expiryAlertDays: 90 }

export function readPharmacySettings(settings: unknown): PharmacySettings {
  const p = ((settings || {}) as { pharmacy?: Partial<PharmacySettings> }).pharmacy || {}
  const days = Number(p.expiryAlertDays)
  return {
    expiryAlertDays: Number.isFinite(days) && days >= 1 && days <= 730 ? Math.round(days) : DEFAULT_PHARMACY_SETTINGS.expiryAlertDays,
  }
}

export async function loadPharmacySettings(db: Pick<TenantDb, 'select'>, tenantId: string): Promise<PharmacySettings> {
  const [row] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  return readPharmacySettings(row?.settings)
}

/** Merge into settings.pharmacy in one statement (other settings keys are left alone) */
export async function savePharmacySettings(db: Pick<TenantDb, 'execute'>, tenantId: string, patch: Partial<PharmacySettings>): Promise<void> {
  await db.execute(sql`
    UPDATE tenants SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{pharmacy}',
      coalesce(settings->'pharmacy', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)
    WHERE id = ${tenantId}::uuid
  `)
}
