'use client'

import { useState } from 'react'
import { Receipt, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface ExpenseRow {
  accountId: string
  accountName: string
  accountNumber: string
  totalAmount: number
  entryCount: number
}

interface ExpenseData {
  summary: {
    totalExpenses: number
    topExpenseCategory: string
    accountCount: number
  }
  data: ExpenseRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'accountNumber', header: 'Account #', width: 12 },
  { key: 'accountName', header: 'Account Name', width: 30 },
  { key: 'totalAmount', header: 'Total Amount', format: 'currency', width: 15 },
  { key: 'entryCount', header: 'Entries', format: 'number', width: 10 },
  { key: 'pctOfTotal', header: '% of Total', format: 'percent', width: 12 },
]

export default function ExpenseReportPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<ExpenseData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/expense-report?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  // Calculate contribution percentages for the table
  const totalExpenses = data?.summary.totalExpenses || 0

  const top10 = data?.data.slice(0, 10) || []

  return (
    <ReportPageLayout
      title="Expense Report"
      filterBar={
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From Date</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputClass} />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To Date</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputClass} />
          </div>
          <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<Receipt size={40} />}
      emptyMessage="Select a date range and click Generate to view expenses."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data.map(row => ({
        ...row,
        pctOfTotal: totalExpenses > 0 ? Math.round((row.totalAmount / totalExpenses) * 10000) / 10000 : 0,
      })) as any}
      exportColumns={exportColumns}
      exportName="Expense Report"
      summaryCards={data ? <>
        <SummaryCard label="Total Expenses" value={formatCurrency(data.summary.totalExpenses)} color="red" />
        <SummaryCard label="Top Category" value={data.summary.topExpenseCategory} color="amber" />
        <SummaryCard label="Expense Accounts" value={data.summary.accountCount.toString()} color="blue" />
      </> : undefined}
      chart={top10.length > 0 ? (
        <BarChart
          labels={top10.map((d) => (d.accountName || "Unknown").slice(0, 20))}
          datasets={[{ label: 'Amount', data: top10.map((d) => d.totalAmount) }]}
          height={250}
          color="red"
        />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Account #</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Account Name</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Amount</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Entries</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => {
                  const pct = totalExpenses > 0 ? (row.totalAmount / totalExpenses) * 100 : 0
                  return (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">{row.accountNumber}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.accountName}</td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalAmount)}</td>
                      <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.entryCount}</td>
                      <td className="px-4 py-2.5 text-sm text-right text-gray-600 dark:text-gray-400">{Math.round(pct * 100) / 100}%</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900">
                <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                  <td colSpan={2} className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white">Total</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-red-600 dark:text-red-400">{formatCurrency(data.summary.totalExpenses)}</td>
                  <td></td>
                  <td className="px-4 py-2.5 text-sm text-right font-bold text-gray-900 dark:text-white">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
