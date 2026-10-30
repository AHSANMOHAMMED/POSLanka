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
import {
  DEFAULT_FOOTER_LINE,
  DEFAULT_RECEIPT_SETTINGS,
  POWERED_BY_LINE,
  type InvoiceCodeType,
  type ReceiptAlign,
  type ReceiptFontSize,
  type ReceiptItemLayout,
  type ReceiptItemSeparator,
  type ReceiptFont,
  type ReceiptTextWeight,
  type ReceiptSettings,
} from './receipt-settings'
import { buildInvoiceVerifyUrl } from './invoice-verify'
import { conversionText, unitShortName } from '@/lib/units/conversions'

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
  barcode?: string | null
  item?: { sku?: string | null; unit?: string | null; barcode?: string | null } | null
  /** Line VAT (sale_items.tax_amount / tax_rate) — printed per line on tax invoices. */
  taxAmount?: Num
  taxRate?: Num
  /** H5: unit sold (sale_items.uom) and promotions applied (sale_items.promotions; cart = share of a bill promotion) */
  uom?: string | null
  /** base units per 1 uom (sale_items.uom_factor): prints "1.5 yd = 1.3716 m" under the line */
  uomFactor?: Num | null
  promotions?: Array<{ label: string; amount: Num; cart?: boolean }> | null
  /** 0179: warranty captured at sale time (sale_items.warranty_months / warranty_until). */
  warrantyMonths?: number | null
  warrantyUntil?: string | null
}

export interface ReceiptCustomerSource {
  name?: string | null
  phone?: string | null
  /** Buyer TIN / VAT number (customers.tax_id). */
  taxId?: string | null
  address?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
}

export interface ReceiptSaleSource {
  invoiceNo: string
  createdAt: string | Date
  customerName?: string | null
  customerPhone?: string | null
  customer?: ReceiptCustomerSource | null
  /** Buyer VAT number when the caller has it but not the customer record. */
  customerTaxId?: string | null
  isReturn?: boolean | null
  /** Return: the original sale id (GET /api/sales/[id] returnAgainst). */
  returnAgainst?: string | null
  /** Return: the original invoice number (credit notes must reference it). */
  originalInvoiceNo?: string | null
  subtotal: Num
  discountAmount?: Num
  taxAmount?: Num
  taxBreakdown?: unknown
  total: Num
  /** H5: cart-level promotions (part of discountAmount) */
  promotionDiscount?: Num
  paidAmount?: Num
  changeAmount?: Num
  loyaltyPointsEarned?: Num
  items?: ReceiptSaleItemSource[]
  payments?: { method: string; amount: Num; reference?: string | null; voidedAt?: string | null }[]
}

export interface ReceiptModelLine {
  name: string
  sku: string | null
  /** Item barcode (printed when showItemBarcode is on). */
  barcode: string | null
  qty: number
  qtyText: string
  unit: string | null
  unitPrice: number
  total: number
  discount: number
  notes: string[]
  /** Tax invoices only: line VAT rate (%) and amount. */
  vatRate: number | null
  vatAmount: number | null
}

/** Sri Lanka tax invoice / credit note particulars (VAT Act s.26), present when the seller is VAT-registered and the sale carries VAT. */
export interface ReceiptTaxInvoice {
  kind: 'tax_invoice' | 'credit_note'
  supplierVatNo: string
  buyer: { name: string; address: string | null; vatNo: string | null } | null
  originalInvoiceNo: string | null
  totalExclVat: number
  totalVat: number
  totalInclVat: number
}

export interface ReceiptAmountRow {
  label: string
  amount: number
  /** Show with a leading minus. */
  negative?: boolean
}

/** Tear-off coupon printed under the receipt (offers / lucky draw). */
export interface ReceiptCoupon {
  title: string
  text: string | null
  invoiceNo: string
  date: string
  amount: number
  name: string | null
  phone: string | null
  address: string | null
}

export interface ReceiptModel {
  business: {
    name: string
    /** Extra lines under the name, already filtered by the settings toggles. */
    lines: string[]
  }
  logo: { show: boolean; widthPct: number; url: string | null; align: ReceiptAlign }
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
  /** value = invoice number (barcode); qrValue = invoice number or the verification URL (QR). */
  invoiceCode: { type: InvoiceCodeType; value: string; qrValue: string }
  fontSize: ReceiptFontSize
  showItemSku: boolean
  showItemBarcode: boolean
  itemLayout: ReceiptItemLayout
  itemSeparator: ReceiptItemSeparator
  fontFamily: ReceiptFont
  textWeight: ReceiptTextWeight
  textColor: string
  /** Tear-off offer coupon (null = not printed on this bill). Customer fields are null when unknown (blank lines). */
  coupon: ReceiptCoupon | null
  /** Small last line ("Powered by skyERPOS") or null. */
  poweredBy: string | null
  decimals: number
  invoiceNo: string
  isReturn: boolean
  taxInvoice: ReceiptTaxInvoice | null
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
  /**
   * Public verification page base (e.g. https://app.example.com). With the
   * Business ID it makes the QR carry the verification URL when the settings
   * ask for it (qrContent = verify_url). Offline (OFF-) receipts keep the number.
   */
  verifyBaseUrl?: string | null
  businessId?: string | null
}

/** Body font size (px) of HTML receipts: one scale for every renderer (web + mobile HTML). */
export const RECEIPT_FONT_PX: Record<58 | 80, Record<ReceiptFontSize, number>> = {
  58: { small: 9, normal: 10, large: 12 },
  80: { small: 10, normal: 11, large: 13 },
}

export const num = (v: Num): number => {
  const n = typeof v === 'string' ? parseFloat(v) : v ?? 0
  return Number.isFinite(n) ? (n as number) : 0
}

export function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

/** 18 → "18", 2.5 → "2.5". */
export function formatRate(rate: number | null | undefined): string {
  const r = Number(rate) || 0
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
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
    logo: { show: s.showLogo && !!tenant.logoUrl, widthPct: s.logoWidthPct, url: tenant.logoUrl || null, align: s.logoAlign || 'center' },
  }
}

/**
 * VAT rate of a sale line: the stored rate, else the rates of its tax breakdown, else derived from
 * the line VAT and value (server-computed lines store tax_rate 0).
 */
/** "Warranty: 12 months (until 27/10/2027)" for a line sold with a warranty (0179). */
export function warrantyNote(it: Pick<ReceiptSaleItemSource, 'warrantyMonths' | 'warrantyUntil'>): string[] {
  const months = Number(it.warrantyMonths) || 0
  if (months <= 0) return []
  const label = months === 1 ? '1 month' : `${months} months`
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(it.warrantyUntil || '')
  return [`Warranty: ${label}${m ? ` (until ${m[3]}/${m[2]}/${m[1]})` : ''}`]
}

function lineVatRate(it: ReceiptSaleItemSource & { taxBreakdown?: unknown }, taxInclusive: boolean): number {
  const stored = num(it.taxRate)
  if (stored > 0) return stored
  const bd = Array.isArray(it.taxBreakdown) ? (it.taxBreakdown as Array<{ rate?: Num; amount?: Num }>) : []
  const fromBd = bd.filter((b) => num(b.amount) !== 0).reduce((s, b) => s + num(b.rate), 0)
  if (fromBd > 0) return fromBd
  const vat = Math.abs(num(it.taxAmount))
  const value = Math.abs(num(it.total))
  const base = taxInclusive ? value - vat : value
  if (!(vat > 0) || !(base > 0)) return 0
  const r = (vat / base) * 100
  return Math.abs(r - Math.round(r)) < 0.05 ? Math.round(r) : Math.round(r * 100) / 100
}

function customerAddress(c: ReceiptCustomerSource | null | undefined): string | null {
  if (!c) return null
  return clean(c.address) || [c.addressLine1, c.addressLine2, c.city].map(clean).filter(Boolean).join(', ') || null
}

export function buildReceiptModel(args: BuildReceiptModelArgs): ReceiptModel {
  const { sale, tenant } = args
  const s: ReceiptSettings = args.settings || DEFAULT_RECEIPT_SETTINGS
  const { name, lines, logo } = buildBusinessBlock(tenant, s)

  // Tax invoice: VAT-registered seller and VAT charged on this document
  const supplierVatNo = clean(tenant.taxId)
  const vatAmount = num(sale.taxAmount)
  const isTaxInvoice = !!supplierVatNo && Math.abs(vatAmount) >= 0.005
  if (isTaxInvoice) {
    // Statutory particulars print whatever the receipt toggles say
    const addr = clean(tenant.address)
    if (addr && !lines.includes(addr)) lines.splice(lines[0] === clean(tenant.legalName) ? 1 : 0, 0, addr)
    const vatLine = lines.findIndex((l) => l.startsWith('VAT/TIN: '))
    if (vatLine >= 0) lines[vatLine] = `VAT Reg No: ${supplierVatNo}`
    else lines.push(`VAT Reg No: ${supplierVatNo}`)
  }

  const created = sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt)
  const dateText = Number.isNaN(created.getTime())
    ? String(sale.createdAt)
    : args.formatDate
      ? args.formatDate(created)
      : created.toLocaleString()

  const originalInvoiceNo = clean(sale.originalInvoiceNo) || null
  const meta: ReceiptModel['meta'] = [
    {
      label: isTaxInvoice ? (sale.isReturn ? 'Credit Note No' : 'Invoice No') : sale.isReturn ? 'Return' : 'Receipt',
      value: sale.invoiceNo,
    },
    { label: 'Date', value: dateText },
  ]
  if (sale.isReturn && originalInvoiceNo) meta.push({ label: isTaxInvoice ? 'Against Invoice' : 'Original', value: originalInvoiceNo })
  if (s.showCounter && clean(args.counter)) meta.push({ label: 'Counter', value: clean(args.counter) })
  if (s.showCashier && clean(args.cashier)) meta.push({ label: 'Cashier', value: clean(args.cashier) })
  const custName = clean(sale.customerName) || clean(sale.customer?.name)
  const custPhone = clean(sale.customerPhone) || clean(sale.customer?.phone)
  const buyerVatNo = clean(sale.customerTaxId) || clean(sale.customer?.taxId) || null
  const buyerAddress = customerAddress(sale.customer)
  if (isTaxInvoice && custName) {
    meta.push({ label: 'Buyer', value: custName })
    if (buyerAddress) meta.push({ label: 'Address', value: buyerAddress })
    if (buyerVatNo) meta.push({ label: 'Buyer VAT No', value: buyerVatNo })
    if (s.showCustomer && custPhone) meta.push({ label: 'Phone', value: custPhone })
  } else if (s.showCustomer && custName) {
    meta.push({ label: 'Customer', value: custName })
    if (custPhone) meta.push({ label: 'Phone', value: custPhone })
  }

  const items: ReceiptModelLine[] = (sale.items || []).map((it, idx) => {
    const qty = num(it.quantity)
    return {
      name: it.itemName,
      sku: clean(it.sku ?? it.item?.sku) || null,
      barcode: clean(it.barcode ?? it.item?.barcode) || null,
      qty,
      qtyText: formatQty(qty),
      unit: it.uom ? unitShortName(it.uom) : (it.unit ?? null),
      unitPrice: num(it.unitPrice),
      total: num(it.total),
      // manual line discount only: the line's promotions print as notes below
      discount: Math.max(0, Math.round((num(it.discount) - (it.promotions || []).filter((p) => !p.cart).reduce((t, p) => t + num(p.amount), 0)) * 100) / 100),
      // H5: line promotions print under the line (the bill promotion share prints in the totals)
      notes: [
        ...(args.lineNotes?.[idx] || []),
        ...(() => {
          const c = it.uom && it.uomFactor != null ? conversionText(qty, it.uom, num(it.uomFactor), it.item?.unit ?? it.unit ?? null) : null
          return c ? [c] : []
        })(),
        ...(s.showWarranty !== false ? warrantyNote(it) : []),
        ...((it.promotions || []).filter((p) => !p.cart && num(p.amount) > 0).map((p) => `${p.label} -${num(p.amount).toFixed(2)}`)),
      ],
      vatRate: isTaxInvoice ? lineVatRate(it, !!tenant.taxInclusive) : null,
      vatAmount: isTaxInvoice ? num(it.taxAmount) : null,
    }
  })

  const taxInclusive = !!tenant.taxInclusive
  const totals: ReceiptAmountRow[] = [{ label: 'Subtotal', amount: num(sale.subtotal) }]
  const disc = num(sale.discountAmount)
  const promo = Math.min(disc, num(sale.promotionDiscount))
  if (promo > 0) totals.push({ label: 'Promotions', amount: promo, negative: true })
  if (disc - promo > 0.004) totals.push({ label: 'Discount', amount: Math.round((disc - promo) * 100) / 100, negative: true })
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
    title: isTaxInvoice ? (sale.isReturn ? 'CREDIT NOTE' : 'TAX INVOICE') : sale.isReturn ? '*** RETURN ***' : null,
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
    invoiceCode: { type: s.invoiceCode, value: sale.invoiceNo, qrValue: qrValueFor(sale, s, args) },
    fontSize: s.fontSize,
    showItemSku: s.showItemSku,
    showItemBarcode: s.showItemBarcode,
    itemLayout: s.itemLayout,
    itemSeparator: s.itemSeparator,
    fontFamily: s.fontFamily,
    textWeight: s.textWeight,
    textColor: s.textColor,
    coupon:
      s.couponEnabled && !sale.isReturn && total >= (s.couponMinTotal || 0)
        ? {
            title: clean(s.couponTitle) || 'COUPON',
            text: clean(s.couponText) || null,
            invoiceNo: sale.invoiceNo,
            date: dateText,
            amount: total,
            name: custName || null,
            phone: custPhone || null,
            address: customerAddress(sale.customer) || null,
          }
        : null,
    poweredBy: s.showPoweredBy ? POWERED_BY_LINE : null,
    decimals: args.decimals ?? 2,
    invoiceNo: sale.invoiceNo,
    isReturn: !!sale.isReturn,
    taxInvoice: isTaxInvoice
      ? {
          kind: sale.isReturn ? 'credit_note' : 'tax_invoice',
          supplierVatNo,
          buyer: custName ? { name: custName, address: buyerAddress, vatNo: buyerVatNo } : null,
          originalInvoiceNo,
          totalExclVat: Math.round((total - vatAmount) * 100) / 100,
          totalVat: vatAmount,
          totalInclVat: total,
        }
      : null,
  }
}

function qrValueFor(sale: ReceiptSaleSource, s: ReceiptSettings, args: BuildReceiptModelArgs): string {
  if (s.qrContent !== 'verify_url' || !args.verifyBaseUrl || !args.businessId) return sale.invoiceNo
  if (/^OFF-/i.test(sale.invoiceNo)) return sale.invoiceNo // not on the server yet
  return buildInvoiceVerifyUrl(args.verifyBaseUrl, args.businessId, sale.invoiceNo, num(sale.total))
}

/** Sample VAT tax invoice (registered seller, B2B buyer) for previews and tests. */
export const SAMPLE_TAX_INVOICE_SALE: ReceiptSaleSource = {
  invoiceNo: 'INV-000124',
  createdAt: '2026-01-15T10:30:00.000Z',
  customerName: 'Lanka Traders (Pvt) Ltd',
  customer: { name: 'Lanka Traders (Pvt) Ltd', taxId: '114567890-7000', address: '12 Main St, Kandy' },
  subtotal: 2000,
  discountAmount: 0,
  taxAmount: 360,
  taxBreakdown: [{ taxName: 'VAT', rate: 18, amount: 360 }],
  total: 2360,
  paidAmount: 2360,
  items: [
    { itemName: 'Office Chair', quantity: 1, unitPrice: 1500, total: 1500, taxRate: 18, taxAmount: 270 },
    { itemName: 'A4 Paper Ream', quantity: 2, unitPrice: 250, total: 500, taxRate: 18, taxAmount: 90 },
  ],
  payments: [{ method: 'bank_transfer', amount: 2360 }],
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
