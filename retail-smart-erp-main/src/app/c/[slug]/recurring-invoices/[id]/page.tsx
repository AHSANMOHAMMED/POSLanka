'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, Pause, Play, Square, Zap, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks'
import { frequencyLabel, upcomingDates, type RecurringFrequency, type RecurringEndType } from '@/lib/recurring-invoices/schedule'
import { RecurringInvoiceForm, type RecurringInvoiceInitial } from '@/components/recurring-invoices/RecurringInvoiceForm'
import { STATUS_COLORS, btnPrimary, btnSecondary, card, readJson, statusLabel } from '@/components/recurring-invoices/ui'

interface Run {
  id: string; runDate: string; status: string; saleId: string | null; invoiceNo: string | null; total: string | null
  dueDate: string | null; error: string | null; triggeredBy: string; saleStatus: string | null; paidAmount: string | null; attempts: number
}
interface Profile extends RecurringInvoiceInitial {
  id: string; customerName: string | null; warehouseName: string | null; status: string; nextRunDate: string | null
  occurrencesGenerated: number; lastError: string | null; runs: Run[]
  frequency: RecurringFrequency; endType: RecurringEndType
}

export default function RecurringInvoiceDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const id = params.id as string
  const router = useRouter()
  const editing = useSearchParams().get('edit') === '1'
  const { fCurrency } = useCurrency()
  const [p, setP] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/recurring-invoices/${id}`)
    const data = await readJson(res)
    if (!res.ok) { setError(String(data.error || 'Not found')); return }
    setP(data as unknown as Profile)
  }, [id])
  useRealtimeData(load, { entityType: 'recurring-invoice', refreshOnMount: false })
  useEffect(() => { load() }, [load])

  async function act(url: string, init: RequestInit, ok: (d: Record<string, unknown>) => string) {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init })
      const data = await readJson(res)
      if (!res.ok) setError(String(data.error || 'Failed'))
      else setNotice(ok(data))
      await load()
    } finally { setBusy(false) }
  }
  const runNow = () => act(`/api/recurring-invoices/${id}/run`, { method: 'POST', body: JSON.stringify({ runDate: p?.nextRunDate }) }, (d) =>
    d.kind === 'generated' ? `Invoice ${d.invoiceNo} created` : d.kind === 'draft' ? 'Draft created — review and post it below' : `Already created for ${d.runDate}`)
  const setStatus = (action: 'pause' | 'resume' | 'stop') => {
    if (action === 'stop' && !confirm('Stop this profile? No more invoices will be raised and it cannot be restarted.')) return
    act(`/api/recurring-invoices/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }, () => `Profile ${action === 'stop' ? 'stopped' : action === 'pause' ? 'paused' : 'resumed'}`)
  }
  const postDraft = (runId: string) => act(`/api/recurring-invoices/${id}/runs/${runId}/post`, { method: 'POST' }, (d) => `Invoice ${d.invoiceNo} created`)
  async function remove() {
    if (!confirm('Delete this recurring profile? Invoices already raised stay.')) return
    const res = await fetch(`/api/recurring-invoices/${id}`, { method: 'DELETE' })
    if (res.ok) router.push(`/c/${slug}/recurring-invoices`)
    else setError(String((await readJson(res)).error || 'Could not delete'))
  }

  if (error && !p) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!p) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  if (editing) {
    return (
      <div className="space-y-3 max-w-6xl">
        <Link href={`/c/${slug}/recurring-invoices/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><ChevronLeft size={14} /> {p.profileName}</Link>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Edit recurring invoice</h1>
        <RecurringInvoiceForm slug={slug} initial={p} />
      </div>
    )
  }

  const upcoming = p.status === 'active' || p.status === 'paused' ? upcomingDates(p, p.occurrencesGenerated, 4) : []
  const open = p.status === 'active' || p.status === 'paused'
  const amount = p.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice) - Number(l.discount || 0), 0)
  return (
    <div className="space-y-4 max-w-6xl">
      <Link href={`/c/${slug}/recurring-invoices`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><ChevronLeft size={14} /> Recurring invoices</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            {p.profileName} <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[p.status] || ''}`}>{statusLabel(p.status)}</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{p.customerName} · {frequencyLabel(p.frequency, p.intervalCount)} from {p.startDate}{p.warehouseName ? ` · ${p.warehouseName}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && <button className={btnPrimary} disabled={busy} onClick={runNow}><Zap size={14} /> Run now</button>}
          {p.status === 'active' && <button className={btnSecondary} disabled={busy} onClick={() => setStatus('pause')}><Pause size={14} /> Pause</button>}
          {p.status === 'paused' && <button className={btnSecondary} disabled={busy} onClick={() => setStatus('resume')}><Play size={14} /> Resume</button>}
          {open && <button className={btnSecondary} disabled={busy} onClick={() => setStatus('stop')}><Square size={14} /> Stop</button>}
          {p.status !== 'stopped' && <button className={btnSecondary} onClick={() => router.push(`/c/${slug}/recurring-invoices/${id}?edit=1`)}><Pencil size={14} /> Edit</button>}
          <button className={btnSecondary} onClick={remove} aria-label="Delete"><Trash2 size={14} /></button>
        </div>
      </div>
      {error && <div role="alert" className="px-3 py-2 text-sm rounded bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-200">{error}</div>}
      {notice && <div role="status" className="px-3 py-2 text-sm rounded bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-200">{notice}</div>}
      {p.lastError && <div className="px-3 py-2 text-sm rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 flex gap-2"><AlertTriangle size={16} /> Last run failed — {p.lastError}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${card} p-4 text-sm space-y-1`}>
          <div className="text-xs uppercase text-gray-500">Next invoice</div>
          <div className="text-xl font-semibold dark:text-white">{p.nextRunDate || '—'}</div>
          <div className="text-gray-500">{upcoming.slice(1).join(' · ')}</div>
        </div>
        <div className={`${card} p-4 text-sm space-y-1`}>
          <div className="text-xs uppercase text-gray-500">Each invoice</div>
          <div className="text-xl font-semibold dark:text-white">{fCurrency(amount)}</div>
          <div className="text-gray-500">{p.invoiceAction === 'draft' ? 'Draft for review' : 'On the customer’s account'} · due in {p.paymentTermsDays} days</div>
        </div>
        <div className={`${card} p-4 text-sm space-y-1`}>
          <div className="text-xs uppercase text-gray-500">Ends</div>
          <div className="text-xl font-semibold dark:text-white">{p.endType === 'never' ? 'Never' : p.endType === 'after' ? `After ${p.endAfterCount}` : p.endDate}</div>
          <div className="text-gray-500">{p.occurrencesGenerated} raised so far{p.notifyChannel !== 'none' ? ` · notifies by ${p.notifyChannel}` : ''}</div>
        </div>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <h2 className="px-4 pt-3 text-sm font-semibold dark:text-white">Lines</h2>
        <table className="w-full text-sm">
          <thead className="text-gray-500"><tr><th scope="col" className="px-4 py-2 text-left font-medium">Item</th><th scope="col" className="px-4 py-2 text-right font-medium">Qty</th><th scope="col" className="px-4 py-2 text-right font-medium">Price</th><th scope="col" className="px-4 py-2 text-right font-medium">Amount</th></tr></thead>
          <tbody>{p.lines.map((l, i) => (
            <tr key={i} className="border-t dark:border-gray-700 dark:text-gray-200">
              <td className="px-4 py-2">{l.itemName}</td>
              <td className="px-4 py-2 text-right">{Number(l.quantity)} {l.uom || ''}</td>
              <td className="px-4 py-2 text-right">{fCurrency(l.unitPrice)}</td>
              <td className="px-4 py-2 text-right">{fCurrency(Number(l.quantity) * Number(l.unitPrice) - Number(l.discount || 0))}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <h2 className="px-4 pt-3 text-sm font-semibold dark:text-white">Invoices raised</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">History of generated invoices</caption>
          <thead className="text-gray-500"><tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">Date</th><th scope="col" className="px-4 py-2 text-left font-medium">Invoice</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">Due</th><th scope="col" className="px-4 py-2 text-left font-medium">Status</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Amount</th><th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {p.runs.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No invoices yet — the first one is raised on {p.nextRunDate || p.startDate}.</td></tr> : p.runs.map((r) => (
              <tr key={r.id} className="border-t dark:border-gray-700 dark:text-gray-200">
                <td className="px-4 py-2 whitespace-nowrap">{r.runDate}{r.triggeredBy === 'manual' ? <span className="ml-1 text-xs text-gray-400">(run now)</span> : null}</td>
                <td className="px-4 py-2">{r.saleId ? <Link className="text-blue-600 dark:text-blue-400 hover:underline" href={`/c/${slug}/sales/${r.saleId}`}>{r.invoiceNo}</Link> : '—'}</td>
                <td className="px-4 py-2">{r.dueDate || '—'}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[r.status] || ''}`}>{r.status === 'generated' && r.saleStatus ? (r.saleStatus === 'completed' ? 'Paid' : r.saleStatus === 'partial' ? 'Partly paid' : r.saleStatus === 'void' ? 'Void' : 'Unpaid') : statusLabel(r.status)}</span>
                  {r.error && <div className="text-xs text-red-600 mt-1">{r.error}{r.attempts > 1 ? ` (${r.attempts} attempts)` : ''}</div>}
                </td>
                <td className="px-4 py-2 text-right">{r.total ? fCurrency(r.total) : '—'}</td>
                <td className="px-4 py-2 text-right">{r.status === 'draft' && <button className={btnSecondary} disabled={busy} onClick={() => postDraft(r.id)}>Post invoice</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
