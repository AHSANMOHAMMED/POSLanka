/**
 * A4 / A5 / Letter document templates (invoice, tax invoice, quotation, credit note) — the
 * Zoho-style template designer model (drizzle/0179: print_templates.config).
 *
 * `print_templates.config` stores a *partial* InvoiceTemplateConfig; the effective settings are
 * mergeTemplateConfig(stored) (deep-merged over DEFAULT_INVOICE_TEMPLATE, tolerant of unknown /
 * old / wrongly-typed data). renderInvoiceHtml() turns config + document + company into a full,
 * self-contained HTML page with print CSS (used by the designer preview iframe and print popups).
 *
 * Paper (paper.ts): A4 / A5 / A6 / Letter / Legal / Half letter, 9.5" continuous dot-matrix stock and
 * custom W × H mm, portrait or landscape. Margins: `general.marginUnit` 'in' (stored by the first
 * designer version — rendered exactly as before) or 'mm' (what the designer saves now).
 * `form` (form-layout.ts): pre-printed form mode — fields at exact mm positions over an uploaded
 * scan of the user's own form. `opts.letterHead`: the template's letter head, printed on every page.
 *
 * Pure module (no DOM / server imports).
 */
import { DOC_PAPER_MM, DOC_PAPER_SIZES, inchesToMm, resolvePageMm, roundMm, type DocPaperSize } from './paper'
import {
  DEFAULT_FORM_LAYOUT,
  FORM_FIELD_LABELS,
  FORM_LINE_HEIGHT,
  fieldOnPage,
  formBoxCss,
  formRowTop,
  paginateRows,
  sanitizeFormColumns,
  sanitizeFormFields,
  type FormColumnKey,
  type FormField,
  type FormLayoutConfig,
} from './form-layout'
import { LETTER_HEAD_CSS, letterHeadBlockHtml, type LetterHeadConfig } from './template-renderer'
import { sanitizeCss } from '@/lib/utils/sanitize-html'

// ─── Config model ─────────────────────────────────────────────────────────

export const INVOICE_PAPER_SIZES = DOC_PAPER_SIZES
export type InvoicePaperSize = DocPaperSize
export const INVOICE_ORIENTATIONS = ['portrait', 'landscape'] as const
export type InvoiceOrientation = (typeof INVOICE_ORIENTATIONS)[number]
export const INVOICE_FONT_FAMILIES = ['sans', 'serif', 'mono', 'roboto', 'georgia', 'verdana'] as const
export type InvoiceFontFamily = (typeof INVOICE_FONT_FAMILIES)[number]
export const INVOICE_DATE_FORMATS = ['DD/MM/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY', 'MM/DD/YYYY'] as const
export type InvoiceDateFormat = (typeof INVOICE_DATE_FORMATS)[number]
export const INVOICE_IMAGE_POSITIONS = ['left', 'center', 'right', 'cover'] as const
export type InvoiceImagePosition = (typeof INVOICE_IMAGE_POSITIONS)[number]
export const INVOICE_ALIGNS = ['left', 'center', 'right'] as const
export type InvoiceAlign = (typeof INVOICE_ALIGNS)[number]

/** Paper size in millimetres (portrait). */
export const INVOICE_PAPER_MM: Record<InvoicePaperSize, { width: number; height: number; label: string }> = DOC_PAPER_MM
export const INVOICE_MARGIN_UNITS = ['in', 'mm'] as const
export type InvoiceMarginUnit = (typeof INVOICE_MARGIN_UNITS)[number]

export const INVOICE_FONT_STACKS: Record<InvoiceFontFamily, { label: string; css: string }> = {
  sans: { label: 'Helvetica / Arial', css: "'Helvetica Neue', Helvetica, Arial, 'Noto Sans Sinhala', 'Noto Sans Tamil', sans-serif" },
  serif: { label: 'Times', css: "'Times New Roman', Times, 'Noto Serif Sinhala', serif" },
  mono: { label: 'Courier', css: "'Courier New', Courier, ui-monospace, monospace" },
  roboto: { label: 'Roboto / Segoe', css: "Roboto, 'Segoe UI', system-ui, -apple-system, sans-serif" },
  georgia: { label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  verdana: { label: 'Verdana / Tahoma', css: 'Verdana, Tahoma, Geneva, sans-serif' },
}

export interface LabeledToggle {
  show: boolean
  label: string
}

export const INVOICE_COLUMN_KEYS = [
  'lineNo', 'item', 'description', 'sku', 'serial', 'warranty', 'qty', 'unit', 'rate', 'discount', 'taxRate', 'taxAmount', 'amount',
] as const
export type InvoiceColumnKey = (typeof INVOICE_COLUMN_KEYS)[number]

export interface InvoiceColumnConfig {
  show: boolean
  label: string
  /** Width in % of the table (0 = automatic). */
  width: number
}

export interface InvoiceBandConfig {
  show: boolean
  /** Data URL or URL of an image printed in the band. */
  backgroundImage: string
  imagePosition: InvoiceImagePosition
  backgroundColor: string
  textColor: string
  /** Free text (new lines kept). */
  text: string
  textAlign: InvoiceAlign
  fontSize: number
  /** Band height in inches (0 = fit content). */
  height: number
  /** Print only on the first page (otherwise repeated on every page). */
  firstPageOnly: boolean
}

export interface InvoiceTemplateConfig {
  version: 1
  general: {
    paperSize: InvoicePaperSize
    orientation: InvoiceOrientation
    /** paperSize 'custom': width × height in mm (portrait). */
    customWidthMm: number
    customHeightMm: number
    /** Page margins, in `marginUnit` ('in' = templates saved before mm support). */
    margins: { top: number; bottom: number; left: number; right: number }
    marginUnit: InvoiceMarginUnit
    fontFamily: InvoiceFontFamily
    /** Base font size in pt. */
    fontSize: number
    textColor: string
    accentColor: string
    backgroundColor: string
    backgroundImage: string
    dateFormat: InvoiceDateFormat
    /** Tear-off payment stub at the end of invoices. */
    includePaymentStub: boolean
  }
  titles: {
    show: boolean
    invoice: string
    taxInvoice: string
    quotation: string
    creditNote: string
    purchaseOrder: string
    fontSize: number
    color: string
  }
  header: InvoiceBandConfig
  footer: InvoiceBandConfig & { showPageNumber: boolean }
  organization: {
    showLogo: boolean
    /** Overrides the company logo (data URL / URL); empty = company logo. */
    logoUrl: string
    /** Logo height in px. */
    logoHeight: number
    showName: boolean
    nameColor: string
    nameFontSize: number
    showLegalName: boolean
    showAddress: boolean
    /** Placeholders: {address} {phone} {email} {website} {taxId} {brn}. Lines without data are dropped. */
    addressFormat: string
  }
  customer: {
    showBillTo: boolean
    billToLabel: string
    showShipTo: boolean
    shipToLabel: string
    /** Party label on purchase orders. */
    vendorLabel: string
    showPhone: boolean
    showEmail: boolean
    showTaxId: boolean
    taxIdLabel: string
  }
  documentDetails: {
    number: LabeledToggle
    date: LabeledToggle
    terms: LabeledToggle
    dueDate: LabeledToggle
    deliveryDate: LabeledToggle
    validUntil: LabeledToggle
    reference: LabeledToggle
    salesperson: LabeledToggle
    originalInvoice: LabeledToggle
    status: LabeledToggle
  }
  table: {
    columns: Record<InvoiceColumnKey, InvoiceColumnConfig>
    headerBackground: string
    headerTextColor: string
    striped: boolean
    stripeColor: string
    borderColor: string
    fontSize: number
    /** When the Serial / Warranty columns are hidden, print them under the item name. */
    extrasUnderItem: boolean
  }
  totals: {
    subTotal: LabeledToggle
    discount: LabeledToggle
    shipping: LabeledToggle
    taxableAmount: LabeledToggle
    /** One row per tax (breakdown) — falls back to a single tax row. */
    taxDetails: LabeledToggle
    total: LabeledToggle
    paymentMade: LabeledToggle
    credits: LabeledToggle
    balanceDue: LabeledToggle
    amountInWords: LabeledToggle
    /** Empty = the company currency code (e.g. "LKR"); e.g. "Rs." */
    currencySymbol: string
    symbolPosition: 'before' | 'after'
    totalBackground: string
    totalTextColor: string
  }
  other: {
    notes: { show: boolean; label: string; fontSize: number }
    paymentOptions: { show: boolean; label: string; text: string }
    terms: { show: boolean; label: string; fontSize: number; text: string }
    signature: { show: boolean; label: string; imageUrl: string; name: string }
    annexure: { show: boolean; label: string; text: string }
  }
  /** Pre-printed form / uploaded template mode (fields at exact mm positions). */
  form: FormLayoutConfig
  /** Advanced: extra CSS appended last. */
  customCss: string
}

/** Deep-partial helper for stored configs. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

const col = (show: boolean, label: string, width = 0): InvoiceColumnConfig => ({ show, label, width })
const lt = (show: boolean, label: string): LabeledToggle => ({ show, label })
const band = (over: Partial<InvoiceBandConfig> = {}): InvoiceBandConfig => ({
  show: true,
  backgroundImage: '',
  imagePosition: 'cover',
  backgroundColor: '',
  textColor: '',
  text: '',
  textAlign: 'center',
  fontSize: 9,
  height: 0,
  firstPageOnly: false,
  ...over,
})

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplateConfig = {
  version: 1,
  general: {
    paperSize: 'a4',
    orientation: 'portrait',
    customWidthMm: 210,
    customHeightMm: 297,
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    marginUnit: 'in',
    fontFamily: 'sans',
    fontSize: 9,
    textColor: '#1f2937',
    accentColor: '#1d4ed8',
    backgroundColor: '#ffffff',
    backgroundImage: '',
    dateFormat: 'DD/MM/YYYY',
    includePaymentStub: false,
  },
  titles: {
    show: true,
    invoice: 'INVOICE',
    taxInvoice: 'TAX INVOICE',
    quotation: 'QUOTATION',
    creditNote: 'CREDIT NOTE',
    purchaseOrder: 'PURCHASE ORDER',
    fontSize: 22,
    color: '',
  },
  header: band({ show: false, firstPageOnly: true }),
  footer: { ...band({ show: true, text: 'Thank you for your business!' }), showPageNumber: false },
  organization: {
    showLogo: true,
    logoUrl: '',
    logoHeight: 60,
    showName: true,
    nameColor: '',
    nameFontSize: 16,
    showLegalName: false,
    showAddress: true,
    addressFormat: '{address}\nTel: {phone}\n{email}\n{website}\nVAT No: {taxId}\nBRN: {brn}',
  },
  customer: {
    showBillTo: true,
    billToLabel: 'Bill To',
    showShipTo: false,
    shipToLabel: 'Ship To',
    vendorLabel: 'Vendor',
    showPhone: true,
    showEmail: true,
    showTaxId: true,
    taxIdLabel: 'VAT No',
  },
  documentDetails: {
    number: lt(true, '#'),
    date: lt(true, 'Date'),
    terms: lt(true, 'Terms'),
    dueDate: lt(true, 'Due Date'),
    deliveryDate: lt(true, 'Delivery Date'),
    validUntil: lt(true, 'Valid Until'),
    reference: lt(true, 'Reference#'),
    salesperson: lt(true, 'Sales Person'),
    originalInvoice: lt(true, 'Original Invoice'),
    status: lt(false, 'Status'),
  },
  table: {
    columns: {
      lineNo: col(true, '#', 5),
      item: col(true, 'Item & Description', 0),
      description: col(false, 'Description', 0),
      sku: col(false, 'Code', 10),
      serial: col(false, 'Serial No.', 14),
      warranty: col(false, 'Warranty', 11),
      qty: col(true, 'Qty', 8),
      unit: col(false, 'Unit', 7),
      rate: col(true, 'Rate', 12),
      discount: col(false, 'Discount', 9),
      taxRate: col(false, 'Tax %', 7),
      taxAmount: col(false, 'Tax', 9),
      amount: col(true, 'Amount', 14),
    },
    headerBackground: '#1f2937',
    headerTextColor: '#ffffff',
    striped: false,
    stripeColor: '#f8fafc',
    borderColor: '#e5e7eb',
    fontSize: 9,
    extrasUnderItem: true,
  },
  totals: {
    subTotal: lt(true, 'Sub Total'),
    discount: lt(true, 'Discount'),
    shipping: lt(true, 'Shipping Charges'),
    taxableAmount: lt(false, 'Taxable Amount'),
    taxDetails: lt(true, 'Tax'),
    total: lt(true, 'Total'),
    paymentMade: lt(true, 'Payment Made'),
    credits: lt(true, 'Credits Applied'),
    balanceDue: lt(true, 'Balance Due'),
    amountInWords: lt(true, 'Total In Words'),
    currencySymbol: '',
    symbolPosition: 'before',
    totalBackground: '#f3f4f6',
    totalTextColor: '',
  },
  other: {
    notes: { show: true, label: 'Notes', fontSize: 9 },
    paymentOptions: { show: false, label: 'Bank Details', text: '' },
    terms: { show: true, label: 'Terms & Conditions', fontSize: 8, text: '' },
    signature: { show: true, label: 'Authorized Signature', imageUrl: '', name: '' },
    annexure: { show: false, label: 'Annexure', text: '' },
  },
  form: DEFAULT_FORM_LAYOUT,
  customCss: '',
}

// ─── Merge (tolerant) ─────────────────────────────────────────────────────

const ENUMS: Record<string, readonly string[]> = {
  'general.paperSize': INVOICE_PAPER_SIZES,
  'general.orientation': INVOICE_ORIENTATIONS,
  'general.marginUnit': INVOICE_MARGIN_UNITS,
  'general.fontFamily': INVOICE_FONT_FAMILIES,
  'general.dateFormat': INVOICE_DATE_FORMATS,
  'header.imagePosition': INVOICE_IMAGE_POSITIONS,
  'footer.imagePosition': INVOICE_IMAGE_POSITIONS,
  'header.textAlign': INVOICE_ALIGNS,
  'footer.textAlign': INVOICE_ALIGNS,
  'totals.symbolPosition': ['before', 'after'],
}

/** Numeric limits [min, max] by key name (applies at any depth). */
const NUM_LIMITS: Record<string, [number, number]> = {
  top: [0, 3], bottom: [0, 3], left: [0, 3], right: [0, 3],
  fontSize: [5, 40], nameFontSize: [6, 48], logoHeight: [10, 300], width: [0, 100], height: [0, 6],
}

/** Limits by full path (checked before NUM_LIMITS). Margins: up to 80 mm; inch margins are capped at 3 after the merge. */
const PATH_LIMITS: Record<string, [number, number]> = {
  'general.margins.top': [0, 80], 'general.margins.bottom': [0, 80], 'general.margins.left': [0, 80], 'general.margins.right': [0, 80],
  'general.customWidthMm': [40, 1200], 'general.customHeightMm': [40, 1200],
  'form.offsetX': [-50, 50], 'form.offsetY': [-50, 50],
  'form.items.x': [0, 1200], 'form.items.y': [0, 1200], 'form.items.width': [0, 1200],
  'form.items.rowHeight': [2, 60], 'form.items.maxRows': [1, 300], 'form.items.fontSize': [4, 40],
}

/** Array-valued settings: tolerant parsers by path. */
const ARRAY_SANITIZERS: Partial<Record<string, (raw: unknown) => unknown[]>> = {
  'form.fields': sanitizeFormFields,
  'form.columns': sanitizeFormColumns,
}

const MAX_TEXT = 1_500_000 // data-URL images fit; plain text fields are far smaller in practice

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function mergeNode(def: unknown, raw: unknown, path: string): unknown {
  if (Array.isArray(def)) {
    const sanitize = ARRAY_SANITIZERS[path]
    return sanitize && Array.isArray(raw) ? sanitize(raw) : [...def]
  }
  if (isPlainObject(def)) {
    const src = isPlainObject(raw) ? raw : {}
    const out: Record<string, unknown> = {}
    for (const [k, dv] of Object.entries(def)) out[k] = mergeNode(dv, src[k], path ? `${path}.${k}` : k)
    return out
  }
  if (raw === undefined || raw === null) return def
  if (typeof def === 'boolean') return typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : def
  if (typeof def === 'number') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    if (!Number.isFinite(n)) return def
    const key = path.split('.').pop() || ''
    const lim = PATH_LIMITS[path] || NUM_LIMITS[key]
    return lim ? Math.min(lim[1], Math.max(lim[0], n)) : n
  }
  if (typeof def === 'string') {
    if (typeof raw !== 'string') return def
    const allowed = ENUMS[path]
    if (allowed) return allowed.includes(raw) ? raw : def
    return raw.slice(0, MAX_TEXT)
  }
  return def
}

/** Effective template settings from a stored partial config (unknown keys dropped, bad values defaulted). */
export function mergeTemplateConfig(partial: unknown): InvoiceTemplateConfig {
  const merged = mergeNode(DEFAULT_INVOICE_TEMPLATE, partial, '') as InvoiceTemplateConfig
  merged.version = 1
  if (merged.general.marginUnit === 'in') {
    const m = merged.general.margins
    m.top = Math.min(3, m.top); m.bottom = Math.min(3, m.bottom); m.left = Math.min(3, m.left); m.right = Math.min(3, m.right)
  }
  return merged
}

/** The config with its page margins in mm (the designer edits mm; same printed size). */
export function withMarginsInMm(c: InvoiceTemplateConfig): InvoiceTemplateConfig {
  if (c.general.marginUnit === 'mm') return c
  const m = c.general.margins
  return {
    ...c,
    general: {
      ...c.general,
      marginUnit: 'mm',
      margins: { top: inchesToMm(m.top), bottom: inchesToMm(m.bottom), left: inchesToMm(m.left), right: inchesToMm(m.right) },
    },
  }
}

/** Page size (mm, after orientation) of a template config. */
export function templatePageMm(c: InvoiceTemplateConfig): { width: number; height: number } {
  return resolvePageMm(c.general.paperSize, c.general.orientation, { widthMm: c.general.customWidthMm, heightMm: c.general.customHeightMm })
}

/**
 * Effective config of a print_templates row: its `config`, with the legacy columns (paper size,
 * orientation, margins in mm, show logo/header/footer, custom CSS) used where the config is silent.
 */
export function templateConfigFromRow(row: {
  config?: unknown
  paperSize?: string | null
  orientation?: string | null
  margins?: { top: number; right: number; bottom: number; left: number } | null
  showLogo?: boolean | null
  showHeader?: boolean | null
  showFooter?: boolean | null
  customCss?: string | null
} | null | undefined): InvoiceTemplateConfig {
  if (!row) return mergeTemplateConfig({})
  const stored = isPlainObject(row.config) ? row.config : {}
  const hasConfig = Object.keys(stored).length > 0
  if (hasConfig) return mergeTemplateConfig(stored)
  const mmToIn = (mm: number) => Math.round((mm / 25.4) * 100) / 100
  const legacy: DeepPartial<InvoiceTemplateConfig> = {
    general: {
      paperSize: (row.paperSize as InvoicePaperSize) || undefined,
      orientation: (row.orientation as InvoiceOrientation) || undefined,
      margins: row.margins
        ? { top: mmToIn(row.margins.top), bottom: mmToIn(row.margins.bottom), left: mmToIn(row.margins.left), right: mmToIn(row.margins.right) }
        : undefined,
    },
    organization: { showLogo: row.showLogo ?? undefined },
    footer: { show: row.showFooter ?? undefined },
    customCss: row.customCss || undefined,
  }
  return mergeTemplateConfig(legacy)
}

// ─── Document model ───────────────────────────────────────────────────────

export type InvoiceDocKind = 'invoice' | 'tax_invoice' | 'quotation' | 'credit_note' | 'purchase_order'

export interface InvoiceDocParty {
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  taxId?: string | null
}

export interface InvoiceDocLine {
  name: string
  description?: string | null
  sku?: string | null
  quantity: number
  unit?: string | null
  unitPrice: number
  discount?: number | null
  taxRate?: number | null
  taxAmount?: number | null
  /** Line amount as charged (after discount). */
  amount: number
  serialNumbers?: string[] | null
  warrantyMonths?: number | null
  /** YYYY-MM-DD */
  warrantyUntil?: string | null
}

export interface InvoiceDoc {
  kind: InvoiceDocKind
  number: string
  /** ISO date / date-time */
  date: string
  dueDate?: string | null
  /** Purchase orders: expected delivery date. */
  deliveryDate?: string | null
  validUntil?: string | null
  terms?: string | null
  reference?: string | null
  salesperson?: string | null
  status?: string | null
  /** Credit notes: the invoice it adjusts. */
  originalInvoiceNo?: string | null
  customer?: InvoiceDocParty | null
  shipTo?: InvoiceDocParty | null
  lines: InvoiceDocLine[]
  subtotal: number
  discount?: number | null
  shipping?: number | null
  taxableAmount?: number | null
  tax?: number | null
  taxBreakdown?: Array<{ name: string; rate?: number | null; amount: number }> | null
  /** Prices include tax: tax rows print as "incl." */
  taxInclusive?: boolean
  total: number
  paid?: number | null
  credits?: number | null
  balanceDue?: number | null
  notes?: string | null
}

export interface InvoiceCompany {
  name?: string | null
  legalName?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  taxId?: string | null
  brn?: string | null
  logoUrl?: string | null
  /** ISO 4217, default LKR */
  currency?: string | null
}

// ─── Formatting helpers ───────────────────────────────────────────────────

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escaped text with line breaks kept. */
function multiline(v: unknown): string {
  return escapeHtml(v).replace(/\r?\n/g, '<br>')
}

/** Only data:image, http(s) and same-origin paths are allowed as image sources. */
export function safeImageUrl(v: string | null | undefined): string {
  const s = (v || '').trim()
  if (!s) return ''
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(s)) return s
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s
  if (/^\/[^\s"'<>]*$/.test(s) && !s.startsWith('//')) return s
  return ''
}

/** CSS colour (hex / rgb / named); anything else → fallback. */
function safeColor(v: string | null | undefined, fallback = ''): string {
  const s = (v || '').trim()
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^rgba?\([\d\s.,%]+\)$/i.test(s) || /^[a-z]{3,20}$/i.test(s)) return s
  return fallback
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function formatAmount(n: number): string {
  const v = Math.round(num(n) * 100) / 100
  const neg = v < 0
  const [int, dec] = Math.abs(v).toFixed(2).split('.')
  return `${neg ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`
}

function formatQty(n: number): string {
  return String(Math.round(num(n) * 1000) / 1000)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDocDate(value: string | null | undefined, fmt: InvoiceDateFormat): string {
  if (!value) return ''
  let y: number, m: number, d: number
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (ymd) {
    y = +ymd[1]; m = +ymd[2]; d = +ymd[3]
  } else {
    const dt = new Date(value)
    if (Number.isNaN(dt.getTime())) return escapeHtml(value)
    y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate()
  }
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  switch (fmt) {
    case 'YYYY-MM-DD': return `${y}-${mm}-${dd}`
    case 'DD MMM YYYY': return `${dd} ${MONTHS[m - 1]} ${y}`
    case 'MM/DD/YYYY': return `${mm}/${dd}/${y}`
    default: return `${dd}/${mm}/${y}`
  }
}

// Amount in words (international system: thousand / million / billion)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowThousand(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) parts.push(`${ONES[h]} Hundred`)
  if (r) {
    if (r < 20) parts.push(ONES[r])
    else parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''))
  }
  return parts.join(' ')
}

export function integerToWords(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'Zero'
  const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion']
  const parts: string[] = []
  let i = 0
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000
    if (chunk) parts.unshift(`${belowThousand(chunk)}${scales[i] ? ` ${scales[i]}` : ''}`)
    n = Math.floor(n / 1000)
    i++
  }
  return parts.join(' ')
}

const CURRENCY_WORDS: Record<string, [string, string]> = {
  LKR: ['Rupees', 'Cents'],
  INR: ['Rupees', 'Paise'],
  PKR: ['Rupees', 'Paisa'],
  USD: ['Dollars', 'Cents'],
  AUD: ['Dollars', 'Cents'],
  SGD: ['Dollars', 'Cents'],
  EUR: ['Euros', 'Cents'],
  GBP: ['Pounds', 'Pence'],
  AED: ['Dirhams', 'Fils'],
  MVR: ['Rufiyaa', 'Laari'],
}

/** "Sri Lankan Rupees One Thousand Two Hundred and Cents Fifty Only" style (LKR: "Rupees ... and ... Cents Only"). */
export function amountInWords(amount: number, currency = 'LKR'): string {
  const v = Math.round(Math.abs(num(amount)) * 100)
  const whole = Math.floor(v / 100)
  const cents = v % 100
  const [major, minor] = CURRENCY_WORDS[currency.toUpperCase()] || [currency.toUpperCase(), 'Cents']
  let out = `${major} ${integerToWords(whole)}`
  if (cents) out += ` and ${integerToWords(cents)} ${minor}`
  return `${num(amount) < 0 ? 'Minus ' : ''}${out} Only`
}

function warrantyText(months: number | null | undefined, until: string | null | undefined, fmt: InvoiceDateFormat): string {
  const m = num(months)
  if (m <= 0) return ''
  const label = m === 1 ? '1 month' : `${m} months`
  return until ? `${label} (until ${formatDocDate(until, fmt)})` : label
}

// ─── Renderer ─────────────────────────────────────────────────────────────

function docTitle(c: InvoiceTemplateConfig, kind: InvoiceDocKind): string {
  switch (kind) {
    case 'tax_invoice': return c.titles.taxInvoice
    case 'quotation': return c.titles.quotation
    case 'credit_note': return c.titles.creditNote
    case 'purchase_order': return c.titles.purchaseOrder
    default: return c.titles.invoice
  }
}

function bandHtml(b: InvoiceBandConfig, cls: string, extra = ''): string {
  if (!b.show) return ''
  const img = safeImageUrl(b.backgroundImage)
  const style: string[] = []
  const bg = safeColor(b.backgroundColor)
  if (bg) style.push(`background-color:${bg}`)
  const fg = safeColor(b.textColor)
  if (fg) style.push(`color:${fg}`)
  if (b.height > 0) style.push(`min-height:${b.height}in`)
  style.push(`text-align:${b.textAlign}`, `font-size:${b.fontSize}pt`)
  let imgHtml = ''
  if (img) {
    if (b.imagePosition === 'cover') {
      style.push(`background-image:url('${img}')`, 'background-size:cover', 'background-position:center')
    } else {
      imgHtml = `<div class="band-img" style="text-align:${b.imagePosition}"><img src="${escapeHtml(img)}" alt=""></div>`
    }
  }
  if (!imgHtml && !b.text.trim() && !extra && !img && !bg) return ''
  return `<div class="${cls}" style="${style.join(';')}">${imgHtml}${b.text.trim() ? `<div class="band-text">${multiline(b.text)}</div>` : ''}${extra}</div>`
}

function formatAddress(format: string, co: InvoiceCompany): string {
  const values: Record<string, string> = {
    address: co.address || '', phone: co.phone || '', email: co.email || '', website: co.website || '',
    taxId: co.taxId || '', brn: co.brn || '',
  }
  return format
    .split(/\r?\n/)
    .map((line) => {
      const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      if (keys.length && keys.every((k) => !values[k]?.trim())) return null
      return line.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '')
    })
    .filter((l): l is string => l !== null && l.trim() !== '')
    .map((l) => multiline(l))
    .join('<br>')
}

function partyHtml(label: string, p: InvoiceDocParty, c: InvoiceTemplateConfig): string {
  const rows: string[] = []
  if (p.name) rows.push(`<div class="party-name">${escapeHtml(p.name)}</div>`)
  if (p.address) rows.push(`<div>${multiline(p.address)}</div>`)
  if (c.customer.showPhone && p.phone) rows.push(`<div>${escapeHtml(p.phone)}</div>`)
  if (c.customer.showEmail && p.email) rows.push(`<div>${escapeHtml(p.email)}</div>`)
  if (c.customer.showTaxId && p.taxId) rows.push(`<div>${escapeHtml(c.customer.taxIdLabel)}: ${escapeHtml(p.taxId)}</div>`)
  if (!rows.length) return ''
  return `<div class="party"><div class="party-label">${escapeHtml(label)}</div>${rows.join('')}</div>`
}

export interface RenderOptions {
  /** Screen-only sheet look (grey backdrop, paper-sized white page) for the designer iframe. */
  preview?: boolean
  autoPrint?: boolean
  /** The template's letter head: header / footer printed on every page (heights in mm). */
  letterHead?: LetterHeadConfig | null
}

/**
 * Full HTML page (with print CSS) for a document. Templates in pre-printed form mode
 * (`form.enabled`) are rendered by renderFormHtml (fields at exact mm positions).
 */
export function renderInvoiceHtml(
  configInput: InvoiceTemplateConfig | DeepPartial<InvoiceTemplateConfig> | null | undefined,
  doc: InvoiceDoc,
  company: InvoiceCompany,
  opts: RenderOptions = {},
): string {
  const c = mergeTemplateConfig(configInput ?? {})
  if (c.form.enabled) return renderFormHtml(c, doc, company, opts)
  const g = c.general
  const currency = (company.currency || 'LKR').toUpperCase()
  const sym = c.totals.currencySymbol.trim() || currency
  const money = (n: number) => escapeHtml(c.totals.symbolPosition === 'after' ? `${formatAmount(n)} ${sym}` : `${sym} ${formatAmount(n)}`)
  const plain = (n: number) => escapeHtml(formatAmount(n))
  const date = (v: string | null | undefined) => escapeHtml(formatDocDate(v, g.dateFormat))
  const isQuote = doc.kind === 'quotation'
  const isInvoice = doc.kind === 'invoice' || doc.kind === 'tax_invoice'

  const { width: pageW, height: pageH } = templatePageMm(c)
  const m = g.margins
  const u = g.marginUnit
  const font = INVOICE_FONT_STACKS[g.fontFamily]?.css || INVOICE_FONT_STACKS.sans.css
  const accent = safeColor(g.accentColor, '#1d4ed8')
  const textColor = safeColor(g.textColor, '#1f2937')
  const bgColor = safeColor(g.backgroundColor, '#ffffff')
  const bgImage = safeImageUrl(g.backgroundImage)
  const t = c.table

  // Organisation block
  const logo = c.organization.showLogo ? safeImageUrl(c.organization.logoUrl || company.logoUrl) : ''
  const orgParts: string[] = []
  if (logo) orgParts.push(`<img class="logo" src="${escapeHtml(logo)}" alt="" style="max-height:${c.organization.logoHeight}px">`)
  const orgText: string[] = []
  if (c.organization.showName && company.name) {
    const nc = safeColor(c.organization.nameColor)
    orgText.push(`<div class="org-name" style="font-size:${c.organization.nameFontSize}pt;${nc ? `color:${nc}` : ''}">${escapeHtml(company.name)}</div>`)
  }
  if (c.organization.showLegalName && company.legalName && company.legalName !== company.name) {
    orgText.push(`<div class="org-legal">${escapeHtml(company.legalName)}</div>`)
  }
  if (c.organization.showAddress) {
    const addr = formatAddress(c.organization.addressFormat, company)
    if (addr) orgText.push(`<div class="org-address">${addr}</div>`)
  }
  if (orgText.length) orgParts.push(`<div class="org-text">${orgText.join('')}</div>`)

  // Document details
  const dd = c.documentDetails
  const details: Array<[string, string]> = []
  const add = (f: LabeledToggle, value: string | null | undefined, raw = false) => {
    if (f.show && value) details.push([escapeHtml(f.label), raw ? value : escapeHtml(value)])
  }
  add(dd.date, date(doc.date), true)
  if (isQuote) add(dd.validUntil, date(doc.validUntil), true)
  else add(dd.terms, doc.terms)
  if (!isQuote) add(dd.dueDate, date(doc.dueDate), true)
  add(dd.deliveryDate, date(doc.deliveryDate), true)
  add(dd.reference, doc.reference)
  add(dd.salesperson, doc.salesperson)
  if (doc.kind === 'credit_note') add(dd.originalInvoice, doc.originalInvoiceNo)
  add(dd.status, doc.status ? doc.status.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : null)

  const titleColor = safeColor(c.titles.color) || accent
  const titleHtml = `<div class="doc-title-block">
    ${c.titles.show ? `<div class="doc-title" style="font-size:${c.titles.fontSize}pt;color:${titleColor}">${escapeHtml(docTitle(c, doc.kind))}</div>` : ''}
    ${dd.number.show ? `<div class="doc-number">${escapeHtml(dd.number.label)} ${escapeHtml(doc.number)}</div>` : ''}
    ${isInvoice && c.totals.balanceDue.show && doc.balanceDue != null && num(doc.balanceDue) > 0.004
      ? `<div class="doc-balance"><div class="muted">${escapeHtml(c.totals.balanceDue.label)}</div><div class="doc-balance-amt">${money(num(doc.balanceDue))}</div></div>`
      : ''}
  </div>`

  // Parties
  const parties: string[] = []
  if (c.customer.showBillTo && doc.customer) parties.push(partyHtml(doc.kind === 'purchase_order' ? c.customer.vendorLabel : c.customer.billToLabel, doc.customer, c))
  if (c.customer.showShipTo && (doc.shipTo || doc.customer)) parties.push(partyHtml(c.customer.shipToLabel, doc.shipTo || doc.customer || {}, c))
  const detailsHtml = details.length
    ? `<table class="details">${details.map(([k, v]) => `<tr><td class="dk">${k}${/[:#]$/.test(k) ? '' : ' :'}</td><td class="dv">${v}</td></tr>`).join('')}</table>`
    : ''

  // Line table
  const cols = INVOICE_COLUMN_KEYS.filter((k) => t.columns[k].show)
  const numeric = new Set<InvoiceColumnKey>(['qty', 'rate', 'discount', 'taxRate', 'taxAmount', 'amount'])
  const colgroup = cols.map((k) => `<col${t.columns[k].width > 0 ? ` style="width:${t.columns[k].width}%"` : ''}>`).join('')
  const thead = cols.map((k) => `<th class="${numeric.has(k) ? 'r' : ''}${k === 'lineNo' ? ' c' : ''}">${escapeHtml(t.columns[k].label)}</th>`).join('')
  const showSerialCol = t.columns.serial.show
  const showWarrantyCol = t.columns.warranty.show
  const showDescCol = t.columns.description.show
  const rows = doc.lines.map((l, i) => {
    const serials = (l.serialNumbers || []).filter(Boolean)
    const warranty = warrantyText(l.warrantyMonths, l.warrantyUntil, g.dateFormat)
    const cell = (k: InvoiceColumnKey): string => {
      switch (k) {
        case 'lineNo': return `<td class="c">${i + 1}</td>`
        case 'item': {
          const extra: string[] = []
          if (!showDescCol && l.description) extra.push(`<div class="sub">${multiline(l.description)}</div>`)
          if (t.extrasUnderItem && !showSerialCol && serials.length) extra.push(`<div class="sub">S/N: ${escapeHtml(serials.join(', '))}</div>`)
          if (t.extrasUnderItem && !showWarrantyCol && warranty) extra.push(`<div class="sub">Warranty: ${escapeHtml(warranty)}</div>`)
          return `<td><div class="item-name">${escapeHtml(l.name)}</div>${extra.join('')}</td>`
        }
        case 'description': return `<td>${multiline(l.description || '')}</td>`
        case 'sku': return `<td>${escapeHtml(l.sku || '')}</td>`
        case 'serial': return `<td class="serials">${serials.map((s) => escapeHtml(s)).join('<br>')}</td>`
        case 'warranty': return `<td>${escapeHtml(warranty)}</td>`
        case 'qty': return `<td class="r">${escapeHtml(formatQty(l.quantity))}${!t.columns.unit.show && l.unit ? ` <span class="muted">${escapeHtml(l.unit)}</span>` : ''}</td>`
        case 'unit': return `<td>${escapeHtml(l.unit || '')}</td>`
        case 'rate': return `<td class="r">${plain(l.unitPrice)}</td>`
        case 'discount': return `<td class="r">${num(l.discount) ? plain(num(l.discount)) : ''}</td>`
        case 'taxRate': return `<td class="r">${l.taxRate != null && num(l.taxRate) ? `${escapeHtml(String(num(l.taxRate)))}%` : ''}</td>`
        case 'taxAmount': return `<td class="r">${num(l.taxAmount) ? plain(num(l.taxAmount)) : ''}</td>`
        case 'amount': return `<td class="r">${plain(l.amount)}</td>`
      }
    }
    return `<tr>${cols.map(cell).join('')}</tr>`
  }).join('')

  // Totals
  const tt = c.totals
  const totalRows: string[] = []
  const trow = (label: string, value: string, cls = '') => totalRows.push(`<tr class="${cls}"><td class="tl">${escapeHtml(label)}</td><td class="tv">${value}</td></tr>`)
  if (tt.subTotal.show) trow(tt.subTotal.label, plain(doc.subtotal))
  if (tt.discount.show && num(doc.discount) > 0.004) trow(tt.discount.label, `(-) ${plain(num(doc.discount))}`)
  if (tt.shipping.show && num(doc.shipping) > 0.004) trow(tt.shipping.label, plain(num(doc.shipping)))
  if (tt.taxableAmount.show) {
    const taxable = doc.taxableAmount ?? (doc.taxInclusive ? doc.total - num(doc.tax) : doc.subtotal - num(doc.discount) + num(doc.shipping))
    trow(tt.taxableAmount.label, plain(taxable))
  }
  if (tt.taxDetails.show) {
    const incl = doc.taxInclusive ? ' (incl.)' : ''
    const breakdown = (doc.taxBreakdown || []).filter((b) => num(b.amount) !== 0)
    if (breakdown.length) {
      for (const b of breakdown) trow(`${b.name}${b.rate != null && !String(b.name).includes('%') ? ` (${num(b.rate)}%)` : ''}${incl}`, plain(num(b.amount)))
    } else if (num(doc.tax) > 0.004) {
      trow(`${tt.taxDetails.label}${incl}`, plain(num(doc.tax)))
    }
  }
  if (tt.total.show) {
    const bg = safeColor(tt.totalBackground)
    const fg = safeColor(tt.totalTextColor)
    totalRows.push(`<tr class="grand" style="${bg ? `background:${bg};` : ''}${fg ? `color:${fg}` : ''}"><td class="tl">${escapeHtml(tt.total.label)}</td><td class="tv">${money(doc.total)}</td></tr>`)
  }
  if (isInvoice) {
    if (tt.paymentMade.show && num(doc.paid) > 0.004) trow(tt.paymentMade.label, `(-) ${plain(num(doc.paid))}`)
    if (tt.credits.show && num(doc.credits) > 0.004) trow(tt.credits.label, `(-) ${plain(num(doc.credits))}`)
    if (tt.balanceDue.show && doc.balanceDue != null) trow(tt.balanceDue.label, money(num(doc.balanceDue)), 'balance')
  }
  const wordsHtml = tt.amountInWords.show
    ? `<div class="words"><span class="muted">${escapeHtml(tt.amountInWords.label)}:</span> <strong>${escapeHtml(amountInWords(doc.total, currency))}</strong></div>`
    : ''

  // Other details
  const o = c.other
  const blocks: string[] = []
  if (o.notes.show && doc.notes?.trim()) {
    blocks.push(`<div class="block" style="font-size:${o.notes.fontSize}pt"><div class="block-label">${escapeHtml(o.notes.label)}</div><div>${multiline(doc.notes)}</div></div>`)
  }
  if (o.paymentOptions.show && o.paymentOptions.text.trim()) {
    blocks.push(`<div class="block"><div class="block-label">${escapeHtml(o.paymentOptions.label)}</div><div>${multiline(o.paymentOptions.text)}</div></div>`)
  }
  if (o.terms.show && o.terms.text.trim()) {
    blocks.push(`<div class="block" style="font-size:${o.terms.fontSize}pt"><div class="block-label">${escapeHtml(o.terms.label)}</div><div>${multiline(o.terms.text)}</div></div>`)
  }
  const sigImg = safeImageUrl(o.signature.imageUrl)
  const signatureHtml = o.signature.show
    ? `<div class="signature">${sigImg ? `<img src="${escapeHtml(sigImg)}" alt="">` : '<div class="sig-space"></div>'}<div class="sig-line"></div><div>${escapeHtml(o.signature.label)}</div>${o.signature.name ? `<div class="muted">${escapeHtml(o.signature.name)}</div>` : ''}</div>`
    : ''
  const annexureHtml = o.annexure.show && o.annexure.text.trim()
    ? `<div class="annexure"><div class="block-label">${escapeHtml(o.annexure.label)}</div><div>${multiline(o.annexure.text)}</div></div>`
    : ''

  const stubHtml = g.includePaymentStub && isInvoice
    ? `<div class="stub">
        <div class="stub-cut">&#9986; - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>
        <div class="stub-title">PAYMENT STUB</div>
        <table class="stub-table">
          <tr><td>${escapeHtml(company.name || '')}</td><td class="r">${escapeHtml(dd.number.label)} ${escapeHtml(doc.number)}</td></tr>
          <tr><td>${escapeHtml(c.customer.billToLabel)}: ${escapeHtml(doc.customer?.name || '')}</td><td class="r">${escapeHtml(tt.balanceDue.label)}: ${money(num(doc.balanceDue ?? doc.total))}</td></tr>
          <tr><td>Amount enclosed: ____________________</td><td class="r">Date: ______________</td></tr>
        </table>
      </div>`
    : ''

  // Header / footer bands: repeated ones live in the page table's thead/tfoot (Chrome repeats them on each printed page)
  const headerBand = bandHtml(c.header, 'page-header')
  const pageNo = c.footer.showPageNumber ? '<div class="page-no"></div>' : ''
  const footerBand = bandHtml(c.footer, 'page-footer', pageNo)
  const repeatHeader = headerBand && !c.header.firstPageOnly
  const repeatFooter = footerBand && !c.footer.firstPageOnly

  const body = `
    ${headerBand && !repeatHeader ? headerBand : ''}
    <div class="top">
      <div class="org">${orgParts.join('')}</div>
      ${titleHtml}
    </div>
    <div class="meta">
      <div class="parties">${parties.join('')}</div>
      ${detailsHtml}
    </div>
    <table class="lines">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${thead}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${cols.length || 1}" class="c muted">No items</td></tr>`}</tbody>
    </table>
    <div class="after-lines">
      <div class="left-col">${wordsHtml}${blocks.join('')}</div>
      <div class="right-col"><table class="totals">${totalRows.join('')}</table>${signatureHtml}</div>
    </div>
    ${annexureHtml}
    ${stubHtml}
    ${footerBand && !repeatFooter ? footerBand : ''}`

  const css = `
@page { size: ${pageW}mm ${pageH}mm; margin: ${m.top}${u} ${m.right}${u} ${m.bottom}${u} ${m.left}${u}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ${font}; font-size: ${g.fontSize}pt; line-height: 1.4; color: ${textColor}; background: ${bgColor};
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { position: relative; background-color: ${bgColor};${bgImage ? ` background-image: url("${bgImage}"); background-size: cover; background-position: center; background-repeat: no-repeat;` : ''} }
table.page { width: 100%; border-collapse: collapse; }
table.page > thead > tr > td, table.page > tfoot > tr > td, table.page > tbody > tr > td { padding: 0; border: 0; }
.page-header { padding: 6px 8px; margin-bottom: 10px; }
.page-footer { padding: 6px 8px; margin-top: 12px; }
.band-img img { max-width: 100%; max-height: 1.6in; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
.org { display: flex; gap: 12px; align-items: flex-start; }
.logo { display: block; max-width: 2.6in; object-fit: contain; }
.org-name { font-weight: 700; line-height: 1.2; }
.org-legal { font-weight: 600; }
.org-address { color: inherit; opacity: .85; margin-top: 2px; }
.doc-title-block { text-align: right; }
.doc-title { font-weight: 700; letter-spacing: .5px; line-height: 1.1; }
.doc-number { font-weight: 600; margin-top: 2px; }
.doc-balance { margin-top: 8px; }
.doc-balance-amt { font-size: 1.35em; font-weight: 700; }
.muted { opacity: .65; }
.meta { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.parties { display: flex; gap: 28px; }
.party-label { font-size: .85em; text-transform: uppercase; letter-spacing: .4px; opacity: .65; margin-bottom: 2px; }
.party-name { font-weight: 700; }
table.details { border-collapse: collapse; margin-left: auto; }
table.details td { padding: 1px 0 1px 10px; vertical-align: top; }
table.details td.dk { text-align: right; opacity: .7; white-space: nowrap; }
table.details td.dv { text-align: right; font-weight: 600; }
table.lines { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: ${t.fontSize}pt; }
table.lines th { background: ${safeColor(t.headerBackground, '#1f2937')}; color: ${safeColor(t.headerTextColor, '#ffffff')}; font-weight: 600; text-align: left; padding: 5px 6px; }
table.lines td { padding: 5px 6px; border-bottom: 1px solid ${safeColor(t.borderColor, '#e5e7eb')}; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
${t.striped ? `table.lines tbody tr:nth-child(even) td { background: ${safeColor(t.stripeColor, '#f8fafc')}; }` : ''}
table.lines thead { display: table-header-group; }
table.lines tr { page-break-inside: avoid; break-inside: avoid; }
.r { text-align: right !important; }
.c { text-align: center !important; }
.item-name { font-weight: 600; }
.sub { font-size: .88em; opacity: .8; }
.serials { font-family: 'Courier New', ui-monospace, monospace; font-size: .9em; }
.after-lines { display: flex; justify-content: space-between; gap: 20px; margin-top: 10px; page-break-inside: avoid; break-inside: avoid; }
.left-col { flex: 1 1 55%; }
.right-col { flex: 0 0 42%; }
table.totals { width: 100%; border-collapse: collapse; }
table.totals td { padding: 4px 6px; }
table.totals td.tl { text-align: right; opacity: .85; }
table.totals td.tv { text-align: right; white-space: nowrap; width: 45%; }
table.totals tr.grand td { font-weight: 700; font-size: 1.12em; border-top: 1px solid ${safeColor(t.borderColor, '#e5e7eb')}; }
table.totals tr.balance td { font-weight: 700; }
.words { margin-bottom: 10px; }
.block { margin-bottom: 10px; }
.block-label { font-weight: 700; margin-bottom: 2px; }
.signature { margin-top: 28px; text-align: center; margin-left: auto; width: 70%; }
.signature img { max-height: 60px; max-width: 100%; display: block; margin: 0 auto 2px; }
.sig-space { height: 46px; }
.sig-line { border-top: 1px solid currentColor; opacity: .6; margin-bottom: 3px; }
.annexure { page-break-before: always; break-before: page; }
.stub { margin-top: 24px; page-break-inside: avoid; break-inside: avoid; }
.stub-cut { overflow: hidden; white-space: nowrap; opacity: .6; }
.stub-title { font-weight: 700; margin: 6px 0; letter-spacing: 1px; }
table.stub-table { width: 100%; border-collapse: collapse; }
table.stub-table td { padding: 4px 0; }
.page-no::after { content: counter(page); }
@media screen {
  body { background: ${opts.preview ? '#e5e7eb' : bgColor}; }
  ${opts.preview ? `.sheet { width: ${pageW}mm; min-height: ${pageH}mm; margin: 16px auto; padding: ${m.top}${u} ${m.right}${u} ${m.bottom}${u} ${m.left}${u}; box-shadow: 0 2px 12px rgba(0,0,0,.18); }` : `.sheet { max-width: ${pageW}mm; margin: 0 auto; padding: 12px; }`}
}
@media print { .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; } }
${opts.letterHead ? `${LETTER_HEAD_CSS}\n` : ''}${sanitizeCss(c.customCss)}`

  // Letter head (if any) above the repeated header band / below the repeated footer band
  const headHtml = `${letterHeadBlockHtml(opts.letterHead, 'header')}${repeatHeader ? headerBand : ''}`
  const footHtml = `${repeatFooter ? footerBand : ''}${letterHeadBlockHtml(opts.letterHead, 'footer')}`
  const content = headHtml || footHtml
    ? `<table class="page">${headHtml ? `<thead><tr><td>${headHtml}</td></tr></thead>` : ''}${footHtml ? `<tfoot><tr><td>${footHtml}</td></tr></tfoot>` : ''}<tbody><tr><td>${body}</td></tr></tbody></table>`
    : body

  const autoPrint = opts.autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print()},300)})</script>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(`${docTitle(c, doc.kind)} ${doc.number}`)}</title><style>${css}</style></head><body><div class="sheet">${content}</div>${autoPrint}</body></html>`
}

// ─── Pre-printed form renderer ─────────────────────────────────────────────

function plainAddress(p: InvoiceDocParty | InvoiceCompany | null | undefined): string {
  return (p?.address || '').trim()
}

/** Text of a form field (unescaped). */
export function formFieldText(
  f: Pick<FormField, 'key' | 'text'>,
  c: InvoiceTemplateConfig,
  doc: InvoiceDoc,
  company: InvoiceCompany,
  page = 0,
  pages = 1,
): string {
  const fmt = c.general.dateFormat
  const currency = (company.currency || 'LKR').toUpperCase()
  const amt = (v: number | null | undefined, skipZero = false) => (v == null || (skipZero && Math.abs(num(v)) < 0.005) ? '' : formatAmount(num(v)))
  const cust = doc.customer
  let v = ''
  switch (f.key) {
    case 'company.name': v = company.name || ''; break
    case 'company.address': v = plainAddress(company); break
    case 'company.phone': v = company.phone || ''; break
    case 'company.taxId': v = company.taxId || ''; break
    case 'doc.title': v = docTitle(c, doc.kind); break
    case 'doc.number': v = doc.number || ''; break
    case 'doc.date': v = formatDocDate(doc.date, fmt); break
    case 'doc.dueDate': v = formatDocDate(doc.dueDate, fmt); break
    case 'doc.validUntil': v = formatDocDate(doc.validUntil, fmt); break
    case 'doc.deliveryDate': v = formatDocDate(doc.deliveryDate, fmt); break
    case 'doc.reference': v = doc.reference || ''; break
    case 'doc.salesperson': v = doc.salesperson || ''; break
    case 'doc.terms': v = doc.terms || ''; break
    case 'doc.originalInvoice': v = doc.originalInvoiceNo || ''; break
    case 'doc.status': v = (doc.status || '').replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()); break
    case 'customer.name': v = cust?.name || ''; break
    case 'customer.address': v = plainAddress(cust); break
    case 'customer.phone': v = cust?.phone || ''; break
    case 'customer.email': v = cust?.email || ''; break
    case 'customer.taxId': v = cust?.taxId || ''; break
    case 'totals.subtotal': v = amt(doc.subtotal); break
    case 'totals.discount': v = amt(doc.discount, true); break
    case 'totals.tax': v = amt(doc.tax, true); break
    case 'totals.total': v = amt(doc.total); break
    case 'totals.paid': v = amt(doc.paid, true); break
    case 'totals.balance': v = amt(doc.balanceDue); break
    case 'totals.words': v = amountInWords(doc.total, currency); break
    case 'notes': v = doc.notes || ''; break
    case 'serials':
      v = doc.lines
        .map((l) => {
          const sn = (l.serialNumbers || []).filter(Boolean)
          const w = warrantyText(l.warrantyMonths, l.warrantyUntil, fmt)
          if (!sn.length && !w) return ''
          return `${l.name}: ${[sn.length ? `S/N ${sn.join(', ')}` : '', w ? `Warranty ${w}` : ''].filter(Boolean).join(' · ')}`
        })
        .filter(Boolean)
        .join('\n')
      break
    case 'page': v = `Page ${page + 1} of ${pages}`; break
    case 'continued': v = page < pages - 1 ? 'Continued…' : ''; break
    case 'text': return f.text
  }
  return v ? `${f.text}${v}` : ''
}

interface FormRow { cells: Partial<Record<FormColumnKey, string>> }

/** Item rows of a form (one per line, plus a serial / warranty row when enabled). */
export function formItemRows(c: InvoiceTemplateConfig, doc: InvoiceDoc): FormRow[] {
  const fmt = c.general.dateFormat
  const hasUnitCol = c.form.columns.some((col) => col.key === 'unit')
  const rows: FormRow[] = []
  doc.lines.forEach((l, i) => {
    const serials = (l.serialNumbers || []).filter(Boolean)
    const warranty = warrantyText(l.warrantyMonths, l.warrantyUntil, fmt)
    rows.push({
      cells: {
        lineNo: String(i + 1),
        item: l.name,
        description: l.description || '',
        sku: l.sku || '',
        serial: serials.join(', '),
        warranty,
        qty: `${formatQty(l.quantity)}${!hasUnitCol && l.unit ? ` ${l.unit}` : ''}`,
        unit: l.unit || '',
        rate: formatAmount(l.unitPrice),
        discount: num(l.discount) ? formatAmount(num(l.discount)) : '',
        taxAmount: num(l.taxAmount) ? formatAmount(num(l.taxAmount)) : '',
        amount: formatAmount(l.amount),
      },
    })
    if (c.form.items.serialRow && (serials.length || warranty)) {
      rows.push({ cells: { item: [serials.length ? `S/N: ${serials.join(', ')}` : '', warranty ? `Warranty: ${warranty}` : ''].filter(Boolean).join('   ') } })
    }
  })
  return rows
}

function formPageCss(c: InvoiceTemplateConfig, pageW: number, pageH: number, preview: boolean): string {
  const f = c.form
  const font = INVOICE_FONT_STACKS[c.general.fontFamily]?.css || INVOICE_FONT_STACKS.sans.css
  return `
@page { size: ${pageW}mm ${pageH}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ${font}; color: ${safeColor(c.general.textColor, '#000000')}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.fpage { position: relative; width: ${pageW}mm; height: ${pageH}mm; overflow: hidden; background: #fff; page-break-after: always; break-after: page; }
.fpage:last-child { page-break-after: auto; break-after: auto; }
.flayer { position: absolute; left: ${roundMm(f.offsetX)}mm; top: ${roundMm(f.offsetY)}mm; width: ${pageW}mm; height: ${pageH}mm; }
.fbg { position: absolute; left: 0; top: 0; width: ${pageW}mm; height: ${pageH}mm; object-fit: fill; }
.ff { position: absolute; line-height: ${FORM_LINE_HEIGHT}; overflow: hidden; text-overflow: clip; }
@media screen {
  body { background: ${preview ? '#e5e7eb' : '#fff'}; }
  .sheet { width: ${pageW}mm; margin: 0 auto; }
  .fpage { margin: 16px auto; box-shadow: 0 2px 12px rgba(0,0,0,.18); }
  .screen-only.fbg { opacity: .45; }
}
@media print { .screen-only { display: none !important; } }
${sanitizeCss(c.customCss)}`
}

function formBackgroundHtml(c: InvoiceTemplateConfig, preview: boolean): string {
  const bg = safeImageUrl(c.form.backgroundImage)
  if (!bg || (!c.form.printBackground && !preview)) return ''
  return `<img class="fbg${c.form.printBackground ? '' : ' screen-only'}" src="${escapeHtml(bg)}" alt="">`
}

/**
 * Pre-printed form mode: every page is exactly the paper size (@page margin 0) and each field is
 * absolutely positioned in mm from the paper's top-left corner (+ calibration offset). Items beyond
 * `form.items.maxRows` continue on further pages; fields marked 'last' (totals) print on the last
 * page only.
 */
export function renderFormHtml(
  configInput: InvoiceTemplateConfig | DeepPartial<InvoiceTemplateConfig> | null | undefined,
  doc: InvoiceDoc,
  company: InvoiceCompany,
  opts: RenderOptions = {},
): string {
  const c = mergeTemplateConfig(configInput ?? {})
  const { width: pageW, height: pageH } = templatePageMm(c)
  const f = c.form
  const pages = f.items.show ? paginateRows(formItemRows(c, doc), f.items.maxRows) : [[]]
  const bg = formBackgroundHtml(c, !!opts.preview)
  const pageHtml = pages.map((rows, p) => {
    const fields = f.fields
      .filter((fl) => fieldOnPage(fl, p, pages.length))
      .map((fl) => {
        const text = formFieldText(fl, c, doc, company, p, pages.length)
        return text ? `<div class="ff" data-key="${escapeHtml(fl.key)}" style="${formBoxCss(fl)}">${escapeHtml(text)}</div>` : ''
      })
      .join('')
    const items = f.items.show
      ? rows.map((row, i) => f.columns.map((col) => {
        const v = row.cells[col.key]
        if (!v) return ''
        const box = { x: f.items.x + col.x, y: formRowTop(f.items, i), width: col.width, fontSize: f.items.fontSize, align: col.align }
        return `<div class="ff fi" style="${formBoxCss(box)}">${escapeHtml(v)}</div>`
      }).join('')).join('')
      : ''
    return `<div class="fpage"><div class="flayer">${bg}${fields}${items}</div></div>`
  }).join('')
  const autoPrint = opts.autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print()},300)})</script>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(`${docTitle(c, doc.kind)} ${doc.number}`)}</title><style>${formPageCss(c, pageW, pageH, !!opts.preview)}</style></head><body><div class="sheet">${pageHtml}</div>${autoPrint}</body></html>`
}

/**
 * Calibration test page for a form template: a mm grid (fine line every 5 mm, numbered every
 * 10 mm) plus the outline of every field and the items region, all shifted by the calibration
 * offset. Print it on the pre-printed form (or plain paper held against it) and adjust
 * offset X / Y until the boxes land on the form's boxes.
 */
export function renderFormCalibrationHtml(configInput: InvoiceTemplateConfig | DeepPartial<InvoiceTemplateConfig> | null | undefined): string {
  const c = mergeTemplateConfig(configInput ?? {})
  const { width: W, height: H } = templatePageMm(c)
  const f = c.form
  const lines: string[] = []
  for (let x = 0; x <= W; x += 5) {
    const major = x % 10 === 0
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${major ? '#666' : '#bbb'}" stroke-width="${major ? 0.2 : 0.1}"/>`)
    if (major && x > 0) lines.push(`<text x="${x + 0.6}" y="3" font-size="2.4">${x}</text>`)
  }
  for (let y = 0; y <= H; y += 5) {
    const major = y % 10 === 0
    lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${major ? '#666' : '#bbb'}" stroke-width="${major ? 0.2 : 0.1}"/>`)
    if (major && y > 0) lines.push(`<text x="0.6" y="${y - 0.6}" font-size="2.4">${y}</text>`)
  }
  const boxes: string[] = []
  const box = (x: number, y: number, w: number, h: number, label: string, color: string) => {
    boxes.push(`<rect x="${roundMm(x)}" y="${roundMm(y)}" width="${roundMm(w)}" height="${roundMm(h)}" fill="none" stroke="${color}" stroke-width="0.3" stroke-dasharray="1.2 0.8"/>`)
    boxes.push(`<text x="${roundMm(x + 0.5)}" y="${roundMm(y + 2.6)}" font-size="2.2" fill="${color}">${escapeHtml(label)}</text>`)
  }
  const ptToMm = 25.4 / 72
  for (const fl of f.fields) {
    box(fl.x, fl.y, fl.width, Math.max(2, fl.lines * fl.fontSize * FORM_LINE_HEIGHT * ptToMm), fl.key === 'text' ? `"${fl.text.slice(0, 30)}"` : FORM_FIELD_LABELS[fl.key], '#dc2626')
  }
  if (f.items.show) {
    box(f.items.x, f.items.y, Math.max(f.items.width, 10), f.items.maxRows * f.items.rowHeight, `Items (${f.items.maxRows} rows × ${f.items.rowHeight} mm)`, '#2563eb')
    for (const col of f.columns) box(f.items.x + col.x, f.items.y, col.width, f.items.rowHeight, col.key, '#2563eb')
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0" font-family="Arial, sans-serif">${lines.join('')}${boxes.join('')}</svg>`
  const note = `<div class="ff" style="left:${roundMm(W * 0.15)}mm;top:${roundMm(H * 0.45)}mm;width:${roundMm(W * 0.7)}mm;font-size:9pt;white-space:pre-wrap;background:#fff;border:0.3mm solid #111;padding:2mm">CALIBRATION PAGE — ${escapeHtml(INVOICE_PAPER_MM[c.general.paperSize]?.label || '')} ${roundMm(W)} × ${roundMm(H)} mm, offset X ${roundMm(f.offsetX)} mm / Y ${roundMm(f.offsetY)} mm.
Print at 100 % scale (no "fit to page"). The 10 mm grid lines must be exactly 10 mm apart; if the red boxes land too far right / down on your form, make the offset smaller (negative moves left / up).</div>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form calibration</title><style>${formPageCss(c, W, H, false)}</style></head><body><div class="sheet"><div class="fpage"><div class="flayer">${formBackgroundHtml({ ...c, form: { ...f, printBackground: false } }, true)}${svg}${note}</div></div></div></body></html>`
}

// ─── Sample data (designer preview) ───────────────────────────────────────

export function sampleInvoiceDoc(kind: InvoiceDocKind = 'invoice'): InvoiceDoc {
  const today = new Date()
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const plus = (months: number, days = 0) => { const d = new Date(today); d.setMonth(d.getMonth() + months); d.setDate(d.getDate() + days); return iso(d) }
  const lines: InvoiceDocLine[] = [
    { name: 'Double Door Refrigerator 340L', description: 'Inverter, frost free', sku: 'FRG-340', quantity: 1, unit: 'Nos', unitPrice: 245000, discount: 5000, taxRate: 18, taxAmount: 43200, amount: 240000, serialNumbers: ['RF340-22A91873'], warrantyMonths: 24, warrantyUntil: plus(24) },
    { name: 'Smart LED TV 55"', description: '4K UHD, Android TV', sku: 'TV-55U', quantity: 1, unit: 'Nos', unitPrice: 189900, taxRate: 18, taxAmount: 34182, amount: 189900, serialNumbers: ['TV55-8812-0043'], warrantyMonths: 12, warrantyUntil: plus(12) },
    { name: 'Sewing Machine (Domestic)', sku: 'SEW-D1', quantity: 2, unit: 'Nos', unitPrice: 42500, taxRate: 18, taxAmount: 15300, amount: 85000, serialNumbers: ['SM-77120', 'SM-77121'], warrantyMonths: 6, warrantyUntil: plus(6) },
    { name: 'Voltage Guard', quantity: 3, unit: 'Nos', unitPrice: 3500, taxRate: 18, taxAmount: 1890, amount: 10500 },
  ]
  const subtotal = lines.reduce((s, l) => s + l.amount, 0)
  const tax = lines.reduce((s, l) => s + num(l.taxAmount), 0)
  const total = subtotal + tax
  return {
    kind,
    number: kind === 'quotation' ? 'QT-000123' : kind === 'credit_note' ? 'CN-000012' : 'INV-000456',
    date: iso(today),
    dueDate: kind === 'quotation' ? null : plus(0, 30),
    validUntil: kind === 'quotation' ? plus(0, 14) : null,
    terms: 'Net 30',
    reference: 'PO-7781',
    salesperson: 'Nimal Perera',
    originalInvoiceNo: kind === 'credit_note' ? 'INV-000401' : null,
    customer: { name: 'Kamal Fernando', address: '25, Galle Road\nColombo 03', phone: '077 123 4567', email: 'kamal@example.lk', taxId: '' },
    lines,
    subtotal,
    discount: 0,
    tax,
    taxBreakdown: [{ name: 'VAT', rate: 18, amount: tax }],
    total,
    paid: kind === 'quotation' ? null : 300000,
    balanceDue: kind === 'quotation' ? null : total - 300000,
    notes: kind === 'quotation' ? 'Prices are valid until the date above. Delivery within Colombo is free.' : 'Thank you for shopping with us. Keep this invoice for warranty claims.',
  }
}
