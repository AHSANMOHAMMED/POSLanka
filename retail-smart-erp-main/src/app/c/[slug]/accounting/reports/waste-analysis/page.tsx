'use client'

import { useState } from 'react'
import { Trash2, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface WasteRow {
  id: string
  itemId: string
  itemName: string
  sku: string
  category: string
  quantity: number
  costPrice: number
  totalValue: number
  reason: string
  notes: string | null
  date: string
}

interface WasteData {
  summary: {
    totalWasteValue: number
    totalItemsWasted: number
    topWastedItem: string
    recordCount: number
  }
  byCategory: Record<string, number>
  data: WasteRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'date', header: 'Date', format: 'date', width: 15 },
  { key: 'itemName', header: 'Item', width: 25 },
  { key: 'sku', header: 'SKU', width: 15 },
  { key: 'category', header: 'Category', width: 18 },
  { key: 'quantity', header: 'Qty Wasted', format: 'number', width: 12 },
  { key: 'costPrice', header: 'Cost Price', format: 'currency', width: 12 },
  { key: 'totalValue', header: 'Total Value', format: 'currency', width: 15 },
  { key: 'reason', header: 'Reason', width: 15 },
]

export default function WasteAnalysisPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<WasteData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/waste-analysis?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const chartLabels = data ? Object.keys(data.byCategory).slice(0, 10) : []
  const chartValues = data ? Object.values(data.byCategory).slice(0, 10) : []

  return (
    <ReportPageLayout
      title="Waste Analysis"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<Trash2 size={40} />}
      emptyMessage="Select a date range to view waste and write-off analysis."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Waste Analysis"
      summaryCards={data ? <>
        <SummaryCard label="Total Waste Value" value={formatCurrency(data.summary.totalWasteValue)} color="red" />
        <SummaryCard label="Items Wasted" value={(Number(data.summary.totalItemsWasted) || 0).toFixed(0)} color="amber" />
        <SummaryCard label="Records" value={(data.summary.recordCount ?? 0).toString()} color="blue" />
        <SummaryCard label="Top Wasted Item" value={(data.summary.topWastedItem || '-').slice(0, 20)} color="purple" />
      </> : undefined}
      chart={chartLabels.length > 0 ? (
        <BarChart labels={chartLabels} datasets={[{ label: 'Waste Value by Category', data: chartValues }]} height={250} color="red" />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Item</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Category</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Qty</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Cost Price</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total Value</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.itemName}
                      {row.sku && <span className="ml-2 text-xs text-gray-500 font-mono">{row.sku}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{row.category}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-red-600 dark:text-red-400">{row.quantity}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(row.costPrice)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-red-600 dark:text-red-400">{formatCurrency(row.totalValue)}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 capitalize">{row.reason.replace(/_/g, ' ')}</td>
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
