// Port of the server's tax-template maths (src/lib/utils/tax-template.ts) so the
// mobile POS sends a `tax` that matches what POST /api/sales recomputes.
// Tax templates need the `viewAccounting` permission; cashiers get 403 and fall
// back to zero tax (same behaviour as the web POS for that role).
import { apiGet } from './api'
import { getBundle, type OfflineBundle } from './localdb'

import {
  EMPTY_TAX_CONFIG,
  type TaxConfig,
  type TaxTemplate,
} from './taxMath'

export * from './taxMath'

function buildTaxConfig(list: any[], defaultId: string | null | undefined): TaxConfig {
  const templates = new Map<string, TaxTemplate>()
  for (const t of list) {
    if (!t || t.isActive === false) continue
    templates.set(t.id, {
      id: t.id,
      name: t.name,
      items: (t.items || []).map((i: any) => ({
        taxName: i.taxName,
        rate: Number(i.rate) || 0,
        accountId: i.accountId ?? null,
        includedInPrice: Boolean(i.includedInPrice),
      })),
    })
  }

  let defaultTemplate: TaxTemplate | null = null
  if (defaultId && templates.has(defaultId)) defaultTemplate = templates.get(defaultId)!

  return { templates, defaultTemplate, unavailable: false }
}

/** Tax config from the offline bundle (GET /api/pos/offline-bundle, cached on the device). */
export function taxConfigFromBundle(bundle: OfflineBundle | null | undefined): TaxConfig | null {
  if (!bundle || bundle.complete === false || !Array.isArray(bundle.taxTemplates)) return null
  return buildTaxConfig(bundle.taxTemplates, bundle.accountingSettings?.defaultTaxTemplateId)
}

/**
 * Tax templates for the POS. Prefers the given / cached offline bundle (available to cashiers and
 * persisted on the device, so offline sales compute the same tax the server expects); falls back
 * to the accounting endpoints (viewAccounting) when no bundle exists.
 */
export async function loadTaxConfig(bundle?: OfflineBundle | null): Promise<TaxConfig> {
  const fromBundle = taxConfigFromBundle(bundle !== undefined ? bundle : await getBundle())
  if (fromBundle) return fromBundle
  const [ttRes, settingsRes] = await Promise.all([
    apiGet<any>('/api/accounting/tax-templates?all=true'),
    apiGet<any>('/api/accounting/settings'),
  ])
  if (!ttRes.ok) return EMPTY_TAX_CONFIG
  const list: any[] = Array.isArray(ttRes.data) ? ttRes.data : ttRes.data?.data || []
  return buildTaxConfig(list, settingsRes.ok ? settingsRes.data?.defaultTaxTemplateId : null)
}

