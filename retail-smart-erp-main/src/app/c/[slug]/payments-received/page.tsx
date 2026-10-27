'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Plus, RefreshCw, Search, Banknote } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { METHOD_LABELS, btnPrimary, btnSecondary, card, input } from '@/components/recurring-invoices/ui'

interface Row {
  id: string; kind: 'invoice_payment' | 'credit_deposit'; date: string; customerId: string; customerName: string | null
  saleId: string | null; invoiceNo: string | null; method: string; reference: string | null; amount: number
  receivedBy: string | null; receiptId: string | null; receiptNo: string | null; warehouseName: string | null
}
interface Totals { count: number; amount: number; creditApplied: number; byMethod: Array<{ method: string; total: number; count: number }> }
interface Option { id: string; name: string }

export default function PaymentsReceivedPage() {
  const router = useRouter()
  const slug = useParams().slug as string
  const { fCurrency } = useCurrency()
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', method: '', customerId: '', warehouseId: '' })
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals>({ count: 0, amount: 0, creditApplied: 0, byMethod: [] })
  const [anyEver, setAnyEver] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Option[]>([])
  const [branches, setBranches] = useState<Option[]>([])

  useEffect(() => {
    const list = (d: unknown) => (Array.isArray(d) ? d : (d as { data?: unknown[] })?.data || []) as Option[]
    fetch('/api/customers?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setCustomers(list(d))).catch(() => undefined)
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setBranches(list(d))).catch(() => undefined)
  }, [])
  useEffect(() => { const t = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300); return () => clearTimeout(t) }, [search])

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v)
    if (debounced) qs.set('search', debounced)
    try {
      const res = await fetch(`/api/payments-received?${qs}`)
      if (!res.ok) return
      const data = await res.json()
      setRows(data.data || [])
      setTotals(data.totals)
      setAnyEver(!!data.anyEver)
      setPagination(data.pagination)
    } finally { setLoading(false) }
  }, [page, pageSize, filters, debounced])
  useRealtimeData(load, { entityType: ['payment-receipt', 'sale', 'customer'], refreshOnMount: false })
  useEffect(() => { load() }, [load])
  const setF = (k: keyof typeof filters, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1) }

  if (!loading && !anyEver) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Payments received</h1>
        <div className={`${card} py-16 px-6 text-center space-y-3`}>
          <Banknote size={40} className="mx-auto text-gray-300" aria-hidden />
          <p className="text-base font-medium text-gray-800 dark:text-gray-100">No payments received yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Payments you collect on invoices, and advances customers leave with you, show up here.</p>
          <div className="flex justify-center gap-2">
            <Link href={`/c/${slug}/sales`} className={btnSecondary}>Go to unpaid invoices</Link>
            <button className={btnPrimary} onClick={() => router.push(`/c/${slug}/payments-received/new`)}><Plus size={14} /> Record payment</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Payments received</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice, receipt, customer, reference…" aria-label="Search"
              className="h-9 w-64 pl-8 pr-3 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white" />
          </div>
          <button onClick={() => load()} className="p-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300" aria-label="Refresh"><RefreshCw size={14} /></button>
          <button onClick={() => router.push(`/c/${slug}/payments-received/new`)} className={btnPrimary}><Plus size={14} /> Record payment</button>
        </div>
      </div>
      <div className={`${card} p-3 grid gap-2 grid-cols-2 md:grid-cols-5`}>
        <input type="date" aria-label="From date" className={input} value={filters.fromDate} onChange={(e) => setF('fromDate', e.target.value)} />
        <input type="date" aria-label="To date" className={input} value={filters.toDate} onChange={(e) => setF('toDate', e.target.value)} />
        <select aria-label="Method" className={input} value={filters.method} onChange={(e) => setF('method', e.target.value)}>
          <option value="">All methods</option>
          {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Customer" className={input} value={filters.customerId} onChange={(e) => setF('customerId', e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Branch" className={input} value={filters.warehouseId} onChange={(e) => setF('warehouseId', e.target.value)}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <div className={`${card} px-4 py-2`}><span className="text-gray-500">Received</span> <span className="font-semibold dark:text-white">{fCurrency(totals.amount)}</span> <span className="text-gray-400">({totals.count})</span></div>
        {totals.creditApplied > 0 && <div className={`${card} px-4 py-2`}><span className="text-gray-500">Store credit applied</span> <span className="font-semibold dark:text-white">{fCurrency(totals.creditApplied)}</span></div>}
        {totals.byMethod.map((m) => <div key={m.method} className={`${card} px-4 py-2`}><span className="text-gray-500">{METHOD_LABELS[m.method] || m.method}</span> <span className="font-medium dark:text-white">{fCurrency(m.total)}</span></div>)}
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <caption className="sr-only">Payments received</caption>
          <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">Date</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Receipt</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Customer</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Invoice</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Mode</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Reference</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No payments match these filters</td></tr>
              : rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="border-t dark:border-gray-700 dark:text-gray-200">
                  <td className="px-4 py-2 whitespace-nowrap">{r.date}</td>
                  <td className="px-4 py-2">{r.receiptId ? <Link className="text-blue-600 dark:text-blue-400 hover:underline" href={`/c/${slug}/payments-received/${r.receiptId}`}>{r.receiptNo}</Link> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-2">{r.customerName || 'Walk-in'}</td>
                  <td className="px-4 py-2">{r.saleId ? <Link className="text-blue-600 dark:text-blue-400 hover:underline" href={`/c/${slug}/sales/${r.saleId}`}>{r.invoiceNo}</Link> : <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">Advance / credit</span>}</td>
                  <td className="px-4 py-2">{METHOD_LABELS[r.method] || r.method}</td>
                  <td className="px-4 py-2 text-gray-500">{r.reference || ''}</td>
                  <td className={`px-4 py-2 text-right font-medium ${r.method === 'credit' ? 'text-gray-500' : ''}`}>{fCurrency(r.amount)}</td>
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
