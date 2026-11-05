'use client'

/**
 * Service job documents (drizzle/0193), printed through executePrint() (hidden iframe, popup
 * fallback) like the other documents, on A4, A5 or an 80 mm roll:
 *  - job card: shop copy for the bench (device / garment, fault, accessories, condition,
 *    measurements, lines) with the customer's tear-off claim slip
 *  - customer receipt: amounts, advances, balance
 *  - warranty card: per sold unit / line with a warranty (serial / IMEI, sale date, until, terms)
 */
import { executePrint } from '@/lib/print/print-executor'
import { PAYMENT_METHOD_LABELS, serviceJobStatusLabel, type ServiceJobKind } from '@/lib/service-jobs/constants'

export type PaperSize = 'a4' | 'a5' | '80mm'
export const PAPER_SIZES: Array<{ value: PaperSize; label: string }> = [
  { value: 'a4', label: 'A4' },
  { value: 'a5', label: 'A5' },
  { value: '80mm', label: '80 mm roll' },
]

export interface PrintCompanyInfo { name?: string | null; address?: string | null; phone?: string | null; email?: string | null }

export interface ServiceJobDoc {
  jobNo: string
  jobType: ServiceJobKind
  title: string
  status: string
  customerName: string
  customerPhone: string | null
  receivedAt: string
  promisedAt: string | null
  isUrgent: boolean
  assignedName: string | null
  warehouseName: string | null
  deviceType: string | null
  brand: string | null
  model: string | null
  serialNumber: string | null
  imei: string | null
  imei2: string | null
  faultReported: string | null
  accessoriesReceived: string | null
  conditionChecklist: Array<{ label: string; ok: boolean | null; note?: string | null }>
  conditionNotes: string | null
  diagnosis: string | null
  workDone: string | null
  underWarranty: boolean
  warrantyUntil: string | null
  garment: string | null
  measurements: Record<string, string>
  fabricSupplied: boolean
  fittingDate: string | null
  estimateAmount: string | null
  estimateStatus: string
  repairWarrantyDays: number | null
  repairWarrantyUntil: string | null
  notes: string | null
  subtotal: string
  discountAmount: string
  taxAmount: string
  total: string
  paidAmount: string
  balanceDue: string
  invoiceNo?: string | null
  lines: Array<{ lineType: string; description: string; quantity: string; unitPrice: string; amount: string; notes: string | null }>
  payments: Array<{ amount: string; paymentMethod: string; reference: string | null; createdAt: string; refundedAt: string | null }>
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n2 = (v: string | number | null | undefined) => (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const d = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString([], { dateStyle: 'medium' }) : '—')
const qty = (v: string) => String(Number(v) || 0)

function pageStyles(size: PaperSize): string {
  const page = size === '80mm' ? '@page { size: 80mm auto; margin: 3mm; }' : size === 'a5' ? '@page { size: A5; margin: 8mm; }' : '@page { size: A4; margin: 12mm; }'
  const base = size === '80mm' ? 11 : size === 'a5' ? 11 : 12
  return `
    ${page}
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; font-size: ${base}px; }
    .wrap { ${size === '80mm' ? 'max-width: 74mm; margin: 0 auto;' : ''} }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 6px; ${size === '80mm' ? 'display:block;text-align:center;' : ''} }
    .co { font-size: ${base + 5}px; font-weight: 800; }
    .muted { color: #333; }
    .no { font-size: ${size === '80mm' ? 22 : 30}px; font-weight: 800; letter-spacing: 1px; line-height: 1.1; }
    .tag { display: inline-block; border: 2px solid #000; padding: 1px 6px; font-weight: 800; margin-top: 3px; }
    .tag.inv { background: #000; color: #fff; }
    .grid { display: grid; grid-template-columns: ${size === '80mm' ? '1fr' : '1fr 1fr'}; gap: 2px 14px; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0; }
    th, td { border: 1px solid #000; padding: 3px 5px; text-align: left; vertical-align: top; }
    th { background: #eee; font-size: ${base - 1}px; text-transform: uppercase; }
    td.n, th.n { text-align: right; }
    h3 { font-size: ${base + 1}px; margin: 8px 0 3px; text-transform: uppercase; border-bottom: 1px solid #000; }
    .box { border: 1px dashed #000; padding: 5px; margin: 6px 0; }
    .big { font-size: ${base + 3}px; font-weight: 800; }
    .sig { display: flex; gap: 20px; margin-top: 26px; }
    .sig div { flex: 1; border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: ${base - 1}px; }
    .cut { border-top: 2px dashed #000; margin: 14px 0 8px; position: relative; text-align: center; font-size: ${base - 2}px; }
    .small { font-size: ${base - 2}px; }
    ${size === '80mm' ? 'table { font-size: 10px; } th, td { padding: 2px 3px; }' : ''}
  `
}

function header(company: PrintCompanyInfo | null | undefined, title: string): string {
  return `<div class="hdr">
    <div><div class="co">${esc(company?.name)}</div>
      ${company?.address ? `<div class="muted small">${esc(company.address)}</div>` : ''}
      ${company?.phone ? `<div class="muted small">Tel: ${esc(company.phone)}${company?.email ? ` · ${esc(company.email)}` : ''}</div>` : ''}
    </div>
    <div style="text-align:right"><div style="font-weight:800;text-transform:uppercase">${esc(title)}</div></div>
  </div>`
}

function kindTitle(kind: ServiceJobKind, docName: string): string {
  const k = kind === 'tailoring' ? 'Tailoring Order' : kind === 'service' ? 'Service Ticket' : 'Repair Job'
  return `${k} ${docName}`.trim()
}

function deviceBlock(job: ServiceJobDoc): string {
  if (job.jobType === 'tailoring') {
    const m = Object.entries(job.measurements || {}).filter(([, v]) => String(v).trim())
    return `
      <div class="grid">
        <div><b>Garment:</b> ${esc(job.garment || '—')}</div>
        <div><b>Fabric:</b> ${job.fabricSupplied ? 'Supplied by customer' : 'From shop'}</div>
        <div><b>Trial / fitting:</b> ${esc(d(job.fittingDate))}</div>
      </div>
      ${m.length ? `<h3>Measurements</h3><table><tbody>${m.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</tbody></table>` : ''}`
  }
  if (job.jobType === 'service') return ''
  const checklist = (job.conditionChecklist || []).filter((c) => (c.ok !== null && c.ok !== undefined) || !!c.note)
  return `
    <div class="grid">
      <div><b>Device:</b> ${esc([job.deviceType, job.brand, job.model].filter(Boolean).join(' · ') || '—')}</div>
      <div><b>Serial:</b> ${esc(job.serialNumber || '—')}</div>
      ${job.imei ? `<div><b>IMEI:</b> ${esc(job.imei)}${job.imei2 ? ` / ${esc(job.imei2)}` : ''}</div>` : ''}
      <div><b>Warranty:</b> ${job.underWarranty ? `<b>UNDER WARRANTY</b> until ${esc(d(job.warrantyUntil))}` : job.warrantyUntil ? `Expired ${esc(d(job.warrantyUntil))}` : 'Not checked / not ours'}</div>
    </div>
    <div class="box"><b>Fault reported:</b> ${esc(job.faultReported || '—')}</div>
    <div class="grid">
      <div><b>Accessories received:</b> ${esc(job.accessoriesReceived || 'None')}</div>
      ${job.conditionNotes ? `<div><b>Condition:</b> ${esc(job.conditionNotes)}</div>` : ''}
    </div>
    ${checklist.length ? `<table><tbody>${checklist.map((c) => `<tr><td>${esc(c.label)}</td><td>${c.ok === true ? 'OK' : c.ok === false ? '<b>NO</b>' : ''}${c.note ? ` — ${esc(c.note)}` : ''}</td></tr>`).join('')}</tbody></table>` : ''}`
}

function linesTable(job: ServiceJobDoc, withPrices: boolean): string {
  if (!job.lines.length) return ''
  return `<table>
    <thead><tr><th>Description</th><th class="n">Qty</th>${withPrices ? '<th class="n">Price</th><th class="n">Amount</th>' : ''}</tr></thead>
    <tbody>${job.lines.map((l) => `<tr><td>${esc(l.description)}${l.lineType === 'part' ? ' <span class="small">(part)</span>' : ''}${l.notes ? `<div class="small">${esc(l.notes)}</div>` : ''}</td>
      <td class="n">${esc(qty(l.quantity))}</td>${withPrices ? `<td class="n">${n2(l.unitPrice)}</td><td class="n">${n2(l.amount)}</td>` : ''}</tr>`).join('')}</tbody>
  </table>`
}

function totalsBlock(job: ServiceJobDoc, currency: string): string {
  const open = job.payments.filter((p) => !p.refundedAt)
  return `
    ${Number(job.total) > 0 ? `
      <div class="row"><span>Subtotal</span><span>${n2(job.subtotal)}</span></div>
      ${Number(job.discountAmount) > 0 ? `<div class="row"><span>Discount</span><span>-${n2(job.discountAmount)}</span></div>` : ''}
      ${Number(job.taxAmount) > 0 ? `<div class="row"><span>Tax</span><span>${n2(job.taxAmount)}</span></div>` : ''}
      <div class="row big"><span>Total (${esc(currency)})</span><span>${n2(job.total)}</span></div>` : job.estimateAmount ? `<div class="row big"><span>Estimate (${esc(currency)})</span><span>${n2(job.estimateAmount)}</span></div>` : ''}
    ${open.map((p) => `<div class="row small"><span>Advance · ${esc(PAYMENT_METHOD_LABELS[p.paymentMethod] || p.paymentMethod)} · ${esc(new Date(p.createdAt).toLocaleDateString())}</span><span>-${n2(p.amount)}</span></div>`).join('')}
    ${Number(job.total) > 0 ? `<div class="row big"><span>Balance due</span><span>${n2(job.balanceDue)}</span></div>` : ''}`
}

/** Job card: the bench copy plus a tear-off claim slip for the customer. */
export function printServiceJobCard(job: ServiceJobDoc, company: PrintCompanyInfo | null | undefined, currency: string, size: PaperSize = 'a4') {
  const content = `<div class="wrap">
    ${header(company, kindTitle(job.jobType, 'Card'))}
    <div class="row" style="align-items:flex-end">
      <div><div class="no">${esc(job.jobNo)}</div>${job.isUrgent ? '<span class="tag inv">URGENT</span>' : ''}</div>
      <div style="text-align:right"><div><b>Promised:</b> ${esc(dt(job.promisedAt))}</div><div class="small">Received ${esc(dt(job.receivedAt))}</div></div>
    </div>
    <div class="grid">
      <div><b>Customer:</b> ${esc(job.customerName)}</div>
      <div><b>Phone:</b> ${esc(job.customerPhone || '—')}</div>
      <div><b>Job:</b> ${esc(job.title)}</div>
      <div><b>${job.jobType === 'tailoring' ? 'Tailor' : job.jobType === 'service' ? 'Assigned to' : 'Technician'}:</b> ${esc(job.assignedName || '—')}</div>
      <div><b>Status:</b> ${esc(serviceJobStatusLabel(job.status, job.jobType))}</div>
      ${job.warehouseName ? `<div><b>Branch:</b> ${esc(job.warehouseName)}</div>` : ''}
    </div>
    ${deviceBlock(job)}
    ${job.diagnosis ? `<div class="box"><b>Diagnosis:</b> ${esc(job.diagnosis)}</div>` : ''}
    ${job.workDone ? `<div class="box"><b>Work done:</b> ${esc(job.workDone)}</div>` : ''}
    ${linesTable(job, true)}
    ${totalsBlock(job, currency)}
    ${job.notes ? `<div class="box"><b>Notes:</b> ${esc(job.notes)}</div>` : ''}
    <div class="small" style="margin-top:6px">Items not collected within 60 days of the ready notice may be disposed of. The shop is not responsible for data on devices — please back up. ${job.estimateAmount ? 'Work beyond the estimate needs your approval.' : ''}</div>
    <div class="sig"><div>Customer signature</div><div>Received by</div></div>
    <div class="cut">✂ customer copy</div>
    <div class="row"><b>${esc(company?.name)}</b><span class="big">${esc(job.jobNo)}</span></div>
    <div class="small">${esc(job.customerName)}${job.customerPhone ? ` · ${esc(job.customerPhone)}` : ''} · ${esc(job.title)}</div>
    ${job.jobType === 'repair' ? `<div class="small">${esc([job.brand, job.model].filter(Boolean).join(' '))}${job.imei || job.serialNumber ? ` · ${esc(job.imei || job.serialNumber)}` : ''}</div>` : ''}
    <div class="row small"><span>Received ${esc(dt(job.receivedAt))}</span><span><b>Ready by ${esc(dt(job.promisedAt))}</b></span></div>
    ${Number(job.paidAmount) > 0 ? `<div class="row small"><span>Advance paid</span><span>${esc(currency)} ${n2(job.paidAmount)}</span></div>` : ''}
    <div class="small">Please bring this slip when collecting.${company?.phone ? ` Enquiries: ${esc(company.phone)}` : ''}</div>
  </div>`
  return executePrint(`Job card ${job.jobNo}`, pageStyles(size), content)
}

/** Customer receipt (booking / advance, or the final bill once invoiced). */
export function printServiceJobReceipt(job: ServiceJobDoc, company: PrintCompanyInfo | null | undefined, currency: string, size: PaperSize = '80mm') {
  const content = `<div class="wrap">
    ${header(company, job.invoiceNo ? `Invoice ${job.invoiceNo}` : 'Job receipt')}
    <div class="no" style="text-align:center">${esc(job.jobNo)}</div>
    <div class="row"><span>Received</span><span>${esc(dt(job.receivedAt))}</span></div>
    <div class="row"><span><b>Ready by</b></span><span><b>${esc(dt(job.promisedAt))}</b></span></div>
    <div class="row"><span>Customer</span><span>${esc(job.customerName)}</span></div>
    ${job.customerPhone ? `<div class="row"><span>Phone</span><span>${esc(job.customerPhone)}</span></div>` : ''}
    <div class="small">${esc(job.title)}</div>
    ${job.jobType === 'repair' && (job.brand || job.model || job.imei || job.serialNumber) ? `<div class="small">${esc([job.brand, job.model].filter(Boolean).join(' '))} ${esc(job.imei || job.serialNumber || '')}</div>` : ''}
    ${linesTable(job, true)}
    ${totalsBlock(job, currency)}
    ${job.repairWarrantyUntil ? `<div class="box">Repair warranty${job.repairWarrantyDays ? ` (${job.repairWarrantyDays} days)` : ''} until <b>${esc(d(job.repairWarrantyUntil))}</b> on the work done and parts fitted.</div>` : ''}
    <div class="small" style="text-align:center;margin-top:6px">Please bring this receipt when collecting. Thank you!</div>
  </div>`
  return executePrint(`Receipt ${job.jobNo}`, pageStyles(size), content)
}

export interface WarrantyCardData {
  company: PrintCompanyInfo | null
  sale: { invoiceNo: string; saleDate: string; customerName: string | null; customerPhone: string | null; customerAddress: string | null; warehouseName: string | null }
  lines: Array<{
    itemName: string; quantity: number; warrantyMonths: number | null; warrantyUntil: string | null
    units: Array<{ serialNumber: string; imei: string | null; imei2: string | null; warrantyUntil: string | null }>
  }>
}

/** Warranty card: one card per serial-numbered unit (or per line without serials). */
export function printWarrantyCard(data: WarrantyCardData, size: PaperSize = 'a5', terms?: string) {
  const defaultTerms = 'Warranty covers manufacturing defects under normal use. It does not cover physical or liquid damage, burns from power surges, '
    + 'broken seals, unauthorised repairs or consumables. Bring this card and the invoice for any warranty claim.'
  const cards = data.lines.flatMap((l) => {
    const units = l.units.length ? l.units : [{ serialNumber: '', imei: null, imei2: null, warrantyUntil: l.warrantyUntil }]
    return units.map((u) => `
      <div style="page-break-inside:avoid;border:2px solid #000;padding:8px;margin-bottom:10px">
        ${header(data.company, 'Warranty Card')}
        <div class="big" style="margin:4px 0">${esc(l.itemName)}</div>
        <div class="grid">
          ${u.serialNumber ? `<div><b>Serial no:</b> ${esc(u.serialNumber)}</div>` : ''}
          ${u.imei ? `<div><b>IMEI:</b> ${esc(u.imei)}${u.imei2 ? ` / ${esc(u.imei2)}` : ''}</div>` : ''}
          <div><b>Invoice:</b> ${esc(data.sale.invoiceNo)}</div>
          <div><b>Sale date:</b> ${esc(d(data.sale.saleDate))}</div>
          <div><b>Customer:</b> ${esc(data.sale.customerName || 'Walk-in')}</div>
          ${data.sale.customerPhone ? `<div><b>Phone:</b> ${esc(data.sale.customerPhone)}</div>` : ''}
          ${l.warrantyMonths ? `<div><b>Period:</b> ${esc(l.warrantyMonths)} months</div>` : ''}
          <div class="big"><b>Valid until:</b> ${esc(u.warrantyUntil ? d(u.warrantyUntil) : '—')}</div>
        </div>
        <div class="small" style="margin-top:4px"><b>Terms:</b> ${esc(terms || defaultTerms)}</div>
        <div class="sig"><div>Customer</div><div>For ${esc(data.company?.name || 'the shop')}</div></div>
      </div>`)
  })
  const content = `<div class="wrap">${cards.join('') || '<p>No item on this sale has a warranty or a serial number.</p>'}</div>`
  return executePrint(`Warranty card ${data.sale.invoiceNo}`, pageStyles(size), content)
}
