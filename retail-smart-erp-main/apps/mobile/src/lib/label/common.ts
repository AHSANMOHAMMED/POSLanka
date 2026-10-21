/**
 * Shared helpers for raw label printer encoders (TSPL / ZPL / EPL).
 * Mobile port of the web src/lib/print/label/common.ts: output must stay
 * byte-identical (checked by scripts/tests/c3-mobile-labels.ts). Pure TS, no
 * node / DOM APIs (UTF-8 via utf8Bytes from ../qr).
 */
import { resolveField, type BarcodeElement, type BarcodeFormat, type LabelElement, type LabelItemData, type LabelTemplate, type TextElement } from './types'
import { utf8Bytes } from '../qr'

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
 * Barcode data cleaned for printer symbologies (check digits are computed by
 * the printer). Returns null (+ reason) when the data cannot be encoded.
 */
export function resolveBarcodeData(
  el: BarcodeElement,
  item: LabelItemData | null,
  o: EncodeLabelOptions
): { data: string } | { error: string } {
  const raw = (resolveField(el.dataField, item, el.customValue, undefined, o.tenantName) || '').trim()
  if (!raw) return { error: 'no data' }
  const digits = (n: number[], name: string) => {
    if (!/^\d+$/.test(raw) || !n.includes(raw.length)) return { error: `${name} needs ${n.join(' or ')} digits (got "${raw}")` }
    return { data: raw.slice(0, Math.min(...n)) }
  }
  switch (el.format) {
    case 'ean13':
      return digits([12, 13], 'EAN-13')
    case 'ean8':
      return digits([7, 8], 'EAN-8')
    case 'upca':
      return digits([11, 12], 'UPC-A')
    case 'itf14': {
      const r = digits([13, 14], 'ITF-14')
      return r
    }
    case 'codabar':
      if (!/^[A-Da-d][0-9\-$:/.+]+[A-Da-d]$/.test(raw)) return { error: `invalid Codabar data "${raw}"` }
      return { data: raw.toUpperCase() }
    case 'code39': {
      const up = raw.toUpperCase()
      if (!/^[0-9A-Z \-.$/+%]+$/.test(up)) return { error: `invalid Code 39 data "${raw}"` }
      return { data: up }
    }
    default:
      return { data: raw }
  }
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
