/**
 * Fixed-width text layout of invoices / receipts / quotations / credit notes / purchase orders for
 * dot matrix printers (ESC/P, escp.ts) — and the same layout as a monospace HTML page for the
 * browser fallback, at the printer's exact pitch (10 / 12 / 17 cpi, 6 lines per inch).
 *
 * Widths: 80 columns (8" carriage at 10 cpi, e.g. LQ-310), 96 (12 cpi), 136 (17 cpi condensed),
 * or anything from 32 columns up (receipt-style). Long item names wrap inside the item column;
 * pages break before the bottom perforation with "Continued…" and a repeated table header.
 *
 * Pure module (no DOM / server imports).
 */
import { encodeTextPages, linesPerPage, type EscpCpi, type TextLine } from './escp'
import {
  DEFAULT_INVOICE_TEMPLATE,
  amountInWords,
  escapeHtml,
  formatAmount,
  formatDocDate,
  type InvoiceCompany,
  type InvoiceDateFormat,
  type InvoiceDoc,
  type InvoiceDocKind,
} from './invoice-template'
import { pageRuleCss, roundMm, MM_PER_INCH } from './paper'

export type { TextLine } from './escp'

export type TextColumnKey = 'lineNo' | 'sku' | 'item' | 'qty' | 'unit' | 'rate' | 'discount' | 'tax' | 'amount'

export interface TextColumn {
  key: TextColumnKey
  label: string
  width: number
  align: 'left' | 'right'
}

export const MIN_TEXT_COLS = 32
export const MAX_TEXT_COLS = 240

/** Columns for a carriage width (inches) at a pitch: LQ-310 = 8" → 80 @10 cpi, 96 @12, 136 @17. */
export function textColsFor(carriageInches: number, cpi: number): number {
  return Math.min(MAX_TEXT_COLS, Math.max(MIN_TEXT_COLS, Math.floor(carriageInches * cpi + 1e-9)))
}

/**
 * Item table columns for a line width: the item column takes what is left; columns are separated
 * by one space, so the widths + separators add up to exactly `cols`.
 */
export function textTableColumns(colsIn: number): TextColumn[] {
  const cols = Math.min(MAX_TEXT_COLS, Math.max(MIN_TEXT_COLS, Math.floor(colsIn)))
  const C = (key: TextColumnKey, label: string, width: number, align: 'left' | 'right' = 'right'): TextColumn => ({ key, label, width, align })
  let fixed: TextColumn[]
  if (cols >= 120) {
    fixed = [C('lineNo', '#', 4), C('sku', 'Code', 12, 'left'), C('item', 'Description', 0, 'left'), C('qty', 'Qty', 8), C('unit', 'Unit', 5, 'left'),
      C('rate', 'Rate', 12), C('discount', 'Disc.', 10), C('tax', 'Tax', 10), C('amount', 'Amount', 14)]
  } else if (cols >= 64) {
    fixed = [C('lineNo', '#', 3), C('item', 'Description', 0, 'left'), C('qty', 'Qty', 7), C('rate', 'Rate', 12), C('amount', 'Amount', 13)]
  } else {
    fixed = [C('item', 'Item', 0, 'left'), C('qty', 'Qty', 5), C('amount', 'Amount', 11)]
  }
  const used = fixed.reduce((s, c) => s + c.width, 0) + (fixed.length - 1)
  return fixed.map((c) => (c.key === 'item' ? { ...c, width: cols - used } : c))
}

function fit(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const t = s.length > width ? s.slice(0, width) : s
  return align === 'right' ? t.padStart(width) : t.padEnd(width)
}

function center(s: string, width: number): string {
  const t = s.length > width ? s.slice(0, width) : s
  const left = Math.floor((width - t.length) / 2)
  return (' '.repeat(left) + t).padEnd(width)
}

/** Word-wrap to `width` (long words are cut). */
export function wrapText(s: string, width: number): string[] {
  const out: string[] = []
  for (const para of String(s ?? '').split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word
      while (w.length > width) {
        if (line) { out.push(line); line = '' }
        out.push(w.slice(0, width))
        w = w.slice(width)
      }
      if (!w) continue
      if (!line) line = w
      else if (line.length + 1 + w.length <= width) line += ` ${w}`
      else { out.push(line); line = w }
    }
    out.push(line)
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop()
  return out
}

function qtyText(n: number): string {
  return String(Math.round((Number(n) || 0) * 1000) / 1000)
}

export interface TextDocOptions {
  /** Line width in characters. */
  cols: number
  /** Lines between perforations (6 lpi × page length in inches). */
  linesPerPage: number
  /** Blank lines kept at the top / bottom of each page (perforation skip). Default 1 / 2. */
  topLines?: number
  bottomLines?: number
  dateFormat?: InvoiceDateFormat
  /** Document titles (template titles); defaults to the built-in ones. */
  titles?: Partial<Record<'invoice' | 'taxInvoice' | 'quotation' | 'creditNote' | 'purchaseOrder', string>>
  /** Printed centred under the totals (e.g. "Thank you for your business!"). */
  footerText?: string
  /** Print an "Authorized signature" line. Default true. */
  signature?: boolean
}

function titleOf(kind: InvoiceDocKind, titles: TextDocOptions['titles']): string {
  const t = { ...DEFAULT_INVOICE_TEMPLATE.titles, ...(titles || {}) }
  switch (kind) {
    case 'tax_invoice': return t.taxInvoice
    case 'quotation': return t.quotation
    case 'credit_note': return t.creditNote
    case 'purchase_order': return t.purchaseOrder
    default: return t.invoice
  }
}

/** Lay a document out as pages of fixed-width text lines. */
export function layoutTextDocument(doc: InvoiceDoc, company: InvoiceCompany, opts: TextDocOptions): TextLine[][] {
  const cols = Math.min(MAX_TEXT_COLS, Math.max(MIN_TEXT_COLS, Math.floor(opts.cols)))
  const top = Math.max(0, opts.topLines ?? 1)
  const bottom = Math.max(0, opts.bottomLines ?? 2)
  const capacity = Math.max(12, opts.linesPerPage - top - bottom)
  const fmt = opts.dateFormat || 'DD/MM/YYYY'
  const currency = (company.currency || 'LKR').toUpperCase()
  const title = titleOf(doc.kind, opts.titles)
  const L = (text: string, bold = false): TextLine => (bold ? { text, bold } : { text })
  const rule = (ch = '-') => L(ch.repeat(cols))
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

  // ── Head (first page)
  const head: TextLine[] = []
  if (company.name) head.push(L(center(company.name, cols), true))
  for (const a of (company.address || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) head.push(L(center(a, cols)))
  const contact = [company.phone ? `Tel: ${company.phone}` : '', company.taxId ? `VAT: ${company.taxId}` : ''].filter(Boolean).join('   ')
  if (contact) head.push(L(center(contact, cols)))
  head.push(L(''))
  head.push(L(center(title, cols), true))
  head.push(rule('='))

  const rightW = Math.min(38, Math.floor(cols * 0.45))
  const leftW = cols - rightW - 2
  const right: string[] = []
  const kv = (k: string, v: string | null | undefined) => { if (v) right.push(`${k.padEnd(11)}: ${v}`) }
  kv('No', doc.number)
  kv('Date', formatDocDate(doc.date, fmt))
  if (doc.kind === 'quotation') kv('Valid until', formatDocDate(doc.validUntil, fmt))
  else kv('Due date', formatDocDate(doc.dueDate, fmt))
  kv('Delivery', formatDocDate(doc.deliveryDate, fmt))
  kv('Reference', doc.reference)
  kv('Salesperson', doc.salesperson)
  if (doc.kind === 'credit_note') kv('Against inv.', doc.originalInvoiceNo)
  const left: string[] = []
  const c = doc.customer
  if (c && (c.name || c.address || c.phone)) {
    left.push(doc.kind === 'purchase_order' ? 'Vendor:' : 'Bill to:')
    const lw = cols < 64 ? cols : leftW
    if (c.name) left.push(...wrapText(c.name, lw))
    for (const a of (c.address || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) left.push(...wrapText(a, lw))
    if (c.phone) left.push(`Tel: ${c.phone}`)
    if (c.taxId) left.push(`VAT: ${c.taxId}`)
  }
  if (cols < 64) {
    // Narrow (receipt-width) paper: document details first, then the customer
    for (const t of [...right, ...(right.length && left.length ? [''] : []), ...left]) head.push(L(fit(t, cols)))
  } else {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      head.push(L(`${fit(left[i] || '', leftW)}  ${fit(right[i] || '', rightW)}`))
    }
  }

  // ── Item table
  const tcols = textTableColumns(cols)
  const row = (cells: Partial<Record<TextColumnKey, string>>) => tcols.map((tc) => fit(cells[tc.key] || '', tc.width, tc.align)).join(' ')
  const tableHead: TextLine[] = [rule(), L(row(Object.fromEntries(tcols.map((tc) => [tc.key, tc.label]))), true), rule()]
  const itemCol = tcols.find((tc) => tc.key === 'item')!
  const groups: TextLine[][] = doc.lines.map((l, i) => {
    const name = [l.name, tcols.some((tc) => tc.key === 'sku') ? '' : l.sku ? `(${l.sku})` : ''].filter(Boolean).join(' ')
    const nameLines = wrapText(name, itemCol.width)
    const g: TextLine[] = [L(row({
      lineNo: String(i + 1), sku: l.sku || '', item: nameLines[0] || '',
      qty: `${qtyText(l.quantity)}${tcols.some((tc) => tc.key === 'unit') || !l.unit || cols < 64 ? '' : ` ${l.unit}`}`.slice(0, 12),
      unit: l.unit || '', rate: formatAmount(l.unitPrice), discount: num(l.discount) ? formatAmount(num(l.discount)) : '',
      tax: num(l.taxAmount) ? formatAmount(num(l.taxAmount)) : '', amount: formatAmount(l.amount),
    }))]
    const extra = nameLines.slice(1)
    if (cols < 64) extra.push(`  ${qtyText(l.quantity)} x ${formatAmount(l.unitPrice)}`)
    const serials = (l.serialNumbers || []).filter(Boolean)
    if (serials.length) extra.push(...wrapText(`S/N: ${serials.join(', ')}`, itemCol.width))
    if (num(l.warrantyMonths) > 0) {
      const m = num(l.warrantyMonths)
      extra.push(...wrapText(`Warranty: ${m === 1 ? '1 month' : `${m} months`}${l.warrantyUntil ? ` (until ${formatDocDate(l.warrantyUntil, fmt)})` : ''}`, itemCol.width))
    }
    for (const t of extra) g.push(L(row({ item: t })))
    return g
  })

  // ── Totals / words / notes / signature
  const tail: TextLine[] = [rule()]
  const tw = Math.min(cols, 46)
  const valW = 16
  const total = (label: string, value: number, bold = false) =>
    tail.push(L(`${' '.repeat(cols - tw)}${fit(label, tw - valW - 1, 'right')} ${fit(formatAmount(value), valW, 'right')}`, bold))
  total('Sub total', num(doc.subtotal))
  if (num(doc.discount) > 0.004) total('Discount', -num(doc.discount))
  if (num(doc.shipping) > 0.004) total('Shipping', num(doc.shipping))
  const breakdown = (doc.taxBreakdown || []).filter((b) => num(b.amount) !== 0)
  const incl = doc.taxInclusive ? ' (incl.)' : ''
  if (breakdown.length) for (const b of breakdown) total(`${b.name}${b.rate != null && !String(b.name).includes('%') ? ` ${num(b.rate)}%` : ''}${incl}`, num(b.amount))
  else if (num(doc.tax) > 0.004) total(`Tax${incl}`, num(doc.tax))
  total(`TOTAL (${currency})`, num(doc.total), true)
  if (doc.kind === 'invoice' || doc.kind === 'tax_invoice') {
    if (num(doc.paid) > 0.004) total('Paid', num(doc.paid))
    if (doc.balanceDue != null && num(doc.balanceDue) > 0.004) total('Balance due', num(doc.balanceDue), true)
  }
  tail.push(L(''))
  for (const w of wrapText(`Amount in words: ${amountInWords(num(doc.total), currency)}`, cols)) tail.push(L(w))
  if (doc.notes?.trim()) {
    tail.push(L(''))
    for (const w of wrapText(`Notes: ${doc.notes.trim()}`, cols)) tail.push(L(w))
  }
  if (opts.signature !== false) {
    tail.push(L(''), L(''))
    const sw = Math.min(28, Math.floor(cols / 2))
    tail.push(L(`${' '.repeat(cols - sw)}${'_'.repeat(sw)}`))
    tail.push(L(`${' '.repeat(cols - sw)}${center(doc.kind === 'purchase_order' ? 'Authorized by' : 'Authorized signature', sw)}`))
  }
  if (opts.footerText?.trim()) {
    tail.push(L(''))
    for (const w of opts.footerText.trim().split(/\r?\n/)) tail.push(L(center(w, cols)))
  }

  // ── Paginate
  const pages: TextLine[][] = []
  const pad = (lines: TextLine[]) => [...Array.from({ length: top }, () => L('')), ...lines]
  let cur: TextLine[] = [...head, ...tableHead]
  const contHead = (page: number) => [
    L(`${fit(`${title} ${doc.number}`, cols - 10)}${fit(`Page ${page}`, 10, 'right')}`, true),
    ...tableHead,
  ]
  const breakPage = () => {
    cur.push(L(fit('Continued...', cols, 'right')))
    pages.push(pad(cur))
    cur = contHead(pages.length + 1)
  }
  if (cur.length > capacity) cur = cur.slice(0, capacity - 1) // absurdly short pages: keep going
  for (const g of groups) {
    if (cur.length + g.length > capacity - 1) breakPage()
    cur.push(...g.slice(0, Math.max(1, capacity - 1 - cur.length)))
  }
  if (cur.length + tail.length <= capacity) {
    cur.push(...tail)
  } else {
    // Totals do not fit under the last rows: they go to a new page (split when longer than a page)
    breakPage()
    let rest = tail
    while (rest.length) {
      const room = capacity - cur.length
      if (rest.length <= room) {
        cur.push(...rest)
        rest = []
      } else {
        cur.push(...rest.slice(0, room - 1))
        rest = rest.slice(room - 1)
        breakPage()
      }
    }
  }
  pages.push(pad(cur))
  return pages
}

// ─── Output ────────────────────────────────────────────────────────────────

export interface DotMatrixSetup {
  cpi: EscpCpi
  /** Carriage / printable width in inches (LQ-310: 8). */
  carriageInches: number
  /** Distance between perforations in inches (11 full, 5.5 half; 12 for 12" stock). */
  pageLengthInches: number
  /** Paper width in mm (browser fallback page width), e.g. 241.3 for 9.5" continuous. */
  paperWidthMm: number
  letterQuality?: boolean
}

export const DEFAULT_DOT_MATRIX_SETUP: DotMatrixSetup = {
  cpi: 10,
  carriageInches: 8,
  pageLengthInches: 11,
  paperWidthMm: 241.3,
  letterQuality: false,
}

export function dotMatrixCols(s: DotMatrixSetup): number {
  return textColsFor(s.carriageInches, s.cpi)
}

/** ESC/P bytes of a document for a dot matrix setup. */
export function documentToEscp(doc: InvoiceDoc, company: InvoiceCompany, s: DotMatrixSetup, extra: Partial<TextDocOptions> = {}): Uint8Array {
  const pages = layoutTextDocument(doc, company, { ...extra, cols: dotMatrixCols(s), linesPerPage: linesPerPage(s.pageLengthInches) })
  return encodeTextPages(pages, { cpi: s.cpi, pageLengthInches: s.pageLengthInches, letterQuality: s.letterQuality })
}

/** Courier advance width is 0.6 em: font size (mm) for a pitch. */
export function monoFontSizeMm(cpi: number): number {
  return roundMm(MM_PER_INCH / cpi / 0.6)
}

/**
 * Browser fallback: the same text pages as an HTML page of exactly the paper size, monospace at
 * the printer's pitch (char width 25.4 / cpi mm) and 6 lines per inch, centred on the carriage.
 */
export function textPagesToHtml(pages: TextLine[][], s: Pick<DotMatrixSetup, 'cpi' | 'carriageInches' | 'pageLengthInches' | 'paperWidthMm'>, title = 'Document'): string {
  const W = roundMm(s.paperWidthMm)
  const H = roundMm(s.pageLengthInches * MM_PER_INCH)
  const cols = textColsFor(s.carriageInches, s.cpi)
  const textW = (cols * MM_PER_INCH) / s.cpi
  const left = roundMm(Math.max(0, (W - textW) / 2))
  const body = pages.map((p) => `<div class="tpage"><pre>${p.map((l) => (l.bold ? `<b>${escapeHtml(l.text)}</b>` : escapeHtml(l.text))).join('\n')}</pre></div>`).join('')
  const css = `${pageRuleCss(W, H, 0)}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
.tpage { width: ${W}mm; height: ${H}mm; padding-left: ${left}mm; overflow: hidden; page-break-after: always; break-after: page; }
.tpage:last-child { page-break-after: auto; break-after: auto; }
pre { margin: 0; font-family: 'Courier New', Courier, monospace; font-size: ${monoFontSizeMm(s.cpi)}mm; line-height: ${roundMm(MM_PER_INCH / 6)}mm; white-space: pre; color: #000; }
pre b { font-weight: 700; }
@media screen { body { background: #e5e7eb; } .tpage { background: #fff; margin: 12px auto; box-shadow: 0 2px 10px rgba(0,0,0,.15); } }`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}</body></html>`
}
