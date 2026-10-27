/**
 * "Through the driver" label printing (L8).
 *
 * For printers whose installed driver does not accept raw ZPL / TSPL (GDI-only
 * drivers, unknown brands): every physical row of the roll (all columns, gaps,
 * margins and calibration offsets) is rendered to a pure black / white 1-bit
 * PNG at the printer's resolution, exactly round(mm / 25.4 * dpi) pixels, and
 * the print agent (POST /print-image) prints one page per PNG through the
 * driver at that exact paper size.
 *
 * Barcodes are drawn here (pure, no DOM) on the printer's dot grid: integer
 * module widths and quiet zones from barcode-fit (same rules as the raw
 * encoders and the browser renderer), so the scan result is the same as raw
 * printing. Text, shapes and images come from the injected `rasterizeLabel`
 * (browser canvas, canvas-raster.ts); without one only the barcodes are drawn
 * (tests).
 */
import type { BarcodeElement, LabelElement, LabelItemData, TextElement } from '@/lib/labels/types'
import { FORMAT_TO_BWIP } from '@/lib/labels/types'
import { linearBarsAndSpaces } from '@/lib/labels/barcode-renderer'
import type { PackedRaster } from '@/lib/print/escpos/encoder'
import { planLinear, TWO_D_FORMATS } from './barcode-fit'
import {
  blitPacked,
  columnOrigins,
  mediaWidthMm,
  mmToDots,
  normalizeItems,
  normalizeLayout,
  packLabelRows,
  resolveBarcodeData,
  rightAngle,
  type EncodeLabelOptions,
  type LabelPrintItem,
  type LabelRasterizer,
  type LabelTemplateLike,
} from './common'

export interface DriverImageOptions extends Omit<EncodeLabelOptions, 'language' | 'rasterizeElement'> {
  /** Whole-label renderer for text / shapes / images (browser canvas). Barcodes are always drawn here. */
  rasterizeLabel?: LabelRasterizer
}

export interface DriverRows {
  /** One bitmap per physical row, in print order (identical rows share one object). */
  rows: PackedRaster[]
  /** Page size in dots (= PNG size). */
  widthDots: number
  heightDots: number
  /** Page size the driver gets (liner width x label height). */
  widthMm: number
  heightMm: number
  dpi: 203 | 300
  warnings: string[]
}

export interface DriverImageJob {
  widthMm: number
  heightMm: number
  dpi: 203 | 300
  /** One PNG per physical row, in order. */
  pages: Uint8Array[]
  warnings: string[]
}

/** HRI band below linear bars (same as the browser renderer). */
const hriDots = (dpi: number) => Math.round((2.6 * dpi) / 25.4)

const blank = (w: number, h: number): PackedRaster => ({ width: w, height: h, data: new Uint8Array(Math.ceil(w / 8) * h) })

function setPx(b: PackedRaster, x: number, y: number, on: boolean) {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height) return
  const i = y * Math.ceil(b.width / 8) + (x >> 3)
  if (on) b.data[i] |= 0x80 >> (x & 7)
  else b.data[i] &= ~(0x80 >> (x & 7)) & 0xff
}

function fillRect(b: PackedRaster, x: number, y: number, w: number, h: number, on: boolean) {
  for (let yy = Math.max(0, y); yy < Math.min(b.height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(b.width, x + w); xx++) setPx(b, xx, yy, on)
}

/**
 * Draw a local bitmap (lw x lh, `get(u, v)` = black) rotated by a right angle
 * about the centre of the element box (canvas / CSS rotation semantics).
 */
function drawRotated(dst: PackedRaster, box: { x: number; y: number; w: number; h: number }, lw: number, lh: number, rot: 0 | 90 | 180 | 270, ox: number, oy: number, get: (u: number, v: number) => boolean) {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  // local top-left so that the local content is centred on the box centre
  const lx0 = cx - lw / 2
  const ly0 = cy - lh / 2
  for (let v = 0; v < lh; v++)
    for (let u = 0; u < lw; u++) {
      if (!get(u, v)) continue
      // pixel centre relative to the box centre
      const px = lx0 + u + 0.5 - cx
      const py = ly0 + v + 0.5 - cy
      let rx = px
      let ry = py
      if (rot === 90) [rx, ry] = [-py, px]
      else if (rot === 180) [rx, ry] = [-px, -py]
      else if (rot === 270) [rx, ry] = [py, -px]
      setPx(dst, ox + Math.floor(cx + rx), oy + Math.floor(cy + ry), true)
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BwipApi = { raw: (bcid: string, text: string, opts: string) => any[] }
let bwipApi: BwipApi | null = null
async function bwip(): Promise<BwipApi> {
  if (bwipApi) return bwipApi
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import('bwip-js/browser')) as any
  // ESM build: the named export `raw` is the 'raw' symbology; the encoder API is default.raw.
  bwipApi = (mod.default && typeof mod.default.raw === 'function' ? mod.default : mod) as BwipApi
  return bwipApi
}

/**
 * Draw one barcode element on a label bitmap (label-relative dots); `mask`
 * receives the area (bars + quiet zones) that must stay white under the bars.
 * Returns an HRI text element for the canvas renderer (or null).
 */
async function drawBarcode(dst: PackedRaster, mask: PackedRaster, el: BarcodeElement, item: LabelItemData | null, o: DriverImageOptions, labelWmm: number, warnings: string[]): Promise<TextElement | null> {
  const dpi = o.dpi
  const choice = resolveBarcodeData(el, item, { ...o, language: 'tspl' })
  if ('error' in choice) {
    warnings.push(`Barcode ${el.id}: ${choice.error}`)
    return null
  }
  if (choice.note) warnings.push(`Barcode ${el.id}: ${choice.note}`)
  const rot = (rightAngle(el.rotation) ?? 0) as 0 | 90 | 180 | 270
  const box = { x: mmToDots(el.x, dpi), y: mmToDots(el.y, dpi), w: Math.max(1, mmToDots(el.width, dpi)), h: Math.max(1, mmToDots(el.height, dpi)) }

  if (TWO_D_FORMATS.includes(choice.format)) {
    let sym: { pixs: number[]; pixx: number; pixy: number }
    try {
      sym = (await bwip()).raw(FORMAT_TO_BWIP[choice.format], choice.data, '')[0]
    } catch (e) {
      warnings.push(`Barcode ${el.id}: ${e instanceof Error ? e.message : 'cannot encode'}`)
      return null
    }
    const yMul = choice.format === 'pdf417' ? 3 : 1
    const fitW = rot === 90 || rot === 270 ? box.h : box.w
    const fitH = rot === 90 || rot === 270 ? box.w : box.h
    const m = Math.max(1, Math.min(Math.floor(fitW / sym.pixx), Math.floor(fitH / (sym.pixy * yMul))))
    const lw = sym.pixx * m
    const lh = sym.pixy * yMul * m
    const quiet = (choice.format === 'pdf417' ? 2 : choice.format === 'qrcode' ? 4 : 1) * m
    drawRotated(mask, box, lw + 2 * quiet, lh + 2 * quiet, rot, 0, 0, () => true)
    drawRotated(dst, box, lw, lh, rot, 0, 0, (u, v) => !!sym.pixs[Math.floor(v / (yMul * m)) * sym.pixx + Math.floor(u / m)])
    return null
  }

  const sbs = await linearBarsAndSpaces(choice)
  if (!sbs) {
    warnings.push(`Barcode ${el.id}: "${choice.value}" cannot be encoded`)
    return null
  }
  const modules = sbs.reduce((a, b) => a + b, 0)
  const labelW = mmToDots(labelWmm, dpi)
  const hri = el.showText && rot === 0 ? hriDots(dpi) : 0
  const barH = Math.max(8, box.h - hri)
  if (rot === 0) {
    const plan = planLinear(choice.format, choice.data, dpi, box.x, box.w, labelW, modules)
    if (!plan.fits) {
      warnings.push(
        `Barcode ${el.id}: "${choice.value}" is too long for a ${labelWmm} mm wide label (needs ${Math.ceil(((plan.symbolDots + 2 * plan.quietDots) / dpi) * 254) / 10} mm with quiet zones at ${plan.module}-dot bars) - it may not scan. Use a shorter code or a wider label.`
      )
    }
    // Quiet zones and the bar area are white whatever is underneath.
    fillRect(mask, plan.x - plan.quietDots, box.y, plan.symbolDots + 2 * plan.quietDots, barH, true)
    let x = plan.x
    for (let i = 0; i < sbs.length; i++) {
      const w = sbs[i] * plan.module
      if (i % 2 === 0) fillRect(dst, x, box.y, w, barH, true)
      x += w
    }
    if (!hri) return null
    const dpm = dpi / 25.4
    // Canvas renderer: px = ptToDots(pt) * 1.33 -> aim for ~85 % of the HRI band.
    const fontPt = Math.max(4, Math.round(((hri * 0.85) / 1.33 / dpm) * (72 / 25.4) * 10) / 10)
    return {
      id: `${el.id}-hri`,
      type: 'text',
      dataField: 'custom',
      customValue: choice.value,
      x: (plan.x - plan.quietDots) / dpm,
      y: (box.y + barH) / dpm,
      width: (plan.symbolDots + 2 * plan.quietDots) / dpm,
      height: hri / dpm,
      fontSize: fontPt,
      fontWeight: 'normal',
      textAlign: 'center',
      maxLines: 1,
      rotation: 0,
      zIndex: el.zIndex + 1,
    }
  }
  // Rotated 90 / 180 / 270: bars along the box's long side, quiet zones kept white.
  const along = rot === 90 || rot === 270 ? box.h : box.w
  const across = rot === 90 || rot === 270 ? box.w : box.h
  const plan = planLinear(choice.format, choice.data, dpi, 0, along, along, modules)
  if (!plan.fits) warnings.push(`Barcode ${el.id}: "${choice.value}" is too long for its ${Math.round((along / dpi) * 254) / 10} mm box - it may not scan.`)
  const lw = plan.symbolDots + 2 * plan.quietDots
  const lh = across
  const bars = new Uint8Array(lw)
  let x = plan.quietDots
  for (let i = 0; i < sbs.length; i++) {
    const w = sbs[i] * plan.module
    if (i % 2 === 0) bars.fill(1, x, x + w)
    x += w
  }
  drawRotated(mask, box, lw, lh, rot, 0, 0, () => true)
  drawRotated(dst, box, lw, lh, rot, 0, 0, (u) => bars[u] === 1)
  return null
}

/** Render one label (template size, label-relative dots). */
async function renderLabel(template: LabelTemplateLike, item: LabelItemData | null, o: DriverImageOptions, wDots: number, hDots: number, labelWmm: number, warnings: string[]): Promise<PackedRaster> {
  const out = blank(wDots, hDots)
  const barcodes: BarcodeElement[] = []
  const rest: LabelElement[] = []
  for (const el of template.elements || []) {
    if (el.type === 'barcode' && rightAngle(el.rotation) !== null) barcodes.push(el)
    else rest.push(el) // odd-angle barcodes stay with the canvas renderer
  }
  const hriTexts: TextElement[] = []
  const bars = blank(wDots, hDots)
  const mask = blank(wDots, hDots)
  for (const el of barcodes) {
    const t = await drawBarcode(bars, mask, el, item, o, labelWmm, warnings)
    if (t) hriTexts.push(t)
  }
  if (o.rasterizeLabel) {
    const bg = await o.rasterizeLabel({ ...template, elements: [...rest, ...hriTexts] }, item, {
      dpi: o.dpi,
      widthDots: wDots,
      heightDots: hDots,
      currencySymbol: o.currencySymbol,
      tenantName: o.tenantName,
      codeWord: o.codeWord,
    })
    if (bg) blitPacked(out, bg, 0, 0)
    else warnings.push(`Label for ${item?.name ?? 'item'} could not be rendered (text / images missing)`)
  }
  // Barcode areas (bars + quiet zones) override anything drawn under them.
  for (let i = 0; i < out.data.length; i++) out.data[i] = (out.data[i] & ~mask.data[i] & 0xff) | bars.data[i]
  return out
}

/**
 * Render every physical row of the roll in print order (labels packed left to
 * right, row after row, quantity x copies; identical rows share one bitmap).
 */
export async function renderDriverRows(template: LabelTemplateLike, items: (LabelPrintItem | LabelItemData)[], o: DriverImageOptions): Promise<DriverRows> {
  const warnings: string[] = []
  const dpi: 203 | 300 = o.dpi === 300 ? 300 : 203
  const opts: DriverImageOptions = { ...o, dpi }
  const labelWmm = o.widthMm ?? Number(template.widthMm)
  const labelHmm = o.heightMm ?? Number(template.heightMm)
  const encOpts = { ...opts, language: 'tspl' as const }
  const widthMm = mediaWidthMm(template, encOpts)
  const widthDots = mmToDots(widthMm, dpi)
  const heightDots = mmToDots(labelHmm, dpi)
  const labelW = mmToDots(labelWmm, dpi)
  const columns = o.layout ? normalizeLayout(o.layout).columns : 1
  const { xs, y: oy } = columnOrigins(template, encOpts)

  const labelCache = new Map<LabelItemData | null, PackedRaster>()
  const label = async (item: LabelItemData | null) => {
    let b = labelCache.get(item)
    if (!b) {
      b = await renderLabel(template, item, opts, labelW, heightDots, labelWmm, warnings)
      labelCache.set(item, b)
    }
    return b
  }

  const rows: PackedRaster[] = []
  for (const row of packLabelRows(normalizeItems(items), columns, o.copies ?? 1)) {
    const dst = blank(widthDots, heightDots)
    for (let k = 0; k < row.cells.length; k++) {
      const cell = row.cells[k]
      if (cell) blitPacked(dst, await label(cell.item), xs[k] ?? 0, oy)
    }
    for (let i = 0; i < row.count; i++) rows.push(dst)
  }
  return { rows, widthDots, heightDots, widthMm, heightMm: labelHmm, dpi, warnings: [...new Set(warnings)] }
}

// ─── 1-bit PNG ────────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null
function crc32(parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const p of parts) for (let i = 0; i < p.length; i++) c = crcTable[(c ^ p[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const t = new Uint8Array([...type].map((c) => c.charCodeAt(0)))
  return [u32(data.length), t, data, u32(crc32([t, data]))]
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** zlib stream: CompressionStream('deflate') when available, else stored (uncompressed) blocks. */
async function zlib(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate')
      const buf = await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(cs)).arrayBuffer()
      return new Uint8Array(buf)
    } catch {
      /* fall through */
    }
  }
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const blk = raw.subarray(i, Math.min(raw.length, i + 65535))
    const last = i + 65535 >= raw.length ? 1 : 0
    parts.push(new Uint8Array([last, blk.length & 0xff, blk.length >> 8, ~blk.length & 0xff, (~blk.length >> 8) & 0xff]), blk)
    if (raw.length === 0) break
  }
  let a = 1
  let b = 0
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521
    b = (b + a) % 65521
  }
  parts.push(u32(((b << 16) | a) >>> 0))
  return concat(parts)
}

/**
 * Encode a packed bitmap (black = 1) as a 1-bit grayscale PNG of exactly
 * `width` x raster.height pixels, with the resolution in pHYs.
 */
export async function encodePng1Bit(raster: PackedRaster, width = raster.width, dpi = 203): Promise<Uint8Array> {
  const h = raster.height
  const srcBpr = Math.ceil(raster.width / 8)
  const bpr = Math.ceil(width / 8)
  const padMask = width % 8 ? (0xff >> (width % 8)) & 0xff : 0
  const raw = new Uint8Array((bpr + 1) * h)
  for (let y = 0; y < h; y++) {
    const o = y * (bpr + 1)
    raw[o] = 0 // filter: none
    for (let i = 0; i < bpr; i++) {
      const v = i < srcBpr ? raster.data[y * srcBpr + i] : 0
      raw[o + 1 + i] = ~v & 0xff // PNG gray 1-bit: 0 = black
    }
    if (padMask) raw[o + bpr] |= padMask
  }
  const ihdr = concat([u32(width), u32(h), new Uint8Array([1, 0, 0, 0, 0])])
  const ppm = Math.round(dpi / 0.0254)
  const phys = concat([u32(ppm), u32(ppm), new Uint8Array([1])])
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunk('IHDR', ihdr), ...chunk('pHYs', phys), ...chunk('IDAT', await zlib(raw)), ...chunk('IEND', new Uint8Array(0))])
}

/** Rows -> PNG pages for the print agent (identical rows encoded once). */
export async function buildDriverImageJob(template: LabelTemplateLike, items: (LabelPrintItem | LabelItemData)[], o: DriverImageOptions): Promise<DriverImageJob> {
  const r = await renderDriverRows(template, items, o)
  const cache = new Map<PackedRaster, Uint8Array>()
  const pages: Uint8Array[] = []
  for (const row of r.rows) {
    let png = cache.get(row)
    if (!png) {
      png = await encodePng1Bit(row, r.widthDots, r.dpi)
      cache.set(row, png)
    }
    pages.push(png)
  }
  return { widthMm: r.widthMm, heightMm: r.heightMm, dpi: r.dpi, pages, warnings: r.warnings }
}
