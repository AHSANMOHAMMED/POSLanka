'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, BarChart3, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { ReportExportButton } from '@/components/reports/ReportExportButton'
import { formatCurrency } from '@/lib/utils/currency'

interface AccountRow {
  accountNumber: string
  accountName: string
  accountId?: string
  amount: number
}

interface ComparisonData {
  assets: AccountRow[]
  liabilities: AccountRow[]
  equity: AccountRow[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  netProfit: number
}

interface BalanceSheetData {
  assets: AccountRow[]
  liabilities: AccountRow[]
  equity: AccountRow[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  netProfit: number
  totalLiabilitiesAndEquity: number
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

export default function BalanceSheetPage() {
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const [asOfDate, setAsOfDate] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [costCentersList, setCostCentersList] = useState<{ id: string; name: string }[]>([])
  const [compareAsOfDate, setCompareAsOfDate] = useState('')
  const [data, setData] = useState<BalanceSheetData | null>(null)
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
    if (!asOfDate) {
      toast.error('Please select an as-of date')
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ asOfDate })
      if (costCenterId) params.set('costCenterId', costCenterId)
      if (compareAsOfDate) params.set('compareAsOfDate', compareAsOfDate)
      const res = await fetch(`/api/accounting/reports/balance-sheet?${params}`)
      if (res.ok) {
        const result = await res.json()
        // Map API field 'balance' → client field 'amount'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapRows = (rows: any[]) => (rows || []).map((r: any) => ({
          accountNumber: r.accountNumber,
          accountName: r.accountName,
          accountId: r.accountId,
          amount: r.balance ?? r.amount ?? 0,
        }))
        const totalLiabPlusEquity = (result.totalLiabilities || 0) + (result.totalEquity || 0) + (result.netProfit || 0)
        setData({
          assets: mapRows(result.assets),
          liabilities: mapRows(result.liabilities),
          equity: mapRows(result.equity),
          totalAssets: result.totalAssets || 0,
          totalLiabilities: result.totalLiabilities || 0,
          totalEquity: result.totalEquity || 0,
          netProfit: result.netProfit || 0,
          totalLiabilitiesAndEquity: Math.round(totalLiabPlusEquity * 100) / 100,
          comparison: result.comparison ? {
            assets: mapRows(result.comparison.assets),
            liabilities: mapRows(result.comparison.liabilities),
            equity: mapRows(result.comparison.equity),
            totalAssets: result.comparison.totalAssets || 0,
            totalLiabilities: result.comparison.totalLiabilities || 0,
            totalEquity: result.comparison.totalEquity || 0,
            netProfit: result.comparison.netProfit || 0,
          } : undefined,
        })
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to generate balance sheet')
      }
    } catch {
      toast.error('Error generating balance sheet')
    } finally {
      setLoading(false)
    }
  }

  const hasComparison = !!data?.comparison

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  const colSpanAll = hasComparison ? 4 : 2

  function renderChange(current: number, comparison: number) {
    const change = current - comparison
    const colorClass = change === 0
      ? 'text-gray-500 dark:text-gray-400'
      : change > 0
        ? 'text-green-600 dark:text-green-400'
        : 'text-red-600 dark:text-red-400'

    return (
      <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${colorClass}`}>
        {change > 0 ? '+' : ''}{formatCurrency(change, currency)}
        {' '}
        <span className="text-xs">({formatVariancePercent(current, comparison)})</span>
      </td>
    )
  }

  function renderSection(
    title: string,
    rows: AccountRow[],
    total: number,
    comparisonRows: AccountRow[] | undefined,
    comparisonTotal: number | undefined,
    colorClass: string,
    bgClass: string,
    borderClass: string
  ) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
        <div className={`px-4 py-3 border-b dark:border-gray-700 ${bgClass} rounded-t-lg`}>
          <h2 className={`text-sm font-semibold ${colorClass}`}>{title}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">{title}</caption>
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
                      Change
                    </th>
                  </>
                ) : (
                  <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                    Balance
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpanAll} className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    No accounts with balances.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const compAmount = hasComparison && comparisonRows
                    ? getComparisonAmount(comparisonRows, row.accountName, row.accountNumber)
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
                          {renderChange(row.amount, compAmount)}
                        </>
                      )}
                    </tr>
                  )
                })
              )}
              {/* Render accounts that exist only in comparison */}
              {hasComparison && comparisonRows && comparisonRows
                .filter(cr => !rows.some(r => r.accountName === cr.accountName || r.accountNumber === cr.accountNumber))
                .map((cr, idx) => (
                  <tr key={`comp-${idx}`} className="border-t border-gray-100 dark:border-gray-700">
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
                    {renderChange(0, cr.amount)}
                  </tr>
                ))
              }
            </tbody>
            <tfoot>
              <tr className={`border-t-2 ${borderClass}`}>
                <td className={`px-4 py-3 text-sm font-semibold ${colorClass}`}>
                  Total {title}
                </td>
                <td className={`px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums ${colorClass}`}>
                  {formatCurrency(total, currency)}
                </td>
                {hasComparison && comparisonTotal !== undefined && (
                  <>
                    <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                      {formatCurrency(comparisonTotal, currency)}
                    </td>
                    {renderChange(total, comparisonTotal)}
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
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
        <span className="text-gray-900 dark:text-white font-medium">Balance Sheet</span>
      </div>

      {/* Title + Export */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Balance Sheet</h1>
        {data && <ReportExportButton
          data={[
            ...data.assets.map(r => ({ section: 'Assets', accountNumber: r.accountNumber, accountName: r.accountName, amount: r.amount })),
            { section: '', accountNumber: '', accountName: 'Total Assets', amount: data.totalAssets },
            ...data.liabilities.map(r => ({ section: 'Liabilities', accountNumber: r.accountNumber, accountName: r.accountName, amount: r.amount })),
            { section: '', accountNumber: '', accountName: 'Total Liabilities', amount: data.totalLiabilities },
            ...data.equity.map(r => ({ section: 'Equity', accountNumber: r.accountNumber, accountName: r.accountName, amount: r.amount })),
            { section: 'Equity', accountNumber: '', accountName: 'Net Profit (Current Period)', amount: data.netProfit },
            { section: '', accountNumber: '', accountName: 'Total Equity', amount: data.totalEquity + data.netProfit },
          ]}
          columns={[
            { key: 'section', header: 'Section', width: 12 },
            { key: 'accountNumber', header: 'Account #', width: 15 },
            { key: 'accountName', header: 'Account', width: 30 },
            { key: 'amount', header: 'Balance', format: 'currency' as const, width: 15 },
          ]}
          reportName="Balance Sheet"
        />}
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[180px] max-w-xs">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              As of Date
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex-1 min-w-[180px] max-w-xs">
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
            Generate
          </button>
          <div className="flex-1 min-w-[180px] max-w-xs">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Compare As of Date
            </label>
            <input
              type="date"
              value={compareAsOfDate}
              onChange={(e) => setCompareAsOfDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Report Content */}
      {data && (
        <div className="space-y-4">
          {/* Assets */}
          {renderSection(
            'Assets',
            data.assets,
            data.totalAssets,
            data.comparison?.assets,
            data.comparison?.totalAssets,
            'text-blue-800 dark:text-blue-300',
            'bg-blue-50 dark:bg-blue-900/20',
            'border-blue-200 dark:border-blue-800'
          )}

          {/* Liabilities */}
          {renderSection(
            'Liabilities',
            data.liabilities,
            data.totalLiabilities,
            data.comparison?.liabilities,
            data.comparison?.totalLiabilities,
            'text-red-800 dark:text-red-300',
            'bg-red-50 dark:bg-red-900/20',
            'border-red-200 dark:border-red-800'
          )}

          {/* Equity */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b dark:border-gray-700 bg-purple-50 dark:bg-purple-900/20 rounded-t-lg">
              <h2 className="text-sm font-semibold text-purple-800 dark:text-purple-300">Equity</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">Equity</caption>
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
                          Change
                        </th>
                      </>
                    ) : (
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                        Balance
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.equity.length === 0 && data.netProfit === 0 ? (
                    <tr>
                      <td colSpan={colSpanAll} className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                        No equity accounts with balances.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {data.equity.map((row, idx) => {
                        const compAmount = hasComparison && data.comparison
                          ? getComparisonAmount(data.comparison.equity, row.accountName, row.accountNumber)
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
                                {renderChange(row.amount, compAmount)}
                              </>
                            )}
                          </tr>
                        )
                      })}
                      {/* Comparison-only equity accounts */}
                      {hasComparison && data.comparison && data.comparison.equity
                        .filter(cr => !data.equity.some(r => r.accountName === cr.accountName || r.accountNumber === cr.accountNumber))
                        .map((cr, idx) => (
                          <tr key={`comp-eq-${idx}`} className="border-t border-gray-100 dark:border-gray-700">
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
                            {renderChange(0, cr.amount)}
                          </tr>
                        ))
                      }
                      {/* Net Profit line within equity */}
                      <tr className="border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50">
                        <td className="px-4 py-2.5">
                          <span className={`text-sm font-medium ${
                            data.netProfit >= 0
                              ? 'text-green-700 dark:text-green-400'
                              : 'text-red-700 dark:text-red-400'
                          }`}>
                            Net Profit (Current Period)
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-medium ${
                          data.netProfit >= 0
                            ? 'text-green-700 dark:text-green-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}>
                          {formatCurrency(data.netProfit, currency)}
                        </td>
                        {hasComparison && data.comparison && (
                          <>
                            <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                              {formatCurrency(data.comparison.netProfit, currency)}
                            </td>
                            {renderChange(data.netProfit, data.comparison.netProfit)}
                          </>
                        )}
                      </tr>
                    </>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-purple-200 dark:border-purple-800">
                    <td className="px-4 py-3 text-sm font-semibold text-purple-800 dark:text-purple-300">
                      Total Equity (incl. Net Profit)
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-purple-800 dark:text-purple-300">
                      {formatCurrency(data.totalEquity + data.netProfit, currency)}
                    </td>
                    {hasComparison && data.comparison && (
                      <>
                        <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                          {formatCurrency(data.comparison.totalEquity + data.comparison.netProfit, currency)}
                        </td>
                        {renderChange(
                          data.totalEquity + data.netProfit,
                          data.comparison.totalEquity + data.comparison.netProfit
                        )}
                      </>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">Total Assets</span>
                <div className="flex items-center gap-4">
                  <span className="font-mono tabular-nums font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(data.totalAssets, currency)}
                  </span>
                  {hasComparison && data.comparison && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                      vs {formatCurrency(data.comparison.totalAssets, currency)}
                    </span>
                  )}
                </div>
              </div>
              <div className="border-t dark:border-gray-700" />
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">Total Liabilities</span>
                <div className="flex items-center gap-4">
                  <span className="font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(data.totalLiabilities, currency)}
                  </span>
                  {hasComparison && data.comparison && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                      vs {formatCurrency(data.comparison.totalLiabilities, currency)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">Total Equity (incl. Net Profit)</span>
                <div className="flex items-center gap-4">
                  <span className="font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(data.totalEquity + data.netProfit, currency)}
                  </span>
                  {hasComparison && data.comparison && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                      vs {formatCurrency(data.comparison.totalEquity + data.comparison.netProfit, currency)}
                    </span>
                  )}
                </div>
              </div>
              <div className="border-t-2 border-gray-300 dark:border-gray-600 pt-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    Total Liabilities + Equity
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="font-mono tabular-nums font-bold text-gray-900 dark:text-white">
                      {formatCurrency(data.totalLiabilitiesAndEquity, currency)}
                    </span>
                    {hasComparison && data.comparison && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                        vs {formatCurrency(data.comparison.totalLiabilities + data.comparison.totalEquity + data.comparison.netProfit, currency)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {Math.abs(data.totalAssets - data.totalLiabilitiesAndEquity) > 0.01 && (
                <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
                  Warning: Balance sheet does not balance. Difference:{' '}
                  {formatCurrency(Math.abs(data.totalAssets - data.totalLiabilitiesAndEquity), currency)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <BarChart3 size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400">
            Select an as-of date and click Generate to view the balance sheet.
          </p>
        </div>
      )}
    </div>
  )
}
