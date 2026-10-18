'use client'

import { useState } from 'react'
import { Receipt, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import LineChart from '@/components/workspace/charts/LineChart'

interface TaxReportData {
  data: {
    month: string
    salesTotal: number
    taxCollected: number
    purchaseTotal: number
    taxPaid: number
    netTax: number
  }[]
  totals: {
    totalTaxCollected: number
    totalTaxPaid: number
    netTaxLiability: number
  }
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'month', header: 'Month', width: 12 },
  { key: 'salesTotal', header: 'Sales Total', format: 'currency', width: 15 },
  { key: 'taxCollected', header: 'Tax Collected', format: 'currency', width: 15 },
  { key: 'purchaseTotal', header: 'Purchase Total', format: 'currency', width: 15 },
  { key: 'taxPaid', header: 'Tax Paid', format: 'currency', width: 15 },
  { key: 'netTax', header: 'Net Tax', format: 'currency', width: 15 },
]

export default function TaxReportPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<TaxReportData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/tax-report?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  return (
    <ReportPageLayout
      title="Tax Report"
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
      emptyMessage="Select a date range to view the tax report."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Tax Report"
      summaryCards={data ? <>
        <SummaryCard label="Tax Collected" value={formatCurrency(data.totals.totalTaxCollected)} color="green" />
        <SummaryCard label="Tax Paid" value={formatCurrency(data.totals.totalTaxPaid)} color="red" />
        <SummaryCard label="Net Tax Liability" value={formatCurrency(data.totals.netTaxLiability)} color={data.totals.netTaxLiability >= 0 ? 'amber' : 'green'} />
      </> : undefined}
      chart={data && data.data.length > 0 ? (
        <LineChart
          labels={data.data.map((d) => d.month)}
          datasets={[
            { label: 'Tax Collected', data: data.data.map((d) => d.taxCollected) },
            { label: 'Tax Paid', data: data.data.map((d) => d.taxPaid) },
          ]}
          height={250}
        />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Month</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Sales</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Tax Collected</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Purchases</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Tax Paid</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Net Tax</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.month}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(row.salesTotal)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-green-600 dark:text-green-400">{formatCurrency(row.taxCollected)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(row.purchaseTotal)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-red-600 dark:text-red-400">{formatCurrency(row.taxPaid)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.netTax >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>{formatCurrency(row.netTax)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">Total</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-sm text-right font-mono tabular-nums font-bold text-green-600 dark:text-green-400">{formatCurrency(data.totals.totalTaxCollected)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-sm text-right font-mono tabular-nums font-bold text-red-600 dark:text-red-400">{formatCurrency(data.totals.totalTaxPaid)}</td>
                  <td className={`px-4 py-3 text-sm text-right font-mono tabular-nums font-bold ${data.totals.netTaxLiability >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>{formatCurrency(data.totals.netTaxLiability)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
