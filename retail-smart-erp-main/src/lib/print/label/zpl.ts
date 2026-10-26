/**
 * ZPL II encoder (Zebra and ZPL-compatible printers).
 */
import type { LabelItemData } from '@/lib/labels/types'
import {
  CommandBuffer,
  fitModule,
  hriHeight,
  isDarkColor,
  mmToDots,
  ptToDots,
  pxToDots,
  qrModules,
  resolveBarcodeData,
  resolveText,
  rightAngle,
  sortedElements,
  toHex,
  columnOrigins,
  mediaWidthMm,
  normalizeLayout,
  packLabelRows,
  type EncodeLabelOptions,
  type LabelPrintItem,
  type LabelTemplateLike,
} from './common'

const ORIENT: Record<0 | 90 | 180 | 270, string> = { 0: 'N', 90: 'R', 180: 'I', 270: 'B' }

/** Escape field data for use with ^FH\ (hex escapes). */
export function zplEscape(s: string): string {
  return s.replace(/\\/g, '\\5C').replace(/\^/g, '\\5E').replace(/~/g, '\\7E')
}

export async function encodeZpl(
  template: LabelTemplateLike,
  items: LabelPrintItem[],
  o: EncodeLabelOptions
): Promise<{ buf: CommandBuffer; warnings: string[] }> {
  const dpi = o.dpi
  const warnings: string[] = []
  const buf = new CommandBuffer('\n')
  const wDots = mmToDots(mediaWidthMm(template, o), dpi)
  const hDots = mmToDots(o.heightMm ?? Number(template.heightMm), dpi)
  const copies = Math.max(1, Math.round(o.copies ?? 1))
  const { xs, y: oy } = columnOrigins(template, o)
  const columns = o.layout ? normalizeLayout(o.layout).columns : 1

  for (const row of packLabelRows(items, columns, copies)) {
    buf.line('^XA')
    buf.line('^CI28')
    buf.line(`^PW${wDots}`)
    buf.line(`^LL${hDots}`)
    buf.line('^LH0,0')
    if (o.speed != null) buf.line(`^PR${Math.round(o.speed)}`)
    if (o.darkness != null) {
      buf.line(`~SD${String(Math.min(30, Math.max(0, Math.round(o.darkness)))).padStart(2, '0')}`)
    } else {
      buf.line('~SD20')
    }
    for (let k = 0; k < row.cells.length; k++) {
      const cell = row.cells[k]
      if (cell) await emitElements(buf, template, cell.item, o, warnings, xs[k] ?? 0, oy)
    }
    buf.line(`^PQ${row.count},0,1,Y`)
    buf.line('^XZ')
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
    const ori = ORIENT[rot ?? 0]

    switch (el.type) {
      case 'text': {
        const text = resolveText(el, item, o)
        if (!text) break
        const fh = ptToDots(el.fontSize, dpi)
        const fw = el.fontWeight === 'bold' ? Math.round(fh * 1.0) : Math.round(fh * 0.85)
        const just = el.textAlign === 'center' ? 'C' : el.textAlign === 'right' ? 'R' : 'L'
        const maxLines = Math.max(1, el.maxLines || 1)

        let cleanText = text
        if (maxLines === 1) {
          // Keep initial name that fits on a single line so it never wraps down or overlaps the barcode below
          const maxChars = Math.max(4, Math.floor(w / Math.max(1, Math.round(fw * 0.58))))
          if (cleanText.length > maxChars) {
            cleanText = cleanText.slice(0, maxChars)
          }
        }

        // utf8 field data (^CI28) with hex escapes for control characters.
        buf.raw(`^FO${x},${y}^A0${ori},${fh},${fw}^FB${w},${maxLines},0,${just},0^FH\\^FD`)
        buf.utf8(zplEscape(cleanText))
        buf.line('^FS')
        break
      }
      case 'barcode': {
        const res = resolveBarcodeData(el, item, o)
        if ('error' in res) {
          warnings.push(`Barcode ${el.id} skipped: ${res.error}`)
          break
        }
        const data = res.data
        const hr = el.showText ? 'Y' : 'N'
        if (el.format === 'qrcode') {
          const mag = Math.max(1, Math.min(10, Math.floor(Math.min(w, h) / qrModules(data))))
          buf.line(`^FO${x},${y}^BQN,2,${mag}^FH\\^FDMA,${zplEscape(data)}^FS`)
          break
        }
        if (el.format === 'datamatrix') {
          const approx = 10 + 2 * Math.ceil(Math.sqrt(data.length * 1.5))
          const mod = Math.max(1, Math.floor(Math.min(w, h) / approx))
          buf.line(`^FO${x},${y}^BX${ori},${mod},200^FH\\^FD${zplEscape(data)}^FS`)
          break
        }
        if (el.format === 'pdf417') {
          buf.line(`^FO${x},${y}^BY2^B7${ori},${Math.max(2, Math.floor(h / 12))},0,0,0,N^FH\\^FD${zplEscape(data)}^FS`)
          break
        }
        const { module, used } = fitModule(el.format, data, w)
        const bh = Math.max(8, h - (el.showText ? hriHeight(dpi) : 0))
        const bx = rot === 0 || rot === null ? x + Math.max(0, Math.floor((w - used) / 2)) : x
        const ratio = ['code39', 'codabar', 'itf14'].includes(el.format) ? '2.0' : '3.0'
        let cmd: string
        let fd = data
        switch (el.format) {
          case 'ean13':
            cmd = `^BE${ori},${bh},${hr},N`
            break
          case 'ean8':
            cmd = `^B8${ori},${bh},${hr},N`
            break
          case 'upca':
            cmd = `^BU${ori},${bh},${hr},N,Y`
            break
          case 'code39':
            cmd = `^B3${ori},N,${bh},${hr},N`
            break
          case 'code93':
            cmd = `^BA${ori},${bh},${hr},N,N`
            break
          case 'codabar':
            cmd = `^BK${ori},N,${bh},${hr},N,${data[0]},${data[data.length - 1]}`
            fd = data.slice(1, -1)
            break
          case 'itf14':
            cmd = `^B2${ori},${bh},${hr},N,Y`
            break
          case 'code128':
          default:
            // Mode 'A' = Automatic subset selection (Subset A/B/C).
            // Without 'A', Zebra requires manual subset specifiers (>:, >;) and will refuse to print unadorned data!
            cmd = `^BC${ori},${bh},${hr},N,N,A`
            break
        }
        const cleanData = fd.replace(/[\^~]/g, '')
        buf.line(`^BY${module},${ratio},${bh}^FO${bx},${y}${cmd}^FD${cleanData}^FS`)
        break
      }
      case 'shape': {
        const t = Math.min(pxToDots(el.borderWidth || 1, dpi), Math.max(1, Math.min(w, h)))
        if (el.shape === 'line') {
          if (w >= h) buf.line(`^FO${x},${y + Math.floor((h - t) / 2)}^GB${w},${t},${t}^FS`)
          else buf.line(`^FO${x + Math.floor((w - t) / 2)},${y}^GB${t},${h},${t}^FS`)
        } else if (el.shape === 'ellipse') {
          buf.line(`^FO${x},${y}^GE${w},${h},${isDarkColor(el.fillColor) ? Math.min(w, h) : t}^FS`)
        } else {
          const thick = isDarkColor(el.fillColor) ? Math.min(w, h) : t
          const round = el.shape === 'rounded-rectangle' ? `,B,${Math.min(8, Math.max(1, Math.round(((el.cornerRadius ?? 2) / Math.min(el.width, el.height)) * 16)))}` : ''
          buf.line(`^FO${x},${y}^GB${w},${h},${thick}${round}^FS`)
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
        const total = bpr * bmp.height
        buf.line(`^FO${x},${y}^GFA,${total},${total},${bpr},${toHex(bmp.data.subarray(0, total))}^FS`)
        break
      }
    }
  }
}
