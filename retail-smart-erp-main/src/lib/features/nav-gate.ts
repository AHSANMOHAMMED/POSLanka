import type { FeatureFlag, FeatureFlagsMap } from './flags'
import { isFeatureEnabled } from './flags'

/** Map top-level module tabs to platform feature flags */
const MODULE_FEATURE_MAP: Record<string, FeatureFlag> = {
  accounting: 'accounting',
  buying: 'purchase',
  reports: 'advanced_reports',
}

/** Map sidebar href fragments to feature flags */
const HREF_FEATURE_MAP: Array<{ match: string; flag: FeatureFlag }> = [
  { match: '/quotations', flag: 'quotation' },
  { match: '/credit-notes', flag: 'quotation' },
  { match: '/settings/loyalty', flag: 'loyalty' },
  { match: '/stock-transfers', flag: 'multi_warehouse' },
]

export function isModuleAllowedByFeatures(
  moduleKey: string,
  flags: FeatureFlagsMap | null | undefined
): boolean {
  const flag = MODULE_FEATURE_MAP[moduleKey]
  if (!flag) return true
  return isFeatureEnabled(flags, flag)
}

export function isHrefAllowedByFeatures(
  href: string,
  flags: FeatureFlagsMap | null | undefined
): boolean {
  for (const rule of HREF_FEATURE_MAP) {
    if (href.includes(rule.match) && !isFeatureEnabled(flags, rule.flag)) {
      return false
    }
  }
  return true
}
