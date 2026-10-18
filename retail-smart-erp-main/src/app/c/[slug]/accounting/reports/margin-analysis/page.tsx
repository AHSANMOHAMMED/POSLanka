'use client'

import { useState } from 'react'
import { PieChart, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface MarginRow {
  name: string
  sku: string
  totalRevenue: number
  totalCost: number
  grossProfit: number
  marginPct: number
  unitsSold: number
}

interface MarginData {
  summary: {
    totalRevenue: number
    totalCost: number
    totalProfit: number
    overallMarginPct: number
    itemCount: number
  }
  groupBy: string
  data: MarginRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'name', header: 'Name', width: 25 },
  { key: 'sku', header: 'SKU', width: 15 },
  { key: 'totalRevenue', header: 'Revenue', format: 'currency', width: 15 },
  { key: 'totalCost', header: 'Cost', format: 'currency', width: 15 },
  { key: 'grossProfit', header: 'Gross Profit', format: 'currency', width: 15 },
  { key: 'marginPct', header: 'Margin %', format: 'number', width: 10 },
  { key: 'unitsSold', header: 'Units Sold', format: 'number', width: 12 },
]

export default function MarginAnalysisPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [groupBy, setGroupBy] = useState<string>('item')
  const [data, setData] = useState<MarginData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate, groupBy })
      const res = await fetch(`/api/reports/margin-analysis?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const top10 = data?.data.slice(0, 10) || []

  return (
    <ReportPageLayout
      title="Margin Analysis"
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
              <option value="item">Item</option>
              <option value="category">Category</option>
            </select>
          </div>
          <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <PieChart size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<PieChart size={40} />}
      emptyMessage="Select a date range and grouping to view margin analysis."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Margin Analysis"
      summaryCards={data ? <>
        <SummaryCard label="Total Revenue" value={formatCurrency(data.summary.totalRevenue)} color="blue" />
        <SummaryCard label="Total Cost" value={formatCurrency(data.summary.totalCost)} color="amber" />
        <SummaryCard label="Gross Profit" value={formatCurrency(data.summary.totalProfit)} color="green" />
        <SummaryCard label="Overall Margin" value={`${data.summary.overallMarginPct}%`} color="purple" />
      </> : undefined}
      chart={top10.length > 0 ? (
        <BarChart
          labels={top10.map(d => ((d.name as string) || "Unknown").slice(0, 20))}
          datasets={[
            { label: 'Revenue', data: top10.map(d => d.totalRevenue) },
            { label: 'Cost', data: top10.map(d => d.totalCost) },
          ]}
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
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">{data.groupBy === 'category' ? 'Category' : 'Item'}</th>
                  {data.groupBy === 'item' && <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">SKU</th>}
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Cost</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Gross Profit</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Margin %</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Units Sold</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.name}</td>
                    {data.groupBy === 'item' && <td className="px-4 py-2.5 text-sm font-mono text-gray-500 dark:text-gray-400">{row.sku || '-'}</td>}
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-600 dark:text-gray-400">{formatCurrency(row.totalCost)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.grossProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatCurrency(row.grossProfit)}
                    </td>
                    <td className={`px-4 py-2.5 text-sm text-right font-semibold ${row.marginPct >= 20 ? 'text-green-600 dark:text-green-400' : row.marginPct >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                      {row.marginPct}%
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.unitsSold}</td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                  <td className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white" colSpan={data.groupBy === 'item' ? 2 : 1}>Total</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalRevenue)}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-600 dark:text-gray-400">{formatCurrency(data.summary.totalCost)}</td>
                  <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold ${data.summary.totalProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {formatCurrency(data.summary.totalProfit)}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right font-bold text-purple-600 dark:text-purple-400">{data.summary.overallMarginPct}%</td>
                  <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
