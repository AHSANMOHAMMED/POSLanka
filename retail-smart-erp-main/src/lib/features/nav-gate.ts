import type { FeatureFlag, FeatureFlagsMap } from './flags'
import { anyFeatureEnabled, featuresForHref, featuresForModule } from './flags'
import { MODULE_TABS } from '@/lib/navigation/module-sidebar'

/** Top-level module tabs hidden by a vendor's feature switches (see FEATURE_DEFS.modules): a
 * module owned by several switches (HR: payroll + attendance) stays while any of them is on. */
export function isModuleAllowedByFeatures(
  moduleKey: string,
  flags: FeatureFlagsMap | null | undefined
): boolean {
  return anyFeatureEnabled(flags, featuresForModule(moduleKey))
}

/** Sidebar / workspace links hidden by a vendor's feature switches (see FEATURE_DEFS.hrefs) */
export function isHrefAllowedByFeatures(
  href: string,
  flags: FeatureFlagsMap | null | undefined
): boolean {
  return anyFeatureEnabled(flags, featuresForHref(href))
}

/**
 * The switches that decide whether a page (relative to /c/[slug]) opens. A module's landing page
 * (/accounting, /hr, /buying, /reports …) follows the module's switches; any other page its most
 * specific href. Empty = not switchable.
 */
export function featuresForPage(relativePath: string): FeatureFlag[] {
  const path = relativePath.split('?')[0].replace(/\/+$/, '') || '/'
  const tab = MODULE_TABS.find((t) => t.href === path)
  if (tab) {
    const keys = featuresForModule(tab.key)
    if (keys.length > 0) return keys
  }
  return featuresForHref(path)
}

/** null = the page may open; else the (first) switch that turned it off */
export function pageBlockedByFeature(relativePath: string, flags: FeatureFlagsMap | null | undefined): FeatureFlag | null {
  const keys = featuresForPage(relativePath)
  return anyFeatureEnabled(flags, keys) ? null : keys[0]
}
