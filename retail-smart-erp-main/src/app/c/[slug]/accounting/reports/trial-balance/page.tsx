'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, BarChart3, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { ReportExportButton } from '@/components/reports/ReportExportButton'

interface TrialBalanceRow {
  accountNumber: string
  accountName: string
  openingDebit: number
  openingCredit: number
  periodDebit: number
  periodCredit: number
  closingDebit: number
  closingCredit: number
}

interface TrialBalanceData {
  rows: TrialBalanceRow[]
  totals: {
    openingDebit: number
    openingCredit: number
    periodDebit: number
    periodCredit: number
    closingDebit: number
    closingCredit: number
  }
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function TrialBalancePage() {
  const { tenantSlug } = useCompany()
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [costCentersList, setCostCentersList] = useState<{ id: string; name: string }[]>([])
  const [data, setData] = useState<TrialBalanceData | null>(null)
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
      const res = await fetch(`/api/accounting/reports/trial-balance?${params}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to generate trial balance')
      }
    } catch {
      toast.error('Error generating trial balance')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
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
        <span className="text-gray-900 dark:text-white font-medium">Trial Balance</span>
      </div>

      {/* Title + Export */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Trial Balance</h1>
        {data && data.rows.length > 0 && <ReportExportButton
          data={data.rows.map(r => ({
            accountNumber: r.accountNumber,
            accountName: r.accountName,
            openingDebit: r.openingDebit,
            openingCredit: r.openingCredit,
            periodDebit: r.periodDebit,
            periodCredit: r.periodCredit,
            closingDebit: r.closingDebit,
            closingCredit: r.closingCredit,
          }))}
          columns={[
            { key: 'accountNumber', header: 'Account #', width: 12 },
            { key: 'accountName', header: 'Account', width: 25 },
            { key: 'openingDebit', header: 'Opening Debit', format: 'currency' as const, width: 12 },
            { key: 'openingCredit', header: 'Opening Credit', format: 'currency' as const, width: 12 },
            { key: 'periodDebit', header: 'Period Debit', format: 'currency' as const, width: 12 },
            { key: 'periodCredit', header: 'Period Credit', format: 'currency' as const, width: 12 },
            { key: 'closingDebit', header: 'Closing Debit', format: 'currency' as const, width: 12 },
            { key: 'closingCredit', header: 'Closing Credit', format: 'currency' as const, width: 12 },
          ]}
          reportName="Trial Balance"
        />}
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
            Generate
          </button>
        </div>
      </div>

      {/* Report Content */}
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Trial Balance Report</caption>
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th scope="col" rowSpan={2} className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400 border-b dark:border-gray-700">
                  Account Number
                </th>
                <th scope="col" rowSpan={2} className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400 border-b dark:border-gray-700">
                  Account Name
                </th>
                <th scope="col" colSpan={2} className="px-4 py-2 text-center text-sm font-medium text-gray-600 dark:text-gray-400 border-b dark:border-gray-700">
                  Opening
                </th>
                <th scope="col" colSpan={2} className="px-4 py-2 text-center text-sm font-medium text-gray-600 dark:text-gray-400 border-b dark:border-gray-700">
                  Period
                </th>
                <th scope="col" colSpan={2} className="px-4 py-2 text-center text-sm font-medium text-gray-600 dark:text-gray-400 border-b dark:border-gray-700">
                  Closing
                </th>
              </tr>
              <tr>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Debit
                </th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Credit
                </th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Debit
                </th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Credit
                </th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Debit
                </th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Credit
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    No data available for the selected period.
                  </td>
                </tr>
              ) : (
                data.rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 font-mono">
                      {row.accountNumber}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.accountName}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {row.openingDebit > 0 ? formatCurrency(row.openingDebit) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {row.openingCredit > 0 ? formatCurrency(row.openingCredit) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {row.periodDebit > 0 ? formatCurrency(row.periodDebit) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {row.periodCredit > 0 ? formatCurrency(row.periodCredit) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {row.closingDebit > 0 ? formatCurrency(row.closingDebit) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {row.closingCredit > 0 ? formatCurrency(row.closingCredit) : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                  <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right">
                    Totals
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(data.totals.openingDebit)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(data.totals.openingCredit)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(data.totals.periodDebit)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(data.totals.periodCredit)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(data.totals.closingDebit)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(data.totals.closingCredit)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {!data && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <BarChart3 size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400">
            Select a date range and click Generate to view the trial balance.
          </p>
        </div>
      )}
    </div>
  )
}
