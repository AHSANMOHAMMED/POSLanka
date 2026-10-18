'use client'

import { useState } from 'react'
import { Wrench, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface JobCardRow {
  id: string
  workOrderNo: string
  customerName: string
  vehicleInfo: string
  status: string
  partsCost: number
  laborRevenue: number
  totalBilled: number
  profit: number
  margin: number
}

interface JobCardData {
  summary: {
    totalRevenue: number
    totalCost: number
    totalProfit: number
    avgMargin: number
    jobCount: number
  }
  data: JobCardRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'workOrderNo', header: 'Work Order #', width: 15 },
  { key: 'customerName', header: 'Customer', width: 20 },
  { key: 'vehicleInfo', header: 'Vehicle', width: 25 },
  { key: 'partsCost', header: 'Parts Cost', format: 'currency', width: 15 },
  { key: 'laborRevenue', header: 'Labor Revenue', format: 'currency', width: 15 },
  { key: 'totalBilled', header: 'Total Billed', format: 'currency', width: 15 },
  { key: 'profit', header: 'Profit', format: 'currency', width: 15 },
  { key: 'margin', header: 'Margin %', format: 'number', width: 10 },
]

export default function JobCardProfitabilityPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<JobCardData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/job-card-profitability?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const top10 = data?.data.slice(0, 10) || []

  return (
    <ReportPageLayout
      title="Job Card Profitability"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<Wrench size={40} />}
      emptyMessage="Select a date range to view job card profitability."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Job Card Profitability"
      summaryCards={data ? <>
        <SummaryCard label="Total Revenue" value={formatCurrency(data.summary.totalRevenue)} color="blue" />
        <SummaryCard label="Total Cost" value={formatCurrency(data.summary.totalCost)} color="red" />
        <SummaryCard label="Total Profit" value={formatCurrency(data.summary.totalProfit)} color="green" />
        <SummaryCard label="Avg Margin" value={`${data.summary.avgMargin}%`} color="purple" />
      </> : undefined}
      chart={top10.length > 0 ? (
        <BarChart
          labels={top10.map((d) => d.workOrderNo)}
          datasets={[
            { label: 'Revenue', data: top10.map((d) => d.totalBilled) },
            { label: 'Cost', data: top10.map((d) => d.partsCost) },
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
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Work Order #</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Customer</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Parts Cost</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Labor</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total Billed</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Profit</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Margin</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm font-medium text-blue-600 dark:text-blue-400">{row.workOrderNo}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.customerName}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{row.vehicleInfo}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-red-600 dark:text-red-400">{formatCurrency(row.partsCost)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(row.laborRevenue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalBilled)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(row.profit)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-semibold ${row.margin >= 30 ? 'text-green-600 dark:text-green-400' : row.margin >= 15 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{row.margin}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900">
                <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                  <td colSpan={3} className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white">Total ({data.summary.jobCount} jobs)</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-red-600 dark:text-red-400">{formatCurrency(data.summary.totalCost)}</td>
                  <td></td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalRevenue)}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-green-600 dark:text-green-400">{formatCurrency(data.summary.totalProfit)}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-bold text-purple-600 dark:text-purple-400">{data.summary.avgMargin}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
