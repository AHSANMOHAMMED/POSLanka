/**
 * Barcode symbology choice + dot-exact sizing for label printers (L6).
 * Mobile copy of the web src/lib/print/label/barcode-fit.ts (keep identical).
 *
 * Pure TS, no imports besides types: shared by the raw encoders (TSPL / ZPL /
 * EPL), the browser label renderer (bars drawn on the printer's dot grid) and
 * the pre-print check. The mobile app keeps a byte-identical copy in
 * apps/mobile/src/lib/label/barcodeFit.ts (scripts/tests/c3-mobile-labels.ts).
 *
 * Rules
 *  - The scanner must return exactly the code stored on the item, so:
 *      13 digits + valid check digit -> EAN-13   (printer computes the check digit from 12)
 *      12 digits + valid check digit -> UPC-A
 *      anything else                 -> Code 128 (optimal B/C subsets)
 *    A template asking for EAN-13 / UPC-A / EAN-8 / ITF-14 with data that is not a
 *    valid code of that type falls back to Code 128 (the printer would otherwise
 *    print a different check digit and the POS would not find the item).
 *  - Module (narrow bar) width is an integer number of printer dots, at least
 *    2 dots at 203 dpi (0.25 mm) / 3 dots at 300 dpi (0.254 mm).
 *  - Quiet zones of >= 10 modules (11 for EAN / UPC) on both sides must fit
 *    inside the label; the symbol may grow past its template box into the
 *    label's white margin, never past the label edge.
 */
import type { BarcodeFormat } from './types'

export const TWO_D_FORMATS: BarcodeFormat[] = ['qrcode', 'datamatrix', 'pdf417']

/** GS1 mod-10 check digit for the digits in `body` (no check digit). */
export function gtinCheckDigit(body: string): number {
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const d = body.charCodeAt(body.length - 1 - i) - 48
    sum += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (sum % 10)) % 10
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false
  return gtinCheckDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48
}

export interface SymbolChoice {
  /** Symbology actually printed. */
  format: BarcodeFormat
  /** Data sent to the printer / renderer (EAN/UPC without check digit). */
  data: string
  /** What a scanner returns when it reads the label. */
  value: string
  /** Set when the template's symbology was replaced. */
  note?: string
}

const isPrintableAscii = (s: string) => /^[\x20-\x7e]+$/.test(s)

/** Pick the symbology for `raw` given the template's requested `format`. */
export function chooseSymbology(format: BarcodeFormat, raw: string): SymbolChoice | { error: string } {
  const v = (raw || '').trim()
  if (!v) return { error: 'no barcode data (item has no barcode or SKU)' }
  if (TWO_D_FORMATS.includes(format)) return { format, data: v, value: v }

  const code128 = (why?: string): SymbolChoice | { error: string } => {
    if (!isPrintableAscii(v)) return { error: `"${v}" has characters a 1D barcode cannot hold (use letters, digits and - . / etc.)` }
    return { format: 'code128', data: v, value: v, ...(why ? { note: why } : {}) }
  }

  switch (format) {
    case 'code128':
    case 'ean13':
    case 'upca':
    case 'ean8': {
      if (/^\d{13}$/.test(v) && isValidGtin(v)) return { format: 'ean13', data: v.slice(0, 12), value: v }
      if (/^\d{12}$/.test(v) && isValidGtin(v)) return { format: 'upca', data: v.slice(0, 11), value: v }
      if (format === 'ean8' && /^\d{8}$/.test(v) && isValidGtin(v)) return { format: 'ean8', data: v.slice(0, 7), value: v }
      if (format === 'code128') return code128()
      const name = format === 'ean13' ? 'EAN-13' : format === 'upca' ? 'UPC-A' : 'EAN-8'
      return code128(`"${v}" is not a valid ${name} code - printed as Code 128 so the scan matches the item`)
    }
    case 'itf14':
      if (/^\d{14}$/.test(v) && isValidGtin(v)) return { format, data: v.slice(0, 13), value: v }
      return code128(`"${v}" is not a valid ITF-14 code - printed as Code 128`)
    case 'code39': {
      const up = v.toUpperCase()
      if (/^[0-9A-Z \-.$/+%]+$/.test(up)) return { format, data: up, value: up }
      return code128(`"${v}" cannot be encoded in Code 39 - printed as Code 128`)
    }
    case 'code93':
      return isPrintableAscii(v) ? { format, data: v, value: v } : code128()
    case 'codabar':
      if (/^[A-Da-d][0-9\-$:/.+]+[A-Da-d]$/.test(v)) return { format, data: v.toUpperCase(), value: v.toUpperCase() }
      return code128(`"${v}" is not valid Codabar data - printed as Code 128`)
    default:
      return code128()
  }
}

/**
 * Minimum number of Code 128 symbol characters (start + data + check) for `data`
 * using subsets B and C (dynamic programming over subset switches).
 */
export function code128SymbolCount(data: string): number {
  const n = data.length
  const isD = (i: number) => i < n && data.charCodeAt(i) >= 48 && data.charCodeAt(i) <= 57
  const pair = (i: number) => isD(i) && isD(i + 1)
  // f[i][0] = in B at i, f[i][1] = in C at i
  const INF = 1e9
  const fB = new Array<number>(n + 2).fill(INF)
  const fC = new Array<number>(n + 2).fill(INF)
  fB[n] = 0
  fC[n] = 0
  for (let i = n - 1; i >= 0; i--) {
    // C: only digit pairs, else switch to B
    const cStay = pair(i) ? 1 + fC[i + 2] : INF
    // B: one char, or switch to C if a pair follows
    const bStay = 1 + fB[i + 1]
    fB[i] = bStay
    fC[i] = cStay
    // resolve switches (one level each way is enough: switching twice is never optimal)
    fB[i] = Math.min(bStay, pair(i) ? 1 + cStay : INF)
    fC[i] = Math.min(cStay, 1 + bStay)
  }
  const body = Math.min(fB[0], pair(0) ? fC[0] : INF)
  return 1 + body + 1 // start + data/switches + check
}

/** Bar/space modules of the symbol itself (no quiet zones). */
export function linearSymbolModules(format: BarcodeFormat, data: string): number {
  switch (format) {
    case 'ean13':
    case 'upca':
      return 95
    case 'ean8':
      return 67
    case 'itf14':
      return 4 + 7 * 14 + 4 // start + 7 digit pairs (wide = 2 x narrow) + stop
    case 'code39':
      return (data.length + 2) * 13 - 1 // wide = 2 x narrow, 1 module gap
    case 'code93':
      return (data.length + 4) * 9 + 1
    case 'codabar':
      return data.length * 11
    case 'code128':
    default:
      return 11 * code128SymbolCount(data) + 13 // + stop (13)
  }
}

/** Quiet zone (modules) required on each side. */
export function quietZoneModules(format: BarcodeFormat): number {
  return format === 'ean13' || format === 'upca' ? 11 : 10
}

export const minModuleDots = (dpi: number) => (dpi >= 300 ? 3 : 2)
export const maxModuleDots = (dpi: number) => (dpi >= 300 ? 6 : 4)

export interface LinearPlan {
  /** Narrow bar width (dots). */
  module: number
  /** Symbol width without quiet zones (dots). */
  symbolDots: number
  /** Quiet zone each side (dots). */
  quietDots: number
  /** Left edge of the first bar, label-relative dots. */
  x: number
  /** Symbol + quiet zones fit inside the label at `module`. */
  fits: boolean
  /** Symbol is wider than its template box (uses the label's white margin). */
  overflowsBox: boolean
}

/**
 * Pick the widest integer module (min..max dots) whose symbol fits the
 * template box with quiet zones inside the label; else the minimum module if
 * symbol + quiet zones still fit the label width; else `fits = false`.
 * Positions are label-relative dots (`boxX`, `boxW`, `labelW`).
 */
export function planLinear(
  format: BarcodeFormat,
  data: string,
  dpi: number,
  boxX: number,
  boxW: number,
  labelW: number,
  /** Exact symbol modules when known (browser renderer: sum of bwip-js bar/space widths). */
  modulesOverride?: number
): LinearPlan {
  const modules = modulesOverride ?? linearSymbolModules(format, data)
  const q = quietZoneModules(format)
  const minM = minModuleDots(dpi)
  const maxM = maxModuleDots(dpi)
  let m = 0
  for (let k = maxM; k >= minM; k--) {
    if (modules * k <= boxW && (modules + 2 * q) * k <= labelW) {
      m = k
      break
    }
  }
  const fitsLabel = (k: number) => (modules + 2 * q) * k <= labelW
  if (!m) m = minM
  const fits = fitsLabel(m)
  const symbolDots = modules * m
  const quietDots = q * m
  let x = Math.round(boxX + boxW / 2 - symbolDots / 2)
  if (fits) {
    x = Math.max(quietDots, Math.min(labelW - quietDots - symbolDots, x))
  } else {
    x = Math.max(0, Math.round((labelW - symbolDots) / 2))
  }
  return { module: m, symbolDots, quietDots, x, fits, overflowsBox: symbolDots > boxW }
}

export const SYMBOLOGY_NAMES: Partial<Record<BarcodeFormat, string>> = {
  code128: 'Code 128',
  ean13: 'EAN-13',
  ean8: 'EAN-8',
  upca: 'UPC-A',
  code39: 'Code 39',
  code93: 'Code 93',
  codabar: 'Codabar',
  itf14: 'ITF-14',
  qrcode: 'QR',
  datamatrix: 'DataMatrix',
  pdf417: 'PDF417',
}
