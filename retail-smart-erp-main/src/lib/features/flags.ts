/**
 * Platform / per-vendor feature flags (POSLanka spec).
 * Stored on tenants.settings.featureFlags (jsonb) and optionally system defaults.
 */

export const FEATURE_FLAGS = [
  'accounting',
  'purchase',
  'credit_customer',
  'loyalty',
  'multi_warehouse',
  'advanced_reports',
  'whatsapp',
  'quotation',
] as const

export type FeatureFlag = (typeof FEATURE_FLAGS)[number]

export const FEATURE_FLAG_LABELS: Record<FeatureFlag, string> = {
  accounting: 'Accounting module',
  purchase: 'Purchase module',
  credit_customer: 'Credit customers',
  loyalty: 'Loyalty points',
  multi_warehouse: 'Multi-warehouse',
  advanced_reports: 'Advanced reports',
  whatsapp: 'WhatsApp integration',
  quotation: 'Quotation module',
}

/** Default flags for newly onboarded vendors */
export const DEFAULT_VENDOR_FEATURE_FLAGS: Record<FeatureFlag, boolean> = {
  accounting: true,
  purchase: true,
  credit_customer: true,
  loyalty: true,
  multi_warehouse: false,
  advanced_reports: true,
  whatsapp: true,
  quotation: true,
}

export type FeatureFlagsMap = Record<FeatureFlag, boolean>

export function normalizeFeatureFlags(
  input?: Partial<Record<string, boolean>> | null
): FeatureFlagsMap {
  const result = { ...DEFAULT_VENDOR_FEATURE_FLAGS }
  if (!input) return result
  for (const key of FEATURE_FLAGS) {
    if (typeof input[key] === 'boolean') {
      result[key] = input[key]!
    }
  }
  return result
}

export function isFeatureEnabled(
  flags: Partial<FeatureFlagsMap> | null | undefined,
  flag: FeatureFlag
): boolean {
  const normalized = normalizeFeatureFlags(flags)
  return normalized[flag]
}
