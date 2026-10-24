// Pure HTML fragments for the `system` print transport (expo-print) and PDF receipts.
// No React Native imports, so tests can render them under Node.
import {
  DEFAULT_RECEIPT_FORMAT,
  RECEIPT_FONT_PX,
  formatReceiptDate,
  invoiceCodeFor,
  money,
  paymentLabel,
  qtyText,
  vatRateText,
  zReportDetailRows,
  type PaperWidth,
  type ReceiptBusiness,
  type ReceiptFormat,
  type ReceiptInput,
  type ReceiptLogo,
  type ZReportInput,
} from './escpos'
import { code128Svg } from './code128'
import { qrSvg } from './qr'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Logo + business name + business block (legal name, address, phone, e-mail, website, tax id, BRN).
 * Callers pass the business already filtered by the receipt settings (show* flags) — fields that
 * are null/empty are simply left out — so receipts and Z-reports share one header.
 */
export function businessHeaderHtml(biz: ReceiptBusiness, logo?: ReceiptLogo | null, logoAlign: ReceiptFormat['logoAlign'] = 'center'): string {
  const bizLines = [
    biz.legalName && biz.legalName.trim().toLowerCase() !== biz.name.trim().toLowerCase() ? biz.legalName : null,
    biz.address,
    biz.phone ? `Tel: ${biz.phone}` : null,
    biz.email,
    biz.website,
    biz.taxId ? `VAT/TIN: ${biz.taxId}` : null,
    biz.brn ? `BRN: ${biz.brn}` : null,
  ]
    .filter(Boolean)
    .map((l) => `<div class="c">${escapeHtml(String(l))}</div>`)
    .join('')
  const logoHtml =
    logo?.pngBase64 && /^[A-Za-z0-9+/=]+$/.test(logo.pngBase64)
      ? `<div style="text-align:${logoAlign}"><img src="data:image/png;base64,${logo.pngBase64}" style="width:${Math.min(100, Math.max(20, logo.widthPct || 60))}%;height:auto" alt=""></div>`
      : ''
  return `
    ${logoHtml}
    <div class="c b big">${escapeHtml(biz.name)}</div>
    ${bizLines}`
}

/** Z-report (shift close) for the system print transport, branded like the HTML receipt. */
export function zReportHtml(input: ZReportInput): string {
  const tenders = input.tenders
    .map((t) => {
      const variance = t.variance ?? (t.actual ?? 0) - (t.expected ?? 0)
      return `<tr><td>${escapeHtml(paymentLabel(t.method))}</td><td class="r">${money(t.expected ?? 0)}</td><td class="r">${money(t.actual ?? 0)}</td><td class="r">${variance > 0 ? '+' : ''}${money(variance)}</td></tr>`
    })
    .join('')
  const tv = input.summary.totalVariance
  return `${businessHeaderHtml(input.business, input.logo)}
    <div class="c b">${escapeHtml(input.title || 'Z REPORT - SHIFT CLOSE')}</div>
    <hr>
    <table>
      ${input.entryNumber ? `<tr><td>Closing</td><td class="r">${escapeHtml(input.entryNumber)}</td></tr>` : ''}
      ${input.counter ? `<tr><td>Counter</td><td class="r">${escapeHtml(input.counter)}</td></tr>` : ''}
      ${input.cashier ? `<tr><td>Cashier</td><td class="r">${escapeHtml(input.cashier)}</td></tr>` : ''}
      ${input.openedAt ? `<tr><td>Opened</td><td class="r">${escapeHtml(formatReceiptDate(input.openedAt))}</td></tr>` : ''}
      <tr><td>Closed</td><td class="r">${escapeHtml(formatReceiptDate(input.closedAt || new Date()))}</td></tr>
    </table>
    <hr>
    <table>
      <tr><td>Gross sales</td><td class="r">${money(input.summary.totalSales)}</td></tr>
      <tr><td>Returns</td><td class="r">-${money(Math.abs(input.summary.totalReturns))}</td></tr>
      <tr class="b"><td>Net sales</td><td class="r">${money(input.summary.netSales)}</td></tr>
      <tr><td>Transactions</td><td class="r">${input.summary.totalTransactions}</td></tr>
    </table>
    <hr>
    <table><tr class="b"><td>Tender</td><td class="r">Expected</td><td class="r">Counted</td><td class="r">Variance</td></tr>${tenders}</table>
    <hr>
    <table><tr class="b big"><td>TOTAL VARIANCE</td><td class="r">${tv > 0 ? '+' : ''}${money(tv)}</td></tr></table>
    ${input.varianceReason ? `<p>Reason: ${escapeHtml(input.varianceReason)}</p>` : ''}
    ${zReportDetailRows(input.details)
      .map((sec) => `<hr><div class="b">${escapeHtml(sec.section)}</div><table>${sec.rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="r">${escapeHtml(v)}</td></tr>`).join('')}</table>`)
      .join('')}
    ${input.notes ? `<p>Notes: ${escapeHtml(input.notes)}</p>` : ''}
    <p>Signature: ____________________</p>
    <div class="c">Powered by skyERPOS</div>`
}

const td = (l: string, r: string, extra = '') =>
  `<div style="display:flex;justify-content:space-between;gap:6px${extra}"><span style="min-width:0;overflow-wrap:anywhere">${l}</span><span style="text-align:right;white-space:nowrap">${r}</span></div>`

/** Real QR (SVG) for HTML / PDF receipts; falls back to the plain value when it cannot be encoded. */
function receiptQrSvg(value: string): string {
  try {
    return qrSvg(value, 110)
  } catch {
    return `<div style="font-size:10px">${escapeHtml(value)}</div>`
  }
}

/**
 * Receipt for the `system` print transport and PDF sharing. Same options and
 * type scale as the web HTML receipt (src/lib/print/receipt-html.ts): one
 * monospace family, shop name +4 bold, TOTAL +3 bold, codes / notes -1.
 */
export function receiptHtml(input: ReceiptInput, paperWidth: PaperWidth = 58): string {
  const f: ReceiptFormat = { ...DEFAULT_RECEIPT_FORMAT, ...(input.format || {}) }
  const base = RECEIPT_FONT_PX[paperWidth][f.fontSize] ?? RECEIPT_FONT_PX[paperWidth].normal
  const e = escapeHtml
  const ti = input.taxInvoice || null
  const hr = '<div style="border-top:1px dashed #000;margin:5px 0"></div>'
  const grid = 'display:grid;grid-template-columns:minmax(0,1fr) 4em 6em 6.5em;column-gap:4px'
  const table = f.itemLayout === 'one_line' && paperWidth === 80
  const items = input.lines
    .map((l, i) => {
      const out: string[] = []
      if (i > 0 && f.itemSeparator !== 'none') out.push(`<div style="border-top:1px ${f.itemSeparator} #000;margin:3px 0"></div>`)
      const qty = `${e(qtyText(l.qty))}${l.unit ? ` ${e(l.unit)}` : ''}`
      if (table)
        out.push(
          `<div style="${grid}"><span style="overflow-wrap:anywhere">${e(l.name)}</span><span style="text-align:right">${qty}</span><span style="text-align:right">${money(l.unitPrice)}</span><span style="text-align:right">${money(l.total)}</span></div>`
        )
      else if (f.itemLayout === 'one_line') out.push(td(`${qty} x ${e(l.name)}`, money(l.total)))
      else out.push(`<div style="font-weight:600">${e(l.name)}</div>`)
      const codes = [f.showItemSku ? l.sku : null, f.showItemBarcode ? l.barcode : null].filter(Boolean) as string[]
      if (codes.length) out.push(`<div style="font-size:${base - 1}px">&nbsp;&nbsp;${codes.map((c) => e(c)).join(' · ')}</div>`)
      if (f.itemLayout !== 'one_line') out.push(td(`&nbsp;&nbsp;${qty} x ${money(l.unitPrice)}`, money(l.total)))
      if (l.conversion) out.push(`<div style="font-size:${base - 1}px">&nbsp;&nbsp;${e(l.conversion)}</div>`)
      if (ti && l.vatAmount) out.push(td(`&nbsp;&nbsp;VAT ${e(vatRateText(l.vatRate))}%`, money(l.vatAmount)))
      return `<div style="margin-bottom:${f.itemSeparator === 'none' ? 3 : 0}px">${out.join('')}</div>`
    })
    .join('')
  const title = ti ? (ti.kind === 'credit_note' ? 'CREDIT NOTE' : 'TAX INVOICE') : input.isReturn ? 'RETURN / CREDIT NOTE' : 'SALES RECEIPT'
  const meta = [
    td(ti ? (ti.kind === 'credit_note' ? 'Credit Note' : 'Invoice No') : 'Invoice', e(input.invoiceNo)),
    td('Date', e(formatReceiptDate(input.dateTime))),
    ti?.originalInvoiceNo ? td('Against Inv', e(ti.originalInvoiceNo)) : '',
    input.counter ? td('Counter', e(input.counter)) : '',
    input.cashier ? td('Cashier', e(input.cashier)) : '',
    ti?.buyer
      ? td('Buyer', e(ti.buyer.name)) + (ti.buyer.address ? `<div>${e(ti.buyer.address)}</div>` : '') + (ti.buyer.vatNo ? td('Buyer VAT No', e(ti.buyer.vatNo)) : '')
      : input.customer?.name
        ? td('Customer', e(input.customer.name))
        : '',
  ].join('')
  const taxes = (input.taxLines || [])
    .filter((t) => Math.abs(t.amount) > 0.004)
    .map((t) => td(e(t.name), money(t.amount)))
    .join('')
  const payments = (input.payments || []).map((p) => td(`${e(paymentLabel(p.method))}${p.reference ? ` (${e(p.reference)})` : ''}`, money(p.amount))).join('')
  const headerLines = input.headerLines?.length ? input.headerLines : input.header ? [input.header] : []
  const footerLines = input.footerLines?.length ? input.footerLines : [input.footer || 'Thank you for shopping with us!']
  const code = invoiceCodeFor(input)
  const codes = [
    code.barcode ? `<div style="margin:6px auto 0;width:85%">${code128Svg(code.value, { height: 40 })}</div>` : '',
    code.qr ? `<div style="margin-top:6px">${receiptQrSvg(code.qrValue)}</div>` : '',
  ].join('')
  return `<div style="font-family:'Courier New',ui-monospace,monospace;font-size:${base}px;line-height:1.35;color:#000">
    <div style="text-align:center">
      ${businessHeaderHtml(input.business, input.logo, f.logoAlign).replace('class="c b big"', `class="c b" style="font-size:${base + 4}px;line-height:1.2"`)}
      ${headerLines.map((h) => `<div>${e(h).replace(/\n/g, '<br>')}</div>`).join('')}
    </div>
    ${hr}
    <div style="font-weight:bold;font-size:${base + 1}px">${title}</div>
    ${meta}
    ${hr}
    ${table ? `<div style="${grid};font-weight:bold"><span>Item</span><span style="text-align:right">Qty</span><span style="text-align:right">Price</span><span style="text-align:right">Total</span></div>` : td('<b>Item</b>', '<b>Amount</b>')}
    <div style="border-top:1px dashed #000;margin:3px 0"></div>
    ${items}
    ${hr}
    ${td('Subtotal', money(input.subtotal))}
    ${input.discount && Math.abs(input.discount) > 0.004 ? td('Discount', `-${money(Math.abs(input.discount))}`) : ''}
    ${taxes}
    ${td(input.isReturn ? 'REFUND' : 'TOTAL', `LKR ${money(input.total)}`, `;font-weight:bold;font-size:${base + 3}px;margin-top:4px`)}
    ${ti ? td('Total excl. VAT', money(ti.totalExclVat)) + td('VAT', money(ti.totalVat)) + td('Total incl. VAT', money(ti.totalInclVat)) : ''}
    ${hr}
    ${payments}
    ${input.change && input.change > 0.004 ? td('Change', money(input.change)) : ''}
    ${hr}
    <div style="text-align:center">
      ${footerLines.map((fl) => `<div>${e(fl).replace(/\n/g, '<br>')}</div>`).join('')}
      ${input.returnPolicy ? `<div style="margin-top:6px;font-size:${base - 1}px">${e(input.returnPolicy)}</div>` : ''}
      ${codes}
      ${f.poweredBy ? `<div style="margin-top:6px;font-size:${Math.max(7, base - 2)}px">Powered by skyERPOS</div>` : ''}
    </div>
  </div>`
}
