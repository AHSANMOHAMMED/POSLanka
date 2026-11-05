/**
 * Label print setup of a shop (Barcode → Print Labels), stored in the tenant
 * `label_settings` settings row under `printSetup`, so it is the same in every
 * browser and survives sign-out:
 *
 *   - printer:  brand, command language, dpi, darkness, speed, exact / fast mode
 *   - media:    the roll the user typed in (label size, gap, columns, offsets) or null = roll list
 *   - chrome:   browser-dialog options (continuous roll, row gap, move print, sheet size)
 *   - layout:   template, roll, quick layout or "as designed", the fields of every quick
 *               layout and the per-element tweaks (move / padding / font / bold / hide),
 *               kept separately per quick layout and per designed template
 *   - lock:     an owner / manager locks the whole setup; nothing changes until unlocked
 *
 * Pure (web + server). The quick layout builder lives here too so the page, the
 * API and the tests use one implementation.
 */
import type { BarcodeElement, LabelElement, LabelTemplate, TextElement } from './types'
import { DEFAULT_HRI_PT } from '@/lib/print/label/barcode-fit'

// ─── Printer brands ──────────────────────────────────────────────────────

export type PrintLanguage = 'zpl' | 'tspl' | 'epl' | 'escpos-raster' | 'driver'
export const PRINT_LANGUAGES: { value: PrintLanguage; label: string; hint: string }[] = [
  { value: 'zpl', label: 'ZPL', hint: 'Zebra and ZPL-emulation printers' },
  { value: 'tspl', label: 'TSPL / TSPL2', hint: 'TSC, Xprinter, Gprinter, HPRT, Rongta, DBL and most Chinese label printers' },
  { value: 'epl', label: 'EPL2', hint: 'Older Zebra / Eltron LP / TLP 2844' },
  { value: 'escpos-raster', label: 'ESC/POS picture', hint: 'Receipt-style printers that print labels as a picture' },
  { value: 'driver', label: 'Through the Windows driver', hint: 'Any printer: a picture printed with its installed driver' },
]

export interface LabelPrinterBrand {
  id: string
  name: string
  language: PrintLanguage
  /** What to check on the printer when the test label prints as text. */
  note?: string
}

export const LABEL_PRINTER_BRANDS: LabelPrinterBrand[] = [
  { id: 'zebra', name: 'Zebra (ZD220 / ZD230 / GK420 / ZT...)', language: 'zpl' },
  { id: 'zebra-epl', name: 'Zebra / Eltron LP 2844, TLP 2844 (EPL)', language: 'epl' },
  { id: 'tsc', name: 'TSC (TE200 / TE210 / TTP-244 / DA...)', language: 'tspl' },
  { id: 'xprinter', name: 'Xprinter (XP-350B / XP-360B / XP-420B...)', language: 'tspl' },
  { id: 'gprinter', name: 'Gprinter / Gainscha (GP-1324D / GP-3120...)', language: 'tspl' },
  { id: 'dbl', name: 'DBL', language: 'tspl', note: 'DBL label printers use TSPL. If it prints text instead of labels, try ZPL.' },
  { id: 'hprt', name: 'HPRT (HT300 / LPQ80...)', language: 'tspl' },
  { id: 'rongta', name: 'Rongta (RP410 / RP420...)', language: 'tspl' },
  { id: 'godex', name: 'GoDEX (G500 / DT2...)', language: 'zpl', note: 'GoDEX: turn on ZPL emulation (GoLabel / printer menu), or use "Through the Windows driver".' },
  { id: 'argox', name: 'Argox (OS-214 / CP-2140...)', language: 'zpl', note: 'Argox: set the printer to PPLZ (ZPL). PPLA / PPLB-only models: use "Through the Windows driver".' },
  { id: 'honeywell', name: 'Honeywell / Datamax / Intermec', language: 'zpl', note: 'Honeywell: set the printer language to ZSim (ZPL).' },
  { id: 'citizen', name: 'Citizen (CL-S / CL-E)', language: 'zpl', note: 'Citizen: Cross-Emulation detects ZPL automatically.' },
  { id: 'bixolon', name: 'Bixolon (SLP / XD...)', language: 'zpl', note: 'Bixolon: ZPL emulation must be on (SLCS is not supported).' },
  { id: 'sato', name: 'SATO', language: 'zpl', note: 'SATO: turn on ZPL emulation (SBPL is not supported).' },
  { id: 'generic', name: 'Other / Chinese label printer', language: 'tspl', note: 'Most unbranded label printers speak TSPL. If the test prints text, try ZPL, else "Through the Windows driver".' },
  { id: 'other-driver', name: 'Other (print through its driver)', language: 'driver' },
]

export const brandById = (id: string | null | undefined) => LABEL_PRINTER_BRANDS.find((b) => b.id === id) || null

export const LABEL_DPIS = [203, 300, 600] as const
export type PrintDpi = (typeof LABEL_DPIS)[number]

// ─── Element tweaks / quick layouts ──────────────────────────────────────

/** Per-element adjustment from the print page customiser (mm / pt deltas). */
export interface ElementTweak {
  dx?: number
  dy?: number
  /** Inner padding (mm): the box shrinks on every side. Negative grows it. */
  pad?: number
  /** Font size change (pt). For a barcode: the numbers below the bars. */
  font?: number
  bold?: boolean
  hidden?: boolean
  /** Barcode: numbers below the bars. */
  showText?: boolean
  /** Barcode: bar height change (mm). */
  dh?: number
}

export type TweakMap = Record<string, ElementTweak>

export interface QuickFields {
  showName: boolean
  nameLengthMode: 'initial' | 'autofit' | 'multiline'
  nameFontSize: 'small' | 'normal' | 'large'
  showBarcode: boolean
  barcodeType: 'code128' | 'qrcode'
  showBarcodeText: boolean
  showPrice: boolean
  showSku: boolean
  showCompany: boolean
  showVendor: boolean
  showCategory: boolean
  showUnit: boolean
  showPriceCode: boolean
}

export const DEFAULT_QUICK_FIELDS: QuickFields = {
  showName: true,
  nameLengthMode: 'initial',
  nameFontSize: 'normal',
  showBarcode: true,
  barcodeType: 'code128',
  showBarcodeText: true,
  showPrice: true,
  showSku: true,
  showCompany: false,
  showVendor: false,
  showCategory: false,
  showUnit: false,
  showPriceCode: false,
}

const off = { showName: false, showBarcode: false, showPrice: false, showSku: false, showCompany: false, showVendor: false, showCategory: false, showUnit: false, showPriceCode: false }

/** The quick 1-click layouts. 'custom' = the fields the user ticked. Each keeps its own fields and tweaks. */
export const QUICK_PRESETS: { id: string; name: string; fields: Partial<QuickFields> }[] = [
  { id: 'standard', name: 'Standard', fields: { ...off, showName: true, nameLengthMode: 'initial', showBarcode: true, showBarcodeText: true, showPrice: true, showSku: true } },
  { id: 'vendor', name: '+ Vendor Name', fields: { ...off, showName: true, nameLengthMode: 'initial', showBarcode: true, showBarcodeText: true, showPrice: true, showSku: true, showVendor: true } },
  { id: 'store-vendor', name: 'Store + Vendor', fields: { ...off, showName: true, nameLengthMode: 'initial', showBarcode: true, showBarcodeText: true, showPrice: true, showCompany: true, showVendor: true } },
  { id: 'price-barcode', name: 'Price + Barcode', fields: { ...off, showBarcode: true, showBarcodeText: true, showPrice: true } },
  { id: 'small-tag', name: 'Jewelry / Small Tag', fields: { ...off, showName: true, nameLengthMode: 'initial', nameFontSize: 'small', showBarcode: true, showBarcodeText: false, showPrice: true, showPriceCode: true } },
  { id: 'all', name: 'All Details', fields: { showName: true, nameLengthMode: 'autofit', showBarcode: true, showBarcodeText: true, showPrice: true, showSku: true, showCompany: true, showVendor: true, showCategory: true, showUnit: true, showPriceCode: true } },
  { id: 'barcode-only', name: 'Barcode Only', fields: { ...off, showBarcode: true, showBarcodeText: false } },
  { id: 'custom', name: 'My fields', fields: {} },
]

export function presetFields(id: string): QuickFields {
  const p = QUICK_PRESETS.find((x) => x.id === id)
  return { ...DEFAULT_QUICK_FIELDS, ...(p?.fields || {}) }
}

/** Quick-layout fields that match what a template prints (first use of a template). */
export function fieldsFromTemplate(t: Pick<LabelTemplate, 'elements'> | null | undefined): QuickFields {
  const els = t?.elements || []
  const txt = (f: string) => els.some((e) => e?.type === 'text' && e.dataField === f)
  const bc = els.find((e) => e?.type === 'barcode') as BarcodeElement | undefined
  return {
    ...DEFAULT_QUICK_FIELDS,
    showName: txt('item.name'),
    showBarcode: !!bc,
    showBarcodeText: bc?.showText ?? true,
    showPrice: txt('item.sellingPrice'),
    showSku: txt('item.sku'),
    showCompany: txt('tenant.name'),
    showVendor: txt('item.supplier') || txt('item.brand'),
    showCategory: txt('item.category'),
    showUnit: txt('item.unit'),
    showPriceCode: txt('item.priceCode'),
  }
}

const text = (p: Partial<TextElement> & Pick<TextElement, 'id' | 'dataField' | 'x' | 'y' | 'width' | 'height' | 'fontSize'>): TextElement => ({
  type: 'text',
  fontWeight: 'normal',
  textAlign: 'center',
  maxLines: 1,
  rotation: 0,
  zIndex: 1,
  ...p,
})

/**
 * The quick layout: elements laid out from the ticked fields for a label of
 * the given size. Top to bottom: store / vendor header, cost code, item name,
 * barcode filling the free height, price / SKU footer at the bottom. Nothing
 * overlaps (the barcode only gets the space left between name and footer).
 */
export function buildQuickLayout(widthMm: number, heightMm: number, f: QuickFields): LabelElement[] {
  const W = Number(widthMm) || 50
  const H = Number(heightMm) || 30
  const narrow = W <= 40
  const out: LabelElement[] = []
  let y = 1.0

  // 1. Header: store name / vendor
  if (f.showCompany && f.showVendor) {
    if (W >= 48) {
      const half = (W - 3) / 2
      out.push(text({ id: 'dyn-company', dataField: 'tenant.name', x: 1, y, width: half, height: 3.2, fontSize: 6, fontWeight: 'bold', textAlign: 'left' }))
      out.push(text({ id: 'dyn-vendor', dataField: 'item.supplier', prefix: 'Vendor: ', x: half + 1.5, y, width: half, height: 3.2, fontSize: 5.5, textAlign: 'right' }))
      y += 3.8
    } else {
      out.push(text({ id: 'dyn-company', dataField: 'tenant.name', x: 1, y, width: W - 2, height: 2.8, fontSize: 5.5, fontWeight: 'bold' }))
      y += 3.0
      out.push(text({ id: 'dyn-vendor', dataField: 'item.supplier', prefix: 'By: ', x: 1, y, width: W - 2, height: 2.4, fontSize: 5 }))
      y += 2.8
    }
  } else if (f.showCompany) {
    out.push(text({ id: 'dyn-company', dataField: 'tenant.name', x: 1, y, width: W - 2, height: 3.2, fontSize: narrow ? 6 : 7, fontWeight: 'bold' }))
    y += 3.8
  } else if (f.showVendor) {
    out.push(text({ id: 'dyn-vendor', dataField: 'item.supplier', prefix: 'Vendor: ', x: 1, y, width: W - 2, height: 3.2, fontSize: narrow ? 6 : 7 }))
    y += 3.8
  }

  // 2. Cost code: top right when there is no header, else its own small line under the header
  if (f.showPriceCode) {
    const header = f.showCompany || f.showVendor
    out.push(text({ id: 'dyn-pricecode', dataField: 'item.priceCode', prefix: '*', x: Math.max(1, W - 17), y: header ? y : 0.8, width: 16, height: 2.8, fontSize: 5.5, textAlign: 'right', zIndex: 3 }))
    if (header) y += 3.0
  }

  // 3. Item name
  if (f.showName) {
    const multi = f.nameLengthMode === 'multiline'
    const nameH = multi ? (narrow ? 5.5 : 6.5) : narrow ? 3.5 : 4.2
    const font = f.nameFontSize === 'small' ? 5.5 : f.nameFontSize === 'large' ? (narrow ? 8.5 : 10) : narrow ? 6.5 : 8
    // with the cost code top right and no header, keep the name clear of it
    const beside = f.showPriceCode && !(f.showCompany || f.showVendor) && y < 3.6
    out.push(text({ id: 'dyn-name', dataField: 'item.name', x: 1, y: beside ? 3.6 : y, width: Math.max(10, W - 2), height: nameH, fontSize: font, fontWeight: 'bold', maxLines: multi ? 2 : 1, autoFit: f.nameLengthMode === 'autofit' }))
    y = (beside ? 3.6 : y) + nameH + 0.8
  } else if (f.showPriceCode && !(f.showCompany || f.showVendor)) {
    y = Math.max(y, 3.8)
  }

  // 4. Footer at the bottom: price / SKU / category / unit
  const hasFooter = f.showPrice || f.showSku || f.showCategory || f.showUnit
  const footerH = narrow ? 5.0 : 6.0
  const footerY = H - footerH - 0.8
  if (hasFooter) {
    if (f.showSku && f.showPrice) {
      const skuW = Math.min(22, Math.floor(W * 0.42))
      const priceX = skuW + 2
      out.push(text({ id: 'dyn-sku', dataField: 'item.sku', prefix: 'SKU: ', x: 1.5, y: footerY + 1.0, width: skuW, height: 3.5, fontSize: 5.5, textAlign: 'left', zIndex: 2 }))
      out.push(text({ id: 'dyn-price', dataField: 'item.sellingPrice', isCurrency: true, x: priceX, y: footerY, width: W - priceX - 1.5, height: footerH, fontSize: narrow ? 8.5 : 11, fontWeight: 'bold', textAlign: 'right', zIndex: 2 }))
    } else if (f.showPrice) {
      out.push(text({ id: 'dyn-price', dataField: 'item.sellingPrice', isCurrency: true, x: 1, y: footerY, width: W - 2, height: footerH, fontSize: narrow ? 10.5 : 13, fontWeight: 'bold', zIndex: 2 }))
    } else if (f.showSku) {
      out.push(text({ id: 'dyn-sku', dataField: 'item.sku', prefix: 'SKU: ', x: 1, y: footerY, width: W - 2, height: 4, fontSize: 6.5, zIndex: 2 }))
    }
    if (f.showCategory && !f.showSku) {
      out.push(text({ id: 'dyn-category', dataField: 'item.category', x: 1.5, y: footerY + 1, width: Math.floor(W * 0.45), height: 3, fontSize: 5.5, textAlign: 'left', zIndex: 2 }))
    }
    if (f.showUnit && !f.showPrice) {
      out.push(text({ id: 'dyn-unit', dataField: 'item.unit', prefix: 'Unit: ', x: Math.max(2, W / 2 - 8), y: footerY, width: 16, height: 3, fontSize: 6, zIndex: 2 }))
    }
  }

  // 5. Barcode: the space left between the name and the footer (never over the footer)
  if (f.showBarcode) {
    const isQr = f.barcodeType === 'qrcode'
    const bottom = hasFooter ? footerY - 0.4 : H - 1.0
    const avail = Math.max(2, bottom - y)
    const h = isQr ? Math.min(avail, Math.min(W - 4, 18)) : Math.min(22, avail)
    const w = isQr ? h : Math.max(10, W - 4)
    out.push({
      id: 'dyn-barcode',
      type: 'barcode',
      dataField: 'item.barcode',
      format: isQr ? 'qrcode' : 'code128',
      barWidth: 2,
      // numbers need ~2.6 mm under the bars: drop them when the code would be too short to scan
      showText: isQr ? false : f.showBarcodeText && h >= 6,
      x: isQr ? Math.max(2, (W - w) / 2) : 2,
      y,
      width: w,
      height: h,
      rotation: 0,
      zIndex: 1,
    })
  }
  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Apply customiser tweaks to elements (hidden ones are removed). */
export function applyElementTweaks(elements: LabelElement[], tweaks: TweakMap | null | undefined): LabelElement[] {
  if (!tweaks || !Object.keys(tweaks).length) return elements
  const out: LabelElement[] = []
  for (const el of elements) {
    const t = tweaks[el.id]
    if (!t) {
      out.push(el)
      continue
    }
    if (t.hidden) continue
    const pad = Number(t.pad) || 0
    const next = {
      ...el,
      x: round2(el.x + (Number(t.dx) || 0) + pad),
      y: round2(el.y + (Number(t.dy) || 0) + pad),
      width: round2(Math.max(1, el.width - 2 * pad)),
      height: round2(Math.max(1, el.height - 2 * pad + (el.type === 'barcode' ? Number(t.dh) || 0 : 0))),
    } as LabelElement
    if (next.type === 'text') {
      if (t.font) next.fontSize = round2(Math.max(3, Math.min(72, next.fontSize + t.font)))
      if (typeof t.bold === 'boolean') next.fontWeight = t.bold ? 'bold' : 'normal'
    } else if (next.type === 'barcode') {
      if (typeof t.showText === 'boolean') next.showText = t.showText
      if (t.font) next.textSizePt = round2(Math.max(3, Math.min(20, (next.textSizePt ?? DEFAULT_HRI_PT) + t.font)))
    }
    out.push(next)
  }
  return out
}

/** Short name of an element for the customiser. */
export function elementLabel(el: LabelElement): string {
  if (el.type === 'barcode') return el.format === 'qrcode' ? 'QR code' : 'Barcode'
  if (el.type === 'image') return 'Image'
  if (el.type === 'shape') return el.shape === 'line' ? 'Line' : 'Box'
  const names: Record<string, string> = {
    'tenant.name': 'Store name',
    'item.name': 'Item name',
    'item.sellingPrice': 'Price',
    'item.costPrice': 'Cost price',
    'item.sku': 'SKU',
    'item.barcode': 'Barcode number',
    'item.priceCode': 'Cost code',
    'item.discountCode': 'Price code',
    'item.supplier': 'Vendor',
    'item.brand': 'Brand',
    'item.category': 'Category',
    'item.unit': 'Unit',
    'item.pluCode': 'PLU',
    'item.weight': 'Weight',
    'item.oemPartNumber': 'OEM part #',
  }
  return names[el.dataField] || (el.dataField === 'custom' ? `Text "${(el.customValue || '').slice(0, 14)}"` : el.dataField)
}

/** Element at a point (mm) on the label: the smallest box containing it. */
export function elementAt(elements: LabelElement[], xMm: number, yMm: number): LabelElement | null {
  let best: LabelElement | null = null
  for (const el of elements) {
    if (xMm < el.x || yMm < el.y || xMm > el.x + el.width || yMm > el.y + el.height) continue
    if (!best || el.width * el.height < best.width * best.height) best = el
  }
  return best
}

// ─── Stored setup ────────────────────────────────────────────────────────

export interface PrintSetupMedia {
  labelWidthMm: number
  labelHeightMm: number
  rowGapMm: number
  columns: number
  columnGapMm: number
  marginLeftMm: number
  offsetXMm: number
  offsetYMm: number
}

export interface LayoutPresetState {
  fields?: QuickFields
  tweaks?: TweakMap
}

export interface LabelPrintSetup {
  printer: {
    brand: string | null
    /** Null = guess from the printer name. */
    language: PrintLanguage | null
    /** Null = the roll's dpi. */
    dpi: PrintDpi | null
    darkness: number | null
    speed: number | null
    /** Raw printers: 'exact' sends the preview as one picture, 'fast' uses the printer's fonts. */
    renderMode: 'exact' | 'fast'
  }
  /** Roll typed in Printer setup; null = the roll picked from the list. */
  media: PrintSetupMedia | null
  chrome: {
    pageSize: 'Label' | 'A4' | 'Letter'
    sheetGapMm: number
    noGapSensing: boolean
    rowGapMm: number | null
    offsetYMm: number
  }
  layout: {
    templateId: string | null
    setupId: string | null
    /** null = automatic (designed for your own templates, quick for the built-in ones). */
    source: 'quick' | 'designed' | null
    preset: string
    presets: Record<string, LayoutPresetState>
    /** Designed templates: tweaks per template id. */
    templateTweaks: Record<string, TweakMap>
  }
  locked: boolean
  lockedBy: string | null
  lockedAt: string | null
}

export const DEFAULT_PRINT_SETUP: LabelPrintSetup = {
  printer: { brand: null, language: null, dpi: null, darkness: null, speed: null, renderMode: 'exact' },
  media: null,
  chrome: { pageSize: 'Label', sheetGapMm: 3, noGapSensing: false, rowGapMm: null, offsetYMm: 0 },
  layout: { templateId: null, setupId: null, source: null, preset: 'custom', presets: {}, templateTweaks: {} },
  locked: false,
  lockedBy: null,
  lockedAt: null,
}

const num = (v: unknown, min: number, max: number, d: number) => {
  const n = Number(v)
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? d : Math.min(max, Math.max(min, n))
}
const optNum = (v: unknown, min: number, max: number) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.min(max, Math.max(min, Number(v))))
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const safeKey = (k: string) => /^[\w:.-]{1,80}$/.test(k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype'

function sanitizeTweak(v: unknown): ElementTweak | null {
  const t = obj(v)
  const out: ElementTweak = {}
  const d = (k: 'dx' | 'dy' | 'pad' | 'font' | 'dh', min: number, max: number) => {
    const n = optNum(t[k], min, max)
    if (n) out[k] = round2(n)
  }
  d('dx', -100, 100)
  d('dy', -100, 100)
  d('pad', -10, 10)
  d('font', -30, 30)
  d('dh', -50, 50)
  if (typeof t.bold === 'boolean') out.bold = t.bold
  if (t.hidden === true) out.hidden = true
  if (typeof t.showText === 'boolean') out.showText = t.showText
  return Object.keys(out).length ? out : null
}

function sanitizeTweaks(v: unknown): TweakMap {
  const out: TweakMap = {}
  let n = 0
  for (const [k, t] of Object.entries(obj(v))) {
    if (!safeKey(k) || n >= 100) continue
    const s = sanitizeTweak(t)
    if (s) {
      out[k] = s
      n++
    }
  }
  return out
}

function sanitizeFields(v: unknown): QuickFields | undefined {
  const f = obj(v)
  if (!Object.keys(f).length) return undefined
  const b = (k: keyof QuickFields) => (typeof f[k] === 'boolean' ? (f[k] as boolean) : (DEFAULT_QUICK_FIELDS[k] as boolean))
  return {
    showName: b('showName'),
    nameLengthMode: f.nameLengthMode === 'autofit' || f.nameLengthMode === 'multiline' ? f.nameLengthMode : 'initial',
    nameFontSize: f.nameFontSize === 'small' || f.nameFontSize === 'large' ? f.nameFontSize : 'normal',
    showBarcode: b('showBarcode'),
    barcodeType: f.barcodeType === 'qrcode' ? 'qrcode' : 'code128',
    showBarcodeText: b('showBarcodeText'),
    showPrice: b('showPrice'),
    showSku: b('showSku'),
    showCompany: b('showCompany'),
    showVendor: b('showVendor'),
    showCategory: b('showCategory'),
    showUnit: b('showUnit'),
    showPriceCode: b('showPriceCode'),
  }
}

/** Lenient normaliser for stored / client values (never throws). */
export function sanitizePrintSetup(raw: unknown): LabelPrintSetup {
  const r = obj(raw)
  const p = obj(r.printer)
  const m = r.media && typeof r.media === 'object' ? obj(r.media) : null
  const c = obj(r.chrome)
  const l = obj(r.layout)
  const lang = PRINT_LANGUAGES.some((x) => x.value === p.language) ? (p.language as PrintLanguage) : null
  const presets: Record<string, LayoutPresetState> = {}
  for (const [k, v] of Object.entries(obj(l.presets))) {
    if (!QUICK_PRESETS.some((q) => q.id === k)) continue
    const fields = sanitizeFields(obj(v).fields)
    const tweaks = sanitizeTweaks(obj(v).tweaks)
    presets[k] = { ...(fields ? { fields } : {}), ...(Object.keys(tweaks).length ? { tweaks } : {}) }
  }
  const templateTweaks: Record<string, TweakMap> = {}
  let n = 0
  for (const [k, v] of Object.entries(obj(l.templateTweaks))) {
    if (!safeKey(k) || n >= 50) continue
    const t = sanitizeTweaks(v)
    if (Object.keys(t).length) {
      templateTweaks[k] = t
      n++
    }
  }
  const locked = r.locked === true
  return {
    printer: {
      brand: brandById(str(p.brand, 40))?.id ?? null,
      language: lang,
      dpi: Number(p.dpi) === 600 ? 600 : Number(p.dpi) === 300 ? 300 : Number(p.dpi) === 203 ? 203 : null,
      darkness: optNum(p.darkness, 0, 30),
      speed: optNum(p.speed, 1, 14),
      renderMode: p.renderMode === 'fast' ? 'fast' : 'exact',
    },
    media: m
      ? {
          labelWidthMm: round2(num(m.labelWidthMm, 10, 220, 50)),
          labelHeightMm: round2(num(m.labelHeightMm, 5, 400, 25)),
          rowGapMm: round2(num(m.rowGapMm, 0, 30, 2)),
          columns: Math.round(num(m.columns, 1, 4, 1)),
          columnGapMm: round2(num(m.columnGapMm, 0, 30, 0)),
          marginLeftMm: round2(num(m.marginLeftMm, 0, 30, 0)),
          offsetXMm: round2(num(m.offsetXMm, -20, 20, 0)),
          offsetYMm: round2(num(m.offsetYMm, -20, 20, 0)),
        }
      : null,
    chrome: {
      pageSize: c.pageSize === 'A4' || c.pageSize === 'Letter' ? c.pageSize : 'Label',
      sheetGapMm: round2(num(c.sheetGapMm, 0, 20, 3)),
      noGapSensing: c.noGapSensing === true,
      rowGapMm: optNum(c.rowGapMm, 0, 10),
      offsetYMm: round2(num(c.offsetYMm, -10, 10, 0)),
    },
    layout: {
      templateId: str(l.templateId, 80),
      setupId: str(l.setupId, 80),
      source: l.source === 'quick' || l.source === 'designed' ? l.source : null,
      preset: QUICK_PRESETS.some((q) => q.id === l.preset) ? (l.preset as string) : 'custom',
      presets,
      templateTweaks,
    },
    locked,
    lockedBy: locked ? str(r.lockedBy, 120) : null,
    lockedAt: locked ? str(r.lockedAt, 40) : null,
  }
}

/** Same setup apart from the lock stamp. */
export function sameSetupContent(a: LabelPrintSetup, b: LabelPrintSetup): boolean {
  const strip = (s: LabelPrintSetup) => JSON.stringify({ ...s, locked: false, lockedBy: null, lockedAt: null })
  return strip(a) === strip(b)
}

export type PrintSetupAction = 'save' | 'lock' | 'unlock'

/**
 * Server rule for a change to the stored setup.
 *   - only users who may manage settings change it (403 otherwise)
 *   - a locked setup is not changed: 'save' answers 409 unless nothing changed; 'lock' on a locked setup keeps it
 *   - 'lock' stores the sent setup and locks it (stamped with who / when); 'unlock' only unlocks
 */
export function applyPrintSetupChange(
  prev: LabelPrintSetup | null,
  incoming: unknown,
  action: PrintSetupAction,
  who: { canManage: boolean; name: string; now?: Date }
): { status: 200; setup: LabelPrintSetup } | { status: 403 | 409; error: string } {
  if (!who.canManage) return { status: 403, error: prev?.locked ? 'The label setup is locked by the owner / manager.' : 'Only the owner or a manager can change the label setup.' }
  const base = prev ?? DEFAULT_PRINT_SETUP
  if (action === 'unlock') return { status: 200, setup: { ...base, locked: false, lockedBy: null, lockedAt: null } }
  const next = sanitizePrintSetup(incoming)
  if (base.locked) {
    if (action === 'lock' || sameSetupContent(base, next)) return { status: 200, setup: base }
    return { status: 409, error: 'The label setup is locked. Press Unlock first.' }
  }
  if (action === 'lock') return { status: 200, setup: { ...next, locked: true, lockedBy: who.name.slice(0, 120), lockedAt: (who.now ?? new Date()).toISOString() } }
  return { status: 200, setup: { ...next, locked: false, lockedBy: null, lockedAt: null } }
}
