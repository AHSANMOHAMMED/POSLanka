'use client'

import { useState } from 'react'
import { LayoutGrid, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface CategoryRow {
  categoryId: string | null
  categoryName: string
  itemCount: number
  qtySold: number
  totalRevenue: number
  contribution: number
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'categoryName', header: 'Category', width: 25 },
  { key: 'itemCount', header: 'Items', format: 'number', width: 10 },
  { key: 'qtySold', header: 'Qty Sold', format: 'number', width: 12 },
  { key: 'totalRevenue', header: 'Revenue', format: 'currency', width: 15 },
  { key: 'contribution', header: 'Contribution %', width: 12 },
]

export default function CategorySalesPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<CategoryRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/category-sales?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const totalRevenue = data?.reduce((s, d) => s + d.totalRevenue, 0) || 0
  const totalItems = data?.reduce((s, d) => s + d.itemCount, 0) || 0
  const top10 = data?.slice(0, 10) || []

  return (
    <ReportPageLayout
      title="Category Sales"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <LayoutGrid size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.length > 0}
      emptyIcon={<LayoutGrid size={40} />}
      emptyMessage="Select a date range to view category sales."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data as any}
      exportColumns={exportColumns}
      exportName="Category Sales"
      summaryCards={data ? <>
        <SummaryCard label="Total Revenue" value={formatCurrency(totalRevenue)} color="blue" />
        <SummaryCard label="Categories" value={(data?.length || 0).toString()} color="purple" />
        <SummaryCard label="Unique Items" value={totalItems.toString()} color="green" />
      </> : undefined}
      chart={top10.length > 0 ? (
        <BarChart labels={top10.map((d) => (d.categoryName || 'Unknown').slice(0, 20))} datasets={[{ label: 'Revenue', data: top10.map((d) => d.totalRevenue) }]} height={250} color="blue" />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Category</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Items</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Qty Sold</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white font-medium">{row.categoryName}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-600 dark:text-gray-400">{row.itemCount}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.qtySold}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(row.contribution, 100)}%` }} />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300 font-medium">{row.contribution}%</span>
                      </div>
                    </td>
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
