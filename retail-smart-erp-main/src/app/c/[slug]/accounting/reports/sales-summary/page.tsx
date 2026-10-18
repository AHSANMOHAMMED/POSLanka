'use client'

import { useState } from 'react'
import { TrendingUp, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface SalesSummaryData {
  summary: {
    totalSales: number
    totalReturns: number
    netSales: number
    avgOrderValue: number
    orderCount: number
    returnCount: number
  }
  groupLabel: string
  data: { group: string; totalSales: number; totalReturns: number; netSales: number; orderCount: number }[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'group', header: 'Period', width: 20 },
  { key: 'totalSales', header: 'Total Sales', format: 'currency', width: 15 },
  { key: 'totalReturns', header: 'Returns', format: 'currency', width: 15 },
  { key: 'netSales', header: 'Net Sales', format: 'currency', width: 15 },
  { key: 'orderCount', header: 'Orders', format: 'number', width: 10 },
]

export default function SalesSummaryPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [groupBy, setGroupBy] = useState<string>('day')
  const [data, setData] = useState<SalesSummaryData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate, groupBy })
      const res = await fetch(`/api/reports/sales-summary?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  return (
    <ReportPageLayout
      title="Sales Summary"
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
          <div className="flex-1 min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Group By</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputClass}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="customer">Customer</option>
              <option value="salesperson">Salesperson</option>
              <option value="payment_method">Payment Method</option>
            </select>
          </div>
          <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data}
      emptyIcon={<TrendingUp size={40} />}
      emptyMessage="Select a date range and click Generate to view the sales summary."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Sales Summary"
      summaryCards={data ? <>
        <SummaryCard label="Total Sales" value={formatCurrency(data.summary.totalSales)} color="blue" />
        <SummaryCard label="Returns" value={formatCurrency(data.summary.totalReturns)} color="red" />
        <SummaryCard label="Net Sales" value={formatCurrency(data.summary.netSales)} color="green" />
        <SummaryCard label="Avg Order Value" value={formatCurrency(data.summary.avgOrderValue)} color="purple" />
      </> : undefined}
      chart={data && data.data.length > 0 ? (
        <BarChart
          labels={data.data.map((d) => d.group)}
          datasets={[{ label: 'Net Sales', data: data.data.map((d) => d.netSales) }]}
          height={250}
          color="blue"
        />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">{data.groupLabel}</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Sales</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Returns</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Net Sales</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Orders</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.group}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(row.totalSales)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-red-600 dark:text-red-400">{formatCurrency(row.totalReturns)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.netSales)}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.orderCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
