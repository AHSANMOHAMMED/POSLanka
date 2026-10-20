/**
 * Shared, renderer-agnostic receipt model (W7).
 *
 * `buildReceiptModel()` turns a sale (as returned by GET /api/sales/[id]) plus
 * the tenant business profile and the effective receipt settings into a
 * normalized structure. Every web renderer consumes this model:
 *   - ESC/POS bytes:   buildReceiptEscPosFromModel()  (src/lib/print/escpos/receipt-from-model.ts)
 *   - HTML / browser:  renderReceiptHtml()             (src/lib/print/receipt-html.ts)
 *
 * Pure module: no DOM, no server imports.
 */
import { DEFAULT_FOOTER_LINE, DEFAULT_RECEIPT_SETTINGS, type InvoiceCodeType, type ReceiptSettings } from './receipt-settings'

type Num = string | number | null | undefined

export interface ReceiptTenantInfo {
  name?: string | null
  legalName?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  taxId?: string | null
  brn?: string | null
  currency?: string | null
  taxInclusive?: boolean | null
  logoUrl?: string | null
}

export interface ReceiptSaleItemSource {
  itemName: string
  quantity: Num
  unitPrice: Num
  total: Num
  discount?: Num
  unit?: string | null
  sku?: string | null
  item?: { sku?: string | null; unit?: string | null } | null
}

export interface ReceiptSaleSource {
  invoiceNo: string
  createdAt: string | Date
  customerName?: string | null
  customerPhone?: string | null
  customer?: { name?: string | null; phone?: string | null } | null
  isReturn?: boolean | null
  subtotal: Num
  discountAmount?: Num
  taxAmount?: Num
  taxBreakdown?: unknown
  total: Num
  paidAmount?: Num
  changeAmount?: Num
  loyaltyPointsEarned?: Num
  items?: ReceiptSaleItemSource[]
  payments?: { method: string; amount: Num; reference?: string | null; voidedAt?: string | null }[]
}

export interface ReceiptModelLine {
  name: string
  sku: string | null
  qty: number
  qtyText: string
  unit: string | null
  unitPrice: number
  total: number
  discount: number
  notes: string[]
}

export interface ReceiptAmountRow {
  label: string
  amount: number
  /** Show with a leading minus. */
  negative?: boolean
}

export interface ReceiptModel {
  business: {
    name: string
    /** Extra lines under the name, already filtered by the settings toggles. */
    lines: string[]
  }
  logo: { show: boolean; widthPct: number; url: string | null }
  headerLines: string[]
  /** e.g. "*** RETURN ***" */
  title: string | null
  copyLabel: string | null
  meta: { label: string; value: string }[]
  items: ReceiptModelLine[]
  totals: ReceiptAmountRow[]
  total: number
  currency: string | null
  payments: ReceiptAmountRow[]
  change: number | null
  extras: { label: string; value: string }[]
  footerLines: string[]
  returnPolicy: string | null
  invoiceCode: { type: InvoiceCodeType; value: string }
  fontSize: 'normal' | 'large'
  showItemSku: boolean
  decimals: number
  invoiceNo: string
  isReturn: boolean
}

export interface BuildReceiptModelArgs {
  sale: ReceiptSaleSource
  tenant: ReceiptTenantInfo
  settings?: ReceiptSettings | null
  cashier?: string | null
  counter?: string | null
  copyLabel?: string | null
  /** Extra per-line notes keyed by item index (serial numbers, modifiers). */
  lineNotes?: Record<number, string[]>
  /** Override date formatting (defaults to toLocaleString()). */
  formatDate?: (d: Date) => string
  decimals?: number
}

export const num = (v: Num): number => {
  const n = typeof v === 'string' ? parseFloat(v) : v ?? 0
  return Number.isFinite(n) ? (n as number) : 0
}

export function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function paymentMethodLabel(method: string): string {
  const map: Record<string, string> = {
    cash: 'Cash',
    card: 'Card',
    credit: 'Credit',
    bank_transfer: 'Bank Transfer',
    mobile: 'Mobile',
    cheque: 'Cheque',
    gift_card: 'Gift Card',
    loyalty: 'Loyalty Points',
    other: 'Other',
  }
  return map[method] || method.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function taxRows(sale: ReceiptSaleSource, taxInclusive: boolean): ReceiptAmountRow[] {
  const tb = sale.taxBreakdown
  if (Array.isArray(tb) && tb.length > 0) {
    const rows = tb
      .map((t) => {
        const o = t as { taxName?: string; name?: string; amount?: Num; rate?: number }
        const name = o.taxName || o.name || 'Tax'
        const label = o.rate != null ? `${name} ${o.rate}%` : name
        return { label: taxInclusive ? `${label} (incl.)` : label, amount: num(o.amount) }
      })
      .filter((t) => t.amount !== 0)
    if (rows.length > 0) return rows
  }
  const tax = num(sale.taxAmount)
  return tax !== 0 ? [{ label: taxInclusive ? 'Tax (incl.)' : 'Tax', amount: tax }] : []
}

const clean = (s: string | null | undefined) => (s || '').trim()

/**
 * Business header block shared by receipts and the Z report: name plus the
 * lines under it (legal name, address, phone, email, website, VAT/TIN, BRN),
 * filtered by the receipt settings toggles, and the logo flag.
 */
export function buildBusinessBlock(
  tenant: ReceiptTenantInfo,
  settings?: ReceiptSettings | null
): { name: string; lines: string[]; logo: ReceiptModel['logo'] } {
  const s: ReceiptSettings = settings || DEFAULT_RECEIPT_SETTINGS
  const name = clean(tenant.name) || 'Business'
  const lines: string[] = []
  const legal = clean(tenant.legalName)
  if (s.showLegalName && legal && legal.toLowerCase() !== name.toLowerCase()) lines.push(legal)
  if (s.showAddress && clean(tenant.address)) lines.push(clean(tenant.address))
  if (s.showPhone && clean(tenant.phone)) lines.push(`Tel: ${clean(tenant.phone)}`)
  if (s.showEmail && clean(tenant.email)) lines.push(clean(tenant.email))
  if (s.showWebsite && clean(tenant.website)) lines.push(clean(tenant.website))
  if (s.showTaxId && clean(tenant.taxId)) lines.push(`VAT/TIN: ${clean(tenant.taxId)}`)
  if (s.showBrn && clean(tenant.brn)) lines.push(`BRN: ${clean(tenant.brn)}`)
  return {
    name,
    lines,
    logo: { show: s.showLogo && !!tenant.logoUrl, widthPct: s.logoWidthPct, url: tenant.logoUrl || null },
  }
}

export function buildReceiptModel(args: BuildReceiptModelArgs): ReceiptModel {
  const { sale, tenant } = args
  const s: ReceiptSettings = args.settings || DEFAULT_RECEIPT_SETTINGS
  const { name, lines, logo } = buildBusinessBlock(tenant, s)

  const created = sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt)
  const dateText = Number.isNaN(created.getTime())
    ? String(sale.createdAt)
    : args.formatDate
      ? args.formatDate(created)
      : created.toLocaleString()

  const meta: ReceiptModel['meta'] = [
    { label: sale.isReturn ? 'Return' : 'Receipt', value: sale.invoiceNo },
    { label: 'Date', value: dateText },
  ]
  if (s.showCounter && clean(args.counter)) meta.push({ label: 'Counter', value: clean(args.counter) })
  if (s.showCashier && clean(args.cashier)) meta.push({ label: 'Cashier', value: clean(args.cashier) })
  const custName = clean(sale.customerName) || clean(sale.customer?.name)
  const custPhone = clean(sale.customerPhone) || clean(sale.customer?.phone)
  if (s.showCustomer && custName) {
    meta.push({ label: 'Customer', value: custName })
    if (custPhone) meta.push({ label: 'Phone', value: custPhone })
  }

  const items: ReceiptModelLine[] = (sale.items || []).map((it, idx) => {
    const qty = num(it.quantity)
    return {
      name: it.itemName,
      sku: clean(it.sku ?? it.item?.sku) || null,
      qty,
      qtyText: formatQty(qty),
      unit: it.unit ?? null,
      unitPrice: num(it.unitPrice),
      total: num(it.total),
      discount: num(it.discount),
      notes: args.lineNotes?.[idx] || [],
    }
  })

  const taxInclusive = !!tenant.taxInclusive
  const totals: ReceiptAmountRow[] = [{ label: 'Subtotal', amount: num(sale.subtotal) }]
  const disc = num(sale.discountAmount)
  if (disc > 0) totals.push({ label: 'Discount', amount: disc, negative: true })
  totals.push(...taxRows(sale, taxInclusive))

  const total = num(sale.total)
  const payments: ReceiptAmountRow[] = (sale.payments || [])
    .filter((p) => !p.voidedAt)
    .map((p) => ({
      label: `${paymentMethodLabel(p.method)}${p.reference ? ` (${p.reference})` : ''}`,
      amount: num(p.amount),
    }))
  const paid = num(sale.paidAmount)
  const change = sale.changeAmount != null ? num(sale.changeAmount) : paid > total ? paid - total : 0

  const extras: ReceiptModel['extras'] = []
  const pts = num(sale.loyaltyPointsEarned)
  if (pts > 0) extras.push({ label: 'Points earned', value: String(pts) })

  const footerLines = s.footerLines.length > 0 ? s.footerLines : [DEFAULT_FOOTER_LINE]

  return {
    business: { name, lines },
    logo,
    headerLines: s.headerLines,
    title: sale.isReturn ? '*** RETURN ***' : null,
    copyLabel: args.copyLabel || null,
    meta,
    items,
    totals,
    total,
    currency: tenant.currency || null,
    payments,
    change: change > 0 ? change : null,
    extras,
    footerLines,
    returnPolicy: clean(s.returnPolicy) || null,
    invoiceCode: { type: s.invoiceCode, value: sale.invoiceNo },
    fontSize: s.fontSize,
    showItemSku: s.showItemSku,
    decimals: args.decimals ?? 2,
    invoiceNo: sale.invoiceNo,
    isReturn: !!sale.isReturn,
  }
}

/** Sample sale used by the settings live preview and tests. */
export const SAMPLE_RECEIPT_SALE: ReceiptSaleSource = {
  invoiceNo: 'INV-000123',
  createdAt: '2026-01-15T10:30:00.000Z',
  customerName: 'Nimal Perera',
  customerPhone: '077 123 4567',
  subtotal: 3450,
  discountAmount: 50,
  taxAmount: 0,
  total: 3400,
  paidAmount: 5000,
  changeAmount: 1600,
  items: [
    { itemName: 'Basmathi Rice 5kg', quantity: 2, unitPrice: 1500, total: 3000, sku: 'RICE-5KG' },
    { itemName: 'White Sugar', quantity: 1.5, unit: 'kg', unitPrice: 300, total: 450, discount: 0, sku: 'SUG-1KG' },
  ],
  payments: [{ method: 'cash', amount: 5000 }],
}
