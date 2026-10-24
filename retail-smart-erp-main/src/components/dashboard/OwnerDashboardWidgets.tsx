'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Loader2, Package, TrendingUp, FileText, CalendarClock, AlertTriangle } from 'lucide-react'
import { useCurrency, useRealtimeData } from '@/hooks'
import { formatCurrency } from '@/lib/utils/currency'

interface ChequeRow { id: string; direction: 'received' | 'issued'; chequeNo: string; bankName: string; chequeDate: string; amount: number; status: string; party: string | null }
interface Dashboard {
  period: { fromDate: string; toDate: string }
  today: string
  branches: Array<{ id: string; name: string }>
  stock: { atCost: number; atSellingPrice: number; potentialMargin: number; byBranch: Array<{ warehouseId: string; name: string; atCost: number; atSellingPrice: number; units: number; itemsInStock: number }> }
  profit: { sales: number; revenue: number; costOfGoods: number; grossProfit: number; marginPercent: number | null; topItems: Array<{ itemId: string | null; name: string; quantity: number; revenue: number; cost: number; profit: number; marginPercent: number | null }> }
  cheques: {
    next7Days: { received: { count: number; amount: number }; issued: { count: number; amount: number }; list: ChequeRow[] }
    overdue: { count: number; amount: number; list: ChequeRow[] }
    bounced: { count: number; amount: number; list: ChequeRow[] }
  }
  expiring: {
    next30Days: { count: number; quantity: number; valueAtCost: number; list: Array<{ id: string; name: string; batchNumber: string; expiryDate: string; quantity: number; valueAtCost: number; warehouse: string | null }> }
    expired: { count: number; quantity: number; valueAtCost: number }
  }
  lowStock: { count: number; outOfStock: number; list: Array<{ itemId: string; name: string; warehouse: string; current: number; reorderLevel: number }> }
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'month', label: 'This month' },
  { key: '30', label: 'Last 30 days' },
] as const
type PeriodKey = typeof PERIODS[number]['key']

function periodRange(key: PeriodKey): { fromDate: string; toDate: string } {
  const now = new Date()
  const toDate = now.toLocaleDateString('en-CA')
  if (key === 'today') return { fromDate: toDate, toDate }
  if (key === 'month') return { fromDate: new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA'), toDate }
  return { fromDate: new Date(now.getTime() - 29 * 86400000).toLocaleDateString('en-CA'), toDate }
}

const CARD = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4'
const H = 'font-semibold text-gray-900 dark:text-white flex items-center gap-2'
const MUTED = 'text-xs text-gray-500 dark:text-gray-400'

/** K1: owner / manager figures (GET /api/dashboard/owner) with a branch and period selector. */
export function OwnerDashboardWidgets() {
  const params = useParams()
  const slug = params.slug as string
  const { currency } = useCurrency()
  const money = (n: number) => formatCurrency(n, currency)
  const [branch, setBranch] = useState('')
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { fromDate, toDate } = periodRange(period)
    const p = new URLSearchParams({ fromDate, toDate })
    if (branch) p.set('warehouseId', branch)
    try {
      const res = await fetch(`/api/dashboard/owner?${p}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error || 'Failed to load'); return }
      setError(null)
      setData(body)
    } finally {
      setLoading(false)
    }
  }, [branch, period])

  useEffect(() => { void load() }, [load])
  useRealtimeData(load, { entityType: 'sale', refreshOnMount: false })
  useRealtimeData(load, { entityType: 'cheque', refreshOnMount: false })

  if (loading && !data) {
    return <div className={`${CARD} flex justify-center py-8`}><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  }
  if (error && !data) return <div className={`${CARD} text-sm text-red-600`}>{error}</div>
  if (!data) return null

  const { stock, profit, cheques, expiring, lowStock } = data
  const chequeLine = (c: ChequeRow) => (
    <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="min-w-0 truncate dark:text-gray-200">
        <span className={c.direction === 'received' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>{c.direction === 'received' ? 'IN' : 'OUT'}</span>{' '}
        {c.chequeNo} · {c.bankName} · {c.party || '—'}
      </span>
      <span className="whitespace-nowrap text-gray-600 dark:text-gray-300">{c.chequeDate} · {money(c.amount)}</span>
    </li>
  )

  return (
    <section aria-label="Business overview" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mr-auto">Business overview</h2>
        <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)} aria-pressed={period === p.key}
              className={`px-3 py-1 text-sm ${period === p.key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {data.branches.length > 1 && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"
            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="">All branches</option>
            {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className={CARD}>
          <h3 className={H}><TrendingUp size={18} className="text-green-600" /> Gross profit</h3>
          <p className="text-2xl font-bold mt-2 text-gray-900 dark:text-white">{money(profit.grossProfit)}</p>
          <p className={MUTED}>{profit.marginPercent !== null ? `${profit.marginPercent}% margin · ` : ''}{profit.sales} sale{profit.sales === 1 ? '' : 's'} · {data.period.fromDate}{data.period.fromDate !== data.period.toDate ? ` → ${data.period.toDate}` : ''}</p>
          <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Revenue (ex. tax)</dt><dd className="text-right dark:text-gray-200">{money(profit.revenue)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Cost of goods</dt><dd className="text-right dark:text-gray-200">{money(profit.costOfGoods)}</dd>
          </dl>
        </div>
        <div className={CARD}>
          <h3 className={H}><Package size={18} className="text-blue-600" /> Stock value</h3>
          <p className="text-2xl font-bold mt-2 text-gray-900 dark:text-white">{money(stock.atCost)}</p>
          <p className={MUTED}>at cost · {money(stock.atSellingPrice)} at selling price · {money(stock.potentialMargin)} potential margin</p>
          {stock.byBranch.length > 1 && (
            <table className="w-full mt-3 text-sm">
              <thead><tr className={MUTED}><th className="text-left font-normal">Branch</th><th className="text-right font-normal">At cost</th><th className="text-right font-normal">At price</th></tr></thead>
              <tbody>{stock.byBranch.map((b) => (
                <tr key={b.warehouseId} className="dark:text-gray-200"><td>{b.name}</td><td className="text-right">{money(b.atCost)}</td><td className="text-right">{money(b.atSellingPrice)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className={CARD}>
          <h3 className={H}><FileText size={18} className="text-indigo-600" /> Cheques — next 7 days</h3>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">To bank ({cheques.next7Days.received.count})</dt><dd className="text-right font-medium text-green-700 dark:text-green-400">{money(cheques.next7Days.received.amount)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Ours presented ({cheques.next7Days.issued.count})</dt><dd className="text-right font-medium text-red-700 dark:text-red-400">{money(cheques.next7Days.issued.amount)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Overdue ({cheques.overdue.count})</dt><dd className={`text-right ${cheques.overdue.count ? 'text-red-600 font-medium' : 'dark:text-gray-200'}`}>{money(cheques.overdue.amount)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Bounced ({cheques.bounced.count})</dt><dd className={`text-right ${cheques.bounced.count ? 'text-red-600 font-medium' : 'dark:text-gray-200'}`}>{money(cheques.bounced.amount)}</dd>
          </dl>
          {[...cheques.overdue.list, ...cheques.next7Days.list].length > 0 && (
            <ul className="mt-2 divide-y dark:divide-gray-700 max-h-40 overflow-y-auto">{[...cheques.overdue.list, ...cheques.next7Days.list].slice(0, 8).map(chequeLine)}</ul>
          )}
          <Link href={`/c/${slug}/accounting/cheques`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Cheques register →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className={CARD}>
          <h3 className={H}><TrendingUp size={18} className="text-emerald-600" /> Top items by profit</h3>
          {profit.topItems.length === 0 ? <p className={`${MUTED} mt-2`}>No sales in this period.</p> : (
            <table className="w-full mt-2 text-sm">
              <thead><tr className={MUTED}><th className="text-left font-normal">Item</th><th className="text-right font-normal">Qty</th><th className="text-right font-normal">Profit</th></tr></thead>
              <tbody>{profit.topItems.map((i) => (
                <tr key={i.itemId || i.name} className="dark:text-gray-200">
                  <td className="truncate max-w-[10rem]">{i.name}</td>
                  <td className="text-right">{i.quantity}</td>
                  <td className="text-right">{money(i.profit)}{i.marginPercent !== null && <span className={MUTED}> · {i.marginPercent}%</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className={CARD}>
          <h3 className={H}><CalendarClock size={18} className="text-amber-600" /> Expiring in 30 days</h3>
          <p className="text-sm mt-2 dark:text-gray-200">{expiring.next30Days.count} batch{expiring.next30Days.count === 1 ? '' : 'es'} · {money(expiring.next30Days.valueAtCost)} at cost</p>
          {expiring.expired.count > 0 && <p className="text-sm text-red-600 dark:text-red-400">{expiring.expired.count} expired batch{expiring.expired.count === 1 ? '' : 'es'} still in stock ({money(expiring.expired.valueAtCost)})</p>}
          <ul className="mt-2 divide-y dark:divide-gray-700 max-h-40 overflow-y-auto">
            {expiring.next30Days.list.slice(0, 8).map((b) => (
              <li key={b.id} className="flex justify-between gap-2 py-1.5 text-sm dark:text-gray-200">
                <span className="truncate">{b.name} <span className={MUTED}>{b.batchNumber}</span></span>
                <span className="whitespace-nowrap">{b.expiryDate} · {b.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={CARD}>
          <h3 className={H}><AlertTriangle size={18} className="text-red-500" /> Low stock</h3>
          <p className="text-sm mt-2 dark:text-gray-200">{lowStock.count} at or below reorder level{lowStock.outOfStock ? ` · ${lowStock.outOfStock} out of stock` : ''}</p>
          <ul className="mt-2 divide-y dark:divide-gray-700 max-h-40 overflow-y-auto">
            {lowStock.list.slice(0, 8).map((l) => (
              <li key={`${l.itemId}-${l.warehouse}`} className="flex justify-between gap-2 py-1.5 text-sm dark:text-gray-200">
                <span className="truncate">{l.name} <span className={MUTED}>{l.warehouse}</span></span>
                <span className={`whitespace-nowrap ${l.current <= 0 ? 'text-red-600' : ''}`}>{l.current} / {l.reorderLevel}</span>
              </li>
            ))}
          </ul>
          <Link href={`/c/${slug}/stock/reorder-dashboard`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Reorder dashboard →</Link>
        </div>
      </div>
    </section>
  )
}
