'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Plus, Search } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks'
import { TimerBar } from '@/components/projects/TimerBar'
import { BILLING_LABELS } from '@/components/projects/ProjectForm'
import { formatHours } from '@/lib/projects/billing'
import { STATUS_COLORS, btnPrimary, card, chip, input, statusLabel } from '@/components/recurring-invoices/ui'

interface Row {
  id: string; projectNo: string; name: string; customerName: string | null; billingMethod: keyof typeof BILLING_LABELS; status: string
  budgetType: string; budgetHours: string | null; loggedMinutes: number; unbilledMinutes: number; invoicedAmount: string
}
interface Report {
  byProject: Array<{ id: string; projectNo: string; name: string; customerName: string | null; minutes: number; billableMinutes: number | null; unbilledMinutes: number; invoicedMinutes: number }>
  byUser: Array<{ id: string; name: string; minutes: number; billableMinutes: number; unbilledMinutes: number; projects: number }>
  unbilled: Array<{ id: string; entryDate: string; minutes: number; notes: string | null; projectId: string; projectName: string; taskName: string | null; userName: string }>
}

export default function ProjectsPage() {
  const router = useRouter()
  const slug = useParams().slug as string
  const { fCurrency } = useCurrency()
  const [tab, setTab] = useState<'projects' | 'reports'>('projects')
  const [status, setStatus] = useState('active')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [canManage, setCanManage] = useState(false)
  const [timerProjects, setTimerProjects] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState({ fromDate: '', toDate: '' })
  const [report, setReport] = useState<Report | null>(null)

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status, pageSize: '100' })
    if (search.trim()) qs.set('search', search.trim())
    try {
      const res = await fetch(`/api/projects?${qs}`)
      if (!res.ok) return
      const d = await res.json()
      setRows(d.data || []); setCounts(d.counts || {}); setCanManage(!!d.canManage)
    } finally { setLoading(false) }
  }, [status, search])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  useRealtimeData(load, { entityType: ['project', 'time-entry'], refreshOnMount: false })
  useEffect(() => {
    fetch('/api/projects?status=active&all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setTimerProjects(Array.isArray(d) ? d : [])).catch(() => undefined)
  }, [])
  const loadReport = useCallback(async () => {
    const qs = new URLSearchParams()
    if (range.fromDate) qs.set('fromDate', range.fromDate)
    if (range.toDate) qs.set('toDate', range.toDate)
    const res = await fetch(`/api/projects/reports?${qs}`)
    if (res.ok) setReport(await res.json())
  }, [range])
  useEffect(() => { if (tab === 'reports') loadReport() }, [tab, loadReport])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Projects &amp; timesheets</h1>
        <div className="flex gap-2">
          <button className={chip(tab === 'projects')} onClick={() => setTab('projects')}>Projects</button>
          <button className={chip(tab === 'reports')} onClick={() => setTab('reports')}>Reports</button>
          {canManage && <button onClick={() => router.push(`/c/${slug}/projects/new`)} className={btnPrimary}><Plus size={14} /> New project</button>}
        </div>
      </div>
      <TimerBar projects={timerProjects} onChange={load} />

      {tab === 'projects' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {['active', 'on_hold', 'completed', 'cancelled', 'all'].map((s) => (
              <button key={s} className={chip(status === s)} onClick={() => setStatus(s)}>{s === 'all' ? 'All' : statusLabel(s)} {s === 'all' ? '' : counts[s] || 0}</button>
            ))}
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project, number, customer…" aria-label="Search" className="h-9 w-60 pl-8 pr-3 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white" />
            </div>
          </div>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <caption className="sr-only">Projects</caption>
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"><tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">Project</th><th scope="col" className="px-4 py-3 text-left font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 text-left font-medium">Billing</th><th scope="col" className="px-4 py-3 text-right font-medium">Logged</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Unbilled</th><th scope="col" className="px-4 py-3 text-right font-medium">Invoiced</th>
                <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
              </tr></thead>
              <tbody>
                {loading && rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                  : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">{canManage ? 'No projects yet — create one to track time and bill it.' : 'You are not on any project yet.'}</td></tr>
                  : rows.map((r) => {
                    const budget = r.budgetType === 'hours' && r.budgetHours ? Number(r.budgetHours) * 60 : 0
                    return (
                      <tr key={r.id} onClick={() => router.push(`/c/${slug}/projects/${r.id}`)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer dark:text-gray-200">
                        <td className="px-4 py-3"><div className="font-semibold text-blue-600 dark:text-blue-400">{r.name}</div><div className="text-xs text-gray-500">{r.projectNo}</div></td>
                        <td className="px-4 py-3">{r.customerName}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{BILLING_LABELS[r.billingMethod]}</td>
                        <td className="px-4 py-3 text-right">{formatHours(r.loggedMinutes)}{budget ? <div className={`text-xs ${r.loggedMinutes > budget ? 'text-red-600' : 'text-gray-500'}`}>of {formatHours(budget)} h</div> : null}</td>
                        <td className="px-4 py-3 text-right">{formatHours(r.unbilledMinutes)}</td>
                        <td className="px-4 py-3 text-right">{fCurrency(r.invoicedAmount)}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-1 text-xs rounded-full ${STATUS_COLORS[r.status] || ''}`}>{statusLabel(r.status)}</span></td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input type="date" aria-label="From date" className={`${input} w-44`} value={range.fromDate} onChange={(e) => setRange({ ...range, fromDate: e.target.value })} />
            <input type="date" aria-label="To date" className={`${input} w-44`} value={range.toDate} onChange={(e) => setRange({ ...range, toDate: e.target.value })} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={`${card} overflow-x-auto`}>
              <h2 className="px-4 pt-3 text-sm font-semibold dark:text-white">Hours by project</h2>
              <table className="w-full text-sm"><thead className="text-gray-500"><tr><th scope="col" className="px-4 py-2 text-left font-medium">Project</th><th scope="col" className="px-4 py-2 text-right font-medium">Total</th><th scope="col" className="px-4 py-2 text-right font-medium">Billable</th><th scope="col" className="px-4 py-2 text-right font-medium">Unbilled</th></tr></thead>
                <tbody>{(report?.byProject || []).map((p) => (
                  <tr key={p.id} className="border-t dark:border-gray-700 dark:text-gray-200"><td className="px-4 py-2"><Link className="text-blue-600 dark:text-blue-400 hover:underline" href={`/c/${slug}/projects/${p.id}`}>{p.name}</Link><div className="text-xs text-gray-500">{p.customerName}</div></td>
                    <td className="px-4 py-2 text-right">{formatHours(p.minutes)}</td><td className="px-4 py-2 text-right">{formatHours(p.billableMinutes || 0)}</td><td className="px-4 py-2 text-right">{formatHours(p.unbilledMinutes)}</td></tr>
                ))}</tbody></table>
            </div>
            <div className={`${card} overflow-x-auto`}>
              <h2 className="px-4 pt-3 text-sm font-semibold dark:text-white">Hours by staff</h2>
              <table className="w-full text-sm"><thead className="text-gray-500"><tr><th scope="col" className="px-4 py-2 text-left font-medium">User</th><th scope="col" className="px-4 py-2 text-right font-medium">Total</th><th scope="col" className="px-4 py-2 text-right font-medium">Billable</th><th scope="col" className="px-4 py-2 text-right font-medium">Projects</th></tr></thead>
                <tbody>{(report?.byUser || []).map((u) => (
                  <tr key={u.id} className="border-t dark:border-gray-700 dark:text-gray-200"><td className="px-4 py-2">{u.name}</td><td className="px-4 py-2 text-right">{formatHours(u.minutes)}</td><td className="px-4 py-2 text-right">{formatHours(u.billableMinutes)}</td><td className="px-4 py-2 text-right">{u.projects}</td></tr>
                ))}</tbody></table>
            </div>
          </div>
          <div className={`${card} overflow-x-auto`}>
            <h2 className="px-4 pt-3 text-sm font-semibold dark:text-white">Unbilled billable time</h2>
            <table className="w-full text-sm"><thead className="text-gray-500"><tr><th scope="col" className="px-4 py-2 text-left font-medium">Date</th><th scope="col" className="px-4 py-2 text-left font-medium">Project</th><th scope="col" className="px-4 py-2 text-left font-medium">Task</th><th scope="col" className="px-4 py-2 text-left font-medium">User</th><th scope="col" className="px-4 py-2 text-left font-medium">Notes</th><th scope="col" className="px-4 py-2 text-right font-medium">Hours</th></tr></thead>
              <tbody>{(report?.unbilled || []).length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Nothing unbilled</td></tr> : report!.unbilled.map((e) => (
                <tr key={e.id} className="border-t dark:border-gray-700 dark:text-gray-200"><td className="px-4 py-2">{e.entryDate}</td><td className="px-4 py-2"><Link className="text-blue-600 dark:text-blue-400 hover:underline" href={`/c/${slug}/projects/${e.projectId}`}>{e.projectName}</Link></td><td className="px-4 py-2">{e.taskName || '—'}</td><td className="px-4 py-2">{e.userName}</td><td className="px-4 py-2 text-gray-500">{e.notes || ''}</td><td className="px-4 py-2 text-right">{formatHours(e.minutes)}</td></tr>
              ))}</tbody></table>
          </div>
        </div>
      )}
    </div>
  )
}
