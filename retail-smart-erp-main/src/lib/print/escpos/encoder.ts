/**
 * Pure ESC/POS byte builder. No DOM access: safe to run in Node (self-test),
 * web workers and the browser. Text is encoded as CP437 (ASCII subset, ESC t 0)
 * or Windows-1252 (ESC t 16); any unencodable character becomes '?' unless a `TextRasterizer` is supplied, in
 * which case lines containing non-ASCII (Sinhala / Tamil ...) are rendered as a
 * bitmap via `rasterImage` (GS v 0).
 */

export type PaperWidth = 58 | 80
export type Align = 'left' | 'center' | 'right'

/** Character columns for the default Font A (12x24 dots). */
export const COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 }
/** Printable dot width per paper size (203 dpi heads). */
export const DOT_WIDTH: Record<PaperWidth, number> = { 58: 384, 80: 576 }

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** Structural subset of the DOM `ImageData` so the encoder stays DOM-free. */
export interface RasterImageData {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray | Uint8Array
}

export interface TextStyle {
  bold?: boolean
  align?: Align
  /** Width / height multiplier, 1 or 2. */
  size?: 1 | 2
  underline?: boolean
}

/**
 * Renders a line of (possibly non-ASCII) text to RGBA pixels. Supplied by the
 * browser layer (offscreen canvas); the encoder only consumes the result.
 */
export type TextRasterizer = (
  text: string,
  opts: { widthDots: number; bold: boolean; size: 1 | 2; align: Align }
) => RasterImageData | null

/** Supported printer character tables (ESC t n). */
export type CodePage = 'cp437' | 'cp1252'
/** ESC t n values (Epson numbering): PC437 = 0, WPC1252 = 16. */
export const CODE_PAGE_ESC_T: Record<CodePage, number> = { cp437: 0, cp1252: 16 }

/** 1-bit packed raster (GS v 0 layout: rows MSB-first, black = 1). */
export interface PackedRaster {
  /** Width in dots (bytes per row = ceil(width / 8)). */
  width: number
  height: number
  data: Uint8Array
}

export interface EscPosBuilderOptions {
  /** Character table used to encode text (default cp437). */
  codePage?: CodePage
  columns?: number
  /** Dot width of the print head; used for bitmap text + image scaling. */
  widthDots?: number
  /** When set, lines containing non-ASCII characters are printed as bitmaps. */
  rasterizer?: TextRasterizer | null
}

export interface TableCell {
  text: string
  width: number
  align?: Align
}

const NON_ASCII = /[^\x20-\x7e]/

export function hasNonAscii(text: string): boolean {
  return NON_ASCII.test(text.replace(/\n/g, ''))
}

// Windows-1252 0x80..0x9F (undefined slots map to null).
const CP1252_HIGH: (number | null)[] = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
]
const CP1252_REVERSE = new Map<number, number>()
CP1252_HIGH.forEach((u, i) => {
  if (u != null) CP1252_REVERSE.set(u, 0x80 + i)
})

function cp1252Byte(c: number): number | null {
  if (c === LF || c === 0x09) return c
  if (c >= 0x20 && c <= 0x7e) return c
  if (c >= 0xa0 && c <= 0xff) return c
  return CP1252_REVERSE.get(c) ?? null
}

/** Encode to Windows-1252; unmappable characters become '?'. */
export function encodeCp1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = cp1252Byte(text.charCodeAt(i)) ?? 0x3f
  return out
}

/** True when `text` contains characters the code page cannot print natively. */
export function hasUnencodable(text: string, codePage: CodePage = 'cp437'): boolean {
  if (codePage === 'cp437') return hasNonAscii(text)
  const t = text.replace(/\n/g, '')
  for (let i = 0; i < t.length; i++) if (cp1252Byte(t.charCodeAt(i)) == null) return true
  return false
}

export function encodeText(text: string, codePage: CodePage = 'cp437'): Uint8Array {
  return codePage === 'cp1252' ? encodeCp1252(text) : encodeCp437(text)
}

/** Decode a base64 string to bytes (Node + browser). */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer
  return new Uint8Array(B.from(b64, 'base64'))
}

/** Encode to CP437 bytes. Only the ASCII range is mapped; the rest becomes '?'. */
export function encodeCp437(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === LF || c === 0x09) out[i] = c
    else if (c >= 0x20 && c <= 0x7e) out[i] = c
    else out[i] = 0x3f // '?'
  }
  return out
}

export function padRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  return text + ' '.repeat(width - text.length)
}

export function padLeft(text: string, width: number): string {
  if (text.length >= width) return text.slice(text.length - width)
  return ' '.repeat(width - text.length) + text
}

export function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  const left = Math.floor((width - text.length) / 2)
  return ' '.repeat(left) + text
}

/** Word-wrap text to a column width. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let cur = ''
    for (const w of words) {
      if (w.length > width) {
        if (cur) lines.push(cur)
        cur = ''
        for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width))
        continue
      }
      if (!cur) cur = w
      else if (cur.length + 1 + w.length <= width) cur += ' ' + w
      else {
        lines.push(cur)
        cur = w
      }
    }
    if (cur) lines.push(cur)
  }
  return lines
}

export function formatMoney(n: number, decimals = 2): string {
  const v = Number.isFinite(n) ? n : 0
  const fixed = Math.abs(v).toFixed(decimals)
  const [int, frac] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (v < 0 ? '-' : '') + grouped + (frac ? '.' + frac : '')
}

export class EscPosBuilder {
  private chunks: Uint8Array[] = []
  readonly columns: number
  readonly widthDots: number
  private rasterizer: TextRasterizer | null
  private curAlign: Align = 'left'
  private curBold = false
  private curSize: 1 | 2 = 1
  /** GS ! value restored after size changes (0x01 = double height "large" body). */
  private baseSizeByte = 0
  readonly codePage: CodePage

  constructor(opts: EscPosBuilderOptions = {}) {
    this.codePage = opts.codePage ?? 'cp437'
    this.columns = opts.columns ?? COLUMNS[80]
    this.widthDots = opts.widthDots ?? (this.columns <= 32 ? DOT_WIDTH[58] : DOT_WIDTH[80])
    this.rasterizer = opts.rasterizer ?? null
  }

  /** Append raw bytes. */
  raw(bytes: ArrayLike<number>): this {
    this.chunks.push(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes))
    return this
  }

  /** ESC @ - initialise printer. */
  init(): this {
    return this.raw([ESC, 0x40])
  }

  /** ESC t n - select the character table matching `codePage`. */
  selectCodePage(cp: CodePage = this.codePage): this {
    return this.raw([ESC, 0x74, CODE_PAGE_ESC_T[cp]])
  }

  /** Body text size used when sizes are reset (normal or double-height). */
  baseSize(large: boolean): this {
    this.baseSizeByte = large ? 0x01 : 0
    return this.raw([GS, 0x21, this.baseSizeByte])
  }

  /** Encode text in the builder's code page. Does not append a line feed. */
  text(str: string): this {
    return this.raw(encodeText(str, this.codePage))
  }

  /** Text followed by LF. */
  line(str = ''): this {
    this.text(str)
    return this.raw([LF])
  }

  /** ESC a n */
  align(a: Align): this {
    this.curAlign = a
    return this.raw([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0])
  }

  /** ESC E n */
  bold(on: boolean): this {
    this.curBold = on
    return this.raw([ESC, 0x45, on ? 1 : 0])
  }

  /** ESC - n */
  underline(on: boolean): this {
    return this.raw([ESC, 0x2d, on ? 1 : 0])
  }

  /** GS ! n - character size, width and height multipliers 1..2 (up to 8 supported by spec). */
  size(w: 1 | 2, h: 1 | 2): this {
    const cw = Math.min(8, Math.max(1, w)) - 1
    const ch = Math.min(8, Math.max(1, h)) - 1
    this.curSize = w >= 2 ? 2 : 1
    const v = (cw << 4) | ch
    return this.raw([GS, 0x21, v === 0 ? this.baseSizeByte : v])
  }

  /** ESC d n - feed n lines. */
  feed(n = 1): this {
    return this.raw([ESC, 0x64, Math.min(255, Math.max(0, n))])
  }

  /** GS V m - paper cut. */
  cut(partial = true): this {
    return this.raw([GS, 0x56, partial ? 1 : 0])
  }

  /** ESC p m t1 t2 - cash drawer kick on pin 2 or 5. */
  drawerKick(pin: 2 | 5 = 2): this {
    return this.raw([ESC, 0x70, pin === 5 ? 1 : 0, 25, 250])
  }

  /** Horizontal rule across the receipt. */
  hr(char = '-'): this {
    return this.line(char.repeat(this.columns))
  }

  /**
   * CODE128 barcode using GS k (function B, m = 73). Non-ASCII characters are
   * dropped. Height in dots, width 2..6, HRI position 0..3 (2 = below).
   */
  barcode(data: string, opts: { height?: number; width?: number; hri?: 0 | 1 | 2 | 3 } = {}): this {
    const clean = data.replace(/[^\x20-\x7e]/g, '')
    if (!clean) return this
    const height = Math.min(255, Math.max(1, opts.height ?? 60))
    const width = Math.min(6, Math.max(2, opts.width ?? 2))
    this.raw([GS, 0x68, height]) // GS h
    this.raw([GS, 0x77, width]) // GS w
    this.raw([GS, 0x48, opts.hri ?? 2]) // GS H
    // Code set B selector "{B" is required by the ESC/POS CODE128 function.
    const payload = encodeCp437('{B' + clean)
    this.raw([GS, 0x6b, 73, payload.length])
    return this.raw(payload)
  }

  /** QR code via GS ( k (model 2). size = module size 1..16. */
  qr(data: string, size = 4, errorLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): this {
    const bytes = encodeUtf8(data)
    if (bytes.length === 0) return this
    const mod = Math.min(16, Math.max(1, size))
    const ec = { L: 48, M: 49, Q: 50, H: 51 }[errorLevel]
    // Model: GS ( k 4 0 49 65 50 0
    this.raw([GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0])
    // Module size: GS ( k 3 0 49 67 n
    this.raw([GS, 0x28, 0x6b, 3, 0, 49, 67, mod])
    // Error correction: GS ( k 3 0 49 69 n
    this.raw([GS, 0x28, 0x6b, 3, 0, 49, 69, ec])
    // Store data: GS ( k pL pH 49 80 48 d1..dk ; (pL + pH*256) = k + 3
    const len = bytes.length + 3
    this.raw([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48])
    this.raw(bytes)
    // Print: GS ( k 3 0 49 81 48
    return this.raw([GS, 0x28, 0x6b, 3, 0, 49, 81, 48])
  }

  /** Two-column row: left text, right-aligned value. */
  row(left: string, right: string): this {
    const rightW = Math.min(right.length, this.columns - 1)
    const leftW = this.columns - rightW - 1
    const leftLines = wrapText(left, Math.max(1, leftW))
    for (let i = 0; i < leftLines.length; i++) {
      if (i === leftLines.length - 1) {
        this.styledLine(padRight(leftLines[i], leftW) + ' ' + padLeft(right, rightW))
      } else {
        this.styledLine(leftLines[i])
      }
    }
    return this
  }

  /** Table row helper: widths must add up to `columns` (extra is truncated). */
  tableRow(cells: TableCell[]): this {
    let out = ''
    for (const c of cells) {
      const w = Math.max(0, c.width)
      const t = c.text ?? ''
      out +=
        c.align === 'right' ? padLeft(t, w) : c.align === 'center' ? padRight(centerText(t, w), w) : padRight(t, w)
    }
    return this.styledLine(out.slice(0, this.columns))
  }

  /**
   * Print a line of text, honouring the current style. When the text contains
   * non-ASCII characters and a rasterizer is available, the line is rendered
   * as a bitmap instead so Unicode scripts print correctly.
   */
  styledLine(str: string, style?: TextStyle): this {
    const bold = style?.bold ?? this.curBold
    const size = style?.size ?? this.curSize
    const align = style?.align ?? this.curAlign
    if (this.rasterizer && hasUnencodable(str, this.codePage)) {
      const img = this.rasterizer(str, { widthDots: this.widthDots, bold, size, align })
      if (img && img.width > 0 && img.height > 0) {
        return this.rasterImage(img, this.widthDots)
      }
    }
    const applied = style !== undefined
    if (applied) {
      if (style?.align !== undefined) this.raw([ESC, 0x61, align === 'center' ? 1 : align === 'right' ? 2 : 0])
      if (style?.bold !== undefined) this.raw([ESC, 0x45, bold ? 1 : 0])
      if (style?.size !== undefined) this.raw([GS, 0x21, size === 2 ? 0x11 : this.baseSizeByte])
      if (style?.underline !== undefined) this.raw([ESC, 0x2d, style.underline ? 1 : 0])
    }
    this.line(str)
    if (applied) {
      // restore
      if (style?.align !== undefined) this.raw([ESC, 0x61, this.curAlign === 'center' ? 1 : this.curAlign === 'right' ? 2 : 0])
      if (style?.bold !== undefined) this.raw([ESC, 0x45, this.curBold ? 1 : 0])
      if (style?.size !== undefined) this.raw([GS, 0x21, this.curSize === 2 ? 0x11 : this.baseSizeByte])
      if (style?.underline !== undefined) this.raw([ESC, 0x2d, 0])
    }
    return this
  }

  /** Word-wrapped paragraph using `styledLine`. */
  paragraph(text: string, style?: TextStyle): this {
    const size = style?.size ?? this.curSize
    const width = size === 2 ? Math.floor(this.columns / 2) : this.columns
    for (const l of wrapText(text, width)) this.styledLine(l, style)
    return this
  }

  /**
   * GS v 0 raster bit image. Pixels darker than the threshold (luminance < 128,
   * alpha >= 128) print black. `width` is the max printable dot width: wider
   * images are scaled down (nearest neighbour) to fit.
   */
  rasterImage(img: RasterImageData, width = this.widthDots, threshold = 128): this {
    if (!img || img.width <= 0 || img.height <= 0) return this
    const maxW = Math.max(8, width)
    const scale = img.width > maxW ? maxW / img.width : 1
    const outW = Math.max(1, Math.floor(img.width * scale))
    const outH = Math.max(1, Math.floor(img.height * scale))
    const bytesPerRow = Math.ceil(outW / 8)
    const bitmap = new Uint8Array(bytesPerRow * outH)

    for (let y = 0; y < outH; y++) {
      const sy = Math.min(img.height - 1, Math.floor(y / scale))
      for (let x = 0; x < outW; x++) {
        const sx = Math.min(img.width - 1, Math.floor(x / scale))
        const i = (sy * img.width + sx) * 4
        const a = img.data[i + 3]
        if (a < 128) continue
        const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
        if (lum < threshold) {
          bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7)
        }
      }
    }

    // Left/center/right placement is handled by the printer's justification.
    this.raw([GS, 0x76, 0x30, 0, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, outH & 0xff, (outH >> 8) & 0xff])
    return this.raw(bitmap)
  }

  /**
   * GS v 0 from an already-packed 1-bit bitmap (e.g. the server logo raster).
   * Rows wider than the print head are cropped symmetrically.
   */
  packedRaster(img: PackedRaster): this {
    if (!img || img.width <= 0 || img.height <= 0) return this
    const srcBpr = Math.ceil(img.width / 8)
    if (img.data.length < srcBpr * img.height) return this
    const maxBpr = Math.ceil(this.widthDots / 8)
    const bpr = Math.min(srcBpr, maxBpr)
    const skip = Math.floor((srcBpr - bpr) / 2)
    let data = img.data
    if (bpr !== srcBpr) {
      data = new Uint8Array(bpr * img.height)
      for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * srcBpr + skip, y * srcBpr + skip + bpr), y * bpr)
    }
    const h = img.height
    this.raw([GS, 0x76, 0x30, 0, bpr & 0xff, (bpr >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff])
    return this.raw(data.length === bpr * h ? data : data.subarray(0, bpr * h))
  }

  /** Concatenate all chunks. */
  build(): Uint8Array {
    let len = 0
    for (const c of this.chunks) len += c.length
    const out = new Uint8Array(len)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }

  get length(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0)
  }
}

function encodeUtf8(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str)
  // Minimal fallback (ASCII only)
  return encodeCp437(str)
}

// ─── Receipt ──────────────────────────────────────────────────────────────

export interface ReceiptBusiness {
  name: string
  address?: string | null
  phone?: string | null
  taxId?: string | null
  brn?: string | null
  email?: string | null
  website?: string | null
}

export interface ReceiptLine {
  name: string
  qty: number
  unit?: string | null
  unitPrice: number
  total: number
  discount?: number | null
  /** Extra sub-lines, e.g. serial numbers or modifiers. */
  notes?: string[]
}

export interface ReceiptInput {
  business: ReceiptBusiness
  header?: string | null
  footer?: string | null
  invoiceNo: string
  dateTime: string
  cashier?: string | null
  counter?: string | null
  customer?: { name: string; phone?: string | null } | null
  lines: ReceiptLine[]
  subtotal: number
  discount: number
  taxLines: { name: string; amount: number }[]
  taxInclusive?: boolean
  total: number
  payments: { method: string; amount: number; reference?: string | null }[]
  change?: number | null
  loyalty?: { earned?: number | null; balance?: number | null } | null
  isReturn?: boolean
  /** Receipt QR payload for return lookup (usually the invoice number). */
  qrPayload?: string | null
  currency?: string | null
  /** Printed as a CODE128 barcode under the QR (defaults to invoiceNo). */
  barcode?: string | null
  /** Optional copy label, e.g. "DUPLICATE". */
  copyLabel?: string | null
}

export interface ReceiptBuildOptions {
  paperWidth: PaperWidth
  /** Print non-ASCII lines as bitmaps (requires `rasterizer`). */
  unicodeAsBitmap?: boolean
  rasterizer?: TextRasterizer | null
  drawerKick?: boolean
  drawerPin?: 2 | 5
  logoImage?: RasterImageData | null
  /** Pre-packed logo bitmap (GET /api/settings/logo/raster). Preferred over logoImage. */
  logoRaster?: PackedRaster | null
  /** Omit the final cut (e.g. when printing several copies). */
  noCut?: boolean
  decimals?: number
  codePage?: CodePage
}

function money(n: number, decimals: number) {
  return formatMoney(n, decimals)
}

function methodLabel(method: string): string {
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

export function builderFor(opts: {
  paperWidth: PaperWidth
  unicodeAsBitmap?: boolean
  rasterizer?: TextRasterizer | null
  codePage?: CodePage
}) {
  return new EscPosBuilder({
    codePage: opts.codePage,
    columns: COLUMNS[opts.paperWidth],
    widthDots: DOT_WIDTH[opts.paperWidth],
    rasterizer: opts.unicodeAsBitmap ? opts.rasterizer ?? null : null,
  })
}

export function buildReceiptEscPos(input: ReceiptInput, opts: ReceiptBuildOptions): Uint8Array {
  const b = builderFor(opts)
  const cols = b.columns
  const dec = opts.decimals ?? 2
  const cur = input.currency ? `${input.currency} ` : ''

  b.init()
  if (opts.drawerKick) b.drawerKick(opts.drawerPin ?? 2)
  b.selectCodePage()

  // Header
  b.align('center')
  if (opts.logoRaster) {
    b.packedRaster(opts.logoRaster)
    b.feed(1)
  } else if (opts.logoImage) {
    b.rasterImage(opts.logoImage, Math.min(b.widthDots, 384))
    b.feed(1)
  }
  b.styledLine(input.business.name, { bold: true, size: 2, align: 'center' })
  if (input.business.address) b.paragraph(input.business.address, { align: 'center' })
  if (input.business.phone) b.styledLine(`Tel: ${input.business.phone}`, { align: 'center' })
  if (input.business.email) b.styledLine(input.business.email, { align: 'center' })
  if (input.business.website) b.styledLine(input.business.website, { align: 'center' })
  if (input.business.taxId) b.styledLine(`VAT/TIN: ${input.business.taxId}`, { align: 'center' })
  if (input.business.brn) b.styledLine(`BRN: ${input.business.brn}`, { align: 'center' })
  if (input.header) b.paragraph(input.header, { align: 'center' })
  if (input.isReturn) b.styledLine('*** RETURN ***', { bold: true, align: 'center' })
  if (input.copyLabel) b.styledLine(`*** ${input.copyLabel} ***`, { align: 'center' })

  b.align('left')
  b.hr()
  b.row('Receipt:', input.invoiceNo)
  b.row('Date:', input.dateTime)
  if (input.counter) b.row('Counter:', input.counter)
  if (input.cashier) b.row('Cashier:', input.cashier)
  if (input.customer?.name) b.row('Customer:', input.customer.name)
  if (input.customer?.phone) b.row('Phone:', input.customer.phone)
  b.hr()

  // Items
  const amtW = Math.max(10, Math.min(14, Math.floor(cols / 3)))
  b.tableRow([
    { text: 'Item', width: cols - amtW },
    { text: 'Amount', width: amtW, align: 'right' },
  ])
  b.hr('-')
  for (const l of input.lines) {
    const qtyStr = Number.isInteger(l.qty) ? String(l.qty) : l.qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
    b.paragraph(l.name)
    const qtyLine = `  ${qtyStr}${l.unit ? ` ${l.unit}` : ''} x ${money(l.unitPrice, dec)}`
    b.row(qtyLine, money(l.total, dec))
    if (l.discount && l.discount > 0) b.row('  Discount', `-${money(l.discount, dec)}`)
    for (const n of l.notes || []) b.paragraph(`  ${n}`)
  }
  b.hr()

  // Totals
  b.row('Subtotal', money(input.subtotal, dec))
  if (input.discount > 0) b.row('Discount', `-${money(input.discount, dec)}`)
  for (const t of input.taxLines) {
    if (t.amount === 0) continue
    b.row(input.taxInclusive ? `${t.name} (incl.)` : t.name, money(t.amount, dec))
  }
  b.styledLine('', {})
  b.bold(true).size(2, 2)
  b.row('TOTAL', `${cur}${money(input.total, dec)}`)
  b.size(1, 1).bold(false)
  b.hr()

  // Payments
  for (const p of input.payments) {
    const ref = p.reference ? ` (${p.reference})` : ''
    b.row(`${methodLabel(p.method)}${ref}`, money(p.amount, dec))
  }
  if (input.change && input.change > 0) b.row('Change', money(input.change, dec))

  if (input.loyalty && (input.loyalty.earned != null || input.loyalty.balance != null)) {
    b.hr()
    if (input.loyalty.earned != null) b.row('Points earned', String(input.loyalty.earned))
    if (input.loyalty.balance != null) b.row('Points balance', String(input.loyalty.balance))
  }

  // Footer
  b.hr()
  b.align('center')
  if (input.footer) b.paragraph(input.footer, { align: 'center' })
  const qrPayload = input.qrPayload ?? input.invoiceNo
  if (qrPayload) {
    b.feed(1)
    b.qr(qrPayload, opts.paperWidth === 58 ? 4 : 5)
  }
  const bc = input.barcode === undefined ? input.invoiceNo : input.barcode
  if (bc) {
    b.feed(1)
    b.barcode(bc, { height: 50, width: 2, hri: 2 })
  }
  b.align('left')
  b.feed(3)
  if (!opts.noCut) b.cut(true)
  return b.build()
}

// ─── Z report ─────────────────────────────────────────────────────────────

export interface ZReportMethod {
  method: string
  opening: number
  sales: number
  expected: number
  actual?: number | null
  variance?: number | null
}

export interface ZReportInput {
  business: ReceiptBusiness
  title?: string
  entryNumber: string
  counter?: string | null
  cashier?: string | null
  openedAt: string
  closedAt: string
  summary: {
    totalSales: number
    totalReturns: number
    netSales: number
    totalTransactions: number
    totalVariance?: number | null
  }
  methods: ZReportMethod[]
  notes?: string | null
  currency?: string | null
}

export interface ZReportBuildOptions {
  paperWidth: PaperWidth
  unicodeAsBitmap?: boolean
  rasterizer?: TextRasterizer | null
  noCut?: boolean
  decimals?: number
  codePage?: CodePage
}

export function buildZReportEscPos(input: ZReportInput, opts: ZReportBuildOptions): Uint8Array {
  const b = builderFor(opts)
  const dec = opts.decimals ?? 2
  const cols = b.columns
  b.init()
  b.selectCodePage()
  b.align('center')
  b.styledLine(input.business.name, { bold: true, size: 2, align: 'center' })
  if (input.business.address) b.paragraph(input.business.address, { align: 'center' })
  b.styledLine(input.title || 'Z REPORT - SHIFT CLOSE', { bold: true, align: 'center' })
  b.align('left')
  b.hr('=')
  b.row('Shift:', input.entryNumber)
  if (input.counter) b.row('Counter:', input.counter)
  if (input.cashier) b.row('Cashier:', input.cashier)
  b.row('Opened:', input.openedAt)
  b.row('Closed:', input.closedAt)
  b.hr()
  b.styledLine('SUMMARY', { bold: true })
  b.row('Transactions', String(input.summary.totalTransactions))
  b.row('Gross sales', money(input.summary.totalSales, dec))
  b.row('Returns', `-${money(input.summary.totalReturns, dec)}`)
  b.bold(true)
  b.row('Net sales', money(input.summary.netSales, dec))
  b.bold(false)
  b.hr()
  b.styledLine('BY PAYMENT METHOD', { bold: true })
  const narrow = cols <= 32
  if (narrow) {
    for (const m of input.methods) {
      b.styledLine(methodLabel(m.method), { bold: true })
      b.row('  Opening', money(m.opening, dec))
      b.row('  Sales', money(m.sales, dec))
      b.row('  Expected', money(m.expected, dec))
      if (m.actual != null) b.row('  Counted', money(m.actual, dec))
      if (m.variance != null) b.row('  Variance', money(m.variance, dec))
    }
  } else {
    const nameW = cols - 36
    b.tableRow([
      { text: 'Method', width: nameW },
      { text: 'Expected', width: 12, align: 'right' },
      { text: 'Counted', width: 12, align: 'right' },
      { text: 'Var', width: 12, align: 'right' },
    ])
    b.hr('-')
    for (const m of input.methods) {
      b.tableRow([
        { text: methodLabel(m.method), width: nameW },
        { text: money(m.expected, dec), width: 12, align: 'right' },
        { text: m.actual != null ? money(m.actual, dec) : '-', width: 12, align: 'right' },
        { text: m.variance != null ? money(m.variance, dec) : '-', width: 12, align: 'right' },
      ])
    }
  }
  if (input.summary.totalVariance != null) {
    b.hr()
    b.bold(true)
    b.row('Total variance', money(input.summary.totalVariance, dec))
    b.bold(false)
  }
  if (input.notes) {
    b.hr()
    b.paragraph(input.notes)
  }
  b.hr('=')
  b.align('center')
  b.styledLine(`Printed ${new Date().toLocaleString()}`, { align: 'center' })
  b.align('left')
  b.feed(3)
  if (!opts.noCut) b.cut(true)
  return b.build()
}

// ─── Small utilities ──────────────────────────────────────────────────────

/** A short test page exercising text, barcode and QR. */
export function buildTestPageEscPos(opts: {
  paperWidth: PaperWidth
  businessName?: string
  drawerKick?: boolean
  codePage?: CodePage
}): Uint8Array {
  const b = builderFor({ paperWidth: opts.paperWidth, codePage: opts.codePage })
  b.init()
  if (opts.drawerKick) b.drawerKick(2)
  b.selectCodePage()
  b.align('center')
  b.styledLine(opts.businessName || 'POSLanka', { bold: true, size: 2, align: 'center' })
  b.styledLine('Printer test page', { align: 'center' })
  b.align('left')
  b.hr()
  b.row('Paper width', `${opts.paperWidth}mm / ${b.columns} cols`)
  b.row('Time', new Date().toLocaleString())
  b.hr()
  b.line('0123456789'.repeat(Math.ceil(b.columns / 10)).slice(0, b.columns))
  b.hr()
  b.align('center')
  b.qr('POSLANKA-TEST', 4)
  b.feed(1)
  b.barcode('TEST-12345', { height: 40 })
  b.align('left')
  b.feed(3)
  b.cut(true)
  return b.build()
}

/** Drawer kick only. */
export function buildDrawerKickEscPos(pin: 2 | 5 = 2): Uint8Array {
  return new EscPosBuilder().init().drawerKick(pin).build()
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
