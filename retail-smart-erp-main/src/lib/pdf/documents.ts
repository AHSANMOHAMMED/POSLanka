/**
 * Lightweight HTML→printable document helpers for receipts/invoices/quotations.
 * Browsers can Save as PDF; API also returns HTML for download/share.
 */

export type PdfDocumentType = 'receipt' | 'invoice' | 'quotation' | 'credit_note' | 'tax_invoice'

export interface DocumentLine {
  name: string
  quantity: number
  unitPrice: number
  /** Line value (excl. VAT on tax invoices). */
  total: number
  /** Tax invoices: VAT rate (%) and amount of the line. */
  vatRate?: number
  vatAmount?: number
}

export interface DocumentPayload {
  type: PdfDocumentType
  number: string
  shopName: string
  shopAddress?: string
  shopPhone?: string
  customerName?: string
  customerPhone?: string
  /** Supplier VAT registration number (tenants.tax_id). Required on a tax invoice. */
  supplierVatNo?: string
  /** Buyer address / VAT number (customers.tax_id) for B2B tax invoices. */
  customerAddress?: string
  customerVatNo?: string
  /** Document date (YYYY-MM-DD or display string). */
  date?: string
  /** Credit / debit note: the invoice it adjusts. */
  originalInvoiceNo?: string
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
    vat: 'VAT',
    vatRate: 'VAT %',
    exclVat: 'Total excl. VAT',
    inclVat: 'Total incl. VAT',
    vatRegNo: 'VAT Reg No',
    buyerVatNo: 'Buyer VAT No',
    date: 'Date',
    against: 'Against invoice',
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
    tax: 'Tax (VAT)',
    vat: 'VAT',
    vatRate: 'VAT %',
    exclVat: 'Total excl. VAT',
    inclVat: 'Total incl. VAT',
    vatRegNo: 'VAT Reg No',
    buyerVatNo: 'Buyer VAT No',
    date: 'Date',
    against: 'Against invoice',
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

  // Tax invoice layout (per-line VAT, excl./incl. totals) when VAT particulars are present
  const vatLayout = (doc.type === 'tax_invoice' || doc.type === 'credit_note') && !!doc.supplierVatNo
  const rows = doc.lines
    .map(
      (l) =>
        `<tr>
          <td>${escapeHtml(l.name)}</td>
          <td style="text-align:right">${l.quantity}</td>
          <td style="text-align:right">${l.unitPrice.toFixed(2)}</td>
          <td style="text-align:right">${l.total.toFixed(2)}</td>${vatLayout ? `
          <td style="text-align:right">${l.vatRate !== undefined ? l.vatRate : ''}</td>
          <td style="text-align:right">${l.vatAmount !== undefined ? l.vatAmount.toFixed(2) : ''}</td>` : ''}
        </tr>`
    )
    .join('')
  const meta = [
    doc.date ? `<div class="muted">${t.date}: ${escapeHtml(doc.date)}</div>` : '',
    doc.originalInvoiceNo ? `<div class="muted">${t.against}: ${escapeHtml(doc.originalInvoiceNo)}</div>` : '',
  ].join('')
  const buyer = doc.customerName
    ? `<div class="muted">Customer: ${escapeHtml(doc.customerName)} ${escapeHtml(doc.customerPhone || '')}</div>` +
      (doc.customerAddress ? `<div class="muted">${escapeHtml(doc.customerAddress)}</div>` : '') +
      (doc.customerVatNo ? `<div class="muted">${t.buyerVatNo}: ${escapeHtml(doc.customerVatNo)}</div>` : '')
    : ''
  const totals = vatLayout
    ? `<div>${t.exclVat}: ${currency} ${doc.subtotal.toFixed(2)}</div>
    <div>${doc.taxLabel || t.vat}: ${currency} ${doc.tax.toFixed(2)}</div>
    <div class="grand">${t.inclVat}: ${currency} ${doc.total.toFixed(2)}</div>`
    : `<div>${t.subtotal}: ${currency} ${doc.subtotal.toFixed(2)}</div>
    <div>${doc.taxLabel || t.tax}: ${currency} ${doc.tax.toFixed(2)}</div>
    <div class="grand">${t.total}: ${currency} ${doc.total.toFixed(2)}</div>`

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
  ${doc.supplierVatNo ? `<div class="muted">${t.vatRegNo}: ${escapeHtml(doc.supplierVatNo)}</div>` : ''}
  <h2 style="margin-top:16px;font-size:16px">${escapeHtml(title)} #${escapeHtml(doc.number)}</h2>
  ${meta}
  ${buyer}
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:right">${t.qty}</th>
        <th style="text-align:right">${t.price}</th>
        <th style="text-align:right">${t.total}</th>${vatLayout ? `
        <th style="text-align:right">${t.vatRate}</th>
        <th style="text-align:right">${t.vat}</th>` : ''}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    ${totals}
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
