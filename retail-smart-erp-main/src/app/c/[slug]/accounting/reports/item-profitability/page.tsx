'use client'

import { useState } from 'react'
import { DollarSign, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface ProfitRow {
  itemId: string | null
  itemName: string
  sku: string
  costPrice: number
  sellingPrice: number
  marginPercent: number
  qtySold: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'itemName', header: 'Item', width: 25 },
  { key: 'sku', header: 'SKU', width: 15 },
  { key: 'costPrice', header: 'Cost Price', format: 'currency', width: 12 },
  { key: 'sellingPrice', header: 'Selling Price', format: 'currency', width: 12 },
  { key: 'marginPercent', header: 'Margin %', format: 'number', width: 10 },
  { key: 'qtySold', header: 'Qty Sold', format: 'number', width: 10 },
  { key: 'totalRevenue', header: 'Revenue', format: 'currency', width: 15 },
  { key: 'totalProfit', header: 'Profit', format: 'currency', width: 15 },
]

export default function ItemProfitabilityPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<ProfitRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/item-profitability?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const totalRevenue = data?.reduce((s, d) => s + d.totalRevenue, 0) || 0
  const totalProfit = data?.reduce((s, d) => s + d.totalProfit, 0) || 0
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  const top10 = data?.slice(0, 10) || []

  return (
    <ReportPageLayout
      title="Item Profitability"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.length > 0}
      emptyIcon={<DollarSign size={40} />}
      emptyMessage="Select a date range to view item profitability."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data as any}
      exportColumns={exportColumns}
      exportName="Item Profitability"
      summaryCards={data ? <>
        <SummaryCard label="Total Revenue" value={formatCurrency(totalRevenue)} color="blue" />
        <SummaryCard label="Total Profit" value={formatCurrency(totalProfit)} color="green" />
        <SummaryCard label="Avg Margin" value={`${(Number(avgMargin) || 0).toFixed(1)}%`} color="purple" />
        <SummaryCard label="Items" value={(data?.length || 0).toString()} color="amber" />
      </> : undefined}
      chart={top10.length > 0 ? (
        <BarChart labels={top10.map((d) => (d.itemName || 'Unknown').slice(0, 20))} datasets={[{ label: 'Profit', data: top10.map((d) => d.totalProfit) }]} height={250} color="green" />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Item</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Cost</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Sell Price</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Margin %</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Qty Sold</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Profit</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.itemName}
                      <span className="ml-2 text-xs text-gray-500 font-mono">{row.sku}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-600 dark:text-gray-400">{formatCurrency(row.costPrice)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(row.sellingPrice)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-semibold ${(row.marginPercent ?? 0) >= 20 ? 'text-green-600 dark:text-green-400' : (row.marginPercent ?? 0) >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{(Number(row.marginPercent) || 0).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.qtySold}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(row.totalRevenue)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.totalProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(row.totalProfit)}</td>
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
