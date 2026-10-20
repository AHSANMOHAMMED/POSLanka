/**
 * ESC/POS renderer for the shared receipt model (W7). Pure (no DOM).
 */
import type { ReceiptModel } from '../receipt-model'
import {
  builderFor,
  formatMoney,
  type CodePage,
  type PackedRaster,
  type PaperWidth,
  type RasterImageData,
  type TextRasterizer,
} from './encoder'

export interface ReceiptModelEscPosOptions {
  paperWidth: PaperWidth
  unicodeAsBitmap?: boolean
  rasterizer?: TextRasterizer | null
  drawerKick?: boolean
  drawerPin?: 2 | 5
  /** Packed logo bitmap from GET /api/settings/logo/raster (printed when model.logo.show). */
  logoRaster?: PackedRaster | null
  /** RGBA logo alternative (scaled to logo.widthPct of the head width). */
  logoImage?: RasterImageData | null
  noCut?: boolean
  codePage?: CodePage
}

export function buildReceiptEscPosFromModel(model: ReceiptModel, opts: ReceiptModelEscPosOptions): Uint8Array {
  const b = builderFor(opts)
  const dec = model.decimals
  const m = (n: number) => formatMoney(n, dec)
  const cols = b.columns
  const cur = model.currency ? `${model.currency} ` : ''

  b.init()
  if (opts.drawerKick) b.drawerKick(opts.drawerPin ?? 2)
  b.selectCodePage()

  // Logo + business block
  b.align('center')
  if (model.logo.show) {
    if (opts.logoRaster) {
      b.packedRaster(opts.logoRaster)
      b.feed(1)
    } else if (opts.logoImage) {
      b.rasterImage(opts.logoImage, Math.round((b.widthDots * model.logo.widthPct) / 100))
      b.feed(1)
    }
  }
  b.styledLine(model.business.name, { bold: true, size: 2, align: 'center' })
  for (const l of model.business.lines) b.paragraph(l, { align: 'center' })
  for (const l of model.headerLines) b.paragraph(l, { align: 'center' })
  if (model.title) b.styledLine(model.title, { bold: true, align: 'center' })
  if (model.copyLabel) b.styledLine(`*** ${model.copyLabel} ***`, { align: 'center' })

  b.align('left')
  if (model.fontSize === 'large') b.baseSize(true)
  b.hr()
  for (const r of model.meta) b.row(`${r.label}:`, r.value)
  b.hr()

  // Items
  const amtW = Math.max(10, Math.min(14, Math.floor(cols / 3)))
  b.tableRow([
    { text: 'Item', width: cols - amtW },
    { text: 'Amount', width: amtW, align: 'right' },
  ])
  b.hr('-')
  for (const l of model.items) {
    b.paragraph(l.name)
    if (model.showItemSku && l.sku) b.paragraph(`  ${l.sku}`)
    b.row(`  ${l.qtyText}${l.unit ? ` ${l.unit}` : ''} x ${m(l.unitPrice)}`, m(l.total))
    if (l.discount > 0) b.row('  Discount', `-${m(l.discount)}`)
    for (const n of l.notes) b.paragraph(`  ${n}`)
  }
  b.hr()

  // Totals
  for (const t of model.totals) b.row(t.label, `${t.negative ? '-' : ''}${m(t.amount)}`)
  b.bold(true).size(2, 2)
  b.row('TOTAL', `${cur}${m(model.total)}`)
  b.size(1, 1).bold(false)
  b.hr()

  for (const p of model.payments) b.row(p.label, m(p.amount))
  if (model.change) b.row('Change', m(model.change))
  if (model.extras.length) {
    b.hr()
    for (const e of model.extras) b.row(e.label, e.value)
  }

  // Footer
  b.hr()
  b.align('center')
  for (const l of model.footerLines) b.paragraph(l, { align: 'center' })
  if (model.returnPolicy) {
    b.feed(1)
    b.paragraph(model.returnPolicy, { align: 'center' })
  }
  const code = model.invoiceCode
  if (code.value && (code.type === 'barcode' || code.type === 'both')) {
    b.feed(1)
    b.barcode(code.value, { height: 50, width: 2, hri: 2 })
  }
  if (code.value && (code.type === 'qr' || code.type === 'both')) {
    b.feed(1)
    b.qr(code.value, opts.paperWidth === 58 ? 4 : 5)
  }
  if (model.fontSize === 'large') b.baseSize(false)
  b.align('left')
  b.feed(3)
  if (!opts.noCut) b.cut(true)
  return b.build()
}
