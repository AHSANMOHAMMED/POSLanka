// Pure ESC/POS byte builder. No native dependencies: every helper returns or
// appends plain bytes so the output can be pushed over Bluetooth SPP, USB or
// TCP 9100 by src/lib/printer.ts. Text is restricted to printable ASCII; any
// other character is replaced by '?' so the printer's default code page is
// always correct (Sri Lankan receipts are printed in English / transliteration).

export type PaperWidth = 58 | 80

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** Printable columns for Font A on the common 58mm / 80mm thermal heads. */
export function columnsFor(paperWidth: PaperWidth): number {
  return paperWidth === 80 ? 48 : 32
}

// ---------------------------------------------------------------------------
// Low-level builder
// ---------------------------------------------------------------------------
export class EscPosBuilder {
  private chunks: number[] = []
  readonly cols: number

  constructor(paperWidth: PaperWidth = 58) {
    this.cols = columnsFor(paperWidth)
  }

  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.chunks.push(bytes[i] & 0xff)
    return this
  }

  /** ESC @ — reset the printer to its power-on state. */
  init(): this {
    return this.raw([ESC, 0x40])
  }

  /** ESC a n — 0 left, 1 centre, 2 right. */
  align(mode: 'left' | 'center' | 'right'): this {
    const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0
    return this.raw([ESC, 0x61, n])
  }

  /** ESC E n — emphasised mode on/off. */
  bold(on: boolean): this {
    return this.raw([ESC, 0x45, on ? 1 : 0])
  }

  /** ESC - n — underline on/off. */
  underline(on: boolean): this {
    return this.raw([ESC, 0x2d, on ? 1 : 0])
  }

  /** GS ! n — character size (1..8 multipliers for width/height). */
  size(width: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = 1, height: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = width): this {
    const n = ((width - 1) << 4) | (height - 1)
    return this.raw([GS, 0x21, n & 0x77])
  }

  /** Writes text (no newline). Non-ASCII is replaced by '?'. */
  text(value: string): this {
    return this.raw(encodeAscii(value))
  }

  /** Writes one line of text followed by LF. */
  line(value = ''): this {
    return this.text(value).raw([LF])
  }

  /** Prints and feeds n lines (ESC d n). */
  feed(lines = 1): this {
    return this.raw([ESC, 0x64, Math.max(0, Math.min(255, lines))])
  }

  /** A full-width rule using the given character. */
  rule(char = '-'): this {
    return this.line(char.repeat(this.cols))
  }

  /** GS V 66 n — partial cut with a small feed first. */
  partialCut(): this {
    return this.feed(3).raw([GS, 0x56, 0x42, 0x00])
  }

  /** GS V 0 — full cut. */
  fullCut(): this {
    return this.feed(3).raw([GS, 0x56, 0x00])
  }

  /** ESC p m t1 t2 — pulse the cash-drawer kick connector (pin 2 by default). */
  drawerKick(pin: 0 | 1 = 0): this {
    return this.raw([ESC, 0x70, pin, 0x19, 0xfa])
  }

  /**
   * CODE128 barcode via GS k 73 n (auto code set B). HRI printed below.
   * Only printable ASCII is encodable; other characters are replaced by '?'.
   */
  barcodeCode128(data: string, opts: { height?: number; width?: 2 | 3 | 4 } = {}): this {
    const payload = encodeAscii(data)
    if (payload.length === 0) return this
    const height = Math.max(1, Math.min(255, opts.height ?? 60))
    const width = opts.width ?? 2
    this.raw([GS, 0x68, height]) // GS h — height
    this.raw([GS, 0x77, width]) // GS w — module width
    this.raw([GS, 0x48, 0x02]) // GS H — HRI below
    this.raw([GS, 0x66, 0x00]) // GS f — HRI font A
    // GS k m n d1..dn with m=73 (CODE128); data starts with {B to select code set B
    const body = [0x7b, 0x42, ...payload]
    this.raw([GS, 0x6b, 73, body.length, ...body])
    return this.raw([LF])
  }

  /**
   * QR code via GS ( k (model 2). Works on most Epson-compatible heads
   * (Xprinter, Rongta, Goojprt, Sunmi...).
   */
  qr(data: string, opts: { size?: number; ecLevel?: 'L' | 'M' | 'Q' | 'H' } = {}): this {
    const payload = encodeAscii(data)
    if (payload.length === 0) return this
    const size = Math.max(1, Math.min(16, opts.size ?? 5))
    const ec = { L: 48, M: 49, Q: 50, H: 51 }[opts.ecLevel ?? 'M']
    // Model: GS ( k 4 0 49 65 n1 n2  (n1=50 → model 2)
    this.raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
    // Module size: GS ( k 3 0 49 67 n
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size])
    // Error correction: GS ( k 3 0 49 69 n
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ec])
    // Store data: GS ( k pL pH 49 80 48 d1..dk  (pL/pH = len + 3)
    const len = payload.length + 3
    this.raw([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...payload])
    // Print: GS ( k 3 0 49 81 48
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])
    return this.raw([LF])
  }

  /**
   * GS v 0 raster from an already-packed 1-bit bitmap (rows MSB-first, 1 = black),
   * e.g. the logo from GET /api/settings/logo/raster. Rows wider than the head
   * (384 dots for 58mm, 576 for 80mm) are cropped symmetrically.
   */
  rasterPacked(width: number, height: number, data: Uint8Array): this {
    if (!width || !height || !data?.length) return this
    const srcBpr = Math.ceil(width / 8)
    if (data.length < srcBpr * height) return this
    const maxBpr = this.cols >= 48 ? 72 : 48
    const bpr = Math.min(srcBpr, maxBpr)
    const skip = Math.floor((srcBpr - bpr) / 2)
    this.raw([GS, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff])
    for (let y = 0; y < height; y++) {
      const start = y * srcBpr + skip
      for (let i = 0; i < bpr; i++) this.chunks.push(data[start + i] & 0xff)
    }
    return this
  }

  // ------------------------------------------------------------------ tables

  /** "label ......... value" on one line; the value is right-aligned. */
  row(left: string, right: string): this {
    return this.line(fitRow(left, right, this.cols))
  }

  /**
   * Fixed-width columns. `widths` must sum to <= cols (the remainder pads the
   * last column). `aligns` defaults to left for the first column and right for
   * the rest. Overflowing cells are truncated, except the first column, which
   * wraps onto following lines when `wrapFirst` is set.
   */
  columns(cells: string[], widths: number[], aligns?: Array<'left' | 'right' | 'center'>, wrapFirst = true): this {
    const lines = layoutColumns(cells, widths, this.cols, aligns, wrapFirst)
    for (const l of lines) this.line(l)
    return this
  }

  /** Centre-aligned text that wraps to the paper width. */
  centeredBlock(value: string): this {
    this.align('center')
    for (const l of wrapText(value, this.cols)) this.line(l)
    return this.align('left')
  }

  /** Left-aligned text that wraps to the paper width. */
  paragraph(value: string): this {
    for (const l of wrapText(value, this.cols)) this.line(l)
    return this
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks)
  }

  get length(): number {
    return this.chunks.length
  }
}

// ---------------------------------------------------------------------------
// Text helpers (exported for tests / the HTML fallback)
// ---------------------------------------------------------------------------
export function sanitizeAscii(value: string): string {
  let out = ''
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0) ?? 0
    out += code >= 0x20 && code <= 0x7e ? ch : code === 0x0a ? '\n' : '?'
  }
  return out
}

export function encodeAscii(value: string): number[] {
  const bytes: number[] = []
  for (const ch of sanitizeAscii(value)) bytes.push(ch.charCodeAt(0))
  return bytes
}

export function padRight(value: string, width: number): string {
  const s = sanitizeAscii(value)
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length)
}

export function padLeft(value: string, width: number): string {
  const s = sanitizeAscii(value)
  return s.length >= width ? s.slice(s.length - width) : ' '.repeat(width - s.length) + s
}

export function padCenter(value: string, width: number): string {
  const s = sanitizeAscii(value)
  if (s.length >= width) return s.slice(0, width)
  const left = Math.floor((width - s.length) / 2)
  return ' '.repeat(left) + s + ' '.repeat(width - s.length - left)
}

export function fitRow(left: string, right: string, cols: number): string {
  const r = sanitizeAscii(right)
  const space = Math.max(1, cols - r.length - 1)
  return padRight(left, space) + ' ' + r
}

export function wrapText(value: string, cols: number): string[] {
  const out: string[] = []
  for (const para of sanitizeAscii(value).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let cur = ''
    for (const w of words) {
      if (w.length > cols) {
        if (cur) out.push(cur)
        cur = ''
        for (let i = 0; i < w.length; i += cols) out.push(w.slice(i, i + cols))
        continue
      }
      if ((cur + ' ' + w).trim().length > cols) {
        out.push(cur)
        cur = w
      } else {
        cur = cur ? `${cur} ${w}` : w
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

export function layoutColumns(
  cells: string[],
  widths: number[],
  cols: number,
  aligns?: Array<'left' | 'right' | 'center'>,
  wrapFirst = true
): string[] {
  const total = widths.reduce((s, w) => s + w, 0)
  const w = [...widths]
  if (total < cols) w[w.length - 1] += cols - total
  const al = cells.map((_, i) => aligns?.[i] ?? (i === 0 ? 'left' : 'right'))
  const fit = (s: string, width: number, a: 'left' | 'right' | 'center') =>
    a === 'right' ? padLeft(s, width) : a === 'center' ? padCenter(s, width) : padRight(s, width)

  const firstLines = wrapFirst ? wrapText(cells[0] ?? '', w[0]) : [sanitizeAscii(cells[0] ?? '').slice(0, w[0])]
  const lines: string[] = []
  const rows = Math.max(1, firstLines.length)
  for (let r = 0; r < rows; r++) {
    let line = fit(firstLines[r] ?? '', w[0], al[0])
    for (let c = 1; c < w.length; c++) {
      // Other columns are printed on the last wrapped line of the first column
      const value = r === rows - 1 ? cells[c] ?? '' : ''
      line += fit(value, w[c], al[c])
    }
    lines.push(line.replace(/\s+$/, ''))
  }
  return lines
}

export function money(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '0'))
  const num = isNaN(v) ? 0 : v
  const abs = Math.abs(num).toFixed(2)
  const [int, dec] = abs.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${num < 0 ? '-' : ''}${grouped}.${dec}`
}

export function qtyText(q: number | string): string {
  const n = typeof q === 'number' ? q : parseFloat(String(q))
  if (isNaN(n)) return String(q)
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

// ---------------------------------------------------------------------------
// Receipt document
// ---------------------------------------------------------------------------
export interface ReceiptBusiness {
  name: string
  legalName?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  /** VAT / TIN number. */
  taxId?: string | null
  /** Business registration number. */
  brn?: string | null
}

export type InvoiceCodeType = 'barcode' | 'qr' | 'both' | 'none'

/** Logo raster as returned by GET /api/settings/logo/raster (data = base64 packed rows). */
export interface ReceiptLogo {
  width: number
  height: number
  data: string
  /** Grayscale PNG (base64) for HTML / PDF receipts. */
  pngBase64?: string | null
  /** Logo width in % of the paper (HTML receipts). */
  widthPct?: number
}

export interface ReceiptLine {
  name: string
  qty: number
  unit?: string | null
  unitPrice: number
  total: number
  /** Sold in a non-base unit: "1 Box = 12 pcs" (printed under the item, columns untouched) */
  conversion?: string | null
  /** Tax invoices: line VAT rate (%) and amount. */
  vatRate?: number | null
  vatAmount?: number | null
}

/** Sri Lanka tax invoice / credit note particulars (VAT-registered seller, VAT charged). */
export interface ReceiptTaxInvoice {
  kind: 'tax_invoice' | 'credit_note'
  supplierVatNo: string
  buyer: { name: string; vatNo: string | null; address: string | null } | null
  originalInvoiceNo: string | null
  totalExclVat: number
  totalVat: number
  totalInclVat: number
}

/** 18 → "18", 2.5 → "2.5". */
export function vatRateText(rate: number | null | undefined): string {
  const r = Number(rate) || 0
  return Number.isInteger(r) ? String(r) : String(Math.round(r * 100) / 100)
}

export interface ReceiptPayment {
  method: string
  amount: number
  reference?: string | null
}

export interface ReceiptInput {
  business: ReceiptBusiness
  header?: string | null
  footer?: string | null
  invoiceNo: string
  dateTime: string | Date
  cashier?: string | null
  counter?: string | null
  customer?: { name: string } | null
  lines: ReceiptLine[]
  subtotal: number
  discount: number
  taxLines: Array<{ name: string; amount: number }>
  total: number
  payments: ReceiptPayment[]
  change?: number
  isReturn?: boolean
  /** Value encoded in the invoice barcode / QR (usually the invoice number, also OFF-... refs). */
  qrPayload?: string | null
  /** Which invoice codes to print. Undefined = legacy (QR only when qrPayload is set). */
  invoiceCode?: InvoiceCodeType
  /** Business-settings driven header / footer lines (take precedence over header/footer). */
  headerLines?: string[]
  footerLines?: string[]
  returnPolicy?: string | null
  logo?: ReceiptLogo | null
  /** Present when the receipt is a tax invoice / VAT credit note. */
  taxInvoice?: ReceiptTaxInvoice | null
}

export interface ReceiptOptions {
  paperWidth: PaperWidth
  drawerKick?: boolean
}

export function formatReceiptDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank / LankaQR',
  credit: 'Credit',
  gift_card: 'Gift card',
}

export function paymentLabel(method: string): string {
  return METHOD_LABELS[method] || method
}

/** Which invoice codes to print and with what value (codes only for code-like values). */
export function invoiceCodeFor(input: Pick<ReceiptInput, 'qrPayload' | 'invoiceCode' | 'invoiceNo'>): { value: string; barcode: boolean; qr: boolean } {
  const value = sanitizeAscii(input.qrPayload ?? (input.invoiceCode ? input.invoiceNo : '') ?? '').trim()
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/.test(value)) return { value: '', barcode: false, qr: false }
  const type: InvoiceCodeType = input.invoiceCode ?? 'qr'
  return { value, barcode: type === 'barcode' || type === 'both', qr: type === 'qr' || type === 'both' }
}

/**
 * Logo (pre-rasterised and centered on the paper width by the server) and the
 * business block. Shared by receipts and the Z report so both carry the same
 * branding (legal name, tax numbers ...). Leaves the builder center-aligned.
 */
function businessHeader(b: EscPosBuilder, biz: ReceiptBusiness, logo?: ReceiptLogo | null): void {
  const cols = b.cols
  if (logo?.data) {
    const bits = base64ToBytes(logo.data)
    b.align('center').rasterPacked(logo.width, logo.height, bits).line()
  }
  b.align('center').bold(true).size(2, 2).line(sanitizeAscii(biz.name).slice(0, Math.floor(cols / 2))).size(1, 1).bold(false)
  if (biz.legalName && biz.legalName.trim().toLowerCase() !== biz.name.trim().toLowerCase()) b.centeredBlock(biz.legalName)
  if (biz.address) b.centeredBlock(biz.address)
  if (biz.phone) b.centeredBlock(`Tel: ${biz.phone}`)
  if (biz.email) b.centeredBlock(biz.email)
  if (biz.website) b.centeredBlock(biz.website)
  if (biz.taxId) b.centeredBlock(`VAT/TIN: ${biz.taxId}`)
  if (biz.brn) b.centeredBlock(`BRN: ${biz.brn}`)
}

export function buildReceipt(input: ReceiptInput, opts: ReceiptOptions): Uint8Array {
  const b = new EscPosBuilder(opts.paperWidth)
  const cols = b.cols
  b.init()
  if (opts.drawerKick && !input.isReturn) b.drawerKick()
  b.raw([ESC, 0x74, 0x00]) // ESC t 0: CP437 (text is ASCII-only)

  // Logo + business block
  businessHeader(b, input.business, input.logo)
  const headerLines = input.headerLines?.length ? input.headerLines : input.header ? [input.header] : []
  if (headerLines.length) {
    b.line()
    for (const h of headerLines) b.centeredBlock(h)
  }
  b.align('left').rule('=')

  // Meta
  const ti = input.taxInvoice || null
  const title = ti ? (ti.kind === 'credit_note' ? 'CREDIT NOTE' : 'TAX INVOICE') : input.isReturn ? 'RETURN / CREDIT NOTE' : 'SALES RECEIPT'
  b.bold(true).line(title).bold(false)
  b.row(ti ? (ti.kind === 'credit_note' ? 'Credit Note' : 'Invoice No') : 'Invoice', input.invoiceNo)
  b.row('Date', formatReceiptDate(input.dateTime))
  if (ti?.originalInvoiceNo) b.row('Against Inv', ti.originalInvoiceNo)
  if (input.counter) b.row('Counter', input.counter)
  if (input.cashier) b.row('Cashier', input.cashier)
  if (ti?.buyer) {
    b.row('Buyer', ti.buyer.name)
    if (ti.buyer.address) b.paragraph(ti.buyer.address)
    if (ti.buyer.vatNo) b.row('Buyer VAT No', ti.buyer.vatNo)
  } else if (input.customer?.name) b.row('Customer', input.customer.name)
  b.rule('-')

  // Items
  const qtyW = cols >= 48 ? 8 : 6
  const priceW = cols >= 48 ? 12 : 9
  const totalW = cols >= 48 ? 12 : 10
  const nameW = cols - qtyW - priceW - totalW
  if (cols >= 48) {
    b.bold(true).columns(['Item', 'Qty', 'Price', 'Total'], [nameW, qtyW, priceW, totalW], undefined, false).bold(false)
    for (const l of input.lines) {
      b.columns([l.name, qtyText(l.qty) + (l.unit ? l.unit : ''), money(l.unitPrice), money(l.total)], [nameW, qtyW, priceW, totalW])
      if (l.conversion) b.line(`  ${l.conversion}`)
      if (ti && l.vatAmount) b.row(`  VAT ${vatRateText(l.vatRate)}%`, money(l.vatAmount))
    }
  } else {
    // 58mm: item name on its own line, then "qty x price" and the line total.
    for (const l of input.lines) {
      b.paragraph(l.name)
      b.row(`  ${qtyText(l.qty)}${l.unit ? ` ${l.unit}` : ''} x ${money(l.unitPrice)}`, money(l.total))
      if (l.conversion) b.line(`  ${l.conversion}`)
      if (ti && l.vatAmount) b.row(`  VAT ${vatRateText(l.vatRate)}%`, money(l.vatAmount))
    }
  }
  b.rule('-')

  // Totals
  b.row('Subtotal', money(input.subtotal))
  if (input.discount && Math.abs(input.discount) > 0.004) b.row('Discount', `-${money(Math.abs(input.discount))}`)
  for (const t of input.taxLines || []) {
    if (Math.abs(t.amount) > 0.004) b.row(t.name, money(t.amount))
  }
  b.bold(true).size(1, 2).row(input.isReturn ? 'REFUND' : 'TOTAL', `LKR ${money(input.total)}`).size(1, 1).bold(false)
  if (ti) {
    b.rule('-')
    b.row('Total excl. VAT', money(ti.totalExclVat))
    b.row('VAT', money(ti.totalVat))
    b.row('Total incl. VAT', money(ti.totalInclVat))
  }
  b.rule('-')

  for (const p of input.payments || []) {
    b.row(paymentLabel(p.method) + (p.reference ? ` (${p.reference})` : ''), money(p.amount))
  }
  if (input.change && input.change > 0.004) b.row('Change', money(input.change))

  // Footer
  b.line()
  const footerLines = input.footerLines?.length ? input.footerLines : [input.footer || 'Thank you for shopping with us!']
  for (const f of footerLines) b.centeredBlock(f)
  if (input.returnPolicy) {
    b.line()
    b.centeredBlock(input.returnPolicy)
  }
  const code = invoiceCodeFor(input)
  // CODE128 (set B) needs 11 modules per character + 35 for start/check/stop; at module width 2
  // a 58mm head (384 dots) fits 14 characters. Longer values (e.g. OFF-<6-char device>-<seq>)
  // print as QR instead so the receipt always carries a scannable code.
  const barcodeFits = cols >= 48 || (code.value.length * 11 + 35) * 2 <= 384
  if (code.barcode && barcodeFits) {
    b.line()
    b.align('center').barcodeCode128(code.value, { height: 50, width: 2 }).align('left')
  }
  if (code.qr || (code.barcode && !barcodeFits)) {
    b.line()
    b.align('center').qr(code.value, { size: cols >= 48 ? 6 : 4 }).align('left')
  }
  b.align('center').line('Powered by skyERPOS').align('left')
  b.partialCut()
  return b.bytes()
}

// ---------------------------------------------------------------------------
// Z report (shift close)
// ---------------------------------------------------------------------------
export interface ZReportTender {
  method: string
  opening?: number
  expected?: number
  actual?: number
  variance?: number
}

/** H1: Z-report detail from the close response (`zReport`, see src/lib/pos/shift-report.ts). */
export interface ZReportDetails {
  tax?: { total: number; sales: number; returns: number; byName?: Array<{ taxName: string; rate: number | null; amount: number }> }
  discounts?: { total: number; count: number }
  voids?: { count: number; total: number; items?: Array<{ invoiceNo: string; total: number; reason: string | null }> }
  returns?: { count: number; total: number }
  cashMovements?: { paidIn: number; paidOut: number; count: number; voidedCount?: number }
  approvals?: { count: number }
  ledger?: { posted: boolean; ledgerCash: number; expectedCashMovement: number; difference: number; tiesOut: boolean }
}

/** Printable lines of the Z-report detail (shared by ESC/POS and HTML). */
export function zReportDetailRows(d: ZReportDetails | null | undefined): Array<{ section: string; rows: Array<[string, string]> }> {
  if (!d) return []
  const out: Array<{ section: string; rows: Array<[string, string]> }> = []
  if (d.cashMovements && (d.cashMovements.count > 0 || (d.cashMovements.voidedCount || 0) > 0)) {
    out.push({ section: 'CASH PAID IN / OUT', rows: [
      ['Paid in', money(d.cashMovements.paidIn)],
      ['Paid out', `-${money(d.cashMovements.paidOut)}`],
      ...(d.cashMovements.voidedCount ? [['Voided movements', String(d.cashMovements.voidedCount)] as [string, string]] : []),
    ] })
  }
  if (d.tax) {
    out.push({ section: 'TAX SUMMARY', rows: [
      ...(d.tax.byName || []).map((t) => [`${t.taxName}${t.rate != null ? ` ${t.rate}%` : ''}`, money(t.amount)] as [string, string]),
      ['Net tax', money(d.tax.total)],
    ] })
  }
  const adj: Array<[string, string]> = []
  if (d.discounts) adj.push([`Discounts (${d.discounts.count})`, `-${money(d.discounts.total)}`])
  if (d.voids) {
    adj.push([`Voids (${d.voids.count})`, money(d.voids.total)])
    for (const v of (d.voids.items || []).slice(0, 20)) adj.push([`  ${v.invoiceNo}${v.reason ? ` ${v.reason}` : ''}`, money(v.total)])
  }
  if (d.returns) adj.push([`Returns (${d.returns.count})`, `-${money(d.returns.total)}`])
  if (d.approvals?.count) adj.push(['Supervisor approvals', String(d.approvals.count)])
  if (adj.length) out.push({ section: 'ADJUSTMENTS', rows: adj })
  if (d.ledger) {
    out.push({ section: 'LEDGER TIE-OUT', rows: d.ledger.posted
      ? [
          ['Drawer cash movement', money(d.ledger.expectedCashMovement)],
          ['Cash ledger', money(d.ledger.ledgerCash)],
          [d.ledger.tiesOut ? 'Ties out' : 'DIFFERENCE', d.ledger.tiesOut ? 'OK' : money(d.ledger.difference)],
        ]
      : [['Ledger', 'Not posted']] })
  }
  return out
}

export interface ZReportInput {
  business: ReceiptBusiness
  title?: string
  entryNumber?: string | null
  counter?: string | null
  cashier?: string | null
  openedAt?: string | Date | null
  closedAt?: string | Date | null
  summary: {
    totalSales: number
    totalReturns: number
    netSales: number
    totalTransactions: number
    totalVariance: number
  }
  tenders: ZReportTender[]
  /** H1: tax, discounts, voids, returns, cash movements, ledger tie-out */
  details?: ZReportDetails | null
  varianceReason?: string | null
  notes?: string | null
  /** Receipt logo raster (same as receipts); printed above the business block. */
  logo?: ReceiptLogo | null
}

export function buildZReport(input: ZReportInput, opts: { paperWidth: PaperWidth }): Uint8Array {
  const b = new EscPosBuilder(opts.paperWidth)
  const cols = b.cols
  b.init()
  b.raw([ESC, 0x74, 0x00]) // ESC t 0: CP437 (text is ASCII-only)
  businessHeader(b, input.business, input.logo)
  b.line()
  b.bold(true).size(1, 2).line(input.title || 'Z REPORT - SHIFT CLOSE').size(1, 1).bold(false)
  b.align('left').rule('=')
  if (input.entryNumber) b.row('Closing', input.entryNumber)
  if (input.counter) b.row('Counter', input.counter)
  if (input.cashier) b.row('Cashier', input.cashier)
  if (input.openedAt) b.row('Opened', formatReceiptDate(input.openedAt))
  b.row('Closed', formatReceiptDate(input.closedAt || new Date()))
  b.rule('-')
  b.bold(true).line('SALES SUMMARY').bold(false)
  b.row('Gross sales', money(input.summary.totalSales))
  b.row('Returns', `-${money(Math.abs(input.summary.totalReturns))}`)
  b.bold(true).row('Net sales', money(input.summary.netSales)).bold(false)
  b.row('Transactions', String(input.summary.totalTransactions))
  b.rule('-')
  b.bold(true).line('DRAWER RECONCILIATION').bold(false)

  if (cols >= 48) {
    const w = [14, 11, 11, 12]
    b.columns(['Tender', 'Expected', 'Counted', 'Variance'], w, undefined, false)
    for (const t of input.tenders) {
      const variance = t.variance ?? (t.actual ?? 0) - (t.expected ?? 0)
      b.columns([paymentLabel(t.method), money(t.expected ?? 0), money(t.actual ?? 0), (variance > 0 ? '+' : '') + money(variance)], w, undefined, false)
    }
  } else {
    for (const t of input.tenders) {
      const variance = t.variance ?? (t.actual ?? 0) - (t.expected ?? 0)
      b.bold(true).line(paymentLabel(t.method)).bold(false)
      if (t.opening !== undefined) b.row('  Opening float', money(t.opening))
      b.row('  Expected', money(t.expected ?? 0))
      b.row('  Counted', money(t.actual ?? 0))
      b.row('  Variance', (variance > 0 ? '+' : '') + money(variance))
    }
  }
  b.rule('-')
  const tv = input.summary.totalVariance
  b.bold(true).size(1, 2).row('TOTAL VARIANCE', (tv > 0 ? '+' : '') + money(tv)).size(1, 1).bold(false)
  if (input.varianceReason) b.row('Reason', input.varianceReason)
  for (const sec of zReportDetailRows(input.details)) {
    b.rule('-')
    b.bold(true).line(sec.section).bold(false)
    for (const [k, v] of sec.rows) b.row(k, v)
  }
  if (input.notes) {
    b.line()
    b.paragraph(`Notes: ${input.notes}`)
  }
  b.line()
  b.line('Signature: ____________________')
  b.line()
  b.align('center').line('Powered by skyERPOS').align('left')
  b.partialCut()
  return b.bytes()
}

// ---------------------------------------------------------------------------
// Base64 (Hermes does not expose Buffer; btoa availability varies by RN version)
// ---------------------------------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  if (i < bytes.length) {
    const rem = bytes.length - i
    const n = (bytes[i] << 16) | (rem === 2 ? bytes[i + 1] << 8 : 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += rem === 2 ? B64[(n >> 6) & 63] : '='
    out += '='
  }
  return out
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '')
  const out: number[] = []
  let buf = 0
  let bits = 0
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i])
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
      buf &= (1 << bits) - 1
    }
  }
  return Uint8Array.from(out)
}

/** Decodes the raw bytes back to a plain-text preview (control bytes stripped). */
export function bytesToPlainText(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (c === LF) out += '\n'
    else if (c >= 0x20 && c <= 0x7e) out += String.fromCharCode(c)
  }
  return out
}
