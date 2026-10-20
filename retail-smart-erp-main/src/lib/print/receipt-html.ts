/**
 * HTML renderer for the shared receipt model (W7). Produces a self-contained
 * HTML fragment (inline styles) for browser printing (quickPrint) and the
 * settings live preview. The invoice barcode / QR are inline SVGs generated
 * with bwip-js (loaded lazily).
 */
import type { ReceiptModel } from './receipt-model'
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
        qrSvg = bwip.toSVG({ bcid: 'qrcode', text: value, scale: 3 })
      } catch {
        qrSvg = null
      }
    }
    return { barcodeSvg, qrSvg }
  } catch {
    return { barcodeSvg: null, qrSvg: null }
  }
}

const row = (l: string, r: string, extra = '') =>
  `<div style="display:flex;justify-content:space-between;gap:8px${extra}"><span>${l}</span><span style="text-align:right;white-space:nowrap">${r}</span></div>`
const hr = '<div style="border-top:1px dashed #000;margin:6px 0"></div>'

/** Synchronous render when SVGs/logo are already resolved. */
export function renderReceiptHtmlSync(model: ReceiptModel, paperWidth: 58 | 80, assets: ReceiptHtmlAssets = {}): string {
  const m = (n: number) => formatMoney(n, model.decimals)
  const e = escapeHtml
  const base = model.fontSize === 'large' ? (paperWidth === 58 ? 12 : 13) : paperWidth === 58 ? 10 : 11
  const parts: string[] = []

  parts.push(
    `<div class="poslanka-receipt" style="font-family:'Courier New',ui-monospace,monospace;font-size:${base}px;line-height:1.35;color:#000;background:#fff;width:100%;box-sizing:border-box;word-wrap:break-word">`
  )
  parts.push('<div style="text-align:center">')
  const logo = model.logo.show ? safeImgSrc(assets.logoSrc ?? model.logo.url) : null
  if (logo) {
    parts.push(
      `<img src="${e(logo)}" alt="" style="display:block;margin:0 auto 4px;width:${model.logo.widthPct}%;max-width:100%;height:auto;filter:grayscale(1)" />`
    )
  }
  parts.push(`<div style="font-weight:bold;font-size:${base + 4}px">${e(model.business.name)}</div>`)
  for (const l of model.business.lines) parts.push(`<div>${e(l)}</div>`)
  if (model.headerLines.length) {
    parts.push('<div style="margin-top:4px">')
    for (const l of model.headerLines) parts.push(`<div>${e(l)}</div>`)
    parts.push('</div>')
  }
  if (model.title) parts.push(`<div style="font-weight:bold;margin-top:4px">${e(model.title)}</div>`)
  if (model.copyLabel) parts.push(`<div style="margin-top:2px">*** ${e(model.copyLabel)} ***</div>`)
  parts.push('</div>')

  parts.push(hr)
  for (const r of model.meta) parts.push(row(`${e(r.label)}:`, e(r.value)))
  parts.push(hr)

  for (const l of model.items) {
    parts.push('<div style="margin-bottom:3px">')
    parts.push(`<div style="font-weight:600">${e(l.name)}</div>`)
    if (model.showItemSku && l.sku) parts.push(`<div style="font-size:${base - 1}px">${e(l.sku)}</div>`)
    parts.push(row(`&nbsp;&nbsp;${e(l.qtyText)}${l.unit ? ` ${e(l.unit)}` : ''} x ${m(l.unitPrice)}`, m(l.total)))
    if (l.discount > 0) parts.push(row('&nbsp;&nbsp;Discount', `-${m(l.discount)}`))
    for (const n of l.notes) parts.push(`<div style="font-size:${base - 1}px">&nbsp;&nbsp;${e(n)}</div>`)
    parts.push('</div>')
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
  parts.push('</div></div>')
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
