'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, FileText, Pencil, Trash2, Plus } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks'
import { TimerBar } from '@/components/projects/TimerBar'
import { BILLING_LABELS, ProjectForm, type ProjectInitial } from '@/components/projects/ProjectForm'
import { formatHours, type BillingPreview } from '@/lib/projects/billing'
import { STATUS_COLORS, btnPrimary, btnSecondary, card, colomboToday, input, label, readJson, statusLabel } from '@/components/recurring-invoices/ui'

interface Entry {
  id: string; taskId: string | null; taskName: string | null; userId: string; userName: string | null; entryDate: string
  durationMinutes: number; notes: string | null; billable: boolean; isRunning: boolean; invoiced: boolean; saleId: string | null
}
interface Project extends ProjectInitial {
  id: string; projectNo: string; customerName: string | null; warehouseName: string | null; serviceItemName: string | null
  loggedMinutes: number; unbilledMinutes: number; invoicedAmount: string; canManage: boolean
  tasks: Array<{ id: string; name: string; rate: string; billable: boolean; isActive: boolean }>
  members: Array<{ userId: string; rate: string; name: string | null }>
  entries: Entry[]
  invoices: Array<{ id: string; saleId: string | null; invoiceNo: string | null; kind: string; hours: string; amount: string; createdAt: string; saleStatus: string | null }>
  unbilled: BillingPreview | null
}

export default function ProjectDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const id = params.id as string
  const router = useRouter()
  const editing = useSearchParams().get('edit') === '1'
  const { fCurrency } = useCurrency()
  const [p, setP] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState({ taskId: '', entryDate: colomboToday(), startTime: '', endTime: '', hours: '', notes: '', billable: true })
  const [fixedAmount, setFixedAmount] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`)
    const d = await readJson(res)
    if (!res.ok) { setError(String(d.error || 'Not found')); return }
    setP(d as unknown as Project)
  }, [id])
  useEffect(() => { load() }, [load])
  useRealtimeData(load, { entityType: ['project', 'time-entry'], refreshOnMount: false })

  async function logTime(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const useTimes = log.startTime && log.endTime
    const minutes = Math.round((Number(log.hours) || 0) * 60)
    if (!useTimes && minutes <= 0) return setError('Enter start and end times, or the hours')
    setBusy(true)
    try {
      const res = await fetch('/api/time-entries', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: id, taskId: log.taskId || null, entryDate: log.entryDate, notes: log.notes || null, billable: log.billable,
          ...(useTimes ? { startTime: log.startTime, endTime: log.endTime } : { durationMinutes: minutes }),
        }),
      })
      const d = await readJson(res)
      if (!res.ok) setError(String(d.error || 'Could not log time'))
      else { setLog((l) => ({ ...l, startTime: '', endTime: '', hours: '', notes: '' })); setNotice('Time logged') }
      await load()
    } finally { setBusy(false) }
  }
  async function removeEntry(entryId: string) {
    if (!confirm('Delete this time entry?')) return
    const res = await fetch(`/api/time-entries/${entryId}`, { method: 'DELETE' })
    if (!res.ok) setError(String((await readJson(res)).error || 'Could not delete'))
    await load()
  }
  async function createInvoice() {
    if (!p) return
    const isFixed = p.billingMethod === 'fixed'
    const amount = isFixed ? Number(fixedAmount || p.unbilled?.fixedRemaining || 0) : p.unbilled?.totalAmount || 0
    if (!confirm(`Create an invoice of ${fCurrency(amount)} for ${p.customerName}?`)) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/projects/${id}/invoice`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isFixed && fixedAmount ? { fixedAmount: Number(fixedAmount) } : {}),
      })
      const d = await readJson(res)
      if (!res.ok) setError(String(d.error || 'Could not create the invoice'))
      else { setNotice(`Invoice ${d.invoiceNo} created`); setFixedAmount('') }
      await load()
    } finally { setBusy(false) }
  }
  async function remove() {
    if (!confirm('Delete this project? Invoices already raised stay.')) return
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    if (res.ok) router.push(`/c/${slug}/projects`)
    else setError(String((await readJson(res)).error || 'Could not delete'))
  }

  if (error && !p) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!p) return <div className="p-6 text-sm text-gray-500">Loading…</div>
  if (editing) {
    return (
      <div className="space-y-3 max-w-6xl">
        <Link href={`/c/${slug}/projects/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><ChevronLeft size={14} /> {p.name}</Link>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Edit project</h1>
        <ProjectForm slug={slug} initial={p} />
      </div>
    )
  }

  const budgetMin = p.budgetType === 'hours' && p.budgetHours ? Number(p.budgetHours) * 60 : 0
  const open = p.status === 'active' || p.status === 'on_hold'
  const activeTasks = p.tasks.filter((t) => t.isActive)
  return (
    <div className="space-y-4 max-w-6xl">
      <Link href={`/c/${slug}/projects`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><ChevronLeft size={14} /> Projects</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">{p.name} <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[p.status] || ''}`}>{statusLabel(p.status)}</span></h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{p.projectNo} · {p.customerName} · {BILLING_LABELS[p.billingMethod]}{p.warehouseName ? ` · ${p.warehouseName}` : ''}</p>
        </div>
        {p.canManage && (
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => router.push(`/c/${slug}/projects/${id}?edit=1`)}><Pencil size={14} /> Edit</button>
            <button className={btnSecondary} onClick={remove} aria-label="Delete project"><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      {error && <div role="alert" className="px-3 py-2 text-sm rounded bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-200">{error}</div>}
      {notice && <div role="status" className="px-3 py-2 text-sm rounded bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-200">{notice}</div>}

      <div className="grid gap-3 md:grid-cols-4">
        <div className={`${card} p-4`}><div className="text-xs uppercase text-gray-500">Logged</div><div className="text-xl font-semibold dark:text-white">{formatHours(p.loggedMinutes)} h</div>{budgetMin > 0 && <div className={`text-xs ${p.loggedMinutes > budgetMin ? 'text-red-600' : 'text-gray-500'}`}>budget {formatHours(budgetMin)} h</div>}</div>
        <div className={`${card} p-4`}><div className="text-xs uppercase text-gray-500">Unbilled</div><div className="text-xl font-semibold dark:text-white">{formatHours(p.unbilledMinutes)} h</div></div>
        <div className={`${card} p-4`}><div className="text-xs uppercase text-gray-500">Invoiced</div><div className="text-xl font-semibold dark:text-white">{fCurrency(p.invoicedAmount)}</div>{p.budgetType === 'amount' && p.budgetAmount ? <div className="text-xs text-gray-500">budget {fCurrency(p.budgetAmount)}</div> : null}</div>
        <div className={`${card} p-4`}><div className="text-xs uppercase text-gray-500">{p.billingMethod === 'fixed' ? 'Fixed price left' : 'Ready to invoice'}</div><div className="text-xl font-semibold dark:text-white">{p.unbilled ? fCurrency(p.billingMethod === 'fixed' ? p.unbilled.fixedRemaining : p.unbilled.totalAmount) : '—'}</div></div>
      </div>

      {open && <TimerBar projects={[{ id: p.id, name: p.name, tasks: p.tasks }]} fixedProjectId={p.id} onChange={load} />}

      {p.canManage && p.unbilled && (
        <div className={`${card} p-4 space-y-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold dark:text-white">Create invoice</h2>
            <div className="flex items-center gap-2">
              {p.billingMethod === 'fixed' && (
                <input aria-label="Amount to invoice" type="number" min={0} step="0.01" className={`${input} w-40`} placeholder={String(p.unbilled.fixedRemaining)} value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} />
              )}
              <button className={btnPrimary} disabled={busy || (p.billingMethod === 'fixed' ? p.unbilled.fixedRemaining <= 0 : p.unbilled.totalAmount <= 0)} onClick={createInvoice}><FileText size={14} /> Create invoice</button>
            </div>
          </div>
          {p.billingMethod !== 'fixed' && (p.unbilled.lines.length === 0 ? <p className="text-sm text-gray-500">No unbilled billable time.</p> : (
            <table className="w-full text-sm"><thead className="text-gray-500"><tr><th scope="col" className="py-1 text-left font-medium">Line</th><th scope="col" className="py-1 text-right font-medium">Hours</th><th scope="col" className="py-1 text-right font-medium">Rate</th><th scope="col" className="py-1 text-right font-medium">Amount</th></tr></thead>
              <tbody>{p.unbilled.lines.map((l) => <tr key={l.key} className="border-t dark:border-gray-700 dark:text-gray-200"><td className="py-1">{l.name}</td><td className="py-1 text-right">{formatHours(l.minutes)}</td><td className="py-1 text-right">{fCurrency(l.rate)}</td><td className="py-1 text-right">{fCurrency(l.amount)}</td></tr>)}</tbody>
            </table>
          ))}
          <p className="text-xs text-gray-500">The invoice is raised on the customer&apos;s account like any sales invoice (service line &quot;{p.serviceItemName || 'Professional services'}&quot;, no stock); tax follows the item&apos;s tax template.</p>
        </div>
      )}

      {open && (
        <form onSubmit={logTime} className={`${card} p-4 grid gap-3 md:grid-cols-7 items-end`}>
          <div className="md:col-span-2">
            <label className={label} htmlFor="lt-task">Task</label>
            <select id="lt-task" className={input} value={log.taskId} onChange={(e) => setLog({ ...log, taskId: e.target.value })}>
              <option value="">No task</option>{activeTasks.map((t) => <option key={t.id} value={t.id}>{t.name}{t.billable ? '' : ' (non-billable)'}</option>)}
            </select>
          </div>
          <div><label className={label} htmlFor="lt-date">Date</label><input id="lt-date" type="date" className={input} value={log.entryDate} onChange={(e) => setLog({ ...log, entryDate: e.target.value })} required /></div>
          <div><label className={label} htmlFor="lt-start">Start</label><input id="lt-start" type="time" className={input} value={log.startTime} onChange={(e) => setLog({ ...log, startTime: e.target.value })} /></div>
          <div><label className={label} htmlFor="lt-end">End</label><input id="lt-end" type="time" className={input} value={log.endTime} onChange={(e) => setLog({ ...log, endTime: e.target.value })} /></div>
          <div><label className={label} htmlFor="lt-hours">or Hours</label><input id="lt-hours" type="number" min={0} step="0.25" className={input} value={log.hours} onChange={(e) => setLog({ ...log, hours: e.target.value })} disabled={!!(log.startTime && log.endTime)} /></div>
          <label className="flex items-center gap-1 text-sm dark:text-gray-200 pb-2"><input type="checkbox" checked={log.billable} onChange={(e) => setLog({ ...log, billable: e.target.checked })} /> Billable</label>
          <div className="md:col-span-6"><label className={label} htmlFor="lt-notes">Notes</label><input id="lt-notes" className={input} value={log.notes} onChange={(e) => setLog({ ...log, notes: e.target.value })} maxLength={2000} /></div>
          <button type="submit" className={btnPrimary} disabled={busy}><Plus size={14} /> Log time</button>
        </form>
      )}

      <div className={`${card} overflow-x-auto`}>
        <h2 className="px-4 pt-3 text-sm font-semibold dark:text-white">Timesheet</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">Time entries</caption>
          <thead className="text-gray-500"><tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">Date</th><th scope="col" className="px-4 py-2 text-left font-medium">User</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">Task</th><th scope="col" className="px-4 py-2 text-left font-medium">Notes</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Hours</th><th scope="col" className="px-4 py-2 text-left font-medium">Billing</th>
            <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {p.entries.length === 0 ? <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">No time logged yet</td></tr> : p.entries.map((e) => (
              <tr key={e.id} className="border-t dark:border-gray-700 dark:text-gray-200">
                <td className="px-4 py-2 whitespace-nowrap">{e.entryDate}</td>
                <td className="px-4 py-2">{e.userName}</td>
                <td className="px-4 py-2">{e.taskName || '—'}</td>
                <td className="px-4 py-2 text-gray-500">{e.notes || ''}</td>
                <td className="px-4 py-2 text-right">{e.isRunning ? <span className="text-green-600">running</span> : formatHours(e.durationMinutes)}</td>
                <td className="px-4 py-2">{e.invoiced ? (e.saleId ? <Link className="text-blue-600 dark:text-blue-400 hover:underline" href={`/c/${slug}/sales/${e.saleId}`}>Invoiced</Link> : 'Invoicing…') : e.billable ? 'Unbilled' : <span className="text-gray-400">Non-billable</span>}</td>
                <td className="px-4 py-2 text-right">{!e.invoiced && !e.isRunning && <button className="p-1 text-gray-400 hover:text-red-600" aria-label="Delete entry" onClick={() => removeEntry(e.id)}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={`${card} p-4 text-sm`}>
          <h2 className="font-semibold mb-2 dark:text-white">Tasks &amp; users</h2>
          <ul className="space-y-1 dark:text-gray-200">
            {p.tasks.map((t) => <li key={t.id} className={t.isActive ? '' : 'line-through text-gray-400'}>{t.name}{p.billingMethod === 'task_hourly' ? ` · ${fCurrency(t.rate)}/h` : ''}{t.billable ? '' : ' · non-billable'}</li>)}
            {p.members.map((m) => <li key={m.userId} className="text-gray-600 dark:text-gray-300">User: {m.name}{p.billingMethod === 'staff_hourly' ? ` · ${fCurrency(m.rate)}/h` : ''}</li>)}
          </ul>
        </div>
        <div className={`${card} p-4 text-sm`}>
          <h2 className="font-semibold mb-2 dark:text-white">Invoices</h2>
          {p.invoices.length === 0 ? <p className="text-gray-500">None yet</p> : (
            <ul className="space-y-1">{p.invoices.map((i) => (
              <li key={i.id} className="flex justify-between dark:text-gray-200">
                <span>{i.saleId ? <Link className="text-blue-600 dark:text-blue-400 hover:underline" href={`/c/${slug}/sales/${i.saleId}`}>{i.invoiceNo}</Link> : i.invoiceNo} <span className="text-xs text-gray-500">{String(i.createdAt).slice(0, 10)} · {i.kind === 'fixed' ? 'fixed price' : `${i.hours} h`}</span></span>
                <span>{fCurrency(i.amount)}</span>
              </li>
            ))}</ul>
          )}
        </div>
      </div>
    </div>
  )
}
