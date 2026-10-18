'use client'

import { useState } from 'react'
import { BookText, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface DayBookEntry {
  id: string
  postingDate: string
  voucherType: string
  voucherNumber: string
  accountName: string
  accountNumber: string
  debit: number
  credit: number
  remarks: string
}

interface VoucherSummary {
  voucherType: string
  count: number
  totalDebit: number
  totalCredit: number
}

interface DayBookData {
  summary: {
    totalDebits: number
    totalCredits: number
    transactionCount: number
  }
  voucherSummary: VoucherSummary[]
  data: DayBookEntry[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'postingDate', header: 'Date', width: 12 },
  { key: 'voucherType', header: 'Voucher Type', width: 15 },
  { key: 'voucherNumber', header: 'Voucher #', width: 15 },
  { key: 'accountName', header: 'Account', width: 25 },
  { key: 'accountNumber', header: 'Acc #', width: 10 },
  { key: 'debit', header: 'Debit', format: 'currency', width: 15 },
  { key: 'credit', header: 'Credit', format: 'currency', width: 15 },
]

export default function DayBookPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<DayBookData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/day-book?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  return (
    <ReportPageLayout
      title="Day Book"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <BookText size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<BookText size={40} />}
      emptyMessage="Select a date range and click Generate to view the day book."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Day Book"
      summaryCards={data ? <>
        <SummaryCard label="Total Debits" value={formatCurrency(data.summary.totalDebits)} color="blue" />
        <SummaryCard label="Total Credits" value={formatCurrency(data.summary.totalCredits)} color="green" />
        <SummaryCard label="Transactions" value={data.summary.transactionCount.toString()} color="purple" />
        <SummaryCard label="Voucher Types" value={data.voucherSummary.length.toString()} color="amber" />
      </> : undefined}
      chart={data && data.voucherSummary.length > 0 ? (
        <BarChart
          labels={data.voucherSummary.map((d) => d.voucherType.replace(/_/g, ' '))}
          datasets={[
            { label: 'Debit', data: data.voucherSummary.map((d) => d.totalDebit) },
            { label: 'Credit', data: data.voucherSummary.map((d) => d.totalCredit) },
          ]}
          height={250}
          color="blue"
        />
      ) : undefined}
    >
      {data && (
        <>
          {/* Voucher Type Summary */}
          {data.voucherSummary.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="px-4 py-3 border-b dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Summary by Voucher Type</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Voucher Type</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Count</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total Debit</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.voucherSummary.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white capitalize">{row.voucherType.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.count}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(row.totalDebit)}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(row.totalCredit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detailed Entries */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="px-4 py-3 border-b dark:border-gray-700">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">All Entries</p>
            </div>
            <div className="overflow-x-auto list-container-xl">
              <table className="w-full">
                <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Voucher Type</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Voucher #</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Account</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Debit</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.postingDate}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 capitalize">{row.voucherType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{row.voucherNumber}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                        <span className="text-gray-500 dark:text-gray-400 text-xs mr-1">{row.accountNumber}</span>
                        {row.accountName}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-900">
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                    <td colSpan={4} className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white">Total</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalDebits)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalCredits)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </ReportPageLayout>
  )
}
