// Builds a catalog of all available shortcut targets from the module navigation system
// Used by the ShortcutPickerModal to let users add shortcuts from any module

import { MODULE_TABS, isModuleTabVisible, getModuleSidebar } from '@/lib/navigation/module-sidebar'
import type { WorkspaceBlock } from './types'

export interface ShortcutCatalogItem {
  label: string
  href: string // relative, e.g. '/items'
  icon: string
  moduleKey: string
  moduleLabel: string
}

export interface ShortcutCatalogGroup {
  moduleKey: string
  moduleLabel: string
  moduleIcon: string
  items: ShortcutCatalogItem[]
}

/**
 * Build a catalog of all available pages grouped by module,
 * filtered by business type, role, and module access config.
 */
export function buildShortcutCatalog(
  businessType?: string,
  role?: string,
  isModuleEnabled?: (moduleKey: string, role?: string) => boolean
): ShortcutCatalogGroup[] {
  const groups: ShortcutCatalogGroup[] = []

  for (const tab of MODULE_TABS) {
    // Skip dashboard — no point shortcutting to dashboard from dashboard
    if (tab.key === 'dashboard') continue

    if (!isModuleTabVisible(tab, businessType, role, isModuleEnabled)) continue

    const sections = getModuleSidebar(tab.key, businessType, role, isModuleEnabled)
    const items: ShortcutCatalogItem[] = []
    const seen = new Set<string>()

    for (const section of sections) {
      for (const item of section.items) {
        // Deduplicate by href (some items appear in multiple sections)
        if (seen.has(item.href)) continue
        seen.add(item.href)

        items.push({
          label: item.label,
          href: item.href,
          icon: item.icon,
          moduleKey: tab.key,
          moduleLabel: tab.label,
        })
      }
    }

    if (items.length > 0) {
      groups.push({
        moduleKey: tab.key,
        moduleLabel: tab.label,
        moduleIcon: tab.icon,
        items,
      })
    }
  }

  return groups
}

/**
 * Strip /c/{slug} prefix from an href to get the relative path.
 * If href doesn't have the prefix, returns as-is.
 */
export function toRelativeHref(href: string): string {
  const match = href.match(/^\/c\/[^/]+(.+)$/)
  return match ? match[1] : href
}

/**
 * Strip basePath prefix from all block hrefs for saving to DB.
 * The DB stores relative hrefs; the API resolves them on GET.
 */
export function stripBasePathFromBlocks(
  blocks: WorkspaceBlock[],
  basePath: string
): WorkspaceBlock[] {
  const strip = (href: string): string =>
    href.startsWith(basePath) ? href.slice(basePath.length) : href

  return blocks.map((block) => {
    switch (block.type) {
      case 'number_card':
        return {
          ...block,
          data: { ...block.data, href: strip(block.data.href) },
        }
      case 'shortcut':
        return {
          ...block,
          data: {
            ...block.data,
            shortcuts: block.data.shortcuts.map((s) => ({
              ...s,
              href: strip(s.href),
            })),
          },
        }
      case 'quick_list':
        return {
          ...block,
          data: { ...block.data, href: strip(block.data.href) },
        }
      case 'card':
        return {
          ...block,
          data: {
            ...block.data,
            links: block.data.links.map((link) => ({
              ...link,
              href: strip(link.href),
            })),
          },
        }
      default:
        return block
    }
  })
}
