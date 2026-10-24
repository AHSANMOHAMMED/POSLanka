/**
 * Raw label printer encoders (W9).
 *
 *   const { bytes, warnings } = await encodeLabels(template, items, { language: 'tspl', dpi: 203 })
 *
 * Supported elements per language:
 *   - tspl:  text (bitmap fonts 1-5 + multipliers, wrapping/alignment), barcodes
 *            (128, EAN13, EAN8, UPCA, 39, 93, CODA, ITF14 via BARCODE; QRCODE; DMATRIX; PDF417),
 *            rect / rounded rect (BOX), filled rect + line (BAR), ellipse (ELLIPSE),
 *            images via BITMAP (needs rasterizeElement)
 *   - zpl:   text (^A0 scalable + ^FB wrap/justify, UTF-8 ^CI28), barcodes (^BC ^BE ^B8 ^BU
 *            ^B3 ^BA ^BK ^B2, ^BQN QR, ^BX DataMatrix, ^B7 PDF417), boxes/lines (^GB),
 *            ellipse (^GE), images via ^GFA (needs rasterizeElement)
 *   - epl:   text (fonts 1-5), barcodes (1/E30/E80/UA0/3/9/K/2C), QR (b..Q),
 *            lines/filled rect (LO), boxes (X), images via GW (needs rasterizeElement);
 *            DataMatrix, PDF417 and ellipses are skipped with a warning
 *   - escpos-raster: whole label rendered to a bitmap (rasterizeLabel) and sent as GS v 0
 * Unsupported / invalid elements are skipped and reported in `warnings`.
 */
import type { LabelItemData } from '@/lib/labels/types'
import { encodeTspl } from './tspl'
import { encodeZpl } from './zpl'
import { encodeEpl } from './epl'
import { encodeEscPosRaster } from './escpos-raster'
import {
  normalizeItems,
  type EncodeLabelOptions,
  type EncodeLabelResult,
  type LabelPrintItem,
  type LabelTemplateLike,
} from './common'

export * from './common'
export { encodeTspl, TSPL_FONTS, TSPL_SYMBOLOGY, pickBitmapFont } from './tspl'
export { encodeZpl, zplEscape } from './zpl'
export { encodeEpl, EPL_FONTS, EPL_SYMBOLOGY } from './epl'
export { encodeEscPosRaster } from './escpos-raster'

export async function encodeLabels(
  template: LabelTemplateLike,
  items: (LabelPrintItem | LabelItemData)[],
  options: EncodeLabelOptions
): Promise<EncodeLabelResult> {
  const list = normalizeItems(items)
  const enc =
    options.language === 'tspl'
      ? encodeTspl
      : options.language === 'zpl'
        ? encodeZpl
        : options.language === 'epl'
          ? encodeEpl
          : encodeEscPosRaster
  const { buf, warnings } = await enc(template, list, options)
  return { bytes: buf.bytes(), text: buf.text, warnings }
}

/** A one-label test print for a label printer profile. */
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
