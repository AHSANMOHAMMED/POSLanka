'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { toast } from '@/components/ui/toast'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCurrency } from '@/hooks/useCurrency'

interface ExpiryRow {
  batchId: string
  batchNumber: string
  expiryDate: string
  quantity: string
  itemName: string
  genericName: string | null
  strength: string | null
  unit: string | null
  warehouseName: string | null
  daysLeft: number
  stockValue: number
}

/** Expired and short-dated batches in stock, soonest first. */
export default function ExpiryReportPage() {
  const { slug } = useParams<{ slug: string }>()
  const { fCurrency } = useCurrency()
  const [days, setDays] = useState(90)
  // Dashboard alert window (tenants.settings.pharmacy.expiryAlertDays)
  const [alertDays, setAlertDays] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ExpiryRow[]>([])
  const [summary, setSummary] = useState<{ batches: number; expiredBatches: number; expiredValue: number; expiringValue: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pharmacy/expiry?days=${days}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the report')
      setRows(body.data)
      setSummary(body.summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the report')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/pharmacy/settings').then((r) => (r.ok ? r.json() : null)).then((s) => {
      if (s?.expiryAlertDays) { setAlertDays(s.expiryAlertDays); setDays(s.expiryAlertDays) }
    }).catch(() => undefined)
  }, [])

  async function saveAlertDays() {
    const res = await fetch('/api/pharmacy/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiryAlertDays: days }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Could not save'); return }
    setAlertDays(body.expiryAlertDays)
    toast.success(`Dashboard expiry alert now warns ${body.expiryAlertDays} days ahead`)
  }

  const q = search.trim().toLowerCase()
  const shown = q ? rows.filter((r) => `${r.itemName} ${r.genericName ?? ''} ${r.batchNumber}`.toLowerCase().includes(q)) : rows

  return (
    <ListPageLayout
      module="Stock"
      moduleHref="/stock"
      title="Expiry Report"
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Medicine, generic name or batch"
      onRefresh={load}
      filterContent={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded border px-2 py-1 text-sm dark:bg-gray-700" aria-label="Expiring within">
            {Array.from(new Set([30, 60, 90, 180, 365, ...(alertDays ? [alertDays] : [])])).sort((a, b) => a - b).map((d) => <option key={d} value={d}>Expired or expiring in {d} days</option>)}
          </select>
          {alertDays !== null && alertDays !== days && (
            <button type="button" onClick={saveAlertDays} className="rounded border px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700">Use {days} days for the dashboard alert</button>
          )}
          <Link href={`/c/${slug}/pharmacy/return-list?days=${days}`} className="rounded border px-2 py-1 text-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700">Return to supplier list</Link>
        </div>
      }
    >
      {summary && (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded border bg-white p-3 dark:border-gray-700 dark:bg-gray-800"><div className="text-xs text-gray-500">Batches</div><div className="text-lg font-semibold">{summary.batches}</div></div>
          <div className="rounded border bg-white p-3 dark:border-gray-700 dark:bg-gray-800"><div className="text-xs text-gray-500">Already expired</div><div className="text-lg font-semibold text-red-600">{summary.expiredBatches}</div></div>
          <div className="rounded border bg-white p-3 dark:border-gray-700 dark:bg-gray-800"><div className="text-xs text-gray-500">Expired stock (cost)</div><div className="text-lg font-semibold text-red-600">{fCurrency(summary.expiredValue)}</div></div>
          <div className="rounded border bg-white p-3 dark:border-gray-700 dark:bg-gray-800"><div className="text-xs text-gray-500">Expiring soon (cost)</div><div className="text-lg font-semibold text-amber-600">{fCurrency(summary.expiringValue)}</div></div>
        </div>
      )}
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="overflow-x-auto rounded border bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
            <tr>
              <th className="px-3 py-2">Medicine</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Expiry</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Value (cost)</th>
              <th className="px-3 py-2">Branch</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Nothing expired or expiring in the next {days} days.</td></tr>
            ) : shown.map((r) => (
              <tr key={r.batchId} className="border-t dark:border-gray-700">
                <td className="px-3 py-2">{r.itemName}{(r.genericName || r.strength) && <div className="text-xs text-gray-500">{[r.genericName, r.strength].filter(Boolean).join(' ')}</div>}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.batchNumber}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.expiryDate}
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-semibold ${r.daysLeft < 0 ? 'bg-red-100 text-red-700' : r.daysLeft <= 30 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>
                    {r.daysLeft < 0 ? `expired ${-r.daysLeft} d ago` : r.daysLeft === 0 ? 'expires today' : `${r.daysLeft} d left`}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{Number(r.quantity)} {r.unit || ''}</td>
                <td className="px-3 py-2 text-right">{fCurrency(r.stockValue)}</td>
                <td className="px-3 py-2">{r.warehouseName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListPageLayout>
  )
}
