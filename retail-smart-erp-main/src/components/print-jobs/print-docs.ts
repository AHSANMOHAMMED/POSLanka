'use client'

/**
 * Print job documents: the production ticket (big job no., sizes, material, finishing, due — no
 * prices) and the customer receipt (amounts, advances, balance). Printed through executePrint()
 * (hidden iframe, popup fallback) like the other documents.
 */
import { executePrint } from '@/lib/print/print-executor'
import { formatSize, AREA_UNIT_LABEL, LENGTH_UNIT_LABEL, type AreaUnit } from '@/lib/print-jobs/size-pricing'
import { PAYMENT_METHOD_LABELS, PRINT_JOB_STATUS_LABELS, PROOF_STATUS_LABELS } from '@/lib/print-jobs/constants'

export interface PrintDocJob {
  jobNo: string
  title: string
  status: string
  proofStatus: string
  proofNote: string | null
  customerName: string
  customerPhone: string | null
  receivedAt: string
  dueAt: string | null
  isUrgent: boolean
  assignedName: string | null
  warehouseName: string | null
  notes: string | null
  subtotal: string
  discountAmount: string
  taxAmount: string
  total: string
  paidAmount: string
  balanceDue: string
  invoiceNo?: string | null
  lines: Array<{
    description: string; pricingMode: string; width: string | null; height: string | null; sizeUnit: string | null; quantity: string
    material: string | null; sides: number; areaUnit: string | null; areaPerPiece: string | null; billableArea: string | null
    rate: string; baseAmount: string; finishing: Array<{ label: string; qty: number; rate: number; amount: number }>; amount: string; notes: string | null
  }>
  payments: Array<{ amount: string; paymentMethod: string; reference: string | null; createdAt: string; refundedAt: string | null }>
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n2 = (v: string | number) => (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const qty = (v: string) => String(Number(v) || 0)

function unitOf(l: PrintDocJob['lines'][number]) {
  const u = (l.areaUnit || 'sqft') as AreaUnit
  return l.pricingMode === 'length' ? LENGTH_UNIT_LABEL[u] : AREA_UNIT_LABEL[u]
}

export function printJobTicket(job: PrintDocJob, shopName: string) {
  const styles = `
    @page { margin: 8mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #000; padding-bottom: 6px; }
    .no { font-size: 40px; font-weight: 800; letter-spacing: 1px; line-height: 1; }
    .urgent { display: inline-block; background: #000; color: #fff; font-weight: 800; font-size: 20px; padding: 4px 10px; margin-top: 6px; }
    .due { font-size: 20px; font-weight: 700; text-align: right; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; font-size: 13px; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border: 1px solid #000; padding: 5px 6px; vertical-align: top; text-align: left; }
    th { background: #eee; font-size: 12px; text-transform: uppercase; }
    .size { font-size: 18px; font-weight: 700; white-space: nowrap; }
    .q { font-size: 18px; font-weight: 700; text-align: center; }
    .fin { font-size: 12px; margin: 2px 0 0; padding-left: 14px; }
    .box { border: 1px dashed #000; padding: 6px; margin-top: 8px; font-size: 13px; }
    .sig { display: flex; gap: 24px; margin-top: 18px; font-size: 12px; }
    .sig div { flex: 1; border-top: 1px solid #000; padding-top: 3px; }
  `
  const rows = job.lines.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><b>${esc(l.description)}</b>${l.notes ? `<div style="font-size:12px">${esc(l.notes)}</div>` : ''}
        ${l.finishing?.length ? `<ul class="fin">${l.finishing.map((f) => `<li>${esc(f.label)}${f.qty ? ` — ${esc(f.qty)}` : ''}</li>`).join('')}</ul>` : ''}</td>
      <td class="size">${esc(formatSize(l.width, l.height, l.sizeUnit) || '—')}</td>
      <td class="q">${esc(qty(l.quantity))}</td>
      <td>${l.sides > 1 ? '2' : '1'}</td>
      <td>${esc(l.material || '—')}</td>
      <td>${l.billableArea && l.pricingMode !== 'unit' ? `${esc(l.billableArea)} ${esc(unitOf(l))}` : l.areaPerPiece ? `${esc(l.areaPerPiece)} ${esc(AREA_UNIT_LABEL[(l.areaUnit || 'sqft') as AreaUnit])}/pc` : '—'}</td>
    </tr>`).join('')
  const content = `
    <div class="hdr">
      <div>
        <div style="font-size:12px">${esc(shopName)} · JOB TICKET</div>
        <div class="no">${esc(job.jobNo)}</div>
        ${job.isUrgent ? '<div class="urgent">URGENT</div>' : ''}
      </div>
      <div class="due">DUE<br/>${esc(dt(job.dueAt))}</div>
    </div>
    <div class="meta">
      <div><b>Job:</b> ${esc(job.title)}</div>
      <div><b>Customer:</b> ${esc(job.customerName)} ${job.customerPhone ? `· ${esc(job.customerPhone)}` : ''}</div>
      <div><b>Received:</b> ${esc(dt(job.receivedAt))}</div>
      <div><b>Designer / operator:</b> ${esc(job.assignedName || '—')}</div>
      <div><b>Status:</b> ${esc(PRINT_JOB_STATUS_LABELS[job.status] || job.status)}</div>
      <div><b>Proof:</b> ${esc(PROOF_STATUS_LABELS[job.proofStatus] || job.proofStatus)}${job.proofNote ? ` — ${esc(job.proofNote)}` : ''}</div>
      ${job.warehouseName ? `<div><b>Branch:</b> ${esc(job.warehouseName)}</div>` : ''}
    </div>
    <table>
      <thead><tr><th>#</th><th>Item / finishing</th><th>Size</th><th>Qty</th><th>Sides</th><th>Material</th><th>Area</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${job.notes ? `<div class="box"><b>Notes:</b> ${esc(job.notes)}</div>` : ''}
    <div class="sig"><div>Designed by</div><div>Printed by</div><div>Finished / QC</div></div>
  `
  return executePrint(`Job ticket ${job.jobNo}`, styles, content)
}

export function printJobReceipt(job: PrintDocJob, shopName: string, currency: string) {
  const styles = `
    @page { margin: 4mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; }
    .r { max-width: 78mm; margin: 0 auto; font-size: 12px; }
    h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
    .c { text-align: center; }
    .no { font-size: 20px; font-weight: 800; text-align: center; margin: 4px 0; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .ln { margin-bottom: 4px; }
    .sub { font-size: 11px; color: #222; }
    .big { font-size: 15px; font-weight: 800; }
  `
  const open = job.payments.filter((p) => !p.refundedAt)
  const lines = job.lines.map((l) => {
    const size = formatSize(l.width, l.height, l.sizeUnit)
    const detail = [size, `× ${qty(l.quantity)}`, l.pricingMode !== 'unit' && l.billableArea ? `${l.billableArea} ${unitOf(l)} @ ${n2(l.rate)}` : `@ ${n2(l.rate)}`].filter(Boolean).join(' ')
    const fin = (l.finishing || []).map((f) => `<div class="row sub"><span>+ ${esc(f.label)}</span><span>${n2(f.amount)}</span></div>`).join('')
    return `<div class="ln"><div class="row"><span><b>${esc(l.description)}</b></span><span>${n2(l.baseAmount)}</span></div><div class="sub">${esc(detail)}${l.material ? ` · ${esc(l.material)}` : ''}</div>${fin}</div>`
  }).join('')
  const content = `<div class="r">
    <h1>${esc(shopName)}</h1>
    <div class="c">${job.invoiceNo ? `Invoice ${esc(job.invoiceNo)}` : 'Order receipt'}</div>
    <div class="no">${esc(job.jobNo)}</div>
    <div class="row"><span>Received</span><span>${esc(dt(job.receivedAt))}</span></div>
    <div class="row"><span><b>Ready by</b></span><span><b>${esc(dt(job.dueAt))}</b></span></div>
    <div class="row"><span>Customer</span><span>${esc(job.customerName)}</span></div>
    ${job.customerPhone ? `<div class="row"><span>Phone</span><span>${esc(job.customerPhone)}</span></div>` : ''}
    <div class="sub">${esc(job.title)}</div>
    <hr/>${lines}<hr/>
    <div class="row"><span>Subtotal</span><span>${n2(job.subtotal)}</span></div>
    ${Number(job.discountAmount) > 0 ? `<div class="row"><span>Discount</span><span>-${n2(job.discountAmount)}</span></div>` : ''}
    ${Number(job.taxAmount) > 0 ? `<div class="row"><span>Tax</span><span>${n2(job.taxAmount)}</span></div>` : ''}
    <div class="row big"><span>Total (${esc(currency)})</span><span>${n2(job.total)}</span></div>
    ${open.map((p) => `<div class="row sub"><span>Advance · ${esc(PAYMENT_METHOD_LABELS[p.paymentMethod] || p.paymentMethod)} · ${esc(new Date(p.createdAt).toLocaleDateString())}</span><span>-${n2(p.amount)}</span></div>`).join('')}
    ${(() => {
      const atDelivery = (Number(job.paidAmount) || 0) - open.reduce((s, p) => s + (Number(p.amount) || 0), 0)
      return atDelivery > 0.004 ? `<div class="row sub"><span>Paid on delivery</span><span>-${n2(atDelivery)}</span></div>` : ''
    })()}
    <div class="row big"><span>Balance due</span><span>${n2(job.balanceDue)}</span></div>
    <hr/>
    <div class="c sub">Please bring this receipt when collecting your order.<br/>Thank you!</div>
  </div>`
  return executePrint(`Receipt ${job.jobNo}`, styles, content)
}
