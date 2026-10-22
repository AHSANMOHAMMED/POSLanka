// Pure tax-template maths (no React Native imports, so scripts/tests can run it with tsx).
// Port of the server's src/lib/utils/tax-template.ts; re-exported by ./tax.
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
  // amount payable for the line: the entered amount (incl. any inclusive tax) + exclusive tax
  const totalAmount = roundCurrency(amount + exclusiveTax)
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
  /**
   * Tax added on top of the item prices (exclusive components only). The amount payable is
   * subtotal + exclusiveTax — inclusive components are already inside the prices. A cart that
   * mixes inclusive and exclusive templates must still add the exclusive part.
   */
  exclusiveTax: number
  perLine: ItemTaxResult[]
}

/** Computes document tax exactly like the web POS: item template -> default -> none. */
export function calculateCartTax(lines: CartTaxLine[], config: TaxConfig, taxExempt = false): CartTaxResult {
  if (taxExempt || config.unavailable || lines.length === 0) {
    return { tax: 0, breakdown: [], hasInclusiveTax: false, exclusiveTax: 0, perLine: lines.map((l) => calculateItemTax(l.lineTotal, null)) }
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
  const exclusiveTax = roundCurrency(breakdown.filter((b) => !b.includedInPrice).reduce((s, b) => s + b.amount, 0))
  return { tax: roundCurrency(total), breakdown, hasInclusiveTax: breakdown.some((b) => b.includedInPrice), exclusiveTax, perLine }
}
