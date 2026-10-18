'use client'

import { useState } from 'react'
import { PackageSearch, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface ShrinkageRow {
  id: string
  itemName: string
  sku: string
  expectedQty: number
  actualQty: number
  variance: number
  costPrice: number
  varianceValue: number
  stockTakeNo: string
  stockTakeDate: string
  notes: string | null
}

interface ShrinkageData {
  summary: {
    totalShortageValue: number
    totalExcessValue: number
    netVariance: number
    itemsAffected: number
    shortageCount: number
    excessCount: number
  }
  data: ShrinkageRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'stockTakeNo', header: 'Stock Take #', width: 18 },
  { key: 'stockTakeDate', header: 'Date', format: 'date', width: 15 },
  { key: 'itemName', header: 'Item', width: 25 },
  { key: 'sku', header: 'SKU', width: 15 },
  { key: 'expectedQty', header: 'Expected', format: 'number', width: 12 },
  { key: 'actualQty', header: 'Actual', format: 'number', width: 12 },
  { key: 'variance', header: 'Variance', format: 'number', width: 12 },
  { key: 'costPrice', header: 'Cost Price', format: 'currency', width: 12 },
  { key: 'varianceValue', header: 'Variance Value', format: 'currency', width: 15 },
]

export default function ShrinkageReportPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<ShrinkageData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/shrinkage-report?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  // Prepare chart data: top 10 items by absolute variance value
  const chartData = data
    ? [...data.data]
        .sort((a, b) => Math.abs(b.varianceValue) - Math.abs(a.varianceValue))
        .slice(0, 10)
    : []

  return (
    <ReportPageLayout
      title="Shrinkage Report"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <PackageSearch size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<PackageSearch size={40} />}
      emptyMessage="Select a date range to view stock take shrinkage."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Shrinkage Report"
      summaryCards={data ? <>
        <SummaryCard label="Shortage Value" value={formatCurrency(data.summary.totalShortageValue)} color="red" />
        <SummaryCard label="Excess Value" value={formatCurrency(data.summary.totalExcessValue)} color="green" />
        <SummaryCard label="Net Variance" value={formatCurrency(data.summary.netVariance)} color={data.summary.netVariance >= 0 ? 'blue' : 'amber'} />
        <SummaryCard label="Items Affected" value={data.summary.itemsAffected.toString()} color="purple" />
      </> : undefined}
      chart={chartData.length > 0 ? (
        <BarChart
          labels={chartData.map(d => ((d.itemName as string) || "Unknown").slice(0, 20))}
          datasets={[{ label: 'Variance Value (Abs)', data: chartData.map(d => Math.abs(d.varianceValue)) }]}
          height={250}
          color="amber"
        />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Stock Take</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Item</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Expected</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actual</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Variance</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Cost Price</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Variance Value</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-mono text-xs">{row.stockTakeNo}</span>
                      <br />
                      <span className="text-xs text-gray-500">{new Date(row.stockTakeDate).toLocaleDateString()}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.itemName}
                      {row.sku && <span className="ml-2 text-xs text-gray-500 font-mono">{row.sku}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{row.expectedQty}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{row.actualQty}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.variance < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {row.variance > 0 ? '+' : ''}{row.variance}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(row.costPrice)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.varianceValue < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {row.varianceValue > 0 ? '+' : ''}{formatCurrency(row.varianceValue)}
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
