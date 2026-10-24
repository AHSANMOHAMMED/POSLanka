import type { FeatureFlagsMap } from './flags'
import { featureForHref, featureForModule, isFeatureEnabled } from './flags'

/** Top-level module tabs hidden by a vendor's feature switches (see FEATURE_DEFS.modules) */
export function isModuleAllowedByFeatures(
  moduleKey: string,
  flags: FeatureFlagsMap | null | undefined
): boolean {
  const flag = featureForModule(moduleKey)
  return !flag || isFeatureEnabled(flags, flag)
}

/** Sidebar / workspace links hidden by a vendor's feature switches (see FEATURE_DEFS.hrefs) */
export function isHrefAllowedByFeatures(
  href: string,
  flags: FeatureFlagsMap | null | undefined
): boolean {
  const flag = featureForHref(href)
  return !flag || isFeatureEnabled(flags, flag)
}
