/**
 * HTML renderer for the shared receipt model (W7). Produces a self-contained
 * HTML fragment (inline styles) for browser printing (quickPrint) and the
 * settings live preview. The invoice barcode / QR are inline SVGs generated
 * with bwip-js (loaded lazily).
 */
import { formatRate, RECEIPT_FONT_PX, type ReceiptModel, type ReceiptModelLine } from './receipt-model'
import { formatMoney } from './escpos/encoder'

export interface ReceiptHtmlAssets {
  /** <img> src for the logo (CDN URL or data: URI). */
  logoSrc?: string | null
  barcodeSvg?: string | null
  qrSvg?: string | null
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only allow http(s), same-origin paths and raster data URIs as <img> sources. */
function safeImgSrc(src: string | null | undefined): string | null {
  if (!src) return null
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return src
  if (/^https?:\/\//i.test(src) || src.startsWith('/')) return src
  return null
}

/** Render the invoice barcode (CODE128) and QR as SVG strings. */
export async function renderInvoiceCodeSvgs(model: ReceiptModel): Promise<{ barcodeSvg: string | null; qrSvg: string | null }> {
  const { type, value } = model.invoiceCode
  const qrValue = model.invoiceCode.qrValue || value
  if (!value || type === 'none') return { barcodeSvg: null, qrSvg: null }
  try {
    const bwip = await import('bwip-js/browser')
    let barcodeSvg: string | null = null
    let qrSvg: string | null = null
    if (type === 'barcode' || type === 'both') {
      try {
        barcodeSvg = bwip.toSVG({
          bcid: 'code128',
          text: value,
          scale: 2,
          height: 10,
          includetext: true,
          textxalign: 'center',
        })
      } catch {
        barcodeSvg = null
      }
    }
    if (type === 'qr' || type === 'both') {
      try {
        qrSvg = bwip.toSVG({ bcid: 'qrcode', text: qrValue, scale: 3 })
      } catch {
        qrSvg = null
      }
    }
    return { barcodeSvg, qrSvg }
  } catch {
    return { barcodeSvg: null, qrSvg: null }
  }
}

const FONT_STACKS: Record<ReceiptModel['fontFamily'], string> = {
  sans: "Arial,'Helvetica Neue',Helvetica,'Liberation Sans',sans-serif",
  mono: "'Courier New',ui-monospace,'Liberation Mono',monospace",
  narrow: "'Arial Narrow','Roboto Condensed','Liberation Sans Narrow',Arial,sans-serif",
}

/** Body text weight: thermal drivers turn thin anti-aliased strokes into faint grey dots, bold prints crisp black. */
function weightCss(w: ReceiptModel['textWeight']): string {
  if (w === 'extra') return 'font-weight:700;-webkit-text-stroke:0.3px currentColor'
  if (w === 'dark') return 'font-weight:700'
  return 'font-weight:400'
}

/** Bordered Item | Qty | Price | Total table (58 mm: Item | Qty | Total). */
function itemsTableHtml(model: ReceiptModel, paperWidth: 58 | 80, base: number, m: (n: number) => string): string {
  const e = escapeHtml
  const wide = paperWidth === 80
  const cell = `border:1px solid ${model.textColor};padding:1px 3px;vertical-align:top`
  const num = `${cell};text-align:right;white-space:nowrap`
  const out: string[] = [
    `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:inherit;color:inherit">`,
    wide
      ? '<colgroup><col /><col style="width:3.6em" /><col style="width:5.6em" /><col style="width:6.2em" /></colgroup>'
      : '<colgroup><col /><col style="width:3.2em" /><col style="width:5.8em" /></colgroup>',
    `<thead><tr><th style="${cell};text-align:left">Item</th><th style="${num}">Qty</th>${wide ? `<th style="${num}">Price</th>` : ''}<th style="${num}">Total</th></tr></thead><tbody>`,
  ]
  for (const l of model.items) {
    const qty = `${e(l.qtyText)}${l.unit ? ` ${e(l.unit)}` : ''}`
    const sub: string[] = []
    const codes = [model.showItemSku ? l.sku : null, model.showItemBarcode ? l.barcode : null].filter(Boolean) as string[]
    if (codes.length) sub.push(codes.map(e).join(' · '))
    if (!wide) sub.push(`${qty} x ${m(l.unitPrice)}`)
    if (l.discount > 0) sub.push(`Discount -${m(l.discount)}`)
    if (model.taxInvoice && l.vatAmount) sub.push(`VAT ${formatRate(l.vatRate)}% ${m(l.vatAmount)}`)
    for (const n of l.notes) sub.push(e(n))
    const name = `${e(l.name)}${sub.length ? `<div style="font-size:${base - 1}px">${sub.join('<br />')}</div>` : ''}`
    out.push(
      `<tr><td style="${cell};overflow-wrap:anywhere">${name}</td><td style="${num}">${qty}</td>${wide ? `<td style="${num}">${m(l.unitPrice)}</td>` : ''}<td style="${num}">${m(l.total)}</td></tr>`
    )
  }
  out.push(`</tbody></table>`)
  return out.join('')
}

/** Tear-off coupon: invoice, date, amount and the customer's name / phone / address (blank lines to fill in). */
function couponHtml(model: ReceiptModel, base: number, m: (n: number) => string): string {
  const c = model.coupon
  if (!c) return ''
  const e = escapeHtml
  const field = (label: string, value: string | null, lines = 1) =>
    value
      ? `<div style="display:flex;gap:6px"><span style="white-space:nowrap">${label}:</span><span style="flex:1;border-bottom:1px solid ${model.textColor};overflow-wrap:anywhere">${e(value)}</span></div>`
      : Array.from({ length: lines }, (_, i) => `<div style="display:flex;gap:6px;margin-top:${i ? 10 : 4}px"><span style="white-space:nowrap;${i ? 'visibility:hidden' : ''}">${label}:</span><span style="flex:1;border-bottom:1px solid ${model.textColor};height:${base + 4}px"></span></div>`).join('')
  return (
    `<div style="margin-top:10px;text-align:center;font-size:${base - 1}px;letter-spacing:1px">- - - - - &#9986; cut here - - - - -</div>` +
    `<div style="margin-top:6px;border:2px dashed ${model.textColor};padding:6px;text-align:left">` +
    `<div style="text-align:center;font-weight:700;font-size:${base + 3}px">${e(c.title)}</div>` +
    (c.text ? `<div style="text-align:center;margin-top:2px">${e(c.text)}</div>` : '') +
    `<div style="margin-top:6px">${row('Invoice', e(c.invoiceNo))}${row('Date', e(c.date))}${row('Amount', m(c.amount))}</div>` +
    `<div style="margin-top:4px">${field('Name', c.name)}${field('Phone', c.phone)}${field('Address', c.address, 2)}</div>` +
    `</div>`
  )
}

const row = (l: string, r: string, extra = '') =>
  `<div style="display:flex;justify-content:space-between;gap:8px${extra}"><span style="min-width:0;overflow-wrap:anywhere">${l}</span><span style="text-align:right;white-space:nowrap">${r}</span></div>`
const hr = '<div style="border-top:1px dashed currentColor;margin:6px 0"></div>'
const sepLine = (kind: 'dashed' | 'solid') => `<div style="border-top:1px ${kind} currentColor;margin:3px 0"></div>`

/**
 * Type scale shared by every receipt renderer: one font family (monospace, so
 * columns line up like on the thermal head), body = RECEIPT_FONT_PX, shop name
 * +4 bold, document title +1 bold, TOTAL +3 bold, secondary text (codes, notes,
 * policy) -1, "Powered by" -2.
 */
function itemHtml(l: ReceiptModelLine, model: ReceiptModel, paperWidth: 58 | 80, base: number, m: (n: number) => string): string {
  const e = escapeHtml
  const out: string[] = []
  const codes = [model.showItemSku ? l.sku : null, model.showItemBarcode ? l.barcode : null].filter(Boolean) as string[]
  const qty = `${e(l.qtyText)}${l.unit ? ` ${e(l.unit)}` : ''}`
  if (model.itemLayout === 'one_line' && paperWidth === 80) {
    out.push(
      `<div style="display:grid;grid-template-columns:minmax(0,1fr) 4em 6em 6.5em;column-gap:4px">` +
        `<span style="overflow-wrap:anywhere">${e(l.name)}</span>` +
        `<span style="text-align:right;white-space:nowrap">${qty}</span>` +
        `<span style="text-align:right;white-space:nowrap">${m(l.unitPrice)}</span>` +
        `<span style="text-align:right;white-space:nowrap">${m(l.total)}</span></div>`
    )
  } else if (model.itemLayout === 'one_line') {
    out.push(row(`${qty} x ${e(l.name)}`, m(l.total)))
  } else {
    out.push(`<div style="font-weight:600">${e(l.name)}</div>`)
  }
  if (codes.length) out.push(`<div style="font-size:${base - 1}px">&nbsp;&nbsp;${codes.map(e).join(' · ')}</div>`)
  if (model.itemLayout !== 'one_line') out.push(row(`&nbsp;&nbsp;${qty} x ${m(l.unitPrice)}`, m(l.total)))
  if (l.discount > 0) out.push(row('&nbsp;&nbsp;Discount', `-${m(l.discount)}`))
  if (model.taxInvoice && l.vatAmount) out.push(row(`&nbsp;&nbsp;VAT ${formatRate(l.vatRate)}%`, m(l.vatAmount)))
  for (const n of l.notes) out.push(`<div style="font-size:${base - 1}px">&nbsp;&nbsp;${e(n)}</div>`)
  return out.join('')
}

/** Synchronous render when SVGs/logo are already resolved. */
export function renderReceiptHtmlSync(model: ReceiptModel, paperWidth: 58 | 80, assets: ReceiptHtmlAssets = {}): string {
  const m = (n: number) => formatMoney(n, model.decimals)
  const e = escapeHtml
  const base = RECEIPT_FONT_PX[paperWidth][model.fontSize] ?? RECEIPT_FONT_PX[paperWidth].normal
  const parts: string[] = []

  parts.push(
    `<div class="poslanka-receipt" style="font-family:${FONT_STACKS[model.fontFamily] ?? FONT_STACKS.sans};font-size:${base}px;line-height:1.35;color:${model.textColor};${weightCss(model.textWeight)};text-rendering:geometricPrecision;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff;width:100%;box-sizing:border-box;word-wrap:break-word">`
  )
  parts.push('<div style="text-align:center">')
  const logo = model.logo.show ? safeImgSrc(assets.logoSrc ?? model.logo.url) : null
  if (logo) {
    const margin = model.logo.align === 'left' ? '0 auto 4px 0' : model.logo.align === 'right' ? '0 0 4px auto' : '0 auto 4px'
    parts.push(
      `<img src="${e(logo)}" alt="" style="display:block;margin:${margin};width:${model.logo.widthPct}%;max-width:100%;height:auto;filter:grayscale(1)" />`
    )
  }
  parts.push(`<div style="font-weight:bold;font-size:${base + 4}px;line-height:1.2">${e(model.business.name)}</div>`)
  for (const l of model.business.lines) parts.push(`<div>${e(l)}</div>`)
  if (model.headerLines.length) {
    parts.push('<div style="margin-top:4px">')
    for (const l of model.headerLines) parts.push(`<div>${e(l)}</div>`)
    parts.push('</div>')
  }
  if (model.title) parts.push(`<div style="font-weight:bold;font-size:${base + 1}px;margin-top:4px">${e(model.title)}</div>`)
  if (model.copyLabel) parts.push(`<div style="margin-top:2px">*** ${e(model.copyLabel)} ***</div>`)
  parts.push('</div>')

  parts.push(hr)
  for (const r of model.meta) parts.push(row(`${e(r.label)}:`, e(r.value)))
  parts.push(hr)

  // Column header (same as the thermal print)
  if (model.itemLayout === 'table') {
    parts.push(itemsTableHtml(model, paperWidth, base, m))
  } else if (model.itemLayout === 'one_line' && paperWidth === 80) {
    parts.push(
      `<div style="display:grid;grid-template-columns:minmax(0,1fr) 4em 6em 6.5em;column-gap:4px;font-weight:bold">` +
        '<span>Item</span><span style="text-align:right">Qty</span><span style="text-align:right">Price</span><span style="text-align:right">Total</span></div>'
    )
  } else {
    parts.push(row('<b>Item</b>', '<b>Amount</b>'))
  }
  if (model.itemLayout !== 'table') {
    parts.push('<div style="border-top:1px dashed currentColor;margin:3px 0"></div>')
    model.items.forEach((l, i) => {
      if (i > 0 && model.itemSeparator !== 'none') parts.push(sepLine(model.itemSeparator))
      parts.push(`<div style="margin-bottom:${model.itemSeparator === 'none' ? 3 : 0}px">${itemHtml(l, model, paperWidth, base, m)}</div>`)
    })
  }
  parts.push(hr)

  for (const t of model.totals) parts.push(row(e(t.label), `${t.negative ? '-' : ''}${m(t.amount)}`))
  parts.push(
    row(
      'TOTAL',
      `${model.currency ? e(model.currency) + ' ' : ''}${m(model.total)}`,
      `;font-weight:bold;font-size:${base + 3}px;margin-top:4px`
    )
  )
  if (model.taxInvoice) {
    parts.push('<div style="border-top:1px dotted currentColor;margin:4px 0"></div>')
    parts.push(row('Total excl. VAT', m(model.taxInvoice.totalExclVat)))
    parts.push(row('VAT', m(model.taxInvoice.totalVat)))
    parts.push(row('Total incl. VAT', m(model.taxInvoice.totalInclVat)))
  }
  parts.push(hr)
  for (const p of model.payments) parts.push(row(e(p.label), m(p.amount)))
  if (model.change) parts.push(row('Change', m(model.change)))
  if (model.extras.length) {
    parts.push(hr)
    for (const x of model.extras) parts.push(row(e(x.label), e(x.value)))
  }
  parts.push(hr)

  parts.push('<div style="text-align:center">')
  for (const l of model.footerLines) parts.push(`<div>${e(l)}</div>`)
  if (model.returnPolicy) parts.push(`<div style="margin-top:6px;font-size:${base - 1}px">${e(model.returnPolicy)}</div>`)
  if (assets.barcodeSvg) {
    parts.push(`<div style="margin-top:8px;display:flex;justify-content:center"><div style="width:90%;max-width:260px">${sizeSvg(assets.barcodeSvg)}</div></div>`)
  }
  if (assets.qrSvg) {
    parts.push(`<div style="margin-top:8px;display:flex;justify-content:center"><div style="width:${paperWidth === 58 ? 90 : 110}px">${sizeSvg(assets.qrSvg)}</div></div>`)
  }
  if (model.invoiceCode.type !== 'none' && !assets.barcodeSvg && !assets.qrSvg && model.invoiceCode.value) {
    parts.push(`<div style="margin-top:6px">${e(model.invoiceCode.value)}</div>`)
  }
  if (model.poweredBy) parts.push(`<div style="margin-top:6px;font-size:${Math.max(7, base - 2)}px">${e(model.poweredBy)}</div>`)
  parts.push('</div>')
  parts.push(couponHtml(model, base, m))
  parts.push('</div>')
  return parts.join('')
}

/** Make a bwip-js SVG scale to its container. */
function sizeSvg(svg: string): string {
  // Strip any XML prolog and make the root svg responsive.
  const s = svg.replace(/<\?xml[^>]*>/, '').trim()
  return s.replace(/<svg\b/, '<svg style="width:100%;height:auto;display:block"')
}

/** Full async render: generates the invoice barcode / QR SVGs as needed. */
export async function renderReceiptHtml(model: ReceiptModel, paperWidth: 58 | 80, assets: { logoSrc?: string | null } = {}): Promise<string> {
  const svgs = await renderInvoiceCodeSvgs(model)
  return renderReceiptHtmlSync(model, paperWidth, { ...svgs, logoSrc: assets.logoSrc })
}
