'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Plus, RefreshCw, Search, Zap, Clock, AlertTriangle } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { PRINT_JOB_STATUS_COLORS, PRINT_JOB_STATUS_LABELS, PRINT_JOB_PIPELINE, PROOF_STATUS_COLORS, PROOF_STATUS_LABELS } from '@/lib/print-jobs/constants'

interface PrintJobRow {
  id: string
  jobNo: string
  title: string
  status: string
  proofStatus: string
  customerName: string
  customerPhone: string | null
  dueAt: string | null
  isUrgent: boolean
  total: string
  paidAmount: string
  balanceDue: string
  assignedName: string | null
  warehouseName: string | null
  createdAt: string
}

interface Summary { counts: Record<string, number>; dueToday: number; overdue: number; urgent: number }

type Filter = { status?: string; due?: string }

function dueLabel(dueAt: string | null): { text: string; overdue: boolean; today: boolean } {
  if (!dueAt) return { text: '—', overdue: false, today: false }
  const d = new Date(dueAt)
  const now = new Date()
  const today = d.toDateString() === now.toDateString()
  const overdue = d.getTime() < now.getTime()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return { text: today ? `Today ${time}` : `${d.toLocaleDateString()} ${time}`, overdue, today }
}

export default function PrintJobsPage() {
  const router = useRouter()
  const params = useParams()
  const slug = params.slug as string
  const searchParams = useSearchParams()
  const { fCurrency } = useCurrency()

  const [filter, setFilter] = useState<Filter>({ status: searchParams.get('status') || 'open', due: searchParams.get('due') || undefined })
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [rows, setRows] = useState<PrintJobRow[]>([])
  const [summary, setSummary] = useState<Summary>({ counts: {}, dueToday: 0, overdue: 0, urgent: 0 })
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (filter.status) qs.set('status', filter.status)
    if (filter.due) qs.set('due', filter.due)
    if (debounced) qs.set('search', debounced)
    try {
      const res = await fetch(`/api/print-jobs?${qs}`)
      if (!res.ok) return
      const data = await res.json()
      setRows(data.data || [])
      setSummary(data.summary || { counts: {}, dueToday: 0, overdue: 0, urgent: 0 })
      setPagination(data.pagination || { page: 1, pageSize, total: 0, totalPages: 0 })
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filter, debounced])

  useRealtimeData(load, { entityType: 'print-job', refreshOnMount: false })
  useEffect(() => { load() }, [load])

  const openCount = ['received', 'designing', 'proof_sent', 'approved', 'printing', 'finishing', 'ready'].reduce((s, k) => s + (summary.counts[k] || 0), 0)
  const chip = (active: boolean) => `flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${active
    ? 'bg-blue-600 border-blue-600 text-white'
    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-500'}`
  const pick = (f: Filter) => { setFilter(f); setPage(1) }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Print jobs</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Job no., phone, customer…"
              className="h-9 w-64 pl-8 pr-3 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button onClick={() => load()} className="p-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300" aria-label="Refresh"><RefreshCw size={14} /></button>
          <button onClick={() => router.push(`/c/${slug}/print-jobs/new`)} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"><Plus size={14} /> New job</button>
        </div>
      </div>

      {/* Status chips (kanban-ish): open pipeline, due filters, closed */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button className={chip(filter.status === 'open' && !filter.due)} onClick={() => pick({ status: 'open' })}>All open <span className="opacity-75">{openCount}</span></button>
        <button className={chip(filter.due === 'today')} onClick={() => pick({ due: 'today' })}><Clock size={12} /> Due today <span className="opacity-75">{summary.dueToday}</span></button>
        <button className={chip(filter.due === 'overdue')} onClick={() => pick({ due: 'overdue' })}><AlertTriangle size={12} className={summary.overdue ? 'text-red-500' : ''} /> Overdue <span className="opacity-75">{summary.overdue}</span></button>
        <button className={chip(filter.due === 'urgent')} onClick={() => pick({ due: 'urgent' })}><Zap size={12} /> Urgent <span className="opacity-75">{summary.urgent}</span></button>
        <span className="w-px bg-gray-300 dark:bg-gray-600 mx-1" />
        {PRINT_JOB_PIPELINE.map((s) => (
          <button key={s} className={chip(filter.status === s && !filter.due)} onClick={() => pick({ status: s })}>
            {PRINT_JOB_STATUS_LABELS[s]} <span className="opacity-75">{summary.counts[s] || 0}</span>
          </button>
        ))}
        <button className={chip(filter.status === 'cancelled')} onClick={() => pick({ status: 'cancelled' })}>Cancelled <span className="opacity-75">{summary.counts.cancelled || 0}</span></button>
        <button className={chip(filter.status === 'all')} onClick={() => pick({ status: 'all' })}>All</button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Print jobs</caption>
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr className="text-left text-sm text-gray-600 dark:text-gray-300">
              <th scope="col" className="px-4 py-3 font-medium">Job</th>
              <th scope="col" className="px-4 py-3 font-medium">Customer</th>
              <th scope="col" className="px-4 py-3 font-medium">Due</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Assigned</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Total</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">{debounced ? 'No jobs match your search' : 'No jobs here'}</td></tr>
            ) : rows.map((j) => {
              const due = dueLabel(j.dueAt)
              const open = !['delivered', 'cancelled'].includes(j.status)
              return (
                <tr key={j.id} onClick={() => router.push(`/c/${slug}/print-jobs/${j.id}`)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {j.isUrgent && open && <Zap size={14} className="text-red-600" aria-label="Urgent" />}
                      <span className="font-semibold text-blue-600 dark:text-blue-400">{j.jobNo}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[16rem]">{j.title}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="text-gray-800 dark:text-gray-200">{j.customerName}</div>
                    <div className="text-xs text-gray-500">{j.customerPhone || ''}</div>
                  </td>
                  <td className={`px-4 py-3 text-sm whitespace-nowrap ${open && due.overdue ? 'text-red-600 font-semibold' : open && due.today ? 'text-amber-600 font-medium' : 'text-gray-600 dark:text-gray-300'}`}>
                    {due.text}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${PRINT_JOB_STATUS_COLORS[j.status] || ''}`}>{PRINT_JOB_STATUS_LABELS[j.status] || j.status}</span>
                    {j.proofStatus !== 'not_needed' && open && (
                      <div className={`text-[11px] mt-1 ${PROOF_STATUS_COLORS[j.proofStatus] || ''}`}>{PROOF_STATUS_LABELS[j.proofStatus]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{j.assignedName || '—'}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium dark:text-white">{fCurrency(j.total)}</td>
                  <td className={`px-4 py-3 text-right text-sm ${parseFloat(j.balanceDue) > 0 ? 'text-orange-600 font-medium' : 'text-green-600'}`}>
                    {parseFloat(j.balanceDue) > 0 ? fCurrency(j.balanceDue) : 'Paid'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={(n: number) => { setPageSize(n); setPage(1) }}
          className="border-t dark:border-gray-700 px-4"
        />
      </div>
    </div>
  )
}
