'use client'

import { useState } from 'react'
import { Activity, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'

interface VelocityRow {
  itemId: string
  itemName: string
  sku: string
  categoryName: string
  currentStock: number
  qtySold: number
  totalRevenue: number
  daysSinceLastSale: number | null
  velocity: 'fast' | 'normal' | 'slow' | 'dead'
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const VELOCITY_COLORS: Record<string, string> = {
  fast: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
  normal: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
  slow: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
  dead: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
}

const VELOCITY_LABELS: Record<string, string> = {
  fast: 'Fast',
  normal: 'Normal',
  slow: 'Slow',
  dead: 'Dead',
}

const exportColumns: ExportColumn[] = [
  { key: 'itemName', header: 'Item', width: 25 },
  { key: 'sku', header: 'SKU', width: 15 },
  { key: 'categoryName', header: 'Category', width: 15 },
  { key: 'currentStock', header: 'Stock', format: 'number', width: 10 },
  { key: 'qtySold', header: 'Qty Sold', format: 'number', width: 10 },
  { key: 'totalRevenue', header: 'Revenue', format: 'currency', width: 15 },
  { key: 'velocity', header: 'Velocity', width: 10 },
]

export default function ItemVelocityPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [velocityFilter, setVelocityFilter] = useState('')
  const [data, setData] = useState<VelocityRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/item-velocity?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const filtered = velocityFilter ? data?.filter(d => d.velocity === velocityFilter) : data
  const fastCount = data?.filter(d => d.velocity === 'fast').length || 0
  const normalCount = data?.filter(d => d.velocity === 'normal').length || 0
  const slowCount = data?.filter(d => d.velocity === 'slow').length || 0
  const deadCount = data?.filter(d => d.velocity === 'dead').length || 0

  return (
    <ReportPageLayout
      title="Item Velocity"
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Velocity</label>
            <select value={velocityFilter} onChange={(e) => setVelocityFilter(e.target.value)} className={inputClass}>
              <option value="">All</option>
              <option value="fast">Fast Moving</option>
              <option value="normal">Normal</option>
              <option value="slow">Slow Moving</option>
              <option value="dead">Dead Stock</option>
            </select>
          </div>
          <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!filtered && filtered.length > 0}
      emptyIcon={<Activity size={40} />}
      emptyMessage="Select a date range to view item velocity."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={filtered as any}
      exportColumns={exportColumns}
      exportName="Item Velocity"
      summaryCards={data ? <>
        <SummaryCard label="Fast Moving" value={fastCount.toString()} color="green" />
        <SummaryCard label="Normal" value={normalCount.toString()} color="blue" />
        <SummaryCard label="Slow Moving" value={slowCount.toString()} color="amber" />
        <SummaryCard label="Dead Stock" value={deadCount.toString()} color="red" />
      </> : undefined}
    >
      {filtered && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Item</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Category</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Stock</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Qty Sold</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Last Sale</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Velocity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.itemName}
                      <span className="ml-2 text-xs text-gray-500 font-mono">{row.sku}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">{row.categoryName}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.currentStock}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.qtySold}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-500 dark:text-gray-400">
                      {row.daysSinceLastSale != null ? `${row.daysSinceLastSale}d ago` : 'Never'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${VELOCITY_COLORS[row.velocity] || ''}`}>
                        {VELOCITY_LABELS[row.velocity] || row.velocity}
                      </span>
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
