'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ChevronLeft, Printer, Receipt, Pencil, Zap, CheckCircle2, XCircle, MessageSquare, Truck, Ban, Trash2, Wallet, FileText, ArrowRight,
  ShieldCheck, ShieldAlert, Eye, EyeOff, KeyRound,
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency, usePermission } from '@/hooks'
import { useBusinessScope, serviceJobBusinessType } from '@/hooks/useBusinessScope'
import { ServiceJobForm, type ServiceJobFormInitial } from '@/components/service-jobs/ServiceJobForm'
import { PAPER_SIZES, printServiceJobCard, printServiceJobReceipt, type PaperSize, type PrintCompanyInfo, type ServiceJobDoc } from '@/components/service-jobs/print-docs'
import {
  ESTIMATE_STATUS_LABELS, LINE_TYPE_LABELS, PAYMENT_METHOD_LABELS, SERVICE_JOB_PIPELINE, SERVICE_JOB_STATUS_COLORS, serviceJobStatusLabel, serviceJobTerms,
} from '@/lib/service-jobs/constants'

interface Job extends Omit<ServiceJobDoc, 'lines' | 'payments'> {
  id: string
  customerId: string | null
  warehouseId: string | null
  assignedTo: string | null
  createdByName: string | null
  hasPasscode: boolean
  canSeePasscode: boolean
  passcode: string | null
  estimateRespondedAt: string | null
  saleId: string | null
  invoiceNo: string | null
  warrantyInvoiceNo: string | null
  warrantySaleId: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  notifiedAt: string | null
  updatedAt: string
  company: PrintCompanyInfo | null
  lines: Array<ServiceJobDoc['lines'][number] & { id: string; itemId: string | null; itemName: string | null; itemUnit: string | null; lineType: 'part' | 'labour' | 'other' }>
  payments: Array<ServiceJobDoc['payments'][number] & { id: string; receivedByName: string | null }>
  history: Array<{ id: string; fromStatus: string | null; toStatus: string | null; note: string | null; changedByName: string | null; createdAt: string }>
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

export default function ServiceJobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const id = params.id as string
  const { fCurrency, currency } = useCurrency()
  // A mall uses the words of its service-job department (electronics repairs, tailoring …)
  const businessType = serviceJobBusinessType(useBusinessScope())
  const terms = serviceJobTerms(businessType)
  const canCreateSales = usePermission('createSales')
  const canManageSales = usePermission('manageSales')
  const canMoney = canCreateSales || canManageSales

  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [paper, setPaper] = useState<PaperSize>('a4')
  const [showPass, setShowPass] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [pay, setPay] = useState({ amount: '', method: 'cash', reference: '' })
  const [invOpen, setInvOpen] = useState(false)
  const [inv, setInv] = useState({ method: 'cash', tendered: '', reference: '', warrantyDays: '' })
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [notify, setNotify] = useState<{ sms: boolean; whatsapp: boolean; channel: 'sms' | 'whatsapp'; phone: string; text: string } | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/service-jobs/${id}`)
      if (res.status === 404) { setJob(null); return }
      if (!res.ok) return
      setJob(await res.json())
    } finally {
      setLoading(false)
    }
  }, [id])
  useRealtimeData(load, { entityType: 'service-job', refreshOnMount: false })
  useEffect(() => { load() }, [load])

  if (loading) return <PageLoading text="Loading job..." />
  if (!job) {
    return (
      <div className="p-8 text-center text-gray-500">
        Job not found. <Link className="text-blue-600" href={`/c/${slug}/service-jobs`}>Back to {terms.many.toLowerCase()}</Link>
      </div>
    )
  }

  const kind = job.jobType
  const open = !['delivered', 'cancelled'].includes(job.status) && !job.saleId
  const balance = parseFloat(job.balanceDue) || 0
  const total = parseFloat(job.total) || 0
  const paid = parseFloat(job.paidAmount) || 0
  const advanceRoom = Math.max(0, Math.max(total, parseFloat(job.estimateAmount || '0') || 0) - paid)
  const activePayments = job.payments.filter((p) => !p.refundedAt)
  const pipeIdx = SERVICE_JOB_PIPELINE.indexOf(job.status as (typeof SERVICE_JOB_PIPELINE)[number])
  const nextStatus = open && pipeIdx >= 0 && pipeIdx < SERVICE_JOB_PIPELINE.length - 2 ? SERVICE_JOB_PIPELINE[pipeIdx + 1] : null
  const overdue = open && job.promisedAt && new Date(job.promisedAt).getTime() < Date.now()
  const assigneeLabel = kind === 'tailoring' ? 'Tailor' : kind === 'service' ? 'Assigned to' : 'Technician'

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
    run(() => api(`/api/service-jobs/${id}/status`, 'POST', { status, ...extra }), ok || `Moved to ${serviceJobStatusLabel(status, kind)}`)

  async function openNotify() {
    try {
      const d = await api(`/api/service-jobs/${id}/notify`, 'GET')
      if (!d.sms && !d.whatsapp) { toast.error('SMS / WhatsApp is not set up for this business'); return }
      setNotify({ sms: d.sms, whatsapp: d.whatsapp, channel: d.sms ? 'sms' : 'whatsapp', phone: d.phone || '', text: d.text || '' })
      setNotifyOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Messaging is not available')
    }
  }

  const doc: ServiceJobDoc = { ...job, lines: job.lines, payments: job.payments }

  if (editing) {
    const initial: ServiceJobFormInitial = {
      id: job.id, updatedAt: job.updatedAt, jobType: job.jobType, customerId: job.customerId, customerName: job.customerName,
      customerPhone: job.customerPhone, title: job.title, warehouseId: job.warehouseId, receivedAt: job.receivedAt, promisedAt: job.promisedAt,
      isUrgent: job.isUrgent, assignedTo: job.assignedTo, deviceType: job.deviceType, brand: job.brand, model: job.model,
      serialNumber: job.serialNumber, imei: job.imei, imei2: job.imei2, hasPasscode: job.hasPasscode, passcode: job.passcode,
      faultReported: job.faultReported, accessoriesReceived: job.accessoriesReceived, conditionChecklist: job.conditionChecklist || [],
      conditionNotes: job.conditionNotes, diagnosis: job.diagnosis, workDone: job.workDone, garment: job.garment,
      measurements: job.measurements || {}, fabricSupplied: job.fabricSupplied, fittingDate: job.fittingDate,
      estimateAmount: job.estimateAmount, repairWarrantyDays: job.repairWarrantyDays, discountAmount: job.discountAmount, notes: job.notes,
      lines: job.lines.map((l) => ({ lineType: l.lineType, itemId: l.itemId, itemName: l.itemName, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, notes: l.notes })),
    }
    return (
      <div className="max-w-6xl mx-auto space-y-3">
        <button onClick={() => setEditing(false)} className="flex items-center text-sm text-gray-500 hover:text-blue-600"><ChevronLeft size={16} /> Back to job</button>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Edit {job.jobNo}</h1>
        <ServiceJobForm slug={slug} initial={initial} />
      </div>
    )
  }

  const tendered = parseFloat(inv.tendered) || 0
  const change = inv.method === 'cash' ? Math.max(0, tendered - balance) : 0
  const measurements = Object.entries(job.measurements || {})

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <Link href={`/c/${slug}/service-jobs`} className="flex items-center text-sm text-gray-500 hover:text-blue-600"><ChevronLeft size={16} /> {terms.many}</Link>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{job.jobNo}</h1>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${SERVICE_JOB_STATUS_COLORS[job.status]}`}>{serviceJobStatusLabel(job.status, kind)}</span>
              {job.isUrgent && open && <span className="flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-full bg-red-600 text-white"><Zap size={12} /> URGENT</span>}
              {kind === 'repair' && job.underWarranty && <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><ShieldCheck size={12} /> Under warranty</span>}
              {job.estimateStatus !== 'none' && <span className="text-xs text-amber-700 dark:text-amber-300">{ESTIMATE_STATUS_LABELS[job.estimateStatus]}{job.estimateAmount ? `: ${fCurrency(job.estimateAmount)}` : ''}</span>}
            </div>
            <div className="text-gray-700 dark:text-gray-300 mt-1">{job.title}</div>
            <div className="text-sm text-gray-500 mt-1">{job.customerName}{job.customerPhone ? ` · ${job.customerPhone}` : ''}{job.customerId ? ' · saved customer' : ''}</div>
          </div>
          <div className="text-right text-sm space-y-0.5">
            <div className={overdue ? 'text-red-600 font-semibold' : 'text-gray-700 dark:text-gray-200 font-medium'}>{kind === 'service' ? 'Due' : 'Promised'}: {dt(job.promisedAt)}{overdue ? ' (overdue)' : ''}</div>
            <div className="text-gray-500">Received: {dt(job.receivedAt)}</div>
            <div className="text-gray-500">{assigneeLabel}: {job.assignedName || '—'}</div>
            {job.warehouseName && <div className="text-gray-500">Branch: {job.warehouseName}</div>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-4">
          {SERVICE_JOB_PIPELINE.map((s, i) => {
            const done = job.status !== 'cancelled' && pipeIdx >= i
            const current = job.status === s
            const clickable = open && s !== 'delivered' && !current
            return (
              <button key={s} disabled={!clickable || busy} onClick={() => moveTo(s)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${current ? 'bg-blue-600 border-blue-600 text-white font-semibold' : done ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 text-gray-500'} ${clickable ? 'hover:border-blue-500 cursor-pointer' : 'cursor-default'}`}>
                {i + 1}. {serviceJobStatusLabel(s, kind)}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {nextStatus && (
            <button disabled={busy} onClick={() => moveTo(nextStatus)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              <ArrowRight size={14} /> {serviceJobStatusLabel(nextStatus, kind)}
            </button>
          )}
          {open && job.estimateStatus === 'pending' && (
            <>
              <button disabled={busy} className={btn} onClick={() => moveTo('in_progress', { estimateStatus: 'approved' }, 'Estimate approved')}><CheckCircle2 size={14} className="text-green-600" /> Customer approved</button>
              <button disabled={busy} className={btn} onClick={() => moveTo('ready', { estimateStatus: 'declined', note: 'Return without repair' }, 'Estimate declined — ready to return')}><XCircle size={14} className="text-red-600" /> Declined</button>
            </>
          )}
          {open && canMoney && (
            <button disabled={busy} onClick={() => { setInv({ method: 'cash', tendered: balance > 0 ? balance.toFixed(2) : '', reference: '', warrantyDays: job.repairWarrantyDays != null ? String(job.repairWarrantyDays) : '' }); setInvOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              <Truck size={14} /> Deliver &amp; invoice
            </button>
          )}
          {open && canMoney && advanceRoom > 0 && <button disabled={busy} className={btn} onClick={() => { setPay({ amount: '', method: 'cash', reference: '' }); setPayOpen(true) }}><Wallet size={14} /> Take advance</button>}
          <span className="flex items-center gap-1">
            <select aria-label="Paper size" className="h-8 px-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
              {PAPER_SIZES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button className={btn} onClick={() => printServiceJobCard(doc, job.company, currency, paper)}><Printer size={14} /> Job card</button>
            <button className={btn} onClick={() => printServiceJobReceipt(doc, job.company, currency, paper)}><Receipt size={14} /> Receipt</button>
          </span>
          {job.status !== 'cancelled' && <button className={btn} onClick={openNotify}><MessageSquare size={14} /> Notify: ready</button>}
          {open && <button className={btn} onClick={() => { setNote(''); setNoteOpen(true) }}><Pencil size={14} /> Add note</button>}
          {open && <button className={btn} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
          {open && <button className={`${btn} text-red-600`} onClick={() => { setCancelReason(''); setCancelOpen(true) }}><Ban size={14} /> Cancel</button>}
          {open && job.payments.length === 0 && canMoney && (
            <button className={`${btn} text-red-600`} onClick={async () => {
              if (!window.confirm(`Delete ${job.jobNo}? This cannot be undone.`)) return
              const ok = await run(() => api(`/api/service-jobs/${id}`, 'DELETE'), 'Job deleted')
              if (ok) router.push(`/c/${slug}/service-jobs`)
            }}><Trash2 size={14} /> Delete</button>
          )}
          {job.saleId && <Link href={`/c/${slug}/sales/${job.saleId}`} className={btn}><FileText size={14} /> Invoice {job.invoiceNo}</Link>}
        </div>
        {job.status === 'cancelled' && <div className="mt-3 text-sm text-red-600">Cancelled {dt(job.cancelledAt)}{job.cancellationReason ? ` — ${job.cancellationReason}` : ''}</div>}
        {job.repairWarrantyUntil && <div className="mt-2 text-sm text-green-700 dark:text-green-400">Repair warranty until {job.repairWarrantyUntil}{job.repairWarrantyDays ? ` (${job.repairWarrantyDays} days)` : ''}</div>}
        {job.notifiedAt && <div className="mt-2 text-xs text-gray-500">Customer notified {dt(job.notifiedAt)}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {kind === 'repair' && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm space-y-2">
              <div className="font-semibold text-gray-800 dark:text-gray-100">Device</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                <div><span className="text-gray-500">Device:</span> {[job.deviceType, job.brand, job.model].filter(Boolean).join(' · ') || '—'}</div>
                <div><span className="text-gray-500">Serial:</span> <span className="font-mono">{job.serialNumber || '—'}</span></div>
                {job.imei && <div><span className="text-gray-500">IMEI:</span> <span className="font-mono">{job.imei}{job.imei2 ? ` / ${job.imei2}` : ''}</span></div>}
                <div>
                  <span className="text-gray-500">Warranty:</span>{' '}
                  {job.warrantyUntil
                    ? (job.underWarranty
                      ? <span className="text-green-700 dark:text-green-400"><ShieldCheck size={12} className="inline" /> until {job.warrantyUntil}</span>
                      : <span className="text-amber-700"><ShieldAlert size={12} className="inline" /> ended {job.warrantyUntil}</span>)
                    : 'not on record'}
                  {job.warrantySaleId && job.warrantyInvoiceNo && <> · <Link className="text-blue-600" href={`/c/${slug}/sales/${job.warrantySaleId}`}>{job.warrantyInvoiceNo}</Link></>}
                </div>
                <div className="flex items-center gap-1">
                  <KeyRound size={12} className="text-gray-500" /><span className="text-gray-500">Passcode:</span>{' '}
                  {!job.hasPasscode ? 'none' : job.canSeePasscode ? (
                    <>
                      <span className="font-mono">{showPass ? job.passcode : '••••••'}</span>
                      <button onClick={() => setShowPass((s) => !s)} className="text-gray-400" aria-label="Show passcode">{showPass ? <EyeOff size={12} /> : <Eye size={12} />}</button>
                    </>
                  ) : 'saved (hidden)'}
                </div>
              </div>
              {job.faultReported && <div><span className="text-gray-500">Fault reported:</span> {job.faultReported}</div>}
              <div><span className="text-gray-500">Accessories:</span> {job.accessoriesReceived || 'none'}</div>
              {(job.conditionChecklist?.length || job.conditionNotes) ? (
                <div>
                  <span className="text-gray-500">Condition:</span>{' '}
                  {(job.conditionChecklist || []).map((c) => (
                    <span key={c.label} className={`inline-block mr-1.5 mb-1 px-1.5 py-0.5 text-[11px] rounded ${c.ok === false ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-gray-100 dark:bg-gray-700'}`}>{c.label}: {c.ok === true ? 'OK' : c.ok === false ? 'No' : '–'}</span>
                  ))}
                  {job.conditionNotes && <div className="text-xs">{job.conditionNotes}</div>}
                </div>
              ) : null}
              {job.diagnosis && <div><span className="text-gray-500">Diagnosis:</span> {job.diagnosis}</div>}
              {job.workDone && <div><span className="text-gray-500">Work done:</span> {job.workDone}</div>}
            </div>
          )}
          {kind === 'tailoring' && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm space-y-2">
              <div className="font-semibold text-gray-800 dark:text-gray-100">Garment</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><span className="text-gray-500">Garment:</span> {job.garment || '—'}</div>
                <div><span className="text-gray-500">Fabric:</span> {job.fabricSupplied ? 'supplied by customer' : 'from shop'}</div>
                <div><span className="text-gray-500">Trial / fitting:</span> {job.fittingDate || '—'}</div>
              </div>
              {measurements.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {measurements.map(([k, v]) => <div key={k} className="rounded bg-gray-50 dark:bg-gray-700 px-2 py-1"><div className="text-[11px] text-gray-500">{k}</div><div className="font-semibold">{v}</div></div>)}
                </div>
              )}
              {job.workDone && <div><span className="text-gray-500">Work done:</span> {job.workDone}</div>}
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Charge</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium text-right">Qty</th>
                  <th className="px-3 py-2 font-medium text-right">Price</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {job.lines.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">No charges yet{open ? ' — use Edit to add parts and labour.' : ''}</td></tr>
                ) : job.lines.map((l) => (
                  <tr key={l.id} className="border-t dark:border-gray-700 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900 dark:text-white">{l.description}</div>
                      {l.itemName && l.itemName !== l.description && <div className="text-xs text-gray-500">{l.itemName}</div>}
                      {l.notes && <div className="text-xs italic text-gray-500">{l.notes}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{LINE_TYPE_LABELS[l.lineType] || l.lineType}{l.itemId ? ' (stock)' : ''}</td>
                    <td className="px-3 py-2 text-right">{parseFloat(l.quantity)}{l.itemUnit ? ` ${l.itemUnit}` : ''}</td>
                    <td className="px-3 py-2 text-right">{parseFloat(l.unitPrice).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fCurrency(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {job.notes && <div className="border-t dark:border-gray-700 p-3 text-sm text-gray-600 dark:text-gray-300"><b>Notes:</b> {job.notes}</div>}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm">
            <div className="font-semibold text-gray-800 dark:text-gray-100 mb-2">History</div>
            <ol className="space-y-1.5">
              {job.history.map((h) => (
                <li key={h.id} className="flex gap-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap w-36">{dt(h.createdAt)}</span>
                  <span>
                    {h.toStatus && (h.fromStatus ? `${serviceJobStatusLabel(h.fromStatus, kind)} → ${serviceJobStatusLabel(h.toStatus, kind)}` : serviceJobStatusLabel(h.toStatus, kind))}
                    {h.toStatus && h.note ? ' · ' : ''}{h.note}
                    {h.changedByName && <span className="text-xs text-gray-500"> — {h.changedByName}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm space-y-1.5">
            {job.estimateAmount && <div className="flex justify-between text-gray-500"><span>Estimate</span><span>{fCurrency(job.estimateAmount)}</span></div>}
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
          <div className="text-xs text-gray-400">Booked by {job.createdByName || '—'}</div>
        </div>
      </div>

      <Modal isOpen={payOpen} onClose={() => setPayOpen(false)} title={`Advance for ${job.jobNo}`} size="sm"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setPayOpen(false)}>Cancel</button>
          <button disabled={busy || !(parseFloat(pay.amount) > 0)} className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
            onClick={async () => {
              const r = await run(() => api(`/api/service-jobs/${id}/payments`, 'POST', { amount: parseFloat(pay.amount), paymentMethod: pay.method, reference: pay.reference || undefined }), 'Payment recorded')
              if (r) setPayOpen(false)
            }}>Record</button>
        </div>}>
        <div className="space-y-3">
          <div className="text-sm text-gray-600 dark:text-gray-300">Can take up to <b>{fCurrency(advanceRoom)}</b></div>
          <input type="number" min={0} step="0.01" className={inputCls} placeholder="Amount" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} autoFocus />
          <select className={inputCls} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option>
          </select>
          <input className={inputCls} placeholder="Reference (optional)" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
        </div>
      </Modal>

      <Modal isOpen={invOpen} onClose={() => setInvOpen(false)} title={`Deliver & invoice ${job.jobNo}`} size="sm"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setInvOpen(false)}>Cancel</button>
          <button disabled={busy || job.lines.length === 0} className="px-4 py-1.5 text-sm rounded bg-green-600 text-white disabled:opacity-50"
            onClick={async () => {
              const r = await run(() => api(`/api/service-jobs/${id}/invoice`, 'POST', {
                expectedUpdatedAt: job.updatedAt,
                paymentMethod: inv.method,
                paidAmount: inv.method === 'credit' ? 0 : Math.min(tendered, balance),
                reference: inv.reference || undefined,
                repairWarrantyDays: inv.warrantyDays === '' ? undefined : parseInt(inv.warrantyDays, 10),
              }), 'Delivered and invoiced')
              if (r) setInvOpen(false)
            }}>Deliver &amp; invoice</button>
        </div>}>
        <div className="space-y-3 text-sm">
          {job.lines.length === 0 && <div className="text-red-600">Add the charges (Edit) before invoicing.</div>}
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
          {kind !== 'service' && (
            <label className="block">
              <span className="text-xs text-gray-500">{kind === 'repair' ? 'Repair warranty (days)' : 'Alteration guarantee (days)'}</span>
              <input type="number" min={0} max={3650} className={inputCls} value={inv.warrantyDays} onChange={(e) => setInv({ ...inv, warrantyDays: e.target.value })} placeholder="0 = none" />
            </label>
          )}
          <p className="text-xs text-gray-500">Creates the sales invoice (advances included), takes the parts out of stock and marks the job delivered.</p>
        </div>
      </Modal>

      <Modal isOpen={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel ${job.jobNo}`} size="sm"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setCancelOpen(false)}>Keep job</button>
          <button disabled={busy} className="px-4 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-50"
            onClick={async () => {
              const r = await run(() => api(`/api/service-jobs/${id}/status`, 'POST', { status: 'cancelled', cancellationReason: cancelReason || undefined, refundAdvances: activePayments.length > 0 }), 'Job cancelled')
              if (r) setCancelOpen(false)
            }}>Cancel job</button>
        </div>}>
        <div className="space-y-3 text-sm">
          <input className={inputCls} placeholder="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          {activePayments.length > 0 && (
            <div className="rounded bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 p-2">
              Refund {fCurrency(activePayments.reduce((s, p) => s + parseFloat(p.amount), 0))} of advances to the customer — the advance postings are reversed.
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={noteOpen} onClose={() => setNoteOpen(false)} title="Add a note" size="sm"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setNoteOpen(false)}>Cancel</button>
          <button disabled={busy || !note.trim()} className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
            onClick={async () => {
              const r = await moveTo(job.status, { note: note.trim() }, 'Note added')
              if (r) setNoteOpen(false)
            }}>Save</button>
        </div>}>
        <textarea className={`${inputCls} h-24 py-2`} placeholder="Called customer, waiting for part…" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Modal>

      <Modal isOpen={notifyOpen && !!notify} onClose={() => setNotifyOpen(false)} title="Notify customer: ready" size="md"
        footer={<div className="flex justify-end gap-2">
          <button className={btn} onClick={() => setNotifyOpen(false)}>Cancel</button>
          <button disabled={busy || !notify} className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
            onClick={async () => {
              if (!notify) return
              const r = await run(() => api(`/api/service-jobs/${id}/notify`, 'POST', { channel: notify.channel, phone: notify.phone || undefined, text: notify.text || undefined }), 'Message sent')
              if (r) setNotifyOpen(false)
            }}>Send</button>
        </div>}>
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
