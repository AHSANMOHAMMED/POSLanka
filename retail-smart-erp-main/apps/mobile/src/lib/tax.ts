// Port of the server's tax-template maths (src/lib/utils/tax-template.ts) so the
// mobile POS sends a `tax` that matches what POST /api/sales recomputes.
// Tax templates need the `viewAccounting` permission; cashiers get 403 and fall
// back to zero tax (same behaviour as the web POS for that role).
import { apiGet } from './api'
import { getBundle, type OfflineBundle } from './localdb'

export interface TaxTemplateItem {
  taxName: string
  rate: number
  accountId: string | null
  includedInPrice: boolean
}

export interface TaxTemplate {
  id: string
  name: string
  items: TaxTemplateItem[]
}

export interface TaxBreakdownItem {
  taxName: string
  rate: number
  amount: number
  accountId: string | null
  includedInPrice: boolean
}

export interface TaxConfig {
  templates: Map<string, TaxTemplate>
  defaultTemplate: TaxTemplate | null
  /** True when templates could not be loaded (e.g. 403 for cashiers). */
  unavailable: boolean
}

export const EMPTY_TAX_CONFIG: TaxConfig = { templates: new Map(), defaultTemplate: null, unavailable: true }

export function roundCurrency(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

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

export interface ItemTaxResult {
  baseAmount: number
  totalTax: number
  totalAmount: number
  breakdown: TaxBreakdownItem[]
  effectiveRate: number
}

export function calculateItemTax(amount: number, template: TaxTemplate | null, taxExempt = false): ItemTaxResult {
  if (!template || taxExempt || template.items.length === 0 || amount === 0) {
    return { baseAmount: roundCurrency(amount), totalTax: 0, totalAmount: roundCurrency(amount), breakdown: [], effectiveRate: 0 }
  }
  const inclusive = template.items.filter((i) => i.includedInPrice)
  const exclusive = template.items.filter((i) => !i.includedInPrice)
  const breakdown: TaxBreakdownItem[] = []
  let totalTax = 0

  const inclusiveRateSum = inclusive.reduce((s, i) => s + i.rate, 0)
  let baseAmount: number
  if (inclusiveRateSum > 0) {
    baseAmount = amount / (1 + inclusiveRateSum / 100)
    const totalInclusiveTax = amount - baseAmount
    for (const item of inclusive) {
      const taxAmount = roundCurrency(totalInclusiveTax * (item.rate / inclusiveRateSum))
      breakdown.push({ taxName: item.taxName, rate: item.rate, amount: taxAmount, accountId: item.accountId, includedInPrice: true })
      totalTax += taxAmount
    }
  } else {
    baseAmount = amount
  }

  for (const item of exclusive) {
    const taxAmount = roundCurrency((baseAmount * item.rate) / 100)
    breakdown.push({ taxName: item.taxName, rate: item.rate, amount: taxAmount, accountId: item.accountId, includedInPrice: false })
    totalTax += taxAmount
  }

  totalTax = roundCurrency(totalTax)
  const exclusiveTax = roundCurrency(breakdown.filter((b) => !b.includedInPrice).reduce((s, b) => s + b.amount, 0))
  const totalAmount = roundCurrency(baseAmount + exclusiveTax)
  const effectiveRate = baseAmount > 0 ? roundCurrency((totalTax / baseAmount) * 100) : 0
  return { baseAmount: roundCurrency(baseAmount), totalTax, totalAmount, breakdown, effectiveRate }
}

export function aggregateTaxBreakdown(all: TaxBreakdownItem[][]): TaxBreakdownItem[] {
  const map = new Map<string, TaxBreakdownItem>()
  for (const list of all) {
    for (const b of list) {
      const key = `${b.taxName}|${b.rate}|${b.includedInPrice}`
      const existing = map.get(key)
      if (existing) existing.amount = roundCurrency(existing.amount + b.amount)
      else map.set(key, { ...b })
    }
  }
  return Array.from(map.values())
}

export interface CartTaxLine {
  lineTotal: number
  taxTemplateId?: string | null
}

export interface CartTaxResult {
  tax: number
  breakdown: TaxBreakdownItem[]
  hasInclusiveTax: boolean
  perLine: ItemTaxResult[]
}

/** Computes document tax exactly like the web POS: item template -> default -> none. */
export function calculateCartTax(lines: CartTaxLine[], config: TaxConfig, taxExempt = false): CartTaxResult {
  if (taxExempt || config.unavailable || lines.length === 0) {
    return { tax: 0, breakdown: [], hasInclusiveTax: false, perLine: lines.map((l) => calculateItemTax(l.lineTotal, null)) }
  }
  const perLine: ItemTaxResult[] = []
  const all: TaxBreakdownItem[][] = []
  let total = 0
  for (const line of lines) {
    const template = line.taxTemplateId
      ? config.templates.get(line.taxTemplateId) || config.defaultTemplate
      : config.defaultTemplate
    const r = calculateItemTax(line.lineTotal, template, false)
    perLine.push(r)
    total += r.totalTax
    if (r.breakdown.length) all.push(r.breakdown)
  }
  const breakdown = aggregateTaxBreakdown(all)
  return { tax: roundCurrency(total), breakdown, hasInclusiveTax: breakdown.some((b) => b.includedInPrice), perLine }
}
