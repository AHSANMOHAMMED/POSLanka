/**
 * Barcode engine — pure functions shared by the barcode-lookup API (and portable to the mobile app).
 *
 * Supports: EAN-13, EAN-8, UPC-A, UPC-E (expanded), ITF-14 / GTIN-14, Code 128 / Code 39 (free text SKUs),
 * GS1-128 / GS1 DataMatrix application identifiers (GTIN, batch, expiry, serial, weight, count, price),
 * weighing-scale price/weight-embedded EAN-13 (prefix 2x, configurable layout) and PLU codes.
 */

export type Symbology =
  | 'ean13' | 'ean8' | 'upca' | 'upce' | 'itf14' | 'gs1' | 'scale' | 'plu' | 'sku' | 'qr' | 'unknown'

export interface ScaleBarcodeConfig {
  enabled: boolean
  /** Leading digit(s) that mark a scale label, e.g. ["2"] or ["20","21","22"] */
  prefixes: string[]
  /** 0-based start index of the PLU/item code inside the 13-digit code */
  pluStart: number
  pluLength: number
  /** 0-based start of the weight/price field */
  valueStart: number
  valueLength: number
  valueType: 'weight' | 'price'
  /** implied decimals in the value field (3 → 01234 = 1.234 kg; 2 → 12345 = 123.45 LKR) */
  valueDecimals: number
  /** validate the EAN-13 check digit (set false for scales that print a non-standard last digit) */
  checkDigit?: boolean
}

export const DEFAULT_SCALE_CONFIG: ScaleBarcodeConfig = {
  enabled: true,
  prefixes: ['20', '21', '22', '2', '02'],
  pluStart: 2,
  pluLength: 5,
  valueStart: 7,
  valueLength: 5,
  valueType: 'weight',
  valueDecimals: 3,
  checkDigit: true,
}

export function normalizeScaleConfig(input?: Partial<ScaleBarcodeConfig> | null): ScaleBarcodeConfig {
  const c = { ...DEFAULT_SCALE_CONFIG, ...(input || {}) }
  c.prefixes = Array.isArray(c.prefixes) && c.prefixes.length > 0
    ? c.prefixes.map((p) => String(p).replace(/\D/g, '')).filter(Boolean)
    : ['20', '21', '22', '2', '02']
  c.pluStart = clampInt(c.pluStart, 1, 11, 2)
  c.pluLength = clampInt(c.pluLength, 1, 10, 5)
  c.valueStart = clampInt(c.valueStart, 1, 11, 7)
  c.valueLength = clampInt(c.valueLength, 1, 10, 5)
  c.valueDecimals = clampInt(c.valueDecimals, 0, 4, 3)
  c.valueType = c.valueType === 'price' ? 'price' : 'weight'
  c.enabled = input?.enabled !== false
  c.checkDigit = c.checkDigit !== false
  return c
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number.parseInt(String(v), 10)
  if (Number.isNaN(n)) return dflt
  return Math.min(max, Math.max(min, n))
}

/** GTIN / EAN / UPC modulo-10 check digit for the first n-1 digits */
export function gtinCheckDigit(digitsWithoutCheck: string): number {
  let sum = 0
  const len = digitsWithoutCheck.length
  for (let i = 0; i < len; i++) {
    const d = digitsWithoutCheck.charCodeAt(len - 1 - i) - 48
    sum += d * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false
  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1])
}

/** Expand a 6/7/8-digit UPC-E to 12-digit UPC-A (returns null when invalid) */
export function expandUpcE(code: string): string | null {
  let c = code
  if (c.length === 8) c = c.slice(1, 7) // strip number system + check
  else if (c.length === 7) c = c.slice(0, 6)
  if (!/^\d{6}$/.test(c)) return null
  const [a, b, cc, d, e, f] = c.split('')
  let upcA: string
  switch (f) {
    case '0': case '1': case '2': upcA = `0${a}${b}${f}0000${cc}${d}${e}`; break
    case '3': upcA = `0${a}${b}${cc}00000${d}${e}`; break
    case '4': upcA = `0${a}${b}${cc}${d}00000${e}`; break
    default: upcA = `0${a}${b}${cc}${d}${e}0000${f}`
  }
  return upcA + gtinCheckDigit(upcA)
}

export interface Gs1Fields {
  gtin?: string
  batchNo?: string
  serial?: string
  expiryDate?: string      // YYYY-MM-DD
  productionDate?: string  // YYYY-MM-DD
  netWeightKg?: number
  count?: number
  price?: number
  raw: Record<string, string>
}

const GS = '\u001d'
/** Fixed-length AIs (AI → data length). Variable-length ones end at FNC1/GS or end of string. */
const FIXED_AI: Record<string, number> = {
  '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2,
}
const VARIABLE_AI = ['10', '21', '22', '30', '37', '90', '91', '92', '240', '241', '250', '251', '400', '410', '414']

function yymmdd(v: string): string | undefined {
  if (!/^\d{6}$/.test(v)) return undefined
  const yy = Number(v.slice(0, 2)); const mm = v.slice(2, 4); let dd = v.slice(4, 6)
  const year = yy >= 70 ? 1900 + yy : 2000 + yy
  if (dd === '00') dd = '28' // GS1: day 00 = end of month; approximate safely
  return `${year}-${mm}-${dd}`
}

/** Parse a GS1 element string (GS1-128 / GS1 DataMatrix). Accepts optional ']C1' / ']d2' AIM prefix and bracketed AIs. */
export function parseGs1(input: string): Gs1Fields | null {
  let s = input.trim()
  if (s.startsWith(']C1') || s.startsWith(']d2') || s.startsWith(']Q3') || s.startsWith(']e0')) s = s.slice(3)
  // Bracketed human-readable form "(01)09501101530003(17)260131(10)AB12"
  if (s.startsWith('(')) s = s.replace(/\((\d{2,4})\)/g, (_, ai) => `${GS}${ai}`).replace(/^\u001d/, '')
  if (!/^\d{2}/.test(s)) return null
  const raw: Record<string, string> = {}
  let i = 0
  let guard = 0
  while (i < s.length && guard++ < 50) {
    if (s[i] === GS) { i++; continue }
    let ai: string | null = null
    for (const len of [2, 3, 4]) {
      const cand = s.slice(i, i + len)
      if (FIXED_AI[cand] !== undefined || VARIABLE_AI.includes(cand) || /^31\d\d$|^32\d\d$|^39[2-3]\d$|^33\d\d$/.test(cand)) { ai = cand; break }
    }
    if (!ai) return Object.keys(raw).length ? { ...gs1ToFields(raw), raw } : null
    i += ai.length
    let value: string
    if (FIXED_AI[ai] !== undefined) {
      value = s.slice(i, i + FIXED_AI[ai]); i += FIXED_AI[ai]
    } else if (/^31\d\d$|^32\d\d$|^33\d\d$/.test(ai)) {
      value = s.slice(i, i + 6); i += 6
    } else {
      const end = s.indexOf(GS, i); value = end === -1 ? s.slice(i) : s.slice(i, end); i = end === -1 ? s.length : end + 1
    }
    raw[ai] = value
  }
  if (!Object.keys(raw).length) return null
  return { ...gs1ToFields(raw), raw }
}

function gs1ToFields(raw: Record<string, string>): Omit<Gs1Fields, 'raw'> {
  const f: Omit<Gs1Fields, 'raw'> = {}
  if (raw['01']) f.gtin = raw['01']
  if (raw['02'] && !f.gtin) f.gtin = raw['02']
  if (raw['10']) f.batchNo = raw['10']
  if (raw['21']) f.serial = raw['21']
  if (raw['17']) f.expiryDate = yymmdd(raw['17'])
  if (raw['15'] && !f.expiryDate) f.expiryDate = yymmdd(raw['15'])
  if (raw['11']) f.productionDate = yymmdd(raw['11'])
  for (const ai of Object.keys(raw)) {
    if (/^310\d$/.test(ai)) f.netWeightKg = Number(raw[ai]) / Math.pow(10, Number(ai[3]))
    if (/^392\d$/.test(ai)) f.price = Number(raw[ai]) / Math.pow(10, Number(ai[3]))
  }
  if (raw['30']) f.count = Number(raw['30'])
  if (raw['37'] && f.count === undefined) f.count = Number(raw['37'])
  return f
}

export interface ScaleParse { plu: string; value: number; valueType: 'weight' | 'price' }

export function parseScaleBarcode(code: string, config: ScaleBarcodeConfig): ScaleParse | null {
  if (!config.enabled) return null
  if (!/^\d{12,13}$/.test(code)) return null
  if (!config.prefixes.some((p) => code.startsWith(p))) return null
  if (code.length === 13 && config.checkDigit !== false && !isValidGtin(code)) return null
  const plu = code.slice(config.pluStart, config.pluStart + config.pluLength)
  const valueRaw = code.slice(config.valueStart, config.valueStart + config.valueLength)
  if (!/^\d+$/.test(plu) || !/^\d+$/.test(valueRaw)) return null
  const value = Number(valueRaw) / Math.pow(10, config.valueDecimals)
  if (!(value > 0)) return null
  return { plu: plu.replace(/^0+(?=\d)/, ''), value, valueType: config.valueType }
}

export interface ScanCandidate { kind: Symbology; lookup: string; field: 'barcode' | 'plu' | 'sku' }

export interface ScanAnalysis {
  symbology: Symbology
  normalized: string
  candidates: ScanCandidate[]
  gs1?: Gs1Fields
  scale?: ScaleParse
  gtinValid?: boolean
}

/**
 * Analyse a scanned string and produce the ordered list of values to look up
 * (barcode / PLU / SKU columns). The first candidate that matches an item wins.
 */
export function analyseScan(input: string, scaleConfig?: Partial<ScaleBarcodeConfig> | null): ScanAnalysis {
  const cfg = normalizeScaleConfig(scaleConfig)
  const raw = input.trim()
  const candidates: ScanCandidate[] = []
  const push = (kind: Symbology, lookup: string, field: ScanCandidate['field']) => {
    if (lookup && !candidates.some((c) => c.lookup === lookup && c.field === field)) candidates.push({ kind, lookup, field })
  }

  // 1. GS1 element strings (FNC1 / AIM prefix / bracketed)
  if (raw.includes(GS) || /^\](C1|d2|Q3|e0)/.test(raw) || /^\(\d{2,4}\)/.test(raw) || (/^01\d{14}/.test(raw) && raw.length > 16)) {
    const gs1 = parseGs1(raw)
    if (gs1?.gtin) {
      const gtin = gs1.gtin
      push('gs1', gtin, 'barcode')
      const stripped = gtin.replace(/^0+/, '')
      if (stripped.length === 13 || stripped.length === 12 || stripped.length === 8) push('gs1', stripped, 'barcode')
      if (gtin.length === 14 && gtin.startsWith('0')) push('gs1', gtin.slice(1), 'barcode')
      return { symbology: 'gs1', normalized: gtin, candidates, gs1, gtinValid: isValidGtin(gtin) }
    }
  }

  // 2. Weighing-scale label
  const scale = parseScaleBarcode(raw, cfg)
  if (scale) {
    // An item whose stored barcode equals the full code wins over the scale reading
    // (auto-generated item barcodes also start with '2').
    push('scale', raw, 'barcode')
    push('scale', scale.plu, 'plu')
    push('scale', scale.plu.padStart(cfg.pluLength, '0'), 'plu')
    return { symbology: 'scale', normalized: raw, candidates, scale, gtinValid: raw.length === 13 ? isValidGtin(raw) : undefined }
  }

  // 3. Numeric retail codes
  if (/^\d+$/.test(raw)) {
    push('plu', raw, 'barcode')
    push('plu', raw, 'plu')
    let symbology: Symbology = 'plu'
    if (raw.length === 13) { symbology = 'ean13'; push('ean13', raw.replace(/^0/, ''), 'barcode') }
    else if (raw.length === 12) { symbology = 'upca'; push('upca', '0' + raw, 'barcode') }
    else if (raw.length === 8) {
      symbology = 'ean8'
      const upcA = expandUpcE(raw)
      if (upcA) { push('upce', upcA, 'barcode'); push('upce', '0' + upcA, 'barcode') }
    } else if (raw.length === 6 || raw.length === 7) {
      const upcA = expandUpcE(raw)
      if (upcA) { symbology = 'upce'; push('upce', upcA, 'barcode'); push('upce', '0' + upcA, 'barcode') }
    } else if (raw.length === 14) {
      symbology = 'itf14'
      push('itf14', raw.slice(1), 'barcode')
      push('itf14', raw.replace(/^0+/, ''), 'barcode')
    }
    push('plu', raw, 'sku')
    const gtinValid = [8, 12, 13, 14].includes(raw.length) ? isValidGtin(raw) : undefined
    return { symbology, normalized: raw, candidates, gtinValid }
  }

  // 4. Free-text codes (Code 128 / Code 39 SKUs, QR payloads)
  const isQr = raw.length > 40 || raw.startsWith('http') || raw.startsWith('{')
  push(isQr ? 'qr' : 'sku', raw, 'barcode')
  push(isQr ? 'qr' : 'sku', raw, 'sku')
  push(isQr ? 'qr' : 'sku', raw.toUpperCase(), 'sku')
  return { symbology: isQr ? 'qr' : 'sku', normalized: raw, candidates }
}
