'use client'

import { useState } from 'react'
import { UtensilsCrossed, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface FoodCostRow {
  itemId: string | null
  itemName: string
  categoryName: string
  totalSold: number
  revenue: number
  costOfGoods: number
  foodCostPct: number
  grossProfit: number
}

interface FoodCostData {
  summary: {
    overallFoodCostPct: number
    totalRevenue: number
    totalCost: number
    totalProfit: number
    itemCount: number
  }
  data: FoodCostRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'itemName', header: 'Item Name', width: 25 },
  { key: 'categoryName', header: 'Category', width: 15 },
  { key: 'totalSold', header: 'Qty Sold', format: 'number', width: 10 },
  { key: 'revenue', header: 'Revenue', format: 'currency', width: 15 },
  { key: 'costOfGoods', header: 'Cost', format: 'currency', width: 15 },
  { key: 'foodCostPct', header: 'Food Cost %', format: 'number', width: 12 },
  { key: 'grossProfit', header: 'Gross Profit', format: 'currency', width: 15 },
]

export default function FoodCostAnalysisPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<FoodCostData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/food-cost-analysis?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const top10 = data?.data.slice(0, 10) || []

  return (
    <ReportPageLayout
      title="Food Cost Analysis"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <UtensilsCrossed size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<UtensilsCrossed size={40} />}
      emptyMessage="Select a date range to view food cost analysis."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Food Cost Analysis"
      summaryCards={data ? <>
        <SummaryCard label="Food Cost %" value={`${data.summary.overallFoodCostPct}%`} color={data.summary.overallFoodCostPct <= 35 ? 'green' : data.summary.overallFoodCostPct <= 45 ? 'amber' : 'red'} />
        <SummaryCard label="Total Revenue" value={formatCurrency(data.summary.totalRevenue)} color="blue" />
        <SummaryCard label="Total Cost" value={formatCurrency(data.summary.totalCost)} color="red" />
        <SummaryCard label="Gross Profit" value={formatCurrency(data.summary.totalProfit)} color="green" />
      </> : undefined}
      chart={top10.length > 0 ? (
        <BarChart
          labels={top10.map((d) => (d.itemName || "Unknown").slice(0, 20))}
          datasets={[
            { label: 'Revenue', data: top10.map((d) => d.revenue) },
            { label: 'Cost', data: top10.map((d) => d.costOfGoods) },
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
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Item</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Category</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Qty Sold</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Cost</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Food Cost %</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Gross Profit</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.itemName}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">{row.categoryName}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.totalSold}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-red-600 dark:text-red-400">{formatCurrency(row.costOfGoods)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-semibold ${row.foodCostPct <= 35 ? 'text-green-600 dark:text-green-400' : row.foodCostPct <= 45 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{row.foodCostPct}%</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.grossProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(row.grossProfit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900">
                <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                  <td colSpan={3} className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white">Total ({data.summary.itemCount} items)</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalRevenue)}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-red-600 dark:text-red-400">{formatCurrency(data.summary.totalCost)}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-bold text-purple-600 dark:text-purple-400">{data.summary.overallFoodCostPct}%</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-green-600 dark:text-green-400">{formatCurrency(data.summary.totalProfit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
