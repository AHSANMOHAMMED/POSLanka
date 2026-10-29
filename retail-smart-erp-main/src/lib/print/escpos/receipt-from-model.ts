/**
 * ESC/POS renderer for the shared receipt model (W7). Pure (no DOM).
 *
 * Type scale (same as the HTML renderer): shop name double size + bold,
 * document title bold, body normal, TOTAL bold + double height (double height
 * only, so the amount column never wraps on 58 mm), secondary lines plain.
 * Font size: small = printer font B (42 / 64 columns), large = double-height body.
 */
import { formatRate, type ReceiptModel, type ReceiptModelLine } from '../receipt-model'
import {
  COLUMNS,
  DOT_WIDTH,
  EscPosBuilder,
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

/** Characters per line with the printer's small font B (9 x 17 dots). */
export const SMALL_FONT_COLUMNS: Record<PaperWidth, number> = { 58: 42, 80: 64 }

/**
 * Move the ink of a packed bitmap (the server logo raster is centred on the
 * paper width) to the left or right edge. Returns a new raster.
 */
export function alignPackedRaster(r: PackedRaster, align: 'left' | 'center' | 'right'): PackedRaster {
  if (align === 'center' || !r || r.width <= 0) return r
  const bpr = Math.ceil(r.width / 8)
  let minX = r.width
  let maxX = -1
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.data[y * bpr + (x >> 3)] & (0x80 >> (x & 7))) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  if (maxX < 0) return r
  const shift = align === 'left' ? -minX : r.width - 1 - maxX
  if (shift === 0) return r
  const out = new Uint8Array(bpr * r.height)
  for (let y = 0; y < r.height; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (r.data[y * bpr + (x >> 3)] & (0x80 >> (x & 7))) {
        const nx = x + shift
        out[y * bpr + (nx >> 3)] |= 0x80 >> (nx & 7)
      }
    }
  }
  return { width: r.width, height: r.height, data: out }
}

/** A solid rule two dots high across the head (GS v 0). */
function solidRule(b: EscPosBuilder): void {
  const bpr = Math.ceil(b.widthDots / 8)
  b.packedRaster({ width: b.widthDots, height: 2, data: new Uint8Array(bpr * 2).fill(0xff) })
}

function itemRows(b: EscPosBuilder, model: ReceiptModel, l: ReceiptModelLine, m: (n: number) => string) {
  const cols = b.columns
  const qty = `${l.qtyText}${l.unit ? ` ${l.unit}` : ''}`
  const codes = [model.showItemSku ? l.sku : null, model.showItemBarcode ? l.barcode : null].filter(Boolean) as string[]
  const oneLine = model.itemLayout === 'one_line' || model.itemLayout === 'table'
  if (oneLine && cols >= 42) {
    // Item | Qty | Price | Total, the name wraps inside its column
    const [nameW, qtyW, priceW, totalW] = tableWidths(cols)
    const nameLines = wrapCell(l.name, nameW)
    b.tableRow([
      { text: nameLines[0], width: nameW },
      { text: qty.slice(0, qtyW - 1), width: qtyW, align: 'right' },
      { text: m(l.unitPrice), width: priceW, align: 'right' },
      { text: m(l.total), width: totalW, align: 'right' },
    ])
    for (const extra of nameLines.slice(1)) b.styledLine(extra)
  } else if (oneLine) {
    b.row(`${qty} x ${l.name}`, m(l.total))
  } else {
    b.paragraph(l.name)
  }
  if (codes.length) b.paragraph(`  ${codes.join(' / ')}`)
  if (!oneLine) b.row(`  ${qty} x ${m(l.unitPrice)}`, m(l.total))
  if (l.discount > 0) b.row('  Discount', `-${m(l.discount)}`)
  if (model.taxInvoice && l.vatAmount) b.row(`  VAT ${formatRate(l.vatRate)}%`, m(l.vatAmount))
  for (const n of l.notes) b.paragraph(`  ${n}`)
}

/** Name / qty / price / total widths for one-line items. */
export function tableWidths(cols: number): [number, number, number, number] {
  const qtyW = cols >= 64 ? 8 : 6
  const priceW = cols >= 64 ? 12 : 10
  const totalW = cols >= 64 ? 13 : 11
  return [cols - qtyW - priceW - totalW, qtyW, priceW, totalW]
}

function wrapCell(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= width - 1) cur += ' ' + w
    else {
      lines.push(cur)
      cur = w
    }
    while (cur.length > width - 1) {
      lines.push(cur.slice(0, width - 1))
      cur = cur.slice(width - 1)
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/** Tear-off coupon: cut line, title, offer text, invoice / date / amount, customer fields (blank lines to fill in). */
function couponRows(b: EscPosBuilder, model: ReceiptModel, m: (n: number) => string) {
  const c = model.coupon!
  const cols = b.columns
  const blank = (label: string) => b.line(`${label}: ${'_'.repeat(Math.max(4, cols - label.length - 2))}`)
  b.feed(1)
  b.align('center')
  b.line('- - - - cut here - - - -')
  b.hr('=')
  b.paragraph(c.title, { bold: true, size: 2, align: 'center' })
  if (c.text) b.paragraph(c.text, { align: 'center' })
  b.align('left')
  b.row('Invoice', c.invoiceNo)
  b.row('Date', c.date)
  b.row('Amount', m(c.amount))
  b.feed(1)
  if (c.name) b.paragraph(`Name: ${c.name}`)
  else blank('Name')
  b.feed(1)
  if (c.phone) b.paragraph(`Phone: ${c.phone}`)
  else blank('Phone')
  b.feed(1)
  if (c.address) b.paragraph(`Address: ${c.address}`)
  else {
    blank('Address')
    b.feed(1)
    b.line('_'.repeat(cols))
  }
  b.hr('=')
}

export function buildReceiptEscPosFromModel(model: ReceiptModel, opts: ReceiptModelEscPosOptions): Uint8Array {
  const small = model.fontSize === 'small'
  const b = new EscPosBuilder({
    codePage: opts.codePage,
    columns: small ? SMALL_FONT_COLUMNS[opts.paperWidth] : COLUMNS[opts.paperWidth],
    widthDots: DOT_WIDTH[opts.paperWidth],
    rasterizer: opts.unicodeAsBitmap ? opts.rasterizer ?? null : null,
  })
  const dec = model.decimals
  const m = (n: number) => formatMoney(n, dec)
  const cols = b.columns
  const cur = model.currency ? `${model.currency} ` : ''

  b.init()
  if (small) b.raw([0x1b, 0x4d, 1]) // ESC M 1: font B
  // Text darkness: dark = emphasized (ESC E), extra = emphasized + double-strike (ESC G)
  const strong = model.textWeight !== 'normal'
  b.bold(strong)
  if (model.textWeight === 'extra') b.raw([0x1b, 0x47, 1])
  if (opts.drawerKick) b.drawerKick(opts.drawerPin ?? 2)
  b.selectCodePage()

  // Logo + business block
  b.align('center')
  if (model.logo.show) {
    const align = model.logo.align || 'center'
    if (opts.logoRaster) {
      b.packedRaster(alignPackedRaster(opts.logoRaster, align))
      b.feed(1)
    } else if (opts.logoImage) {
      if (align !== 'center') b.align(align)
      b.rasterImage(opts.logoImage, Math.round((b.widthDots * model.logo.widthPct) / 100))
      b.align('center')
      b.feed(1)
    }
  }
  b.paragraph(model.business.name, { bold: true, size: 2, align: 'center' })
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
  b.bold(true)
  if ((model.itemLayout === 'one_line' || model.itemLayout === 'table') && cols >= 42) {
    const [nameW, qtyW, priceW, totalW] = tableWidths(cols)
    b.tableRow([
      { text: 'Item', width: nameW },
      { text: 'Qty', width: qtyW, align: 'right' },
      { text: 'Price', width: priceW, align: 'right' },
      { text: 'Total', width: totalW, align: 'right' },
    ])
  } else {
    const amtW = Math.max(10, Math.min(14, Math.floor(cols / 3)))
    b.tableRow([
      { text: 'Item', width: cols - amtW },
      { text: 'Amount', width: amtW, align: 'right' },
    ])
  }
  b.bold(strong)
  b.hr('-')
  model.items.forEach((l, i) => {
    if (i > 0 && (model.itemSeparator === 'solid' || model.itemLayout === 'table')) solidRule(b)
    else if (i > 0 && model.itemSeparator === 'dashed') b.line('- '.repeat(Math.floor(cols / 2)).trimEnd())
    itemRows(b, model, l, m)
  })
  b.hr()

  // Totals
  for (const t of model.totals) b.row(t.label, `${t.negative ? '-' : ''}${m(t.amount)}`)
  // Double height only: double width would halve the columns and wrap the amount on 58 mm
  b.bold(true).size(1, 2)
  b.row('TOTAL', `${cur}${m(model.total)}`)
  b.size(1, 1).bold(strong)
  if (model.taxInvoice) {
    b.hr('-')
    b.row('Total excl. VAT', m(model.taxInvoice.totalExclVat))
    b.row('VAT', m(model.taxInvoice.totalVat))
    b.row('Total incl. VAT', m(model.taxInvoice.totalInclVat))
  }
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
  const qrValue = code.qrValue || code.value
  if (qrValue && (code.type === 'qr' || code.type === 'both')) {
    b.feed(1)
    b.qr(qrValue, qrValue.length > 40 ? (opts.paperWidth === 58 ? 3 : 4) : opts.paperWidth === 58 ? 4 : 5)
  }
  if (model.fontSize === 'large') b.baseSize(false)
  if (model.poweredBy) {
    b.feed(1)
    b.paragraph(model.poweredBy, { align: 'center' })
  }
  if (model.coupon) couponRows(b, model, m)
  b.align('left')
  b.feed(3)
  if (!opts.noCut) b.cut(true)
  return b.build()
}
