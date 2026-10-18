/**
 * Lightweight HTML→printable document helpers for receipts/invoices/quotations.
 * Browsers can Save as PDF; API also returns HTML for download/share.
 */

export type PdfDocumentType = 'receipt' | 'invoice' | 'quotation' | 'credit_note' | 'tax_invoice'

export interface DocumentLine {
  name: string
  quantity: number
  unitPrice: number
  total: number
}

export interface DocumentPayload {
  type: PdfDocumentType
  number: string
  shopName: string
  shopAddress?: string
  shopPhone?: string
  customerName?: string
  customerPhone?: string
  lines: DocumentLine[]
  subtotal: number
  tax: number
  taxLabel?: string
  total: number
  currency?: string
  notes?: string
  locale?: 'en' | 'si'
}

const LABELS = {
  en: {
    receipt: 'Receipt',
    invoice: 'Invoice',
    quotation: 'Quotation',
    credit_note: 'Credit Note',
    tax_invoice: 'Tax Invoice',
    qty: 'Qty',
    price: 'Price',
    total: 'Total',
    subtotal: 'Subtotal',
    tax: 'Tax',
    thankYou: 'Thank you for your business',
  },
  si: {
    receipt: 'Receipt',
    invoice: 'Invoice',
    quotation: 'Quotation',
    credit_note: 'Credit Note',
    tax_invoice: 'Tax Invoice',
    qty: 'Qty',
    price: 'Price',
    total: 'Total',
    subtotal: 'Subtotal',
    tax: 'Tax (VAT/NBT)',
    thankYou: 'Obage vyaparayata sthutiyi',
  },
} as const

export function renderDocumentHtml(doc: DocumentPayload): string {
  const locale = doc.locale === 'si' ? 'si' : 'en'
  const t = LABELS[locale]
  const currency = doc.currency || 'LKR'
  const title =
    doc.type === 'tax_invoice'
      ? t.tax_invoice
      : doc.type === 'credit_note'
        ? t.credit_note
        : t[doc.type as 'receipt' | 'invoice' | 'quotation']

  const rows = doc.lines
    .map(
      (l) =>
        `<tr>
          <td>${escapeHtml(l.name)}</td>
          <td style="text-align:right">${l.quantity}</td>
          <td style="text-align:right">${l.unitPrice.toFixed(2)}</td>
          <td style="text-align:right">${l.total.toFixed(2)}</td>
        </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} ${escapeHtml(doc.number)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 24px auto; color: #111; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .muted { color: #555; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px 4px; }
    th { text-align: left; }
    .totals { margin-top: 16px; text-align: right; font-size: 14px; }
    .totals div { margin: 4px 0; }
    .grand { font-weight: 700; font-size: 16px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(doc.shopName)}</h1>
  <div class="muted">${escapeHtml(doc.shopAddress || '')} ${escapeHtml(doc.shopPhone || '')}</div>
  <h2 style="margin-top:16px;font-size:16px">${escapeHtml(title)} #${escapeHtml(doc.number)}</h2>
  ${doc.customerName ? `<div class="muted">Customer: ${escapeHtml(doc.customerName)} ${escapeHtml(doc.customerPhone || '')}</div>` : ''}
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:right">${t.qty}</th>
        <th style="text-align:right">${t.price}</th>
        <th style="text-align:right">${t.total}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div>${t.subtotal}: ${currency} ${doc.subtotal.toFixed(2)}</div>
    <div>${doc.taxLabel || t.tax}: ${currency} ${doc.tax.toFixed(2)}</div>
    <div class="grand">${t.total}: ${currency} ${doc.total.toFixed(2)}</div>
  </div>
  ${doc.notes ? `<p class="muted" style="margin-top:16px">${escapeHtml(doc.notes)}</p>` : ''}
  <p class="muted" style="margin-top:24px">${t.thankYou}</p>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
