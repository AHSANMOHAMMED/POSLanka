/**
 * "Pre-printed form" layouts for document templates (stored in print_templates.config.form, no
 * migration): the user uploads a scan / design of their printed invoice form, then places each
 * field (customer name, invoice no, items table columns, totals …) at an exact position in mm
 * from the top-left corner of the paper. renderInvoiceHtml() prints the fields absolutely
 * positioned on a page of exactly the paper size, with the background image either printed
 * (plain paper) or only shown in the designer (pre-printed stationery).
 *
 * Calibration: offsetX / offsetY (mm) shift every field (and the background) to compensate for
 * the printer's feed / left-edge offset; a test print with a mm grid helps to measure it.
 *
 * Pure module (no DOM / server imports).
 */

export const FORM_FIELD_KEYS = [
  'company.name', 'company.address', 'company.phone', 'company.taxId',
  'doc.title', 'doc.number', 'doc.date', 'doc.dueDate', 'doc.validUntil', 'doc.deliveryDate', 'doc.reference', 'doc.salesperson',
  'doc.terms', 'doc.originalInvoice', 'doc.status',
  'customer.name', 'customer.address', 'customer.phone', 'customer.email', 'customer.taxId',
  'totals.subtotal', 'totals.discount', 'totals.tax', 'totals.total', 'totals.paid', 'totals.balance', 'totals.words',
  'notes', 'serials', 'page', 'continued', 'text',
] as const
export type FormFieldKey = (typeof FORM_FIELD_KEYS)[number]

export const FORM_FIELD_LABELS: Record<FormFieldKey, string> = {
  'company.name': 'Business name',
  'company.address': 'Business address',
  'company.phone': 'Business phone',
  'company.taxId': 'Business VAT / tax no.',
  'doc.title': 'Document title',
  'doc.number': 'Document number',
  'doc.date': 'Date',
  'doc.dueDate': 'Due date',
  'doc.validUntil': 'Valid until',
  'doc.deliveryDate': 'Delivery date',
  'doc.reference': 'Reference / P.O.',
  'doc.salesperson': 'Sales person',
  'doc.terms': 'Terms',
  'doc.originalInvoice': 'Original invoice',
  'doc.status': 'Status',
  'customer.name': 'Customer name',
  'customer.address': 'Customer address',
  'customer.phone': 'Customer phone',
  'customer.email': 'Customer email',
  'customer.taxId': 'Customer VAT no.',
  'totals.subtotal': 'Sub total',
  'totals.discount': 'Discount',
  'totals.tax': 'Tax',
  'totals.total': 'Total',
  'totals.paid': 'Paid',
  'totals.balance': 'Balance due',
  'totals.words': 'Amount in words',
  notes: 'Notes',
  serials: 'Serial numbers / warranty (all lines)',
  page: 'Page number (Page 1 of 2)',
  continued: '"Continued…" (all pages but the last)',
  text: 'Fixed text',
}

export const FORM_COLUMN_KEYS = [
  'lineNo', 'item', 'description', 'sku', 'serial', 'warranty', 'qty', 'unit', 'rate', 'discount', 'taxAmount', 'amount',
] as const
export type FormColumnKey = (typeof FORM_COLUMN_KEYS)[number]

export const FORM_COLUMN_LABELS: Record<FormColumnKey, string> = {
  lineNo: '#', item: 'Item', description: 'Description', sku: 'Code', serial: 'Serial no.', warranty: 'Warranty',
  qty: 'Qty', unit: 'Unit', rate: 'Rate', discount: 'Discount', taxAmount: 'Tax', amount: 'Amount',
}

export type FormAlign = 'left' | 'center' | 'right'
/** On which pages a field prints when the items run over several pages. */
export type FormFieldPages = 'all' | 'first' | 'last'

export interface FormField {
  id: string
  key: FormFieldKey
  /** mm from the left / top paper edge. */
  x: number
  y: number
  /** Box width in mm (text is clipped / wrapped inside it). */
  width: number
  /** Number of text lines the box may use (1 = single line, clipped). */
  lines: number
  /** pt */
  fontSize: number
  bold: boolean
  align: FormAlign
  pages: FormFieldPages
  /** Fixed text for key 'text'; for other keys a prefix printed before the value (e.g. "Rs. "). */
  text: string
}

export interface FormColumn {
  key: FormColumnKey
  /** mm from the items region's left edge. */
  x: number
  width: number
  align: FormAlign
}

export interface FormItemsRegion {
  show: boolean
  /** Top-left corner of the first item row (mm from the paper edge). */
  x: number
  y: number
  /** Region width (mm) — designer guide only. */
  width: number
  /** Distance between item rows (mm). */
  rowHeight: number
  /** Rows that fit on one page; more items continue on a new page. */
  maxRows: number
  fontSize: number
  /** Print serial numbers / warranty on an extra row under the item. */
  serialRow: boolean
}

export interface FormLayoutConfig {
  enabled: boolean
  /** Scanned / designed form (URL of an uploaded file, or a data URL). */
  backgroundImage: string
  /** Print the background (plain paper); off = pre-printed stationery, background only in the designer. */
  printBackground: boolean
  /** Calibration shift (mm, + = right / down). */
  offsetX: number
  offsetY: number
  fields: FormField[]
  items: FormItemsRegion
  columns: FormColumn[]
}

export const FORM_MAX_FIELDS = 80
export const FORM_MAX_COLUMNS = 16
export const FORM_LINE_HEIGHT = 1.2
const POS_MAX = 1200

export const DEFAULT_FORM_LAYOUT: FormLayoutConfig = {
  enabled: false,
  backgroundImage: '',
  printBackground: false,
  offsetX: 0,
  offsetY: 0,
  fields: [],
  items: { show: true, x: 10, y: 100, width: 190, rowHeight: 6, maxRows: 20, fontSize: 9, serialRow: false },
  columns: [],
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function numIn(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : dflt
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt)

/** Tolerant parse of stored fields (unknown keys dropped, numbers clamped). */
export function sanitizeFormFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return []
  const out: FormField[] = []
  for (const [i, r] of raw.entries()) {
    if (out.length >= FORM_MAX_FIELDS) break
    if (!isObj(r) || !(FORM_FIELD_KEYS as readonly string[]).includes(r.key as string)) continue
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : `f${i + 1}`,
      key: r.key as FormFieldKey,
      x: numIn(r.x, 0, POS_MAX, 10),
      y: numIn(r.y, 0, POS_MAX, 10),
      width: numIn(r.width, 2, POS_MAX, 60),
      lines: Math.round(numIn(r.lines, 1, 30, 1)),
      fontSize: numIn(r.fontSize, 4, 40, 10),
      bold: r.bold === true,
      align: oneOf(r.align, ['left', 'center', 'right'] as const, 'left'),
      pages: oneOf(r.pages, ['all', 'first', 'last'] as const, 'all'),
      text: typeof r.text === 'string' ? r.text.slice(0, 500) : '',
    })
  }
  return out
}

export function sanitizeFormColumns(raw: unknown): FormColumn[] {
  if (!Array.isArray(raw)) return []
  const out: FormColumn[] = []
  for (const r of raw) {
    if (out.length >= FORM_MAX_COLUMNS) break
    if (!isObj(r) || !(FORM_COLUMN_KEYS as readonly string[]).includes(r.key as string)) continue
    out.push({
      key: r.key as FormColumnKey,
      x: numIn(r.x, 0, POS_MAX, 0),
      width: numIn(r.width, 2, POS_MAX, 20),
      align: oneOf(r.align, ['left', 'center', 'right'] as const, 'left'),
    })
  }
  return out
}

/** Fields printed on page `page` (0-based) of `pages`. */
export function fieldOnPage(f: Pick<FormField, 'pages'>, page: number, pages: number): boolean {
  if (f.pages === 'first') return page === 0
  if (f.pages === 'last') return page === pages - 1
  return true
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Inline CSS of an absolutely positioned box, in mm from the (calibrated) page origin.
 * Line height is FORM_LINE_HEIGHT; multi-line boxes are capped at `lines` lines.
 */
export function formBoxCss(box: { x: number; y: number; width: number; fontSize: number; bold?: boolean; align?: FormAlign; lines?: number }): string {
  const lines = Math.max(1, Math.round(box.lines || 1))
  const parts = [
    `left:${r2(box.x)}mm`, `top:${r2(box.y)}mm`, `width:${r2(box.width)}mm`, `font-size:${r2(box.fontSize)}pt`,
    `text-align:${box.align || 'left'}`, `font-weight:${box.bold ? 700 : 400}`,
  ]
  if (lines > 1) parts.push('white-space:pre-wrap', `max-height:${r2(lines * box.fontSize * FORM_LINE_HEIGHT)}pt`)
  else parts.push('white-space:nowrap')
  return parts.join(';')
}

/** Top (mm) of item row `i` (0-based) inside the items region. */
export function formRowTop(items: Pick<FormItemsRegion, 'y' | 'rowHeight'>, i: number): number {
  return r2(items.y + i * items.rowHeight)
}

/** Height (mm) of the items region: rows per page × row height. */
export function formItemsHeightMm(items: Pick<FormItemsRegion, 'rowHeight' | 'maxRows'>): number {
  return r2(items.rowHeight * items.maxRows)
}

/** Split rows into pages of `maxRows` (always at least one page). */
export function paginateRows<T>(rows: T[], maxRows: number): T[][] {
  const per = Math.max(1, Math.floor(maxRows) || 1)
  const pages: T[][] = []
  for (let i = 0; i < rows.length; i += per) pages.push(rows.slice(i, i + per))
  return pages.length ? pages : [[]]
}

let idSeq = 0
export function newFormFieldId(): string {
  idSeq = (idSeq + 1) % 1e6
  return `f${Date.now().toString(36)}${idSeq.toString(36)}`
}

function field(key: FormFieldKey, x: number, y: number, width: number, over: Partial<FormField> = {}): FormField {
  return { id: newFormFieldId(), key, x, y, width, lines: 1, fontSize: 10, bold: false, align: 'left', pages: 'all', text: '', ...over }
}

/**
 * Starting layout for a page of the given width / height (mm): a typical invoice form. The user
 * then drags each box onto the boxes of their own form.
 */
export function formPreset(pageW: number, pageH: number): Pick<FormLayoutConfig, 'fields' | 'items' | 'columns'> {
  const sx = pageW / 210
  const sy = pageH / 297
  const X = (v: number) => r2(v * sx)
  const Y = (v: number) => r2(v * sy)
  const half = pageH < 200
  const fields: FormField[] = [
    field('company.name', X(12), Y(12), X(110), { fontSize: 14, bold: true }),
    field('company.address', X(12), Y(20), X(110), { lines: 3, fontSize: 9 }),
    field('doc.title', X(140), Y(12), X(58), { fontSize: 14, bold: true, align: 'right' }),
    field('doc.number', X(140), Y(22), X(58), { align: 'right' }),
    field('doc.date', X(140), Y(28), X(58), { align: 'right' }),
    field('customer.name', X(12), Y(45), X(110), { bold: true }),
    field('customer.address', X(12), Y(51), X(110), { lines: 2, fontSize: 9 }),
    field('customer.phone', X(12), Y(61), X(80), { fontSize: 9 }),
    field('totals.subtotal', X(150), Y(half ? 240 : 238), X(48), { align: 'right', pages: 'last' }),
    field('totals.tax', X(150), Y(half ? 252 : 245), X(48), { align: 'right', pages: 'last' }),
    field('totals.total', X(150), Y(half ? 264 : 252), X(48), { align: 'right', bold: true, pages: 'last' }),
    field('totals.words', X(12), Y(half ? 240 : 238), X(125), { lines: 2, fontSize: 9, pages: 'last' }),
    field('continued', X(150), Y(half ? 240 : 238), X(48), { align: 'right', fontSize: 9, pages: 'all' }),
    field('page', X(150), Y(half ? 282 : 285), X(48), { align: 'right', fontSize: 8 }),
  ]
  if (!half) fields.push(field('notes', X(12), Y(262), X(125), { lines: 3, fontSize: 8, pages: 'last' }))
  const regionTop = Y(80)
  const regionBottom = Y(half ? 232 : 230)
  const rowHeight = 6
  return {
    fields,
    items: { show: true, x: X(10), y: regionTop, width: X(190), rowHeight, maxRows: Math.max(1, Math.floor((regionBottom - regionTop) / rowHeight)), fontSize: 9, serialRow: false },
    columns: [
      { key: 'lineNo', x: 0, width: X(8), align: 'center' },
      { key: 'item', x: X(10), width: X(92), align: 'left' },
      { key: 'qty', x: X(104), width: X(18), align: 'right' },
      { key: 'rate', x: X(124), width: X(30), align: 'right' },
      { key: 'amount', x: X(156), width: X(34), align: 'right' },
    ],
  }
}
