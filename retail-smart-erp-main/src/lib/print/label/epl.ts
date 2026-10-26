/**
 * EPL2 encoder (older Zebra / Eltron desktop printers, many clones).
 */
import type { BarcodeFormat, LabelItemData } from '@/lib/labels/types'
import { pickBitmapFont } from './tspl'
import {
  CommandBuffer,
  asciiOnly,
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
  columnOrigins,
  mediaWidthMm,
  normalizeLayout,
  packLabelRows,
  type EncodeLabelOptions,
  type LabelPrintItem,
  type LabelTemplateLike,
} from './common'

/** EPL2 resident fonts [name, cellWidth, cellHeight] in dots. */
export const EPL_FONTS: Record<203 | 300, Array<[string, number, number]>> = {
  203: [
    ['1', 10, 12],
    ['2', 12, 16],
    ['3', 14, 20],
    ['4', 16, 24],
    ['5', 34, 48],
  ],
  300: [
    ['1', 14, 22],
    ['2', 18, 30],
    ['3', 22, 40],
    ['4', 26, 48],
    ['5', 60, 80],
  ],
}

export const EPL_SYMBOLOGY: Partial<Record<BarcodeFormat, string>> = {
  code128: '1',
  ean13: 'E30',
  ean8: 'E80',
  upca: 'UA0',
  code39: '3',
  code93: '9',
  codabar: 'K',
  itf14: '2C',
}

const ROT: Record<0 | 90 | 180 | 270, number> = { 0: 0, 90: 1, 180: 2, 270: 3 }
const q = (s: string) => `"${asciiOnly(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export async function encodeEpl(
  template: LabelTemplateLike,
  items: LabelPrintItem[],
  o: EncodeLabelOptions
): Promise<{ buf: CommandBuffer; warnings: string[] }> {
  const dpi = o.dpi
  const warnings: string[] = []
  const buf = new CommandBuffer('\r\n')
  const wDots = mmToDots(mediaWidthMm(template, o), dpi)
  const hDots = mmToDots(o.heightMm ?? Number(template.heightMm), dpi)
  const gap = mmToDots(o.gapMm ?? 2, dpi)
  const copies = Math.max(1, Math.round(o.copies ?? 1))

  buf.line('')
  buf.line(`q${wDots}`)
  buf.line(`Q${hDots},${gap}`)
  if (o.speed != null) buf.line(`S${Math.min(6, Math.max(1, Math.round(o.speed)))}`)
  if (o.darkness != null) buf.line(`D${Math.min(15, Math.max(0, Math.round(o.darkness)))}`)
  buf.line('ZT')
  const { xs, y: oy } = columnOrigins(template, o)
  const columns = o.layout ? normalizeLayout(o.layout).columns : 1
  for (const row of packLabelRows(items, columns, copies)) {
    buf.line('N')
    for (let k = 0; k < row.cells.length; k++) {
      const cell = row.cells[k]
      if (cell) await emitElements(buf, template, cell.item, o, warnings, xs[k] ?? 0, oy)
    }
    buf.line(`P${row.count},1`)
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
  const fonts = EPL_FONTS[dpi === 300 ? 300 : 203]
  for (const el of sortedElements(template)) {
    const x = Math.max(0, ox + mmToDots(el.x, dpi))
    const y = Math.max(0, oy + mmToDots(el.y, dpi))
    const w = Math.max(1, mmToDots(el.width, dpi))
    const h = Math.max(1, mmToDots(el.height, dpi))
    const rot = rightAngle(el.rotation)
    if (rot === null) warnings.push(`Element ${el.id}: rotation ${el.rotation}° not supported, printed unrotated`)
    const r = ROT[rot ?? 0]

    switch (el.type) {
      case 'text': {
        const text = resolveText(el, item, o)
        if (!text) break
        const f = pickBitmapFont(ptToDots(el.fontSize, dpi), fonts)
        const charW = f.cw * f.mul
        const lineH = f.ch * f.mul
        const isName = el.dataField === 'item.name'
        const maxLines = isName ? 1 : Math.max(1, Math.min(el.maxLines || 1, Math.floor(h / lineH) || 1))
        const maxChars = Math.max(1, Math.floor(w / charW))
        let cleanText = text
        if ((isName || maxLines === 1) && cleanText.length > maxChars) {
          cleanText = cleanText.slice(0, maxChars)
        }
        const lines = r === 0 ? wrapChars(cleanText, maxChars, maxLines) : [cleanText]
        lines.forEach((ln, i) => {
          const lw = ln.length * charW
          const lx = el.textAlign === 'center' ? x + Math.max(0, (w - lw) / 2) : el.textAlign === 'right' ? x + Math.max(0, w - lw) : x
          buf.line(`A${Math.round(lx)},${y + i * lineH},${r},${f.font},${f.mul},${f.mul},N,${q(ln)}`)
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
          buf.line(`b${x},${y},Q,m2,s${cell},eM,${q(data)}`)
          break
        }
        if (el.format === 'datamatrix' || el.format === 'pdf417') {
          warnings.push(`Barcode ${el.id}: ${el.format} is not supported by the EPL encoder (skipped)`)
          break
        }
        const sym = EPL_SYMBOLOGY[el.format]
        if (!sym) {
          warnings.push(`Barcode ${el.id}: ${el.format} not supported in EPL`)
          break
        }
        const ratio = ['code39', 'codabar', 'itf14'].includes(el.format) ? 2 : 1
        const { module, used } = fitModule(el.format, data, w)
        const bh = Math.max(8, h - (el.showText ? hriHeight(dpi) : 0))
        const bx = r === 0 ? x + Math.max(0, Math.floor((w - used) / 2)) : x
        buf.line(`B${bx},${y},${r},${sym},${module},${module * ratio},${bh},${el.showText ? 'B' : 'N'},${q(data)}`)
        break
      }
      case 'shape': {
        const t = Math.min(pxToDots(el.borderWidth || 1, dpi), Math.max(1, Math.min(w, h)))
        if (el.shape === 'line') {
          if (w >= h) buf.line(`LO${x},${y + Math.floor((h - t) / 2)},${w},${t}`)
          else buf.line(`LO${x + Math.floor((w - t) / 2)},${y},${t},${h}`)
        } else if (el.shape === 'ellipse') {
          warnings.push(`Shape ${el.id}: ellipse not supported in EPL (skipped)`)
        } else if (isDarkColor(el.fillColor)) {
          buf.line(`LO${x},${y},${w},${h}`)
        } else {
          buf.line(`X${x},${y},${t},${x + w},${y + h}`)
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
        const bpr = Math.ceil(bmp.width / 8)
        buf.raw(`GW${x},${y},${bpr},${bmp.height},`)
        buf.binary(invertBits(bmp.data.subarray(0, bpr * bmp.height)))
        buf.raw('\r\n')
        break
      }
    }
  }
}
