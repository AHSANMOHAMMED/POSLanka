'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  Loader2,
  Package,
  TrendingUp,
  FileText,
  CalendarClock,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Award,
} from 'lucide-react'
import { useCurrency, useRealtimeData } from '@/hooks'
import { formatCurrency } from '@/lib/utils/currency'

interface ChequeRow {
  id: string
  direction: 'received' | 'issued'
  chequeNo: string
  bankName: string
  chequeDate: string
  amount: number
  status: string
  party: string | null
}

interface Dashboard {
  period: { fromDate: string; toDate: string }
  today: string
  branches: Array<{ id: string; name: string }>
  stock: {
    atCost: number
    atSellingPrice: number
    potentialMargin: number
    byBranch: Array<{
      warehouseId: string
      name: string
      atCost: number
      atSellingPrice: number
      units: number
      itemsInStock: number
    }>
  }
  profit: {
    sales: number
    revenue: number
    costOfGoods: number
    grossProfit: number
    marginPercent: number | null
    topItems: Array<{
      itemId: string | null
      name: string
      quantity: number
      revenue: number
      cost: number
      profit: number
      marginPercent: number | null
    }>
  }
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
  { key: 'month', label: 'This Month' },
  { key: '30', label: 'Last 30 Days' },
] as const
type PeriodKey = typeof PERIODS[number]['key']

function periodRange(key: PeriodKey): { fromDate: string; toDate: string } {
  const now = new Date()
  const toDate = now.toLocaleDateString('en-CA')
  if (key === 'today') return { fromDate: toDate, toDate }
  if (key === 'month') return { fromDate: new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA'), toDate }
  return { fromDate: new Date(now.getTime() - 29 * 86400000).toLocaleDateString('en-CA'), toDate }
}

const CARD_CLASS = 'bg-white dark:bg-gray-800/90 backdrop-blur-sm rounded-xl border border-gray-200/90 dark:border-gray-700/80 p-5 shadow-sm hover:border-gray-300 dark:hover:border-gray-600 transition-all flex flex-col justify-between'

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
      if (!res.ok) {
        setError(body.error || 'Failed to load executive figures')
        return
      }
      setError(null)
      setData(body)
    } finally {
      setLoading(false)
    }
  }, [branch, period])

  useEffect(() => {
    void load()
  }, [load])

  useRealtimeData(load, { entityType: 'sale', refreshOnMount: false })
  useRealtimeData(load, { entityType: 'cheque', refreshOnMount: false })

  if (loading && !data) {
    return (
      <div className={`${CARD_CLASS} items-center justify-center py-12`}>
        <Loader2 className="w-7 h-7 animate-spin text-blue-500 mb-2" />
        <p className="text-xs text-gray-400">Loading business metrics...</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className={`${CARD_CLASS} text-sm text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/50`}>
        {error}
      </div>
    )
  }

  if (!data) return null

  const { stock, profit, cheques, expiring, lowStock } = data

  const maxTopProfit = profit.topItems.length > 0 ? Math.max(...profit.topItems.map(i => Math.max(i.profit, 0))) : 1

  return (
    <section aria-label="Business overview" className="space-y-4">
      {/* Header Bar with Segmented Control & Branch Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-gray-800/80 p-3 rounded-xl border border-gray-200/90 dark:border-gray-700/80 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">
            Executive Performance Overview
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period Segmented Control */}
          <div className="flex bg-gray-100 dark:bg-gray-700/60 p-0.5 rounded-lg border border-gray-200/80 dark:border-gray-600/50" role="group" aria-label="Period">
            {PERIODS.map((p) => {
              const active = period === p.key
              return (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  aria-pressed={active}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    active
                      ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          {/* Branch Dropdown */}
          {data.branches.length > 1 && (
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              aria-label="Branch"
              className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1 text-xs font-medium bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Branches</option>
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {loading && <Loader2 className="w-4 h-4 animate-spin text-blue-500 ml-1" />}
        </div>
      </div>

      {/* Row 1: Primary Executive Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Gross Profit Card */}
        <div className={CARD_CLASS}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <TrendingUp size={18} />
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Gross Profit
                  </span>
                  <div className="text-[11px] text-gray-400">
                    {profit.sales} completed transaction{profit.sales === 1 ? '' : 's'}
                  </div>
                </div>
              </div>

              {profit.marginPercent !== null && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                  <ArrowUpRight size={14} />
                  {profit.marginPercent}% margin
                </span>
              )}
            </div>

            <p className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              {money(profit.grossProfit)}
            </p>

            {/* Margin Progress Meter */}
            {profit.marginPercent !== null && (
              <div className="mt-3">
                <div className="flex justify-between text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
                  <span>Gross Margin Efficiency</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{profit.marginPercent}%</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-700 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(Math.max(profit.marginPercent, 0), 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/60 grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 dark:bg-gray-700/30 p-2 rounded-lg">
              <span className="text-gray-400 dark:text-gray-400 block text-[10px] uppercase font-semibold">Revenue (ex. tax)</span>
              <span className="font-bold text-gray-800 dark:text-gray-100">{money(profit.revenue)}</span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/30 p-2 rounded-lg">
              <span className="text-gray-400 dark:text-gray-400 block text-[10px] uppercase font-semibold">Cost of Goods</span>
              <span className="font-bold text-gray-800 dark:text-gray-100">{money(profit.costOfGoods)}</span>
            </div>
          </div>
        </div>

        {/* Stock Value Card */}
        <div className={CARD_CLASS}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Package size={18} />
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Total Inventory Value
                  </span>
                  <div className="text-[11px] text-gray-400">At warehouse acquisition cost</div>
                </div>
              </div>
            </div>

            <p className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              {money(stock.atCost)}
            </p>

            <div className="mt-3 flex items-center justify-between text-xs font-medium bg-blue-50/60 dark:bg-blue-950/20 p-2 rounded-lg border border-blue-100 dark:border-blue-900/30">
              <span className="text-gray-600 dark:text-gray-300">Potential Gross Margin:</span>
              <span className="font-bold text-blue-700 dark:text-blue-400">+{money(stock.potentialMargin)}</span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/60">
            <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
              <span>Retail Value (at selling price):</span>
              <span className="font-bold text-gray-900 dark:text-white">{money(stock.atSellingPrice)}</span>
            </div>

            {stock.byBranch.length > 1 && (
              <div className="mt-2 max-h-24 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50 text-[11px]">
                {stock.byBranch.map((b) => (
                  <div key={b.warehouseId} className="flex justify-between py-1 text-gray-600 dark:text-gray-300">
                    <span className="font-medium truncate">{b.name}</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{money(b.atCost)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cheques Cashflow Card */}
        <div className={CARD_CLASS}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <FileText size={18} />
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Cheques Horizon (7 Days)
                  </span>
                  <div className="text-[11px] text-gray-400">Upcoming clearing schedule</div>
                </div>
              </div>

              <Link
                href={`/c/${slug}/accounting/cheques`}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5"
              >
                Register <ChevronRight size={14} />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-emerald-50/60 dark:bg-emerald-950/30 p-2 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">
                  <ArrowDownRight size={12} /> Received ({cheques.next7Days.received.count})
                </div>
                <div className="text-sm font-extrabold text-emerald-800 dark:text-emerald-300 mt-0.5">
                  {money(cheques.next7Days.received.amount)}
                </div>
              </div>

              <div className="bg-rose-50/60 dark:bg-rose-950/30 p-2 rounded-lg border border-rose-100 dark:border-rose-900/30">
                <div className="flex items-center gap-1 text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase">
                  <ArrowUpRight size={12} /> Issued ({cheques.next7Days.issued.count})
                </div>
                <div className="text-sm font-extrabold text-rose-800 dark:text-rose-300 mt-0.5">
                  {money(cheques.next7Days.issued.amount)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/60 text-xs">
            {cheques.overdue.count > 0 || cheques.bounced.count > 0 ? (
              <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 p-2 rounded-lg border border-amber-200 dark:border-amber-900/40 text-[11px] font-medium">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-amber-600" />
                  <span>
                    {cheques.overdue.count} Overdue · {cheques.bounced.count} Bounced
                  </span>
                </div>
                <span className="font-bold">{money(cheques.overdue.amount + cheques.bounced.amount)}</span>
              </div>
            ) : (
              <div className="text-center py-2 text-[11px] text-gray-400">
                All scheduled cheques in good standing
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Secondary Performance & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Items by Profit Card */}
        <div className={CARD_CLASS}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Award size={18} />
                </div>
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Top Margin Drivers
                </span>
              </div>
              <span className="text-[11px] text-gray-400">By net profit</span>
            </div>

            {profit.topItems.length === 0 ? (
              <div className="text-center py-6 px-3 bg-gray-50/50 dark:bg-gray-800/40 rounded-lg border border-dashed border-gray-200 dark:border-gray-700/60">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">No products sold in this period</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Top profit contributors will rank here automatically as sales happen</p>
                <Link
                  href={`/c/${slug}/pos`}
                  className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
                >
                  Start selling at POS
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                {profit.topItems.slice(0, 5).map((item, index) => {
                  const percentOfTop = Math.max(Math.min((item.profit / maxTopProfit) * 100, 100), 5)
                  const rankBadgeClass =
                    index === 0
                      ? 'bg-amber-500 text-white'
                      : index === 1
                      ? 'bg-slate-400 text-white'
                      : index === 2
                      ? 'bg-amber-700 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'

                  return (
                    <div key={item.itemId || item.name} className="group">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${rankBadgeClass}`}>
                            {index + 1}
                          </span>
                          <span className="font-semibold text-gray-800 dark:text-gray-200 truncate group-hover:text-blue-600 transition-colors">
                            {item.name}
                          </span>
                          <span className="text-[10px] text-gray-400">({item.quantity} sold)</span>
                        </div>
                        <div className="text-right whitespace-nowrap pl-2">
                          <span className="font-bold text-gray-900 dark:text-white">{money(item.profit)}</span>
                          {item.marginPercent !== null && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium ml-1">
                              {item.marginPercent}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-700/60 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${percentOfTop}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Expiring Batches Card */}
        <div className={CARD_CLASS}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 flex items-center justify-center">
                  <CalendarClock size={18} />
                </div>
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Expiring Batches (30d)
                </span>
              </div>
              {expiring.next30Days.count > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                  {expiring.next30Days.count} batch{expiring.next30Days.count === 1 ? '' : 'es'}
                </span>
              )}
            </div>

            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {money(expiring.next30Days.valueAtCost)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Estimated exposure at cost price</p>

            {expiring.expired.count > 0 && (
              <div className="mt-3 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs font-medium border border-rose-200 dark:border-rose-900/40">
                {expiring.expired.count} batch{expiring.expired.count === 1 ? '' : 'es'} already expired ({money(expiring.expired.valueAtCost)})
              </div>
            )}

            {expiring.next30Days.list.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto">
                {expiring.next30Days.list.slice(0, 5).map((b) => (
                  <div key={b.id} className="flex justify-between items-center text-xs py-1 border-b border-gray-100 dark:border-gray-700/50">
                    <span className="truncate font-medium text-gray-700 dark:text-gray-300 max-w-[12rem]">
                      {b.name} <span className="text-[10px] text-gray-400">{b.batchNumber}</span>
                    </span>
                    <span className="text-orange-600 dark:text-orange-400 font-semibold text-[11px] whitespace-nowrap">
                      {b.expiryDate}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Low Stock Alerts Card */}
        <div className={CARD_CLASS}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center">
                  <AlertTriangle size={18} />
                </div>
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Reorder Attention
                </span>
              </div>
              <Link
                href={`/c/${slug}/stock/reorder-dashboard`}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
              >
                Reorder <ChevronRight size={14} />
              </Link>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {lowStock.count}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                item{lowStock.count === 1 ? '' : 's'} at or below reorder threshold
              </span>
            </div>

            {lowStock.outOfStock > 0 && (
              <div className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
                ⚠️ {lowStock.outOfStock} completely out of stock
              </div>
            )}

            {lowStock.list.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto">
                {lowStock.list.slice(0, 5).map((l) => (
                  <div key={`${l.itemId}-${l.warehouse}`} className="flex justify-between items-center text-xs py-1 border-b border-gray-100 dark:border-gray-700/50">
                    <span className="truncate font-medium text-gray-700 dark:text-gray-300 max-w-[12rem]">
                      {l.name} <span className="text-[10px] text-gray-400">({l.warehouse})</span>
                    </span>
                    <span className={`font-bold text-[11px] ${l.current <= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {l.current} / {l.reorderLevel}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
