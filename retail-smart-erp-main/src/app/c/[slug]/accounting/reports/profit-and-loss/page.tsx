'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, TrendingUp, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { ReportExportButton } from '@/components/reports/ReportExportButton'
import { formatCurrency } from '@/lib/utils/currency'
import type { ExportColumn } from '@/lib/reports/export'

interface AccountRow {
  accountNumber: string
  accountName: string
  accountId?: string
  amount: number
}

interface ComparisonData {
  income: AccountRow[]
  expenses: AccountRow[]
  totalIncome: number
  totalExpenses: number
  netProfitLoss: number
}

interface ProfitAndLossData {
  income: AccountRow[]
  expenses: AccountRow[]
  totalIncome: number
  totalExpenses: number
  netProfitLoss: number
  comparison?: ComparisonData
}

function formatVariancePercent(current: number, comparison: number): string {
  if (comparison === 0) return '-'
  const pct = ((current - comparison) / Math.abs(comparison)) * 100
  if (!isFinite(pct)) return '-'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function getComparisonAmount(rows: AccountRow[], accountName: string, accountNumber: string): number {
  const match = rows.find(
    r => r.accountName === accountName || r.accountNumber === accountNumber
  )
  return match?.amount ?? 0
}

export default function ProfitAndLossPage() {
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [costCentersList, setCostCentersList] = useState<{ id: string; name: string }[]>([])
  const [compareMode, setCompareMode] = useState<'none' | 'previous' | 'same_period_last_year'>('none')
  const [data, setData] = useState<ProfitAndLossData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function loadCostCenters() {
      try {
        const res = await fetch('/api/accounting/cost-centers?all=true')
        if (res.ok) {
          const data = await res.json()
          setCostCentersList(Array.isArray(data) ? data : data.data || [])
        }
      } catch {
        // Silently fail
      }
    }
    loadCostCenters()
  }, [])

  async function handleGenerate() {
    if (!fromDate || !toDate) {
      toast.error('Please select both from and to dates')
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      if (costCenterId) params.set('costCenterId', costCenterId)

      // Calculate comparison dates
      if (compareMode !== 'none') {
        const from = new Date(fromDate)
        const to = new Date(toDate)

        if (compareMode === 'previous') {
          // Same-length period ending the day before fromDate
          const durationMs = to.getTime() - from.getTime()
          const compareEnd = new Date(from)
          compareEnd.setDate(compareEnd.getDate() - 1)
          const compareStart = new Date(compareEnd.getTime() - durationMs)
          params.set('compareFromDate', compareStart.toISOString().split('T')[0])
          params.set('compareToDate', compareEnd.toISOString().split('T')[0])
        } else if (compareMode === 'same_period_last_year') {
          const compareFrom = new Date(from)
          compareFrom.setFullYear(compareFrom.getFullYear() - 1)
          const compareTo = new Date(to)
          compareTo.setFullYear(compareTo.getFullYear() - 1)
          params.set('compareFromDate', compareFrom.toISOString().split('T')[0])
          params.set('compareToDate', compareTo.toISOString().split('T')[0])
        }
      }

      const res = await fetch(`/api/accounting/reports/profit-and-loss?${params}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to generate P&L report')
      }
    } catch {
      toast.error('Error generating P&L report')
    } finally {
      setLoading(false)
    }
  }

  const hasComparison = !!data?.comparison

  const exportColumns: ExportColumn[] = [
    { key: 'type', header: 'Type', width: 10 },
    { key: 'accountNumber', header: 'Account #', width: 15 },
    { key: 'accountName', header: 'Account', width: 30 },
    { key: 'amount', header: 'Amount', format: 'currency', width: 15 },
  ]

  const exportData = data ? [
    ...data.income.map(r => ({ type: 'Income', ...r })),
    { type: '', accountNumber: '', accountName: 'Total Income', amount: data.totalIncome },
    ...data.expenses.map(r => ({ type: 'Expense', ...r })),
    { type: '', accountNumber: '', accountName: 'Total Expenses', amount: data.totalExpenses },
    { type: '', accountNumber: '', accountName: data.netProfitLoss >= 0 ? 'Net Profit' : 'Net Loss', amount: data.netProfitLoss },
  ] : []

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  const colSpanAll = hasComparison ? 5 : 2

  function renderVariance(current: number, comparison: number, favorableWhenPositive: boolean) {
    const variance = current - comparison
    // For income: increase is favorable. For expenses: decrease is favorable.
    const isFavorable = favorableWhenPositive ? variance >= 0 : variance <= 0
    const colorClass = variance === 0
      ? 'text-gray-500 dark:text-gray-400'
      : isFavorable
        ? 'text-green-600 dark:text-green-400'
        : 'text-red-600 dark:text-red-400'

    return (
      <>
        <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${colorClass}`}>
          {variance > 0 ? '+' : ''}{formatCurrency(variance, currency)}
        </td>
        <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${colorClass}`}>
          {formatVariancePercent(current, comparison)}
        </td>
      </>
    )
  }

  return (
    <div className="space-y-4 p-4 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/accounting`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Accounting
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-500 dark:text-gray-400">Reports</span>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">Profit &amp; Loss</span>
      </div>

      {/* Title + Export */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Profit &amp; Loss</h1>
        {data && <ReportExportButton data={exportData} columns={exportColumns} reportName="Profit and Loss" />}
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Cost Center
            </label>
            <select
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              className={inputClass}
            >
              <option value="">All Cost Centers</option>
              {costCentersList.map((cc) => (
                <option key={cc.id} value={cc.id}>{cc.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
            Generate
          </button>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Compare With
            </label>
            <select
              value={compareMode}
              onChange={(e) => setCompareMode(e.target.value as 'none' | 'previous' | 'same_period_last_year')}
              className={inputClass}
            >
              <option value="none">No Comparison</option>
              <option value="previous">Previous Period</option>
              <option value="same_period_last_year">Same Period Last Year</option>
            </select>
          </div>
        </div>
      </div>

      {/* Report Content */}
      {data && (
        <div className="space-y-4">
          {/* Income Section */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b dark:border-gray-700 bg-green-50 dark:bg-green-900/20 rounded-t-lg">
              <h2 className="text-sm font-semibold text-green-800 dark:text-green-300">Income</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">Income accounts</caption>
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                      Account
                    </th>
                    {hasComparison ? (
                      <>
                        <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                          Current
                        </th>
                        <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                          Comparison
                        </th>
                        <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                          Variance
                        </th>
                        <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                          %
                        </th>
                      </>
                    ) : (
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                        Amount
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.income.length === 0 ? (
                    <tr>
                      <td colSpan={colSpanAll} className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                        No income transactions for this period.
                      </td>
                    </tr>
                  ) : (
                    data.income.map((row, idx) => {
                      const compAmount = hasComparison
                        ? getComparisonAmount(data.comparison!.income, row.accountName, row.accountNumber)
                        : 0
                      return (
                        <tr key={idx} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="px-4 py-2.5">
                            <span className="text-sm text-gray-900 dark:text-white">{row.accountName}</span>
                            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                              {row.accountNumber}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                            {formatCurrency(row.amount, currency)}
                          </td>
                          {hasComparison && (
                            <>
                              <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                                {formatCurrency(compAmount, currency)}
                              </td>
                              {renderVariance(row.amount, compAmount, true)}
                            </>
                          )}
                        </tr>
                      )
                    })
                  )}
                  {/* Render accounts that exist only in comparison */}
                  {hasComparison && data.comparison!.income
                    .filter(cr => !data.income.some(r => r.accountName === cr.accountName || r.accountNumber === cr.accountNumber))
                    .map((cr, idx) => (
                      <tr key={`comp-inc-${idx}`} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-2.5">
                          <span className="text-sm text-gray-900 dark:text-white">{cr.accountName}</span>
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                            {cr.accountNumber}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                          {formatCurrency(0, currency)}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                          {formatCurrency(cr.amount, currency)}
                        </td>
                        {renderVariance(0, cr.amount, true)}
                      </tr>
                    ))
                  }
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10">
                    <td className="px-4 py-3 text-sm font-semibold text-green-800 dark:text-green-300">
                      Total Income
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-green-800 dark:text-green-300">
                      {formatCurrency(data.totalIncome, currency)}
                    </td>
                    {hasComparison && (
                      <>
                        <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                          {formatCurrency(data.comparison!.totalIncome, currency)}
                        </td>
                        {renderVariance(data.totalIncome, data.comparison!.totalIncome, true)}
                      </>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Expenses Section */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b dark:border-gray-700 bg-red-50 dark:bg-red-900/20 rounded-t-lg">
              <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">Expenses</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">Expense accounts</caption>
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                      Account
                    </th>
                    {hasComparison ? (
                      <>
                        <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                          Current
                        </th>
                        <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                          Comparison
                        </th>
                        <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                          Variance
                        </th>
                        <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                          %
                        </th>
                      </>
                    ) : (
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                        Amount
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.length === 0 ? (
                    <tr>
                      <td colSpan={colSpanAll} className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                        No expense transactions for this period.
                      </td>
                    </tr>
                  ) : (
                    data.expenses.map((row, idx) => {
                      const compAmount = hasComparison
                        ? getComparisonAmount(data.comparison!.expenses, row.accountName, row.accountNumber)
                        : 0
                      return (
                        <tr key={idx} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="px-4 py-2.5">
                            <span className="text-sm text-gray-900 dark:text-white">{row.accountName}</span>
                            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                              {row.accountNumber}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                            {formatCurrency(row.amount, currency)}
                          </td>
                          {hasComparison && (
                            <>
                              <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                                {formatCurrency(compAmount, currency)}
                              </td>
                              {/* Expenses: decrease is favorable, so favorableWhenPositive = false */}
                              {renderVariance(row.amount, compAmount, false)}
                            </>
                          )}
                        </tr>
                      )
                    })
                  )}
                  {/* Render accounts that exist only in comparison */}
                  {hasComparison && data.comparison!.expenses
                    .filter(cr => !data.expenses.some(r => r.accountName === cr.accountName || r.accountNumber === cr.accountNumber))
                    .map((cr, idx) => (
                      <tr key={`comp-exp-${idx}`} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-2.5">
                          <span className="text-sm text-gray-900 dark:text-white">{cr.accountName}</span>
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                            {cr.accountNumber}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                          {formatCurrency(0, currency)}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                          {formatCurrency(cr.amount, currency)}
                        </td>
                        {renderVariance(0, cr.amount, false)}
                      </tr>
                    ))
                  }
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10">
                    <td className="px-4 py-3 text-sm font-semibold text-red-800 dark:text-red-300">
                      Total Expenses
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-red-800 dark:text-red-300">
                      {formatCurrency(data.totalExpenses, currency)}
                    </td>
                    {hasComparison && (
                      <>
                        <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                          {formatCurrency(data.comparison!.totalExpenses, currency)}
                        </td>
                        {renderVariance(data.totalExpenses, data.comparison!.totalExpenses, false)}
                      </>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Net Profit/Loss */}
          <div className={`rounded border p-4 ${
            data.netProfitLoss >= 0
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}>
            <div className={`flex items-center ${hasComparison ? 'justify-between' : 'justify-between'}`}>
              <span className={`text-lg font-semibold ${
                data.netProfitLoss >= 0
                  ? 'text-green-800 dark:text-green-300'
                  : 'text-red-800 dark:text-red-300'
              }`}>
                {data.netProfitLoss >= 0 ? 'Net Profit' : 'Net Loss'}
              </span>
              <div className="flex items-center gap-6">
                <span className={`text-lg font-bold font-mono tabular-nums ${
                  data.netProfitLoss >= 0
                    ? 'text-green-800 dark:text-green-300'
                    : 'text-red-800 dark:text-red-300'
                }`}>
                  {formatCurrency(Math.abs(data.netProfitLoss), currency)}
                </span>
                {hasComparison && (
                  <>
                    <span className="text-sm text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                      vs {formatCurrency(Math.abs(data.comparison!.netProfitLoss), currency)}
                    </span>
                    {(() => {
                      const variance = data.netProfitLoss - data.comparison!.netProfitLoss
                      const isFavorable = variance >= 0
                      const colorClass = variance === 0
                        ? 'text-gray-500 dark:text-gray-400'
                        : isFavorable
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      return (
                        <span className={`text-sm font-mono tabular-nums font-semibold ${colorClass}`}>
                          {variance > 0 ? '+' : ''}{formatCurrency(variance, currency)}
                          {' '}
                          ({formatVariancePercent(data.netProfitLoss, data.comparison!.netProfitLoss)})
                        </span>
                      )
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <TrendingUp size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400">
            Select a date range and click Generate to view the profit and loss report.
          </p>
        </div>
      )}
    </div>
  )
}
