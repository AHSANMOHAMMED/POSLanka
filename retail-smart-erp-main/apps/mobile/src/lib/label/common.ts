/**
 * Shared helpers for raw label printer encoders (TSPL / ZPL / EPL).
 * Mobile port of the web src/lib/print/label/common.ts: output must stay
 * byte-identical (checked by scripts/tests/c3-mobile-labels.ts). Pure TS, no
 * node / DOM APIs (UTF-8 via utf8Bytes from ../qr).
 */
import { resolveField, type BarcodeElement, type BarcodeFormat, type LabelElement, type LabelItemData, type LabelTemplate, type TextElement } from './types'
import { utf8Bytes } from '../qr'
import { chooseSymbology, planLinear, type LinearPlan, type SymbolChoice } from './barcodeFit'

/** Packed 1-bit bitmap (MSB first, 1 = black), rows padded to whole bytes. */
export interface PackedRaster {
  /** Width in dots (bytes per row = ceil(width / 8)). */
  width: number
  height: number
  data: Uint8Array
}

export type RawLabelLanguage = 'tspl' | 'zpl' | 'epl' | 'escpos-raster'

export type LabelTemplateLike = Pick<LabelTemplate, 'widthMm' | 'heightMm' | 'elements'> &
  Partial<Pick<LabelTemplate, 'labelShape' | 'cornerRadius' | 'name'>>

export interface LabelPrintItem {
  item: LabelItemData | null
  quantity: number
}

/** Rasterise one element (images) to a packed 1-bit bitmap of exactly w x h dots. */
export type ElementRasterizer = (
  el: LabelElement,
  ctx: { item: LabelItemData | null; widthDots: number; heightDots: number; dpi: number }
) => Promise<PackedRaster | null>

/** Rasterise a whole label (ESC/POS raster mode). */
export type LabelRasterizer = (
  template: LabelTemplateLike,
  item: LabelItemData | null,
  ctx: { dpi: number; widthDots: number; heightDots: number; currencySymbol?: string; tenantName?: string; codeWord?: string }
) => Promise<PackedRaster | null>

export interface EncodeLabelOptions {
  language: RawLabelLanguage
  dpi: 203 | 300
  /** Multiplies each item's quantity (default 1). */
  copies?: number
  codeWord?: string
  currencySymbol?: string
  tenantName?: string
  /** Gap between labels (mm). Default 2. */
  gapMm?: number
  /** Override media size (defaults to the template size). */
  widthMm?: number
  heightMm?: number
  darkness?: number
  speed?: number
  /** Used for image elements in TSPL (BITMAP) / ZPL (^GFA) / EPL (GW). */
  rasterizeElement?: ElementRasterizer
  /** Required for 'escpos-raster'. */
  rasterizeLabel?: LabelRasterizer
  /**
   * Multi-across roll layout (sticker stock: 1/2/3/4 labels across, gaps and
   * calibration offsets). Omitted = one label across, no offsets (legacy output).
   */
  layout?: LabelSheetLayout
}

/** Physical layout of a label roll / sheet (all mm). */
export interface LabelSheetLayout {
  /** Labels across the roll (1..4). */
  columns: number
  /** Horizontal gap between adjacent labels in a row. */
  columnGapMm: number
  /** Liner margin left of the first column (and right of the last). */
  marginLeftMm: number
  /** Calibration shift (positive = right / down; may be negative). */
  offsetXMm: number
  offsetYMm: number
  /** TSPL DIRECTION (0 or 1, default 1). */
  direction?: 0 | 1
}

export function normalizeLayout(l: Partial<LabelSheetLayout> | null | undefined): LabelSheetLayout {
  const n = (v: unknown, min: number, max: number, d: number) => {
    const x = Number(v)
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d
  }
  return {
    columns: Math.round(n(l?.columns, 1, 4, 1)),
    columnGapMm: n(l?.columnGapMm, 0, 30, 0),
    marginLeftMm: n(l?.marginLeftMm, 0, 30, 0),
    offsetXMm: n(l?.offsetXMm, -20, 20, 0),
    offsetYMm: n(l?.offsetYMm, -20, 20, 0),
    direction: l?.direction === 0 ? 0 : 1,
  }
}

/** Media width (mm) the printer is told about: the whole liner for multi-across rolls. */
export function mediaWidthMm(template: LabelTemplateLike, o: EncodeLabelOptions): number {
  const w = o.widthMm ?? Number(template.widthMm)
  if (!o.layout) return w
  const l = normalizeLayout(o.layout)
  return Math.round((l.marginLeftMm * 2 + l.columns * w + (l.columns - 1) * l.columnGapMm) * 100) / 100
}

/** Origin (dots) of each column's label on the media, calibration offsets applied. */
export function columnOrigins(template: LabelTemplateLike, o: EncodeLabelOptions): { xs: number[]; y: number } {
  const w = o.widthMm ?? Number(template.widthMm)
  if (!o.layout) return { xs: [0], y: 0 }
  const l = normalizeLayout(o.layout)
  const xs = Array.from({ length: l.columns }, (_, i) => mmToDots(l.marginLeftMm + l.offsetXMm + i * (w + l.columnGapMm), o.dpi))
  return { xs, y: mmToDots(l.offsetYMm, o.dpi) }
}

/** One printed row of a multi-across roll; `count` identical rows in a row. A null cell is left blank. */
export interface LabelRow {
  cells: ({ item: LabelItemData | null } | null)[]
  count: number
}

/**
 * Lay labels out across the roll: each item is repeated quantity x copies and
 * the labels fill the columns left to right, row after row. Consecutive
 * identical rows are merged (printed with one command and a count). With one
 * column every item is one row printed quantity x copies times.
 */
export function packLabelRows(items: LabelPrintItem[], columns: number, copies = 1): LabelRow[] {
  const cols = Math.max(1, Math.min(4, Math.round(columns || 1)))
  const c = Math.max(1, Math.round(copies || 1))
  if (cols === 1) return items.map(({ item, quantity }) => ({ cells: [{ item }], count: quantity * c }))
  const flat: (LabelItemData | null)[] = []
  for (const { item, quantity } of items) for (let i = 0; i < quantity * c; i++) flat.push(item)
  const rows: LabelRow[] = []
  for (let i = 0; i < flat.length; i += cols) {
    const cells: LabelRow['cells'] = []
    for (let k = 0; k < cols; k++) cells.push(i + k < flat.length ? { item: flat[i + k] } : null)
    const prev = rows[rows.length - 1]
    const same = prev && prev.cells.every((x, k) => (x === null ? cells[k] === null : cells[k] !== null && x.item === cells[k]!.item))
    if (same) prev.count++
    else rows.push({ cells, count: 1 })
  }
  return rows
}

/** OR a packed 1-bit bitmap into another at (x, y) dots (clipped). */
export function blitPacked(dst: PackedRaster, src: PackedRaster, x: number, y: number): void {
  const dBpr = Math.ceil(dst.width / 8)
  const sBpr = Math.ceil(src.width / 8)
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy
    if (dy < 0 || dy >= dst.height) continue
    for (let sx = 0; sx < src.width; sx++) {
      if (!(src.data[sy * sBpr + (sx >> 3)] & (0x80 >> (sx & 7)))) continue
      const dx = x + sx
      if (dx < 0 || dx >= dst.width) continue
      dst.data[dy * dBpr + (dx >> 3)] |= 0x80 >> (dx & 7)
    }
  }
}

export interface EncodeLabelResult {
  bytes: Uint8Array
  /** Human-readable command text (binary bitmap payloads elided). */
  text: string
  warnings: string[]
}

export const dotsPerMm = (dpi: number) => dpi / 25.4
export const mmToDots = (mm: number, dpi: number) => Math.round(Number(mm) * dotsPerMm(dpi))
/** Template font sizes are points. */
export const ptToDots = (pt: number, dpi: number) => Math.max(1, Math.round((Number(pt) * dpi) / 72))
/** Shape border widths are CSS px (96/in). */
export const pxToDots = (px: number, dpi: number) => Math.max(1, Math.round((Number(px) * dpi) / 96))

/** Normalised rotation (0/90/180/270) or null when unsupported. */
export function rightAngle(rot: number | undefined): 0 | 90 | 180 | 270 | null {
  const r = (((Math.round(Number(rot) || 0) % 360) + 360) % 360) as number
  return r === 0 || r === 90 || r === 180 || r === 270 ? r : null
}

export function resolveText(el: TextElement, item: LabelItemData | null, o: EncodeLabelOptions): string {
  let text = resolveField(el.dataField, item, el.customValue, el.isCurrency ? o.currencySymbol : undefined, o.tenantName, o.codeWord)
  if (el.prefix) text = el.prefix + text
  if (el.suffix) text = text + el.suffix
  return text
}

/**
 * Value a barcode element encodes: its data field, else (for an item) the
 * item's barcode, then SKU, then PLU - the fields /api/items/barcode-lookup
 * matches, so a scanned label always finds the item. Never invents a code.
 */
export function barcodeSourceValue(el: BarcodeElement, item: LabelItemData | null, o: Pick<EncodeLabelOptions, 'tenantName'>): string {
  let raw = (resolveField(el.dataField, item, el.customValue, undefined, o.tenantName) || '').trim()
  if (!raw && item) raw = (item.barcode || item.sku || item.pluCode || '').trim()
  return raw
}

/**
 * Barcode data cleaned for printer symbologies (check digits are computed by
 * the printer) and the symbology actually printed (EAN-13 / UPC-A for valid
 * retail codes, else Code 128). Returns an error when nothing can be encoded.
 */
export function resolveBarcodeData(
  el: BarcodeElement,
  item: LabelItemData | null,
  o: EncodeLabelOptions
): (SymbolChoice & { data: string }) | { error: string } {
  return chooseSymbology(el.format, barcodeSourceValue(el, item, o))
}

/** Approximate number of modules for linear symbologies (used to fit the element width). */
export function linearModules(format: BarcodeFormat, data: string): number {
  switch (format) {
    case 'ean13':
      return 95
    case 'ean8':
      return 67
    case 'upca':
      return 95
    case 'itf14':
      return 14 * 9 + 9 // 2 bars (n=3 wide ratio) approx per digit pair
    case 'code39':
      return (data.length + 2) * 16
    case 'code93':
      return (data.length + 4) * 9 + 1
    case 'codabar':
      return data.length * 12
    case 'code128':
    default: {
      // Use set C for long numeric strings (2 digits per symbol).
      const symbols = /^\d+$/.test(data) && data.length >= 4 ? Math.ceil(data.length / 2) : data.length
      return 11 * (symbols + 3) + 2
    }
  }
}

/** QR module count for byte-mode data at ECC level M. */
export function qrModules(data: string): number {
  const caps = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666]
  const len = utf8Bytes(data).length
  let v = caps.findIndex((c) => len <= c) + 1
  if (v <= 0) v = 25
  return 17 + 4 * v
}

/** Fit a narrow-bar width (dots) for a linear barcode into `widthDots`. */
export function fitModule(format: BarcodeFormat, data: string, widthDots: number, maxModule = 10): { module: number; used: number } {
  const modules = linearModules(format, data)
  const mod = Math.max(1, Math.min(maxModule, Math.floor(widthDots / modules)))
  return { module: mod, used: modules * mod }
}

/**
 * Dot-exact placement of a linear barcode element (module width, left edge of
 * the bars, bar height) on a label whose left edge is at `ox` dots. Pushes a
 * warning when the code cannot be printed scannably (too long for the label)
 * or when the symbology was changed.
 */
export function placeLinearBarcode(
  template: LabelTemplateLike,
  el: BarcodeElement,
  choice: SymbolChoice,
  o: EncodeLabelOptions,
  ox: number,
  warnings: string[]
): { module: number; x: number; barHeight: number; plan: LinearPlan } {
  const dpi = o.dpi
  const labelWmm = o.widthMm ?? Number(template.widthMm)
  const labelW = mmToDots(labelWmm, dpi)
  const boxX = mmToDots(el.x, dpi)
  const boxW = Math.max(1, mmToDots(el.width, dpi))
  const plan = planLinear(choice.format, choice.data, dpi, boxX, boxW, labelW)
  if (choice.note) warnings.push(`Barcode ${el.id}: ${choice.note}`)
  if (!plan.fits) {
    warnings.push(
      `Barcode ${el.id}: "${choice.value}" is too long for a ${labelWmm} mm wide label (needs ${Math.ceil(((plan.symbolDots + 2 * plan.quietDots) / dpi) * 254) / 10} mm with quiet zones at ${plan.module}-dot bars) - it may not scan. Use a shorter code or a wider label.`
    )
  }
  const h = Math.max(1, mmToDots(el.height, dpi))
  const barHeight = Math.max(8, h - (el.showText ? hriHeight(dpi) : 0))
  const r = rightAngle(el.rotation) ?? 0
  return { module: plan.module, x: r === 0 ? ox + plan.x : Math.max(0, ox + boxX), barHeight, plan }
}

/** Human-readable text height reserved below linear barcodes (dots). */
export const hriHeight = (dpi: number) => mmToDots(2.5, dpi)

/** Simple word wrap by character count. */
export function wrapChars(text: string, maxChars: number, maxLines: number): string[] {
  const width = Math.max(1, maxChars)
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w
    else {
      lines.push(cur)
      cur = w
    }
    while (cur.length > width) {
      lines.push(cur.slice(0, width))
      cur = cur.slice(width)
    }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, Math.max(1, maxLines))
}

/** Strip to printable ASCII ('?' for others). */
export function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '?')
}

/** Elements sorted by zIndex (back to front). */
export function sortedElements(t: LabelTemplateLike): LabelElement[] {
  return [...(t.elements || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
}

export function isDarkColor(c: string | undefined | null): boolean {
  if (!c || c === 'transparent' || c === 'none') return false
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return c.trim().toLowerCase() === 'black'
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b < 128
}

/** Byte/text accumulator mixing ASCII command lines and binary payloads. */
export class CommandBuffer {
  private parts: Uint8Array[] = []
  private textParts: string[] = []
  constructor(private readonly eol = '\r\n') {}

  line(s: string): this {
    const str = s + this.eol
    this.parts.push(asciiBytes(str))
    this.textParts.push(str)
    return this
  }

  /** Raw text without EOL. */
  raw(s: string): this {
    this.parts.push(asciiBytes(s))
    this.textParts.push(s)
    return this
  }

  utf8(s: string): this {
    this.parts.push(new Uint8Array(utf8Bytes(s)))
    this.textParts.push(s)
    return this
  }

  binary(b: Uint8Array, placeholder = `<${b.length} bytes>`): this {
    this.parts.push(b)
    this.textParts.push(placeholder)
    return this
  }

  get text(): string {
    return this.textParts.join('')
  }

  bytes(): Uint8Array {
    const len = this.parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(len)
    let o = 0
    for (const p of this.parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i] = c < 0x100 ? c : 0x3f
  }
  return out
}

/** Invert a packed bitmap (TSPL BITMAP / EPL GW use 0 = black). */
export function invertBits(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = ~data[i] & 0xff
  return out
}

export function toHex(data: Uint8Array): string {
  let s = ''
  for (let i = 0; i < data.length; i++) s += data[i].toString(16).padStart(2, '0').toUpperCase()
  return s
}

export function normalizeItems(items: (LabelPrintItem | LabelItemData)[]): LabelPrintItem[] {
  return items.map((i) =>
    i && typeof i === 'object' && 'quantity' in i && 'item' in i
      ? { item: (i as LabelPrintItem).item, quantity: Math.max(1, Math.round((i as LabelPrintItem).quantity || 1)) }
      : { item: i as LabelItemData, quantity: 1 }
  )
}

// ---------------------------------------------------------------------------
// Currency symbol (mirror of web getCurrencySymbol in src/lib/utils/currency.ts,
// which the web label renderer uses via useTenantCurrency().symbol)
// ---------------------------------------------------------------------------
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  LKR: 'Rs',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  AED: 'د.إ',
  MYR: 'RM',
  PKR: '₨',
  BDT: '৳',
  ZAR: 'R',
  NGN: '₦',
  KES: 'KSh',
}

/**
 * Currency prefix for price fields on labels, from the tenant currency code (GET /api/tenant
 * `currency`, default LKR → "Rs"). Same table as the web; raw label printers (TSPL/ZPL/EPL)
 * only print ASCII, so a non-ASCII symbol (€, ₹, ...) falls back to the ISO code + space.
 */
export function labelCurrencySymbol(currencyCode: string | null | undefined): string {
  const code = String(currencyCode || 'LKR').trim().toUpperCase() || 'LKR'
  const symbol = CURRENCY_SYMBOLS[code] || code
  return /^[\x20-\x7e]+$/.test(symbol) ? symbol : `${code} `
}
