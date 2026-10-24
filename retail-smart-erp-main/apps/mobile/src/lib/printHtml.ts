// Pure HTML fragments for the `system` print transport (expo-print) and PDF receipts.
// No React Native imports, so tests can render them under Node.
import { formatReceiptDate, money, paymentLabel, zReportDetailRows, type ReceiptBusiness, type ReceiptLogo, type ZReportInput } from './escpos'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Logo + business name + business block (legal name, address, phone, e-mail, website, tax id, BRN).
 * Callers pass the business already filtered by the receipt settings (show* flags) — fields that
 * are null/empty are simply left out — so receipts and Z-reports share one header.
 */
export function businessHeaderHtml(biz: ReceiptBusiness, logo?: ReceiptLogo | null): string {
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
      ? `<div class="c"><img src="data:image/png;base64,${logo.pngBase64}" style="width:${Math.min(100, Math.max(40, logo.widthPct || 60))}%;height:auto" alt=""></div>`
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
