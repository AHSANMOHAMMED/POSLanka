/**
 * "Exact" raw label printing: every physical row of the roll is rendered to a
 * 1-bit bitmap at the printer's dpi (driver-image.ts: barcodes on the dot grid,
 * text / shapes / images from the same canvas renderer as the preview) and sent
 * as ONE graphic per row in the printer's own language:
 *
 *   zpl:           ^GFA (hex, 1 = black)
 *   tspl:          BITMAP x,y,widthBytes,height,0,<binary> (0 = black)
 *   epl:           GW x,y,widthBytes,height,<binary> (0 = black)
 *   escpos-raster: GS v 0 + feed the gap
 *
 * The printer's built-in fonts are never used, so the printed label is the
 * preview pixel for pixel (no font substitution, no truncation by character
 * count). Pure: the rows are produced by the caller.
 */
import { EscPosBuilder, type PackedRaster } from '@/lib/print/escpos/encoder'
import { CommandBuffer, invertBits, mmToDots, toHex, type EncodeLabelResult, type LabelDpi, type RawLabelLanguage } from './common'

export interface GraphicRowsInput {
  /** One bitmap per physical row in print order (identical consecutive rows may share one object). */
  rows: PackedRaster[]
  widthDots: number
  heightDots: number
  dpi: LabelDpi
  /** Media size (mm) for TSPL SIZE; default from the dots. */
  widthMm?: number
  heightMm?: number
}

export interface GraphicEncodeOptions {
  language: RawLabelLanguage
  /** Gap between rows (mm). Default 2. */
  gapMm?: number
  darkness?: number | null
  speed?: number | null
  /** TSPL DIRECTION (default 1). */
  direction?: 0 | 1
}

/** Bytes per row of a packed bitmap cut to `widthDots`. */
const bytesPerRow = (widthDots: number) => Math.ceil(widthDots / 8)

/** The bitmap cropped / padded to exactly widthDots x heightDots, packed 1 = black. */
export function fitRaster(b: PackedRaster, widthDots: number, heightDots: number): Uint8Array {
  const dst = bytesPerRow(widthDots)
  const src = Math.ceil(b.width / 8)
  const out = new Uint8Array(dst * heightDots)
  for (let y = 0; y < Math.min(heightDots, b.height); y++) out.set(b.data.subarray(y * src, y * src + Math.min(src, dst)), y * dst)
  // clear the padding bits past widthDots
  const pad = widthDots % 8
  if (pad) for (let y = 0; y < heightDots; y++) out[y * dst + dst - 1] &= (0xff << (8 - pad)) & 0xff
  return out
}

/** ZPL ^GFA field for a bitmap placed at (x, y). */
export function zplGraphic(data: Uint8Array, widthDots: number, heightDots: number, x = 0, y = 0): string {
  const bpr = bytesPerRow(widthDots)
  const total = bpr * heightDots
  return `^FO${x},${y}^GFA,${total},${total},${bpr},${toHex(data.subarray(0, total))}^FS`
}

/** Merge consecutive identical rows (same bitmap object) into (row, count). */
function runs(rows: PackedRaster[]): Array<{ row: PackedRaster; count: number }> {
  const out: Array<{ row: PackedRaster; count: number }> = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && last.row === r) last.count++
    else out.push({ row: r, count: 1 })
  }
  return out
}

export function encodeGraphicRows(input: GraphicRowsInput, o: GraphicEncodeOptions): EncodeLabelResult {
  const { widthDots: W, heightDots: H, dpi } = input
  const bpr = bytesPerRow(W)
  const gapMm = o.gapMm ?? 2
  const warnings: string[] = []
  if (o.language === 'zpl') {
    const buf = new CommandBuffer('\n')
    for (const { row, count } of runs(input.rows)) {
      buf.line('^XA')
      buf.line('^MNY')
      buf.line('^MMT')
      buf.line('^MTD')
      buf.line('^LS0')
      buf.line(`^PW${W}`)
      buf.line(`^LL${H}`)
      buf.line('^LH0,0')
      if (o.speed != null) buf.line(`^PR${Math.round(o.speed)}`)
      buf.line(`~SD${String(Math.min(30, Math.max(0, Math.round(o.darkness ?? 20)))).padStart(2, '0')}`)
      const data = fitRaster(row, W, H)
      buf.raw(`^FO0,0^GFA,${bpr * H},${bpr * H},${bpr},`)
      buf.binary(new TextEncoder().encode(toHex(data)), `<${bpr * H * 2} hex>`)
      buf.line('^FS')
      buf.line(`^PQ${count},0,1,Y`)
      buf.line('^XZ')
    }
    return { bytes: buf.bytes(), text: buf.text, warnings }
  }
  if (o.language === 'tspl') {
    const buf = new CommandBuffer('\r\n')
    const f = (n: number) => String(Math.round(n * 100) / 100)
    buf.line(`SIZE ${f(input.widthMm ?? (W / dpi) * 25.4)} mm,${f(input.heightMm ?? (H / dpi) * 25.4)} mm`)
    buf.line(`GAP ${f(gapMm)} mm,0 mm`)
    buf.line(`DIRECTION ${o.direction === 0 ? 0 : 1},0`)
    buf.line('REFERENCE 0,0')
    buf.line('SET TEAR ON')
    buf.line('SET PEEL OFF')
    buf.line('OFFSET 0 mm')
    if (o.speed != null) buf.line(`SPEED ${Math.round(o.speed)}`)
    if (o.darkness != null) buf.line(`DENSITY ${Math.min(15, Math.max(0, Math.round(o.darkness)))}`)
    for (const { row, count } of runs(input.rows)) {
      buf.line('CLS')
      buf.raw(`BITMAP 0,0,${bpr},${H},0,`)
      buf.binary(invertBits(fitRaster(row, W, H)), `<${bpr * H} bytes>`)
      buf.raw('\r\n')
      buf.line(`PRINT ${count},1`)
    }
    return { bytes: buf.bytes(), text: buf.text, warnings }
  }
  if (o.language === 'epl') {
    const buf = new CommandBuffer('\r\n')
    buf.line('')
    buf.line(`q${W}`)
    buf.line(`Q${H},${mmToDots(gapMm, dpi)}`)
    if (o.speed != null) buf.line(`S${Math.min(6, Math.max(1, Math.round(o.speed)))}`)
    if (o.darkness != null) buf.line(`D${Math.min(15, Math.max(0, Math.round(o.darkness)))}`)
    buf.line('ZT')
    for (const { row, count } of runs(input.rows)) {
      buf.line('N')
      buf.raw(`GW0,0,${bpr},${H},`)
      buf.binary(invertBits(fitRaster(row, W, H)), `<${bpr * H} bytes>`)
      buf.raw('\r\n')
      buf.line(`P${count},1`)
    }
    return { bytes: buf.bytes(), text: buf.text, warnings }
  }
  // escpos-raster: GS v 0 per row, then feed the gap
  const buf = new CommandBuffer('\n')
  buf.binary(new EscPosBuilder({ widthDots: W }).init().align('center').build(), '<ESC @><ESC a 1>\n')
  const gapDots = mmToDots(gapMm, dpi)
  for (const { row, count } of runs(input.rows)) {
    const b = new EscPosBuilder({ widthDots: W }).packedRaster({ width: bpr * 8, height: H, data: fitRaster(row, W, H) })
    for (let g = gapDots; g > 0; g -= 255) b.raw([0x1b, 0x4a, Math.min(255, g)])
    const bytes = b.build()
    for (let i = 0; i < count; i++) buf.binary(bytes, `<GS v 0 ${W}x${H}><ESC J ${gapDots}>\n`)
  }
  return { bytes: buf.bytes(), text: buf.text, warnings }
}
