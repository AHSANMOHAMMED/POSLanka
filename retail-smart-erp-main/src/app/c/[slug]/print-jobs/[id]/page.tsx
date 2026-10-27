'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ChevronLeft, Printer, Receipt, Pencil, Zap, Send, CheckCircle2, XCircle, MessageSquare, Truck, Ban, Trash2, Wallet, FileText, ArrowRight,
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { PrintJobForm, type PrintJobFormInitial } from '@/components/print-jobs/PrintJobForm'
import { printJobReceipt, printJobTicket, type PrintDocJob } from '@/components/print-jobs/print-docs'
import { formatSize, AREA_UNIT_LABEL, LENGTH_UNIT_LABEL, type AreaUnit } from '@/lib/print-jobs/size-pricing'
import {
  PAYMENT_METHOD_LABELS, PRINT_JOB_PIPELINE, PRINT_JOB_STATUS_COLORS, PRINT_JOB_STATUS_LABELS, PROOF_STATUS_COLORS, PROOF_STATUS_LABELS,
} from '@/lib/print-jobs/constants'

interface JobLine {
  id: string
  itemId: string | null
  itemName: string | null
  description: string
  pricingMode: 'unit' | 'area' | 'length'
  width: string | null
  height: string | null
  sizeUnit: 'inch' | 'ft' | 'cm' | 'mm' | 'm' | null
  quantity: string
  material: string | null
  sides: number
  areaUnit: AreaUnit | null
  areaPerPiece: string | null
  billableArea: string | null
  rate: string
  baseAmount: string
  finishing: Array<{ code: string; label: string; qty: number; rate: number; amount: number }>
  finishingAmount: string
  amount: string
  notes: string | null
}

interface Job {
  id: string
  jobNo: string
  title: string
  status: string
  proofStatus: string
  proofFiles: Array<{ url: string; name?: string | null; fileId?: string | null; addedAt?: string | null }>
  proofNote: string | null
  proofSentAt: string | null
  proofRespondedAt: string | null
  customerId: string | null
  customerName: string
  customerPhone: string | null
  warehouseId: string | null
  warehouseName: string | null
  receivedAt: string
  dueAt: string | null
  isUrgent: boolean
  assignedTo: string | null
  assignedName: string | null
  createdByName: string | null
  subtotal: string
  discountAmount: string
  taxAmount: string
  total: string
  paidAmount: string
  balanceDue: string
  notes: string | null
  saleId: string | null
  invoiceNo: string | null
  sale: { id: string; invoiceNo: string | null; total: string | null; paidAmount: string | null; status: string | null } | null
  deliveredAt: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  notifiedAt: string | null
  updatedAt: string
  lines: JobLine[]
  payments: Array<{ id: string; amount: string; paymentMethod: string; reference: string | null; receivedByName: string | null; refundedAt: string | null; createdAt: string }>
}

const inputCls = 'w-full h-9 px-2.5 text-sm rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
const btn = 'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-blue-500 disabled:opacity-50'
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = Array.isArray(data.details) ? data.details.map((d: { message?: string }) => d.message).filter(Boolean).join(', ') : ''
    throw Object.assign(new Error(detail || data.error || 'Request failed'), { code: data.code })
  }
  return data
}

export default function PrintJobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const id = params.id as string
  const { fCurrency, currency } = useCurrency()
  const { tenantName } = useCompany()

  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [pay, setPay] = useState({ amount: '', method: 'cash', reference: '' })
  const [invOpen, setInvOpen] = useState(false)
  const [inv, setInv] = useState({ method: 'cash', tendered: '', reference: '' })
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [changesOpen, setChangesOpen] = useState(false)
  const [changesNote, setChangesNote] = useState('')
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [notify, setNotify] = useState<{ sms: boolean; whatsapp: boolean; channel: 'sms' | 'whatsapp'; phone: string; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/print-jobs/${id}`)
      if (res.status === 404) { setJob(null); return }
      if (!res.ok) return
      setJob(await res.json())
    } finally {
      setLoading(false)
    }
  }, [id])
  useRealtimeData(load, { entityType: 'print-job', refreshOnMount: false })
  useEffect(() => { load() }, [load])

  if (loading) return <PageLoading text="Loading job..." />
  if (!job) {
    return (
      <div className="p-8 text-center text-gray-500">
        Job not found. <Link className="text-blue-600" href={`/c/${slug}/print-jobs`}>Back to print jobs</Link>
      </div>
    )
  }

  const open = !['delivered', 'cancelled'].includes(job.status) && !job.saleId
  const balance = parseFloat(job.balanceDue) || 0
  const activePayments = job.payments.filter((p) => !p.refundedAt)
  const pipeIdx = PRINT_JOB_PIPELINE.indexOf(job.status as (typeof PRINT_JOB_PIPELINE)[number])
  const nextStatus = open && pipeIdx >= 0 && pipeIdx < PRINT_JOB_PIPELINE.length - 2 ? PRINT_JOB_PIPELINE[pipeIdx + 1] : null
  const overdue = open && job.dueAt && new Date(job.dueAt).getTime() < Date.now()

  async function run<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(true)
    try {
      const r = await fn()
      if (ok) toast.success(ok)
      await load()
      return r
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const moveTo = (status: string, extra: Record<string, unknown> = {}, ok?: string) =>
    run(() => api(`/api/print-jobs/${id}/status`, 'POST', { status, ...extra }), ok || `Moved to ${PRINT_JOB_STATUS_LABELS[status]}`)

  async function openNotify() {
    try {
      const d = await api(`/api/print-jobs/${id}/notify`, 'GET')
      if (!d.sms && !d.whatsapp) { toast.error('SMS / WhatsApp is not set up for this business'); return }
      setNotify({ sms: d.sms, whatsapp: d.whatsapp, channel: d.sms ? 'sms' : 'whatsapp', phone: d.phone || '', text: d.text || '' })
      setNotifyOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Messaging is not available')
    }
  }

  const docJob: PrintDocJob = { ...job, invoiceNo: job.invoiceNo, lines: job.lines, payments: job.payments }

  if (editing) {
    const initial: PrintJobFormInitial = {
      id: job.id, updatedAt: job.updatedAt, customerId: job.customerId, customerName: job.customerName, customerPhone: job.customerPhone,
      title: job.title, warehouseId: job.warehouseId, receivedAt: job.receivedAt, dueAt: job.dueAt, isUrgent: job.isUrgent,
      assignedTo: job.assignedTo, discountAmount: job.discountAmount, notes: job.notes, proofStatus: job.proofStatus,
      proofFiles: job.proofFiles || [], proofNote: job.proofNote,
      lines: job.lines.map((l) => ({ ...l, itemName: l.itemName })),
    }
    return (
      <div className="max-w-6xl mx-auto space-y-3">
        <button onClick={() => setEditing(false)} className="flex items-center text-sm text-gray-500 hover:text-blue-600"><ChevronLeft size={16} /> Back to job</button>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Edit {job.jobNo}</h1>
        <PrintJobForm slug={slug} initial={initial} />
      </div>
    )
  }

  const tendered = parseFloat(inv.tendered) || 0
  const change = inv.method === 'cash' ? Math.max(0, tendered - balance) : 0

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <Link href={`/c/${slug}/print-jobs`} className="flex items-center text-sm text-gray-500 hover:text-blue-600"><ChevronLeft size={16} /> Print jobs</Link>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{job.jobNo}</h1>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${PRINT_JOB_STATUS_COLORS[job.status]}`}>{PRINT_JOB_STATUS_LABELS[job.status]}</span>
              {job.isUrgent && open && <span className="flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-full bg-red-600 text-white"><Zap size={12} /> URGENT</span>}
            </div>
            <div className="text-gray-700 dark:text-gray-300 mt-1">{job.title}</div>
            <div className="text-sm text-gray-500 mt-1">
              {job.customerName}{job.customerPhone ? ` · ${job.customerPhone}` : ''}{job.customerId ? ' · saved customer' : ''}
            </div>
          </div>
          <div className="text-right text-sm space-y-0.5">
            <div className={overdue ? 'text-red-600 font-semibold' : 'text-gray-700 dark:text-gray-200 font-medium'}>Due: {dt(job.dueAt)}{overdue ? ' (overdue)' : ''}</div>
            <div className="text-gray-500">Received: {dt(job.receivedAt)}</div>
            <div className="text-gray-500">Designer / operator: {job.assignedName || '—'}</div>
            {job.warehouseName && <div className="text-gray-500">Branch: {job.warehouseName}</div>}
          </div>
        </div>

        {/* Pipeline */}
        <div className="flex flex-wrap gap-1 mt-4">
          {PRINT_JOB_PIPELINE.map((s, i) => {
            const done = job.status !== 'cancelled' && pipeIdx >= i
            const current = job.status === s
            const clickable = open && s !== 'delivered' && !current
            return (
              <button
                key={s}
                disabled={!clickable || busy}
                onClick={() => moveTo(s)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${current ? 'bg-blue-600 border-blue-600 text-white font-semibold' : done ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 text-gray-500'} ${clickable ? 'hover:border-blue-500 cursor-pointer' : 'cursor-default'}`}
              >
                {i + 1}. {PRINT_JOB_STATUS_LABELS[s]}
              </button>
            )
          })}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-4">
          {nextStatus && (
            <button disabled={busy} onClick={() => moveTo(nextStatus)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              <ArrowRight size={14} /> {PRINT_JOB_STATUS_LABELS[nextStatus]}
            </button>
          )}
          {open && (
            <button disabled={busy} onClick={() => { setInv({ method: 'cash', tendered: balance > 0 ? balance.toFixed(2) : '', reference: '' }); setInvOpen(true) }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              <Truck size={14} /> Mark delivered &amp; invoice
            </button>
          )}
          {open && balance > 0 && <button disabled={busy} className={btn} onClick={() => { setPay({ amount: '', method: 'cash', reference: '' }); setPayOpen(true) }}><Wallet size={14} /> Take advance</button>}
          <button className={btn} onClick={() => printJobTicket(docJob, tenantName)}><Printer size={14} /> Job ticket</button>
          <button className={btn} onClick={() => printJobReceipt(docJob, tenantName, currency)}><Receipt size={14} /> Receipt</button>
          {job.status !== 'cancelled' && <button className={btn} onClick={openNotify}><MessageSquare size={14} /> Notify: job ready</button>}
          {open && <button className={btn} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
          {open && <button className={`${btn} text-red-600`} onClick={() => { setCancelReason(''); setCancelOpen(true) }}><Ban size={14} /> Cancel job</button>}
          {open && job.payments.length === 0 && (
            <button
              className={`${btn} text-red-600`}
              onClick={async () => {
                if (!window.confirm(`Delete ${job.jobNo}? This cannot be undone.`)) return
                const ok = await run(() => api(`/api/print-jobs/${id}`, 'DELETE'), 'Job deleted')
                if (ok) router.push(`/c/${slug}/print-jobs`)
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
          {job.saleId && (
            <Link href={`/c/${slug}/sales/${job.saleId}`} className={btn}><FileText size={14} /> Invoice {job.invoiceNo}</Link>
          )}
        </div>
        {job.status === 'cancelled' && (
          <div className="mt-3 text-sm text-red-600">Cancelled {dt(job.cancelledAt)}{job.cancellationReason ? ` — ${job.cancellationReason}` : ''}</div>
        )}
        {job.notifiedAt && <div className="mt-2 text-xs text-gray-500">Customer notified {dt(job.notifiedAt)}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lines */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Billable</th>
                <th className="px-3 py-2 font-medium text-right">Rate</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {job.lines.map((l) => {
                const u = (l.areaUnit || 'sqft') as AreaUnit
                return (
                  <tr key={l.id} className="border-t dark:border-gray-700 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900 dark:text-white">{l.description}</div>
                      <div className="text-xs text-gray-500">
                        {[l.material, l.sides > 1 ? '2-sided' : null, l.itemName && l.itemName !== l.description ? l.itemName : null].filter(Boolean).join(' · ')}
                      </div>
                      {l.finishing?.map((f, i) => (
                        <div key={i} className="text-xs text-gray-600 dark:text-gray-400">+ {f.label}: {f.qty} × {f.rate} = {f.amount.toFixed(2)}</div>
                      ))}
                      {l.notes && <div className="text-xs italic text-gray-500">{l.notes}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatSize(l.width, l.height, l.sizeUnit) || '—'}</td>
                    <td className="px-3 py-2 text-right">{parseFloat(l.quantity)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {l.pricingMode !== 'unit' && l.billableArea ? `${l.billableArea} ${l.pricingMode === 'length' ? LENGTH_UNIT_LABEL[u] : AREA_UNIT_LABEL[u]}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">{parseFloat(l.rate).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fCurrency(l.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {job.notes && <div className="border-t dark:border-gray-700 p-3 text-sm text-gray-600 dark:text-gray-300"><b>Notes:</b> {job.notes}</div>}
        </div>

        <div className="space-y-4">
          {/* Money */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{fCurrency(job.subtotal)}</span></div>
            {parseFloat(job.discountAmount) > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span>-{fCurrency(job.discountAmount)}</span></div>}
            {parseFloat(job.taxAmount) > 0 && <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>{fCurrency(job.taxAmount)}</span></div>}
            <div className="flex justify-between font-semibold text-base border-t dark:border-gray-700 pt-1.5"><span>Total</span><span>{fCurrency(job.total)}</span></div>
            <div className="flex justify-between text-green-700 dark:text-green-400"><span>Paid</span><span>{fCurrency(job.paidAmount)}</span></div>
            <div className={`flex justify-between font-semibold ${balance > 0 ? 'text-orange-600' : 'text-green-600'}`}><span>Balance due</span><span>{fCurrency(job.balanceDue)}</span></div>
            {job.payments.length > 0 && (
              <div className="border-t dark:border-gray-700 pt-2 mt-2 space-y-1">
                <div className="text-xs font-medium text-gray-500">Advances</div>
                {job.payments.map((p) => (
                  <div key={p.id} className={`flex justify-between text-xs ${p.refundedAt ? 'line-through text-gray-400' : ''}`}>
                    <span>{new Date(p.createdAt).toLocaleDateString()} · {PAYMENT_METHOD_LABELS[p.paymentMethod] || p.paymentMethod}{p.reference ? ` · ${p.reference}` : ''}{p.refundedAt ? ' (refunded)' : ''}</span>
                    <span>{fCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Proof */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-800 dark:text-gray-100">Design proof</span>
              <span className={`text-xs font-medium ${PROOF_STATUS_COLORS[job.proofStatus]}`}>{PROOF_STATUS_LABELS[job.proofStatus]}</span>
            </div>
            {job.proofFiles?.length ? (
              <ul className="space-y-1">
                {job.proofFiles.map((f, i) => (
                  <li key={i}><a className="text-blue-600 dark:text-blue-400 hover:underline break-all" href={f.url} target="_blank" rel="noreferrer">{f.name || f.url}</a></li>
                ))}
              </ul>
            ) : <div className="text-xs text-gray-500">No files attached{open ? ' — use Edit to upload or link the design.' : ''}</div>}
            {job.proofNote && <div className="text-xs text-gray-600 dark:text-gray-300">Note: {job.proofNote}</div>}
            {(job.proofSentAt || job.proofRespondedAt) && (
              <div className="text-xs text-gray-500">{job.proofSentAt ? `Sent ${dt(job.proofSentAt)}` : ''}{job.proofRespondedAt ? ` · Answered ${dt(job.proofRespondedAt)}` : ''}</div>
            )}
            {open && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button disabled={busy} className={btn} onClick={() => moveTo('proof_sent', { proofStatus: 'sent' }, 'Proof marked as sent')}><Send size={14} /> Proof sent</button>
                <button disabled={busy} className={btn} onClick={() => moveTo('approved', { proofStatus: 'approved' }, 'Proof approved')}><CheckCircle2 size={14} className="text-green-600" /> Approved</button>
                <button disabled={busy} className={btn} onClick={() => { setChangesNote(''); setChangesOpen(true) }}><XCircle size={14} className="text-red-600" /> Changes</button>
              </div>
            )}
          </div>
          <div className="text-xs text-gray-400">Booked by {job.createdByName || '—'}</div>
        </div>
      </div>

      {/* Take advance */}
      <Modal isOpen={payOpen} onClose={() => setPayOpen(false)} title={`Advance for ${job.jobNo}`} size="sm"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setPayOpen(false)}>Cancel</button>
          <button disabled={busy || !(parseFloat(pay.amount) > 0)} className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
            onClick={async () => {
              const r = await run(() => api(`/api/print-jobs/${id}/payments`, 'POST', { amount: parseFloat(pay.amount), paymentMethod: pay.method, reference: pay.reference || undefined }), 'Payment recorded')
              if (r) setPayOpen(false)
            }}>Record</button>
        </div>}
      >
        <div className="space-y-3">
          <div className="text-sm text-gray-600 dark:text-gray-300">Balance due: <b>{fCurrency(balance)}</b></div>
          <input type="number" min={0} step="0.01" className={inputCls} placeholder="Amount" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} autoFocus />
          <div className="flex gap-1">
            {[50, 100].map((pct) => <button key={pct} className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600" onClick={() => setPay({ ...pay, amount: (Math.round(balance * pct) / 100).toFixed(2) })}>{pct}%</button>)}
          </div>
          <select className={inputCls} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option>
          </select>
          <input className={inputCls} placeholder="Reference (optional)" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
        </div>
      </Modal>

      {/* Deliver & invoice */}
      <Modal isOpen={invOpen} onClose={() => setInvOpen(false)} title={`Deliver & invoice ${job.jobNo}`} size="sm"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setInvOpen(false)}>Cancel</button>
          <button disabled={busy} className="px-4 py-1.5 text-sm rounded bg-green-600 text-white disabled:opacity-50"
            onClick={async () => {
              const r = await run(() => api(`/api/print-jobs/${id}/invoice`, 'POST', {
                expectedUpdatedAt: job.updatedAt,
                paymentMethod: inv.method,
                paidAmount: inv.method === 'credit' ? 0 : Math.min(tendered, balance),
                reference: inv.reference || undefined,
              }), 'Delivered and invoiced')
              if (r) setInvOpen(false)
            }}>Deliver &amp; invoice</button>
        </div>}
      >
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span>Total</span><b>{fCurrency(job.total)}</b></div>
          <div className="flex justify-between"><span>Advances</span><span>-{fCurrency(activePayments.reduce((s, p) => s + parseFloat(p.amount), 0))}</span></div>
          <div className="flex justify-between text-base"><span>Balance to collect</span><b>{fCurrency(balance)}</b></div>
          {balance > 0 && (
            <>
              <select className={inputCls} value={inv.method} onChange={(e) => setInv({ ...inv, method: e.target.value })}>
                <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option>
                {job.customerId && <option value="credit">On account (customer credit)</option>}
              </select>
              {inv.method !== 'credit' && (
                <>
                  <input type="number" min={0} step="0.01" className={inputCls} placeholder={inv.method === 'cash' ? 'Cash received' : 'Amount'} value={inv.tendered} onChange={(e) => setInv({ ...inv, tendered: e.target.value })} />
                  {inv.method !== 'cash' && <input className={inputCls} placeholder="Reference (optional)" value={inv.reference} onChange={(e) => setInv({ ...inv, reference: e.target.value })} />}
                  {change > 0 && <div className="flex justify-between text-green-700"><span>Change</span><b>{fCurrency(change)}</b></div>}
                  {tendered < balance && <div className="text-xs text-orange-600">{fCurrency(balance - tendered)} will stay unpaid on the invoice.</div>}
                </>
              )}
            </>
          )}
          <p className="text-xs text-gray-500">Creates the sales invoice (advances included), moves stock for stock-tracked media and marks the job delivered.</p>
        </div>
      </Modal>

      {/* Cancel */}
      <Modal isOpen={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel ${job.jobNo}`} size="sm"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setCancelOpen(false)}>Keep job</button>
          <button disabled={busy} className="px-4 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-50"
            onClick={async () => {
              const r = await run(() => api(`/api/print-jobs/${id}/status`, 'POST', { status: 'cancelled', cancellationReason: cancelReason || undefined, refundAdvances: activePayments.length > 0 }), 'Job cancelled')
              if (r) setCancelOpen(false)
            }}>Cancel job</button>
        </div>}
      >
        <div className="space-y-3 text-sm">
          <input className={inputCls} placeholder="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          {activePayments.length > 0 && (
            <div className="rounded bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 p-2">
              Refund {fCurrency(activePayments.reduce((s, p) => s + parseFloat(p.amount), 0))} of advances to the customer — the advance postings are reversed.
            </div>
          )}
        </div>
      </Modal>

      {/* Changes requested */}
      <Modal isOpen={changesOpen} onClose={() => setChangesOpen(false)} title="Customer requested changes" size="sm"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setChangesOpen(false)}>Cancel</button>
          <button disabled={busy} className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
            onClick={async () => {
              const r = await moveTo('designing', { proofStatus: 'changes_requested', proofNote: changesNote || undefined }, 'Back to design')
              if (r) setChangesOpen(false)
            }}>Save &amp; back to design</button>
        </div>}
      >
        <textarea className={`${inputCls} h-24 py-2`} placeholder="What should change?" value={changesNote} onChange={(e) => setChangesNote(e.target.value)} autoFocus />
      </Modal>

      {/* Notify */}
      <Modal isOpen={notifyOpen && !!notify} onClose={() => setNotifyOpen(false)} title="Notify customer: job ready" size="md"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setNotifyOpen(false)}>Cancel</button>
          <button disabled={busy || !notify} className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
            onClick={async () => {
              if (!notify) return
              const r = await run(() => api(`/api/print-jobs/${id}/notify`, 'POST', { channel: notify.channel, phone: notify.phone || undefined, text: notify.text || undefined }), 'Message sent')
              if (r) setNotifyOpen(false)
            }}>Send</button>
        </div>}
      >
        {notify && (
          <div className="space-y-3 text-sm">
            <div className="flex gap-2">
              {notify.sms && <label className="flex items-center gap-1"><input type="radio" checked={notify.channel === 'sms'} onChange={() => setNotify({ ...notify, channel: 'sms' })} /> SMS</label>}
              {notify.whatsapp && <label className="flex items-center gap-1"><input type="radio" checked={notify.channel === 'whatsapp'} onChange={() => setNotify({ ...notify, channel: 'whatsapp' })} /> WhatsApp</label>}
            </div>
            <input className={inputCls} value={notify.phone} onChange={(e) => setNotify({ ...notify, phone: e.target.value })} placeholder="07X XXX XXXX" />
            <textarea className={`${inputCls} h-28 py-2`} maxLength={640} value={notify.text} onChange={(e) => setNotify({ ...notify, text: e.target.value })} />
          </div>
        )}
      </Modal>
    </div>
  )
}
