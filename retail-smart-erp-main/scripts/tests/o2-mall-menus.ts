/**
 * O2 — mall / multi-shop menus (pure, no database).
 *
 * 1. Every existing (non-mall) vendor sees EXACTLY the same menus, module tabs, module routing,
 *    workspace defaults and shortcut catalog whether the code passes the old plain business-type
 *    string or the new BusinessScope shapes ({ businessType, businessSegments }, [type]).
 * 2. A mall gets the de-duplicated union of its segments' menus and workspace blocks.
 *
 *   npx tsx scripts/tests/o2-mall-menus.ts
 */
import { isDeepStrictEqual } from 'util'
import {
  MODULE_TABS,
  getModuleFromPathname,
  getModuleSidebar,
  isModuleTabVisible,
  isServiceCapable,
  isStoreBusiness,
  type SidebarSection,
} from '@/lib/navigation/module-sidebar'
import { getDefaultWorkspace } from '@/lib/workspace/defaults'
import { buildShortcutCatalog } from '@/lib/workspace/shortcut-catalog'
import { ROLE_HIERARCHY } from '@/lib/auth/roles'
import { SEGMENT_TYPES, tillBusinessType, type BusinessScope } from '@/lib/business-types/scope'
import type { WorkspaceBlock } from '@/lib/workspace/types'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400))
  }
}

const SINGLE_TYPES = [...SEGMENT_TYPES, ''] as string[]
const ROLES: Array<string | undefined> = [...Object.keys(ROLE_HIERARCHY), undefined]
const MODULES = MODULE_TABS.map((t) => t.key)
const WORKSPACES = ['dashboard', 'stock', 'selling', 'buying', 'reports', 'settings', 'hr', 'accounting']
const PATHS = ['/c/x/work-orders', '/c/x/appointments', '/c/x/items', '/c/x/restaurant/orders', '/c/x/dealership/sales', '/c/x/pharmacy/expiry', '/dashboard']

/* --------------------------------------------- 1. non-mall vendors: identical for every scope shape */
for (const bt of SINGLE_TYPES) {
  const plain = bt || undefined
  const shapes: Array<[string, BusinessScope]> = [
    ['object', { businessType: bt, businessSegments: null }],
    // segments are ignored for every type except 'mall'
    ['object+segments', { businessType: bt, businessSegments: ['restaurant', 'pharmacy'] }],
    ['array', bt ? [bt] : []],
  ]
  for (const [shapeName, scope] of shapes) {
    let same = true
    for (const role of ROLES) {
      for (const tab of MODULE_TABS) {
        if (isModuleTabVisible(tab, plain, role) !== isModuleTabVisible(tab, scope, role)) {
          same = false
          check(`tab ${tab.key} visible ${bt}/${role}/${shapeName}`, false)
        }
        if (!isDeepStrictEqual(getModuleSidebar(tab.key, plain, role), getModuleSidebar(tab.key, scope, role))) {
          same = false
          check(`sidebar ${tab.key} ${bt}/${role}/${shapeName}`, false, getModuleSidebar(tab.key, scope, role))
        }
      }
      if (!isDeepStrictEqual(buildShortcutCatalog(plain, role), buildShortcutCatalog(scope, role))) {
        same = false
        check(`shortcut catalog ${bt}/${role}/${shapeName}`, false)
      }
    }
    check(`menus identical: ${bt || '(none)'} as ${shapeName}`, same)
    check(`routing identical: ${bt || '(none)'} as ${shapeName}`,
      PATHS.every((p) => getModuleFromPathname(p, plain) === getModuleFromPathname(p, scope)))
    check(`workspaces identical: ${bt || '(none)'} as ${shapeName}`,
      WORKSPACES.every((k) => isDeepStrictEqual(getDefaultWorkspace(k, plain), getDefaultWorkspace(k, scope))))
    check(`store / service flags identical: ${bt || '(none)'} as ${shapeName}`,
      isStoreBusiness(plain) === isStoreBusiness(scope) && isServiceCapable(plain) === isServiceCapable(scope))
  }
  // A till of a non-mall vendor always works as the vendor's own type, whatever the counter says
  if (bt) check(`till type ${bt}`, tillBusinessType(bt, 'restaurant') === bt && tillBusinessType({ businessType: bt, businessSegments: null }, null) === bt)
}

/* --------------------------------------------- 2. malls: de-duplicated union */
const hrefs = (sections: SidebarSection[]) => sections.flatMap((s) => s.items.map((i) => i.href))
const mall = (segments: string[]): BusinessScope => ({ businessType: 'mall', businessSegments: segments })

const COMBOS: string[][] = [
  ['supermarket', 'restaurant'],
  ['supermarket', 'textile', 'electronics', 'pharmacy', 'restaurant'],
  ['auto_service', 'dealership'],
  ['electronics', 'auto_service'],
  ['retail', 'print_studio', 'office'],
  [...SEGMENT_TYPES],
]
for (const segs of COMBOS) {
  const scope = mall(segs)
  const label = segs.join('+')
  for (const role of ['owner', 'manager', 'cashier', 'chef', 'technician']) {
    for (const key of MODULES) {
      const got = hrefs(getModuleSidebar(key, scope, role))
      check(`mall ${label} ${key}/${role}: no duplicate links`, new Set(got).size === got.length, got)
      const union = new Set(segs.flatMap((t) => hrefs(getModuleSidebar(key, t, role))))
      check(`mall ${label} ${key}/${role}: union of its segments`, isDeepStrictEqual(new Set(got), union), { got, union: [...union] })
    }
    for (const tab of MODULE_TABS) {
      const any = segs.some((t) => isModuleTabVisible(tab, t, role))
      check(`mall ${label} tab ${tab.key}/${role}`, isModuleTabVisible(tab, scope, role) === any)
    }
  }
  for (const key of ['dashboard', 'selling', 'reports']) {
    const ws = getDefaultWorkspace(key, scope)!
    const ids = ws.blocks.map((b) => b.id)
    check(`mall ${label} ${key} workspace: unique block ids`, new Set(ids).size === ids.length, ids)
    const keyOf = (b: WorkspaceBlock) => JSON.stringify((b.data as Record<string, unknown>).metricKey ?? (b.data as Record<string, unknown>).chartKey ?? (b.data as Record<string, unknown>).listKey ?? (b.data as Record<string, unknown>).title ?? b.type)
    const got = new Set(ws.blocks.map(keyOf))
    const want = new Set(segs.flatMap((t) => getDefaultWorkspace(key, t)!.blocks.map(keyOf)))
    check(`mall ${label} ${key} workspace: union of blocks`, isDeepStrictEqual(got, want), { got: [...got], want: [...want] })
    const shortcutRows = ws.blocks.filter((b) => b.type === 'shortcut')
    check(`mall ${label} ${key} workspace: one shortcut row`, shortcutRows.length <= 1)
    const shortcutHrefs = new Set(segs.flatMap((t) => getDefaultWorkspace(key, t)!.blocks.flatMap((b) => (b.type === 'shortcut' ? b.data.shortcuts.map((s) => s.href) : []))))
    const gotShortcuts = shortcutRows.flatMap((b) => (b.type === 'shortcut' ? b.data.shortcuts.map((s) => s.href) : []))
    check(`mall ${label} ${key} workspace: shortcuts merged`, gotShortcuts.length === shortcutHrefs.size && gotShortcuts.every((h) => shortcutHrefs.has(h)))
  }
}

// Restaurant inside a mall: the module, its menu links and the restaurant till
const foodMall = mall(['supermarket', 'restaurant'])
const restaurantTab = MODULE_TABS.find((t) => t.key === 'restaurant')!
check('mall with restaurant shows the Restaurant module', isModuleTabVisible(restaurantTab, foodMall, 'owner'))
check('mall without restaurant hides it', !isModuleTabVisible(restaurantTab, mall(['supermarket', 'textile']), 'owner'))
check('mall with restaurant: Orders in Selling', hrefs(getModuleSidebar('selling', foodMall, 'owner')).includes('/restaurant/orders'))
check('mall with restaurant: restaurant reports', hrefs(getModuleSidebar('reports', foodMall, 'owner')).includes('/accounting/reports/table-turnover'))
check('food-court counter works as the restaurant till', tillBusinessType(foodMall, 'restaurant') === 'restaurant')
check('grocery counter works as the supermarket till', tillBusinessType(foodMall, 'supermarket') === 'supermarket')
check('general counter works as the primary type', tillBusinessType(foodMall, null) === 'supermarket')
check('counter set to a type the mall does not run falls back', tillBusinessType(foodMall, 'pharmacy') === 'supermarket')
// A mall running auto service + dealership keeps work orders in Auto Service
check('mall auto+dealer: /work-orders in auto-service', getModuleFromPathname('/c/x/work-orders', mall(['auto_service', 'dealership'])) === 'auto-service')
check('dealership-only mall: /work-orders in dealership', getModuleFromPathname('/c/x/work-orders', mall(['dealership'])) === 'dealership')
// 'mall' without segments runs the default segments
check('bare mall = supermarket + retail menus', isDeepStrictEqual(getModuleSidebar('stock', 'mall', 'owner'), getModuleSidebar('stock', mall(['supermarket', 'retail']), 'owner')))

console.log(`\nO2 mall menus: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
