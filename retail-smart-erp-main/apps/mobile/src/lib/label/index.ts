/**
 * Raw label printer encoders for the mobile app (port of web src/lib/print/label).
 *
 *   const { bytes, warnings } = await encodeLabels(template, items, { language: 'tspl', dpi: 203 })
 *
 * TSPL / ZPL / EPL output is byte-identical to the web encoders. Differences:
 *   - image elements: there is no image rasterizer on the device, so they are
 *     skipped and reported in `warnings` (the web does the same without a rasterizer)
 *   - 'escpos-raster' (whole label as a bitmap on a receipt printer) is not
 *     supported on mobile: nothing is encoded and a warning explains why
 */
import { encodeTspl } from './tspl'
import { encodeZpl } from './zpl'
import { encodeEpl } from './epl'
import {
  normalizeItems,
  type EncodeLabelOptions,
  type EncodeLabelResult,
  type LabelPrintItem,
  type LabelTemplateLike,
} from './common'
import type { LabelItemData } from './types'

export * from './common'
export * from './types'
export { encodeTspl, TSPL_FONTS, TSPL_SYMBOLOGY, pickBitmapFont } from './tspl'
export { encodeZpl, zplEscape } from './zpl'
export { encodeEpl, EPL_FONTS, EPL_SYMBOLOGY } from './epl'

export const ESCPOS_RASTER_UNSUPPORTED =
  'ESC/POS raster labels are not supported on mobile. Set the label printer language to TSPL, ZPL or EPL, or print these labels from the web app.'

export async function encodeLabels(
  template: LabelTemplateLike,
  items: (LabelPrintItem | LabelItemData)[],
  options: EncodeLabelOptions
): Promise<EncodeLabelResult> {
  const list = normalizeItems(items)
  if (options.language === 'escpos-raster') {
    return { bytes: new Uint8Array(0), text: '', warnings: [ESCPOS_RASTER_UNSUPPORTED] }
  }
  const enc = options.language === 'tspl' ? encodeTspl : options.language === 'zpl' ? encodeZpl : options.language === 'epl' ? encodeEpl : null
  if (!enc) return { bytes: new Uint8Array(0), text: '', warnings: [`Unknown label language "${String(options.language)}"`] }
  const { buf, warnings } = await enc(template, list, options)
  return { bytes: buf.bytes(), text: buf.text, warnings }
}

/** A one-label test print for a label printer (same template as the web test print). */
export function labelTestTemplate(widthMm: number, heightMm: number): LabelTemplateLike {
  const w = Number(widthMm)
  const h = Number(heightMm)
  return {
    widthMm: w,
    heightMm: h,
    elements: [
      { id: 'border', type: 'shape', shape: 'rectangle', x: 1, y: 1, width: w - 2, height: h - 2, rotation: 0, zIndex: 0, borderWidth: 2, borderColor: '#000', borderStyle: 'solid' },
      { id: 'title', type: 'text', dataField: 'custom', customValue: 'skyERPOS label test', x: 2, y: 2.5, width: w - 4, height: h * 0.2, rotation: 0, zIndex: 1, fontSize: 9, fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
      { id: 'size', type: 'text', dataField: 'custom', customValue: `${w} x ${h} mm`, x: 2, y: 2.5 + h * 0.2, width: w - 4, height: h * 0.15, rotation: 0, zIndex: 1, fontSize: 7, fontWeight: 'normal', textAlign: 'center', maxLines: 1 },
      { id: 'bc', type: 'barcode', format: 'code128', dataField: 'custom', customValue: 'TEST-12345', showText: true, barWidth: 2, x: 3, y: h * 0.45, width: w - 6, height: h * 0.45, rotation: 0, zIndex: 1 },
    ],
  }
}
