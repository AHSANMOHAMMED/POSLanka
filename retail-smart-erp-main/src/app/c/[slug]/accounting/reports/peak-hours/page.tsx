'use client'

import { useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface PeakHourRow {
  hour: number
  hourLabel: string
  orderCount: number
  totalRevenue: number
  avgOrderValue: number
}

interface PeakHoursData {
  summary: {
    peakHour: string
    peakOrders: number
    totalOrders: number
    totalRevenue: number
    avgHourlyRevenue: number
  }
  data: PeakHourRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'hourLabel', header: 'Hour', width: 10 },
  { key: 'orderCount', header: 'Orders', format: 'number', width: 10 },
  { key: 'totalRevenue', header: 'Revenue', format: 'currency', width: 15 },
  { key: 'avgOrderValue', header: 'Avg Order Value', format: 'currency', width: 15 },
]

export default function PeakHoursPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<PeakHoursData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/peak-hours?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const peakHourValue = data?.data.reduce((max, d) => d.orderCount > max.orderCount ? d : max, data.data[0])

  return (
    <ReportPageLayout
      title="Peak Hours Analysis"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<Clock size={40} />}
      emptyMessage="Select a date range and click Generate to view peak hours analysis."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Peak Hours Analysis"
      summaryCards={data ? <>
        <SummaryCard label="Peak Hour" value={data.summary.peakHour} color="amber" />
        <SummaryCard label="Total Orders" value={data.summary.totalOrders.toString()} color="blue" />
        <SummaryCard label="Total Revenue" value={formatCurrency(data.summary.totalRevenue)} color="green" />
        <SummaryCard label="Avg Hourly Revenue" value={formatCurrency(data.summary.avgHourlyRevenue)} color="purple" />
      </> : undefined}
      chart={data && data.data.length > 0 ? (
        <BarChart
          labels={data.data.map((d) => d.hourLabel)}
          datasets={[{ label: 'Orders', data: data.data.map((d) => d.orderCount) }]}
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
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Hour</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Orders</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Avg Order Value</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Volume</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => {
                  const maxOrders = peakHourValue?.orderCount || 1
                  const barWidth = Math.max(5, (row.orderCount / maxOrders) * 100)
                  const isPeak = row.hourLabel === data.summary.peakHour

                  return (
                    <tr key={i} className={`border-t border-gray-100 dark:border-gray-700 ${isPeak ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}>
                      <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white font-medium">
                        {row.hourLabel}
                        {isPeak && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 font-semibold">PEAK</span>}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{row.orderCount}</td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalRevenue)}</td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-600 dark:text-gray-400">{formatCurrency(row.avgOrderValue)}</td>
                      <td className="px-4 py-2.5">
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${isPeak ? 'bg-amber-500' : 'bg-blue-500'}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900">
                <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                  <td className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white">Total</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{data.summary.totalOrders}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-green-600 dark:text-green-400">{formatCurrency(data.summary.totalRevenue)}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
