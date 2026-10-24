/**
 * TSPL / TSPL2 encoder (TSC, Xprinter, Gainscha, HPRT, iDPRT ... label printers).
 */
import type { BarcodeFormat, LabelItemData } from '@/lib/labels/types'
import {
  CommandBuffer,
  fitModule,
  hriHeight,
  invertBits,
  isDarkColor,
  mmToDots,
  ptToDots,
  pxToDots,
  qrModules,
  resolveBarcodeData,
  resolveText,
  rightAngle,
  sortedElements,
  wrapChars,
  asciiOnly,
  columnOrigins,
  mediaWidthMm,
  normalizeLayout,
  packLabelRows,
  type EncodeLabelOptions,
  type LabelPrintItem,
  type LabelTemplateLike,
} from './common'

/** Built-in bitmap fonts: [name, charWidth, charHeight] in dots. */
export const TSPL_FONTS: Array<[string, number, number]> = [
  ['1', 8, 12],
  ['2', 12, 20],
  ['3', 16, 24],
  ['4', 24, 32],
  ['5', 32, 48],
]

export const TSPL_SYMBOLOGY: Partial<Record<BarcodeFormat, string>> = {
  code128: '128',
  ean13: 'EAN13',
  ean8: 'EAN8',
  upca: 'UPCA',
  code39: '39',
  code93: '93',
  codabar: 'CODA',
  itf14: 'ITF14',
}

/** Pick the bitmap font + integer multiplier closest to a target cap height. */
export function pickBitmapFont(targetH: number, fonts: Array<[string, number, number]>) {
  let best = { font: fonts[0][0], cw: fonts[0][1], ch: fonts[0][2], mul: 1, err: Infinity }
  for (const [font, cw, ch] of fonts) {
    const mul = Math.min(10, Math.max(1, Math.round(targetH / ch)))
    const err = Math.abs(ch * mul - targetH)
    if (err < best.err || (err === best.err && ch > best.ch)) best = { font, cw, ch, mul, err }
  }
  return best
}

const fmt = (n: number) => String(Math.round(n * 100) / 100)
const q = (s: string) => `"${asciiOnly(s).replace(/"/g, '\\["]')}"`

export async function encodeTspl(
  template: LabelTemplateLike,
  items: LabelPrintItem[],
  o: EncodeLabelOptions
): Promise<{ buf: CommandBuffer; warnings: string[] }> {
  const warnings: string[] = []
  const buf = new CommandBuffer('\r\n')
  // Multi-across rolls: SIZE is the whole liner width, each column is placed at its x origin.
  const wMm = mediaWidthMm(template, o)
  const hMm = o.heightMm ?? Number(template.heightMm)
  const layout = o.layout ? normalizeLayout(o.layout) : null

  buf.line(`SIZE ${fmt(wMm)} mm,${fmt(hMm)} mm`)
  buf.line(`GAP ${fmt(o.gapMm ?? 2)} mm,0 mm`)
  buf.line(`DIRECTION ${layout ? layout.direction : 1},0`)
  buf.line('REFERENCE 0,0')
  if (o.speed != null) buf.line(`SPEED ${Math.round(o.speed)}`)
  if (o.darkness != null) buf.line(`DENSITY ${Math.min(15, Math.max(0, Math.round(o.darkness)))}`)

  const copies = Math.max(1, Math.round(o.copies ?? 1))
  const { xs, y: oy } = columnOrigins(template, o)
  for (const row of packLabelRows(items, layout?.columns ?? 1, copies)) {
    buf.line('CLS')
    for (let k = 0; k < row.cells.length; k++) {
      const cell = row.cells[k]
      if (cell) await emitElements(buf, template, cell.item, o, warnings, xs[k] ?? 0, oy)
    }
    buf.line(`PRINT ${row.count},1`)
  }
  return { buf, warnings }
}

async function emitElements(
  buf: CommandBuffer,
  template: LabelTemplateLike,
  item: LabelItemData | null,
  o: EncodeLabelOptions,
  warnings: string[],
  ox = 0,
  oy = 0
) {
  const dpi = o.dpi
  for (const el of sortedElements(template)) {
    const x = Math.max(0, ox + mmToDots(el.x, dpi))
    const y = Math.max(0, oy + mmToDots(el.y, dpi))
    const w = Math.max(1, mmToDots(el.width, dpi))
    const h = Math.max(1, mmToDots(el.height, dpi))
    const rot = rightAngle(el.rotation)
    if (rot === null) warnings.push(`Element ${el.id}: rotation ${el.rotation}° not supported, printed unrotated`)
    const r = rot ?? 0

    switch (el.type) {
      case 'text': {
        const text = resolveText(el, item, o)
        if (!text) break
        const f = pickBitmapFont(ptToDots(el.fontSize, dpi), TSPL_FONTS)
        const charW = f.cw * f.mul
        const lineH = f.ch * f.mul
        const maxLines = Math.max(1, Math.min(el.maxLines || 1, Math.floor(h / lineH) || 1))
        const lines = r === 0 ? wrapChars(text, Math.floor(w / charW), maxLines) : [text]
        lines.forEach((ln, i) => {
          const lw = ln.length * charW
          const lx = el.textAlign === 'center' ? x + Math.max(0, (w - lw) / 2) : el.textAlign === 'right' ? x + Math.max(0, w - lw) : x
          buf.line(`TEXT ${Math.round(lx)},${y + i * lineH},"${f.font}",${r},${f.mul},${f.mul},${q(ln)}`)
        })
        break
      }
      case 'barcode': {
        const res = resolveBarcodeData(el, item, o)
        if ('error' in res) {
          warnings.push(`Barcode ${el.id} skipped: ${res.error}`)
          break
        }
        const data = res.data
        if (el.format === 'qrcode') {
          const cell = Math.max(1, Math.min(10, Math.floor(Math.min(w, h) / qrModules(data))))
          buf.line(`QRCODE ${x},${y},M,${cell},A,${r},${q(data)}`)
        } else if (el.format === 'datamatrix') {
          buf.line(`DMATRIX ${x},${y},${w},${h},${q(data)}`)
        } else if (el.format === 'pdf417') {
          buf.line(`PDF417 ${x},${y},${w},${h},${r},${q(data)}`)
        } else {
          const sym = TSPL_SYMBOLOGY[el.format]
          if (!sym) {
            warnings.push(`Barcode ${el.id}: ${el.format} not supported in TSPL`)
            break
          }
          const ratio = ['code39', 'codabar', 'itf14'].includes(el.format) ? 2 : 1
          const { module, used } = fitModule(el.format, data, w)
          const bh = Math.max(8, h - (el.showText ? hriHeight(dpi) : 0))
          const bx = r === 0 ? x + Math.max(0, Math.floor((w - used) / 2)) : x
          buf.line(`BARCODE ${bx},${y},"${sym}",${bh},${el.showText ? 1 : 0},${r},${module},${module * ratio},${q(data)}`)
        }
        break
      }
      case 'shape': {
        const t = Math.min(pxToDots(el.borderWidth || 1, dpi), Math.max(1, Math.min(w, h)))
        if (el.shape === 'line') {
          if (w >= h) buf.line(`BAR ${x},${y + Math.floor((h - t) / 2)},${w},${t}`)
          else buf.line(`BAR ${x + Math.floor((w - t) / 2)},${y},${t},${h}`)
        } else if (el.shape === 'ellipse') {
          buf.line(`ELLIPSE ${x},${y},${w},${h},${t}`)
        } else if (isDarkColor(el.fillColor)) {
          buf.line(`BAR ${x},${y},${w},${h}`)
        } else {
          const radius = el.shape === 'rounded-rectangle' ? `,${mmToDots(el.cornerRadius ?? 2, dpi)}` : ''
          buf.line(`BOX ${x},${y},${x + w},${y + h},${t}${radius}`)
        }
        break
      }
      case 'image': {
        if (!o.rasterizeElement) {
          warnings.push(`Image ${el.id} skipped: no image rasterizer available`)
          break
        }
        const bmp = await o.rasterizeElement(el, { item, widthDots: w, heightDots: h, dpi })
        if (!bmp) {
          warnings.push(`Image ${el.id} skipped: could not load image`)
          break
        }
        const wb = Math.ceil(bmp.width / 8)
        buf.raw(`BITMAP ${x},${y},${wb},${bmp.height},0,`)
        buf.binary(invertBits(bmp.data), `<${wb * bmp.height} bytes>`)
        buf.raw('\r\n')
        break
      }
    }
  }
}
