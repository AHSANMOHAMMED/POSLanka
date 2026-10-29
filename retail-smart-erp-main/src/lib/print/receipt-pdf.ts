/**
 * Receipt as a PDF (for WhatsApp / download), drawn from the same ReceiptModel as the printed
 * receipt: receipt-width page (58 / 80 mm) as tall as the content, logo, business block, meta,
 * items (two-line, one-line or bordered table), totals, payments, footer, invoice barcode / QR and
 * the tear-off coupon. Standard PDF fonts (Helvetica / Courier): characters they cannot encode
 * (e.g. Sinhala / Tamil) print as "?".
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib'
import { formatRate, type ReceiptModel, type ReceiptModelLine } from './receipt-model'
import { formatMoney } from './escpos/encoder'

const MM = 72 / 25.4

export interface ReceiptPdfAssets {
  logoPng?: Uint8Array | null
  barcodePng?: Uint8Array | null
  qrPng?: Uint8Array | null
}

type Align = 'left' | 'center' | 'right'
type Op =
  | { k: 'text'; text: string; size: number; bold?: boolean; align?: Align; indent?: number }
  | { k: 'row'; left: string; right: string; size: number; bold?: boolean; indent?: number }
  | { k: 'rule'; dashed?: boolean }
  | { k: 'gap'; h: number }
  | { k: 'image'; img: PDFImage; w: number; align?: Align }
  | { k: 'table'; head: string[]; rows: { cells: string[]; sub: string[] }[]; widths: number[]; size: number }
  | { k: 'box'; ops: Op[]; dashed: boolean }

// WinAnsi (standard fonts) covers Latin-1 plus a few typographic marks
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
function safe(text: string): string {
  let out = ''
  for (const ch of text.replace(/\s+/g, ' ')) {
    const c = ch.codePointAt(0)!
    out += (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch) ? ch : '?'
  }
  return out
}

function hexColor(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '')
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0, 0, 0)
}

export async function buildReceiptPdf(model: ReceiptModel, paperWidth: 58 | 80 = 80, assets: ReceiptPdfAssets = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${model.isReturn ? 'Credit note' : 'Receipt'} ${model.invoiceNo}`)
  doc.setCreator('skyERPOS')
  const mono = model.fontFamily === 'mono'
  const strong = model.textWeight !== 'normal'
  const regular = await doc.embedFont(mono ? (strong ? StandardFonts.CourierBold : StandardFonts.Courier) : strong ? StandardFonts.HelveticaBold : StandardFonts.Helvetica)
  const bold = await doc.embedFont(mono ? StandardFonts.CourierBold : StandardFonts.HelveticaBold)
  const color = hexColor(model.textColor)

  const pageW = paperWidth * MM
  const margin = 3.5 * MM
  const contentW = pageW - margin * 2
  const base = paperWidth === 58 ? 7 : 8 + (model.fontSize === 'large' ? 1.5 : model.fontSize === 'small' ? -1 : 0)
  const m = (n: number) => formatMoney(n, model.decimals)
  const lh = (size: number) => size * 1.3

  const font = (b?: boolean): PDFFont => (b ? bold : regular)
  const width = (t: string, size: number, b?: boolean) => font(b).widthOfTextAtSize(t, size)
  function wrap(text: string, size: number, maxW: number, b?: boolean): string[] {
    const words = safe(text).split(' ')
    const lines: string[] = []
    let cur = ''
    for (const w0 of words) {
      let w = w0
      while (width(w, size, b) > maxW && w.length > 1) {
        // hard-break a word longer than the line
        let cut = w.length - 1
        while (cut > 1 && width(w.slice(0, cut), size, b) > maxW) cut--
        if (cur) { lines.push(cur); cur = '' }
        lines.push(w.slice(0, cut))
        w = w.slice(cut)
      }
      const next = cur ? `${cur} ${w}` : w
      if (width(next, size, b) <= maxW) cur = next
      else { if (cur) lines.push(cur); cur = w }
    }
    if (cur || !lines.length) lines.push(cur)
    return lines
  }

  // ---------------------------------------------------------------- layout ops
  const ops: Op[] = []
  const text = (t: string, size = base, o: { bold?: boolean; align?: Align; indent?: number } = {}) => ops.push({ k: 'text', text: t, size, ...o })
  const row = (left: string, right: string, size = base, b?: boolean, indent?: number) => ops.push({ k: 'row', left, right, size, bold: b, indent })
  const IND = 8

  if (assets.logoPng && model.logo.show) {
    try {
      const img = await doc.embedPng(assets.logoPng)
      ops.push({ k: 'image', img, w: Math.min(contentW, (contentW * model.logo.widthPct) / 100), align: model.logo.align })
      ops.push({ k: 'gap', h: 3 })
    } catch {
      /* unreadable logo: skip */
    }
  }
  text(model.business.name, base + 4, { bold: true, align: 'center' })
  for (const l of model.business.lines) text(l, base, { align: 'center' })
  for (const l of model.headerLines) text(l, base, { align: 'center' })
  if (model.title) text(model.title, base + 1, { bold: true, align: 'center' })
  if (model.copyLabel) text(`*** ${model.copyLabel} ***`, base, { align: 'center' })
  ops.push({ k: 'rule', dashed: true })
  for (const r of model.meta) row(`${r.label}:`, r.value)
  ops.push({ k: 'rule', dashed: true })

  const qtyOf = (l: ReceiptModelLine) => `${l.qtyText}${l.unit ? ` ${l.unit}` : ''}`
  const subLines = (l: ReceiptModelLine, withQty: boolean) => {
    const sub: string[] = []
    const codes = [model.showItemSku ? l.sku : null, model.showItemBarcode ? l.barcode : null].filter(Boolean) as string[]
    if (codes.length) sub.push(codes.join(' · '))
    if (withQty) sub.push(`${qtyOf(l)} x ${m(l.unitPrice)}`)
    if (l.discount > 0) sub.push(`Discount -${m(l.discount)}`)
    if (model.taxInvoice && l.vatAmount) sub.push(`VAT ${formatRate(l.vatRate)}% ${m(l.vatAmount)}`)
    sub.push(...l.notes)
    return sub
  }
  if (model.itemLayout === 'table') {
    const wide = paperWidth === 80
    const widths = wide ? [contentW - 44 * MM, 11 * MM, 16 * MM, 17 * MM] : [contentW - 24 * MM, 9 * MM, 15 * MM]
    ops.push({
      k: 'table',
      head: wide ? ['Item', 'Qty', 'Price', 'Total'] : ['Item', 'Qty', 'Total'],
      rows: model.items.map((l) => ({
        cells: wide ? [l.name, qtyOf(l), m(l.unitPrice), m(l.total)] : [l.name, qtyOf(l), m(l.total)],
        sub: subLines(l, !wide),
      })),
      widths,
      size: base - 0.5,
    })
  } else {
    row('Item', 'Amount', base, true)
    ops.push({ k: 'rule', dashed: true })
    model.items.forEach((l, i) => {
      if (i > 0 && model.itemSeparator !== 'none') ops.push({ k: 'rule', dashed: model.itemSeparator === 'dashed' })
      if (model.itemLayout === 'one_line') row(`${qtyOf(l)} x ${l.name}`, m(l.total))
      else {
        text(l.name, base, { bold: true })
        row(`${qtyOf(l)} x ${m(l.unitPrice)}`, m(l.total), base, false, IND)
      }
      for (const s of subLines(l, false)) text(s, base - 1, { indent: IND })
    })
  }
  ops.push({ k: 'rule', dashed: true })

  for (const t of model.totals) row(t.label, `${t.negative ? '-' : ''}${m(t.amount)}`)
  ops.push({ k: 'gap', h: 2 })
  row('TOTAL', `${model.currency ? `${model.currency} ` : ''}${m(model.total)}`, base + 3, true)
  if (model.taxInvoice) {
    ops.push({ k: 'rule', dashed: true })
    row('Total excl. VAT', m(model.taxInvoice.totalExclVat))
    row('VAT', m(model.taxInvoice.totalVat))
    row('Total incl. VAT', m(model.taxInvoice.totalInclVat))
  }
  ops.push({ k: 'rule', dashed: true })
  for (const p of model.payments) row(p.label, m(p.amount))
  if (model.change) row('Change', m(model.change))
  if (model.extras.length) {
    ops.push({ k: 'rule', dashed: true })
    for (const x of model.extras) row(x.label, x.value)
  }
  ops.push({ k: 'rule', dashed: true })
  for (const l of model.footerLines) text(l, base, { align: 'center' })
  if (model.returnPolicy) { ops.push({ k: 'gap', h: 3 }); text(model.returnPolicy, base - 1, { align: 'center' }) }
  for (const png of [assets.barcodePng, assets.qrPng]) {
    if (!png) continue
    try {
      const img = await doc.embedPng(png)
      const isQr = png === assets.qrPng
      ops.push({ k: 'gap', h: 5 })
      ops.push({ k: 'image', img, w: isQr ? Math.min(28 * MM, contentW) : Math.min(contentW * 0.9, 55 * MM), align: 'center' })
    } catch {
      /* skip */
    }
  }
  if (model.poweredBy) { ops.push({ k: 'gap', h: 4 }); text(model.poweredBy, base - 2, { align: 'center' }) }

  if (model.coupon) {
    const c = model.coupon
    ops.push({ k: 'gap', h: 8 })
    text('- - - - -  cut here  - - - - -', base - 1, { align: 'center' })
    ops.push({ k: 'gap', h: 3 })
    const inner: Op[] = [
      { k: 'text', text: c.title, size: base + 3, bold: true, align: 'center' },
      ...(c.text ? [{ k: 'text', text: c.text, size: base, align: 'center' } as Op] : []),
      { k: 'gap', h: 3 },
      { k: 'row', left: 'Invoice', right: c.invoiceNo, size: base },
      { k: 'row', left: 'Date', right: c.date, size: base },
      { k: 'row', left: 'Amount', right: m(c.amount), size: base },
      { k: 'gap', h: 4 },
      { k: 'text', text: `Name: ${c.name ?? '____________________________'}`, size: base },
      { k: 'gap', h: 3 },
      { k: 'text', text: `Phone: ${c.phone ?? '___________________________'}`, size: base },
      { k: 'gap', h: 3 },
      { k: 'text', text: `Address: ${c.address ?? '_________________________'}`, size: base },
      ...(c.address ? [] : [{ k: 'gap', h: 3 } as Op, { k: 'text', text: '_________________________________', size: base } as Op]),
    ]
    ops.push({ k: 'box', ops: inner, dashed: true })
  }

  // ---------------------------------------------------------------- measure + draw
  const pad = 4
  function measure(list: Op[], w: number): number {
    let h = 0
    for (const op of list) {
      if (op.k === 'text') h += wrap(op.text, op.size, w - (op.indent || 0), op.bold).length * lh(op.size)
      else if (op.k === 'row') h += rowLines(op, w).length * lh(op.size)
      else if (op.k === 'rule') h += 6
      else if (op.k === 'gap') h += op.h
      else if (op.k === 'image') h += (op.w / op.img.width) * op.img.height
      else if (op.k === 'table') h += tableHeight(op)
      else if (op.k === 'box') h += measure(op.ops, w - pad * 2) + pad * 2
    }
    return h
  }
  function rowLines(op: Extract<Op, { k: 'row' }>, w: number): string[] {
    const rw = width(safe(op.right), op.size, op.bold)
    return wrap(op.left, op.size, Math.max(20, w - (op.indent || 0) - rw - 6), op.bold)
  }
  function cellLines(t: string, i: number, op: Extract<Op, { k: 'table' }>, b?: boolean) {
    return i === 0 ? wrap(t, op.size, op.widths[i] - 4, b) : [safe(t)]
  }
  function tableRowHeight(op: Extract<Op, { k: 'table' }>, cells: string[], sub: string[], b?: boolean) {
    const nameLines = cellLines(cells[0], 0, op, b).length + sub.reduce((n, s) => n + wrap(s, op.size - 1, op.widths[0] - 4).length, 0)
    return Math.max(1, nameLines) * lh(op.size) + 3
  }
  function tableHeight(op: Extract<Op, { k: 'table' }>) {
    return tableRowHeight(op, op.head, [], true) + op.rows.reduce((h, r) => h + tableRowHeight(op, r.cells, r.sub), 0)
  }

  const contentH = measure(ops, contentW)
  const pageH = Math.max(60 * MM, contentH + margin * 2)
  const page: PDFPage = doc.addPage([pageW, pageH])
  let y = pageH - margin

  const drawStr = (t: string, x: number, yy: number, size: number, b?: boolean) => page.drawText(t, { x, y: yy, size, font: font(b), color })
  const hline = (x1: number, x2: number, yy: number, dashed?: boolean, thickness = 0.6) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color, ...(dashed ? { dashArray: [2, 1.5] } : {}) })

  function draw(list: Op[], x0: number, w: number) {
    for (const op of list) {
      if (op.k === 'text') {
        const ind = op.indent || 0
        for (const l of wrap(op.text, op.size, w - ind, op.bold)) {
          y -= lh(op.size)
          const tw = width(l, op.size, op.bold)
          const x = op.align === 'center' ? x0 + (w - tw) / 2 : op.align === 'right' ? x0 + w - tw : x0 + ind
          drawStr(l, x, y + op.size * 0.25, op.size, op.bold)
        }
      } else if (op.k === 'row') {
        const lines = rowLines(op, w)
        const right = safe(op.right)
        lines.forEach((l, i) => {
          y -= lh(op.size)
          drawStr(l, x0 + (op.indent || 0), y + op.size * 0.25, op.size, op.bold)
          if (i === 0) drawStr(right, x0 + w - width(right, op.size, op.bold), y + op.size * 0.25, op.size, op.bold)
        })
      } else if (op.k === 'rule') {
        y -= 3
        hline(x0, x0 + w, y, op.dashed)
        y -= 3
      } else if (op.k === 'gap') {
        y -= op.h
      } else if (op.k === 'image') {
        const h = (op.w / op.img.width) * op.img.height
        y -= h
        const x = op.align === 'left' ? x0 : op.align === 'right' ? x0 + w - op.w : x0 + (w - op.w) / 2
        page.drawImage(op.img, { x, y, width: op.w, height: h })
      } else if (op.k === 'table') {
        const drawRow = (cells: string[], sub: string[], b?: boolean) => {
          const h = tableRowHeight(op, cells, sub, b)
          const top = y
          let x = x0
          cells.forEach((cell, i) => {
            let yy = top
            const lines = cellLines(cell, i, op, b)
            for (const l of lines) {
              yy -= lh(op.size)
              const tw = width(l, op.size, b)
              drawStr(l, i === 0 ? x + 2 : x + op.widths[i] - 2 - tw, yy + op.size * 0.25 + 1, op.size, b)
            }
            if (i === 0) for (const s of sub) for (const l of wrap(s, op.size - 1, op.widths[0] - 4)) {
              yy -= lh(op.size)
              drawStr(l, x + 2, yy + op.size * 0.25 + 1, op.size - 1)
            }
            x += op.widths[i]
          })
          // borders
          page.drawRectangle({ x: x0, y: top - h, width: op.widths.reduce((a, c) => a + c, 0), height: h, borderColor: color, borderWidth: 0.6 })
          let vx = x0
          for (const cw of op.widths.slice(0, -1)) { vx += cw; page.drawLine({ start: { x: vx, y: top }, end: { x: vx, y: top - h }, thickness: 0.6, color }) }
          y = top - h
        }
        drawRow(op.head, [], true)
        for (const r of op.rows) drawRow(r.cells, r.sub)
      } else if (op.k === 'box') {
        const h = measure(op.ops, w - pad * 2) + pad * 2
        const top = y
        page.drawRectangle({ x: x0, y: top - h, width: w, height: h, borderColor: color, borderWidth: 1, ...(op.dashed ? { borderDashArray: [3, 2] } : {}) })
        y -= pad
        draw(op.ops, x0 + pad, w - pad * 2)
        y = top - h
      }
    }
  }
  draw(ops, margin, contentW)
  return doc.save()
}
