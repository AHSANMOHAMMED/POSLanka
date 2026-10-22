// Turns server responses (POST /api/sales, shift close) into the printer's
// ReceiptInput / ZReportInput documents. Business details, receipt settings and
// the logo raster come from GET /api/tenant + GET /api/settings/logo/raster and
// are cached in memory and in a JSON file (documentDirectory) so receipts
// printed offline keep the logo, tax numbers and layout. Header/footer can be
// overridden per counter by the shift's POS profile.
import * as FileSystem from 'expo-file-system'
import { apiGet, getUser } from './api'
import type { InvoiceCodeType, ReceiptInput, ReceiptLine, ReceiptLogo, ReceiptPayment, ReceiptTaxInvoice, ZReportInput } from './escpos'
import { getPrinterSettings } from './printer'
import { shiftCounterName, type Shift } from './shift'

/** Subset of the web ReceiptSettings (src/lib/print/receipt-settings.ts). */
export interface ReceiptSettingsLite {
  showLogo: boolean
  logoWidthPct: number
  showLegalName: boolean
  showAddress: boolean
  showPhone: boolean
  showEmail: boolean
  showWebsite: boolean
  showTaxId: boolean
  showBrn: boolean
  headerLines: string[]
  footerLines: string[]
  returnPolicy: string
  invoiceCode: InvoiceCodeType
  showCashier: boolean
  showCounter: boolean
  showCustomer: boolean
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettingsLite = {
  showLogo: true,
  logoWidthPct: 60,
  showLegalName: true,
  showAddress: true,
  showPhone: true,
  showEmail: true,
  showWebsite: true,
  showTaxId: true,
  showBrn: true,
  headerLines: [],
  footerLines: [],
  returnPolicy: '',
  invoiceCode: 'both',
  showCashier: true,
  showCounter: true,
  showCustomer: true,
}

export interface BusinessInfo {
  name: string
  legalName?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  taxId?: string | null
  brn?: string | null
  logoUrl?: string | null
  /** Tenant currency code (GET /api/tenant `currency`, e.g. LKR). */
  currency?: string | null
  /** Tenant-level receipt settings (effective). */
  receiptSettings?: Partial<ReceiptSettingsLite> | null
  /** Logo raster for the configured paper width (+ PNG for HTML receipts). */
  logo?: ReceiptLogo | null
  /** Paper dot width the logo was rasterised for. */
  logoPaperDots?: number
  fetchedAt?: number
}

let cachedBusiness: BusinessInfo | null = null

async function cacheFile(): Promise<string> {
  const user = await getUser()
  const slug = (user?.tenantSlug || 'default').replace(/[^a-z0-9_-]/gi, '_')
  return `${FileSystem.documentDirectory || ''}poslanka-business-${slug}.json`
}

async function readCachedBusiness(): Promise<BusinessInfo | null> {
  try {
    const file = await cacheFile()
    const info = await FileSystem.getInfoAsync(file)
    if (!info.exists) return null
    return JSON.parse(await FileSystem.readAsStringAsync(file)) as BusinessInfo
  } catch {
    return null
  }
}

async function writeCachedBusiness(b: BusinessInfo): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(await cacheFile(), JSON.stringify(b))
  } catch {
    // cache is best effort
  }
}

interface TenantResponse {
  name?: string
  legalName?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  taxId?: string | null
  brn?: string | null
  logoUrl?: string | null
  currency?: string | null
  receiptSettings?: Partial<ReceiptSettingsLite> | null
}

/**
 * GET /api/tenant (+ logo raster). Online: refreshes the persistent cache.
 * Offline: returns the last cached copy, or the login's tenant name.
 */
export async function loadBusinessInfo(force = false): Promise<BusinessInfo> {
  if (cachedBusiness && !force) {
    // Re-rasterise when the printer's paper width changed since the logo was fetched.
    const dots = (await getPrinterSettings()).paperWidth === 80 ? 576 : 384
    if (!cachedBusiness.logo || cachedBusiness.logoPaperDots === dots) return cachedBusiness
  }
  const user = await getUser()
  const fallback: BusinessInfo = { name: user?.tenantName || 'POSLanka', address: null, phone: null }
  const previous = cachedBusiness || (await readCachedBusiness())

  const res = await apiGet<TenantResponse>('/api/tenant')
  if (res.ok && res.data) {
    const t = res.data
    const info: BusinessInfo = {
      name: t.name || fallback.name,
      legalName: t.legalName || null,
      address: t.address || null,
      phone: t.phone || null,
      email: t.email || null,
      website: t.website || null,
      taxId: t.taxId || null,
      brn: t.brn || null,
      logoUrl: t.logoUrl || null,
      currency: t.currency || null,
      receiptSettings: t.receiptSettings || null,
      logo: null,
      fetchedAt: Date.now(),
    }
    const settings = { ...DEFAULT_RECEIPT_SETTINGS, ...(info.receiptSettings || {}) }
    if (info.logoUrl && settings.showLogo !== false) {
      const paper = (await getPrinterSettings()).paperWidth
      const dots = paper === 80 ? 576 : 384
      const pct = Math.min(100, Math.max(40, Math.round(settings.logoWidthPct || 60)))
      const raster = await apiGet<{ width: number; height: number; data: string; pngBase64?: string }>(
        `/api/settings/logo/raster?width=${dots}&pct=${pct}`
      )
      if (raster.ok && raster.data?.data) {
        info.logo = { width: raster.data.width, height: raster.data.height, data: raster.data.data, pngBase64: raster.data.pngBase64 || null, widthPct: pct }
        info.logoPaperDots = dots
      } else if (raster.status === 0 && previous?.logo && previous.logoUrl === info.logoUrl) {
        // network blip: keep the previously cached logo
        info.logo = previous.logo
        info.logoPaperDots = previous.logoPaperDots
      }
    }
    cachedBusiness = info
    await writeCachedBusiness(info)
    return info
  }
  if (previous) {
    cachedBusiness = previous
    return previous
  }
  return fallback
}

export function clearBusinessInfoCache() {
  cachedBusiness = null
}

function textLines(text: string | null | undefined): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5)
}

/** defaults <- tenant settings <- POS profile legacy header/footer/showLogo <- POS profile overrides. */
export function resolveReceiptSettings(business: BusinessInfo, shift?: Shift | null): ReceiptSettingsLite {
  const profile = shift?.posProfile
  const legacy: Partial<ReceiptSettingsLite> = {}
  if (profile) {
    const h = textLines(profile.receiptHeader)
    const f = textLines(profile.receiptFooter)
    if (h.length) legacy.headerLines = h
    if (f.length) legacy.footerLines = f
    if (profile.showLogoOnReceipt === false) legacy.showLogo = false
  }
  const overrides = (profile?.receiptSettings || {}) as Partial<ReceiptSettingsLite>
  return { ...DEFAULT_RECEIPT_SETTINGS, ...(business.receiptSettings || {}), ...legacy, ...overrides }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return isNaN(n) ? 0 : n
}

/** Shape of the relevant parts of the POST /api/sales (and GET /api/sales rows) response. */
export interface SaleResponseLike {
  id?: string
  invoiceNo: string
  items?: Array<{
    itemName?: string; name?: string; quantity: string | number; unitPrice: string | number; total?: string | number; unit?: string | null; taxAmount?: string | number; taxRate?: string | number
    /** H5: unit sold and promotions applied (cart: share of a bill promotion) */
    uom?: string | null
    promotions?: Array<{ label: string; amount: string | number; cart?: boolean }> | null
  }>
  payments?: Array<{ method?: string; paymentMethod?: string; amount: string | number; reference?: string | null }>
  paymentMethod?: string | null
  subtotal?: string | number
  discountAmount?: string | number
  discount?: string | number
  taxAmount?: string | number
  tax?: string | number
  taxBreakdown?: Array<{ taxName?: string; name?: string; amount: string | number; rate?: string | number }> | null
  total: string | number
  paidAmount?: string | number
  createdAt?: string
  isReturn?: boolean
  customerName?: string | null
  customer?: { name?: string; taxId?: string | null; address?: string | null } | null
  /** Return: original invoice number (when the response carries it). */
  originalInvoiceNo?: string | null
}

/** @deprecated use ReceiptTaxInvoice from ./escpos (kept for callers importing it from here). */
export type MobileTaxInvoice = ReceiptTaxInvoice
export type MobileReceiptInput = ReceiptInput

export interface ReceiptContext {
  business: BusinessInfo
  shift?: Shift | null
  cashier?: string | null
  customerName?: string | null
  /** Change handed back (cash sales). */
  change?: number
  /** Fallback payment when the response has no `payments` (e.g. offline). */
  fallbackPayment?: { method: string; amount: number; reference?: string | null }
  /** Attached customer's buyer details (tax invoices: name, TIN / VAT number, address). */
  customer?: { name?: string | null; taxId?: string | null; address?: string | null } | null
  /** Return: number of the invoice being credited. */
  originalInvoiceNo?: string | null
}

const fmtRate = (r: number) => (Number.isInteger(r) ? String(r) : String(Math.round(r * 100) / 100))

/**
 * VAT rate of a line: the stored rate, else derived from its VAT and value (server-computed lines
 * store tax_rate 0). Picks the exclusive or inclusive reading that gives a whole-number rate.
 */
function lineVatRate(rate: number, vat: number, value: number): number {
  if (rate > 0) return rate
  if (!(vat > 0) || !(value > 0)) return 0
  const excl = (vat / value) * 100
  const incl = value > vat ? (vat / (value - vat)) * 100 : excl
  const near = (r: number) => Math.abs(r - Math.round(r)) < 0.05
  const r = near(excl) ? excl : near(incl) ? incl : excl
  return near(r) ? Math.round(r) : Math.round(r * 100) / 100
}

export function receiptFromSale(sale: SaleResponseLike, ctx: ReceiptContext): MobileReceiptInput {
  const lines: ReceiptLine[] = (sale.items || []).map((i) => {
    const qty = num(i.quantity)
    const unitPrice = num(i.unitPrice)
    // H5: line promotions print with the item name (the line total is already net of them)
    const promo = (i.promotions || []).filter((p) => !p.cart && num(p.amount) > 0)
    const name = i.itemName || i.name || 'Item'
    return {
      name: promo.length ? `${name} (${promo.map((p) => `${p.label} -${num(p.amount).toFixed(2)}`).join(', ')})` : name,
      qty,
      unit: i.uom || i.unit || null,
      unitPrice,
      total: i.total !== undefined ? num(i.total) : qty * unitPrice,
    }
  })

  let payments: ReceiptPayment[] = (sale.payments || [])
    .map((p) => ({ method: p.method || p.paymentMethod || 'cash', amount: num(p.amount), reference: p.reference || null }))
    .filter((p) => p.amount !== 0)
  if (payments.length === 0) {
    if (ctx.fallbackPayment) payments = [ctx.fallbackPayment]
    else payments = [{ method: sale.paymentMethod || 'cash', amount: num(sale.paidAmount ?? sale.total) }]
  }

  const taxAmount = num(sale.taxAmount ?? sale.tax)
  const taxLines =
    Array.isArray(sale.taxBreakdown) && sale.taxBreakdown.length
      ? sale.taxBreakdown.map((t) => {
          const name = t.taxName || t.name || 'Tax'
          return { name: t.rate != null && num(t.rate) ? `${name} ${fmtRate(num(t.rate))}%` : name, amount: num(t.amount) }
        })
      : taxAmount
        ? [{ name: 'Tax', amount: taxAmount }]
        : []

  const settings = resolveReceiptSettings(ctx.business, ctx.shift)
  const b = ctx.business
  const customerName = ctx.customerName || sale.customerName || sale.customer?.name || ctx.customer?.name || null
  const isReturn = Boolean(sale.isReturn) || num(sale.total) < 0
  const total = num(sale.total)

  // Tax invoice (VAT Act): VAT-registered seller + VAT on the document. Statutory particulars
  // print regardless of the receipt toggles (escpos.ts / printer.ts render taxInvoice).
  const supplierVatNo = (b.taxId || '').trim()
  let taxInvoice: ReceiptTaxInvoice | null = null
  if (supplierVatNo && Math.abs(taxAmount) >= 0.005) {
    const buyerVat = (ctx.customer?.taxId || sale.customer?.taxId || '').trim() || null
    const buyerAddress = (ctx.customer?.address || sale.customer?.address || '').trim() || null
    taxInvoice = {
      kind: isReturn ? 'credit_note' : 'tax_invoice',
      supplierVatNo,
      buyer: customerName ? { name: customerName, vatNo: buyerVat, address: buyerAddress } : null,
      originalInvoiceNo: ctx.originalInvoiceNo || sale.originalInvoiceNo || null,
      totalExclVat: Math.round((total - taxAmount) * 100) / 100,
      totalVat: taxAmount,
      totalInclVat: total,
    }
    ;(sale.items || []).forEach((i, idx) => {
      const vat = num(i.taxAmount)
      if (!lines[idx] || !vat) return
      lines[idx].vatAmount = vat
      lines[idx].vatRate = lineVatRate(num(i.taxRate), Math.abs(vat), Math.abs(lines[idx].total))
    })
  }
  const customer: ReceiptInput['customer'] = settings.showCustomer && customerName ? { name: customerName } : null

  return {
    business: {
      name: b.name,
      legalName: settings.showLegalName ? b.legalName || null : null,
      address: settings.showAddress || taxInvoice ? b.address || null : null,
      phone: settings.showPhone ? b.phone || null : null,
      email: settings.showEmail ? b.email || null : null,
      website: settings.showWebsite ? b.website || null : null,
      taxId: settings.showTaxId || taxInvoice ? b.taxId || null : null,
      brn: settings.showBrn ? b.brn || null : null,
    },
    headerLines: settings.headerLines,
    footerLines: settings.footerLines,
    returnPolicy: settings.returnPolicy || null,
    logo: settings.showLogo && b.logo ? b.logo : null,
    invoiceNo: sale.invoiceNo,
    dateTime: sale.createdAt || new Date(),
    cashier: settings.showCashier ? ctx.cashier || null : null,
    counter: settings.showCounter ? shiftCounterName(ctx.shift) || null : null,
    customer,
    lines,
    subtotal: num(sale.subtotal),
    discount: num(sale.discountAmount ?? sale.discount),
    taxLines,
    total,
    payments,
    change: ctx.change && ctx.change > 0 ? ctx.change : undefined,
    isReturn,
    // The barcode / QR carries the invoice number (INV-, RTN- or offline OFF- refs) so a
    // later return can be started by scanning the slip.
    qrPayload: sale.invoiceNo || null,
    invoiceCode: settings.invoiceCode,
    taxInvoice,
  }
}

export interface ShiftCloseLike {
  closingEntry?: { entryNumber?: string; closingTime?: string } | null
  reconciliation?: Array<{
    paymentMethod: string
    openingAmount?: string | number
    expectedAmount?: string | number
    actualAmount?: string | number
    variance?: number
    difference?: number
  }>
  summary?: { totalSales: number; totalReturns: number; netSales: number; totalTransactions: number; totalVariance: number }
  /** H1: Z-report detail and the variance reason given at close */
  zReport?: ZReportInput['details']
  varianceReason?: string | null
}

export function zReportFromClose(result: ShiftCloseLike, ctx: { business: BusinessInfo; shift?: Shift | null; cashier?: string | null; notes?: string | null }): ZReportInput {
  const rows = result.reconciliation || []
  const tenders = rows.map((r) => ({
    method: r.paymentMethod,
    opening: r.openingAmount !== undefined ? num(r.openingAmount) : undefined,
    expected: num(r.expectedAmount),
    actual: num(r.actualAmount),
    variance: r.variance ?? r.difference ?? num(r.actualAmount) - num(r.expectedAmount),
  }))
  const summary = result.summary || {
    totalSales: 0,
    totalReturns: 0,
    netSales: 0,
    totalTransactions: 0,
    totalVariance: tenders.reduce((s, t) => s + (t.variance || 0), 0),
  }
  return {
    business: ctx.business,
    entryNumber: result.closingEntry?.entryNumber || null,
    counter: shiftCounterName(ctx.shift) || null,
    cashier: ctx.cashier || null,
    openedAt: ctx.shift?.openingTime || null,
    closedAt: result.closingEntry?.closingTime || new Date(),
    summary,
    tenders,
    details: result.zReport || null,
    varianceReason: result.varianceReason || null,
    notes: ctx.notes || null,
  }
}
