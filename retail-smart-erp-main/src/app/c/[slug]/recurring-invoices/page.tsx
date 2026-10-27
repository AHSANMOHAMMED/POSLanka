'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Plus, RefreshCw, Search, AlertTriangle } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { frequencyLabel, type RecurringFrequency } from '@/lib/recurring-invoices/schedule'
import { STATUS_COLORS, btnPrimary, card, chip, statusLabel } from '@/components/recurring-invoices/ui'

interface Row {
  id: string; profileName: string; customerName: string | null; warehouseName: string | null
  frequency: RecurringFrequency; intervalCount: number; nextRunDate: string | null; occurrencesGenerated: number
  invoiceAction: string; status: string; lastRunAt: string | null; lastError: string | null; amount: string
}

const STATUSES = ['active', 'paused', 'stopped', 'completed'] as const

export default function RecurringInvoicesPage() {
  const router = useRouter()
  const slug = useParams().slug as string
  const { fCurrency } = useCurrency()
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [rows, setRows] = useState<Row[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { const t = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300); return () => clearTimeout(t) }, [search])

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status })
    if (debounced) qs.set('search', debounced)
    try {
      const res = await fetch(`/api/recurring-invoices?${qs}`)
      if (!res.ok) return
      const data = await res.json()
      setRows(data.data || [])
      setCounts(data.counts || {})
      setPagination(data.pagination || { page: 1, pageSize, total: 0, totalPages: 0 })
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, status, debounced])
  useRealtimeData(load, { entityType: 'recurring-invoice', refreshOnMount: false })
  useEffect(() => { load() }, [load])

  const all = Object.values(counts).reduce((s, n) => s + n, 0)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Recurring invoices</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Profile or customer…" aria-label="Search"
              className="h-9 w-60 pl-8 pr-3 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white" />
          </div>
          <button onClick={() => load()} className="p-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300" aria-label="Refresh"><RefreshCw size={14} /></button>
          <button onClick={() => router.push(`/c/${slug}/recurring-invoices/new`)} className={btnPrimary}><Plus size={14} /> New</button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button className={chip(status === 'all')} onClick={() => { setStatus('all'); setPage(1) }}>All {all}</button>
        {STATUSES.map((s) => <button key={s} className={chip(status === s)} onClick={() => { setStatus(s); setPage(1) }}>{statusLabel(s)} {counts[s] || 0}</button>)}
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full">
          <caption className="sr-only">Recurring invoice profiles</caption>
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr className="text-left text-sm text-gray-600 dark:text-gray-300">
              <th scope="col" className="px-4 py-3 font-medium">Profile</th>
              <th scope="col" className="px-4 py-3 font-medium">Customer</th>
              <th scope="col" className="px-4 py-3 font-medium">Frequency</th>
              <th scope="col" className="px-4 py-3 font-medium">Next invoice</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                {debounced ? 'No profiles match your search' : (
                  <div className="space-y-2">
                    <p className="font-medium text-gray-700 dark:text-gray-200">Create recurring invoices for customers you bill regularly</p>
                    <button onClick={() => router.push(`/c/${slug}/recurring-invoices/new`)} className={btnPrimary}><Plus size={14} /> New recurring invoice</button>
                  </div>
                )}
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/c/${slug}/recurring-invoices/${r.id}`)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm">
                <td className="px-4 py-3">
                  <div className="font-semibold text-blue-600 dark:text-blue-400">{r.profileName}</div>
                  <div className="text-xs text-gray-500">{r.occurrencesGenerated} raised · {r.invoiceAction === 'draft' ? 'drafts' : 'on account'}{r.warehouseName ? ` · ${r.warehouseName}` : ''}</div>
                </td>
                <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{r.customerName}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{frequencyLabel(r.frequency, r.intervalCount)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                  {r.nextRunDate || '—'}
                  {r.lastError && <span className="ml-1 inline-flex" title={r.lastError}><AlertTriangle size={13} className="text-red-500" aria-label="Last run failed" /></span>}
                </td>
                <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[r.status] || ''}`}>{statusLabel(r.status)}</span></td>
                <td className="px-4 py-3 text-right font-medium dark:text-white">{fCurrency(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage} onPageSizeChange={(n: number) => { setPageSize(n); setPage(1) }} className="border-t dark:border-gray-700 px-4" />
      </div>
    </div>
  )
}
