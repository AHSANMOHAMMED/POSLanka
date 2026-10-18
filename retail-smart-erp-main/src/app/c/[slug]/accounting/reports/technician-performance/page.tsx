'use client'

import { useState } from 'react'
import { Users, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface TechnicianRow {
  technicianId: string | null
  technicianName: string
  jobsCompleted: number
  jobsTotal: number
  completionRate: number
  totalRevenue: number
  avgJobValue: number
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'technicianName', header: 'Technician', width: 25 },
  { key: 'jobsCompleted', header: 'Completed', format: 'number', width: 10 },
  { key: 'jobsTotal', header: 'Total Jobs', format: 'number', width: 10 },
  { key: 'completionRate', header: 'Completion %', format: 'number', width: 12 },
  { key: 'totalRevenue', header: 'Revenue', format: 'currency', width: 15 },
  { key: 'avgJobValue', header: 'Avg Job Value', format: 'currency', width: 15 },
]

export default function TechnicianPerformancePage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<TechnicianRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/technician-performance?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const totalRevenue = data?.reduce((s, d) => s + d.totalRevenue, 0) || 0
  const totalJobs = data?.reduce((s, d) => s + d.jobsTotal, 0) || 0
  const totalCompleted = data?.reduce((s, d) => s + d.jobsCompleted, 0) || 0
  const avgRate = totalJobs > 0 ? Math.round((totalCompleted / totalJobs) * 100) : 0

  return (
    <ReportPageLayout
      title="Technician Performance"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.length > 0}
      emptyIcon={<Users size={40} />}
      emptyMessage="Select a date range to view technician performance."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data as any}
      exportColumns={exportColumns}
      exportName="Technician Performance"
      summaryCards={data ? <>
        <SummaryCard label="Total Revenue" value={formatCurrency(totalRevenue)} color="blue" />
        <SummaryCard label="Total Jobs" value={totalJobs.toString()} color="purple" />
        <SummaryCard label="Completed" value={totalCompleted.toString()} color="green" />
        <SummaryCard label="Completion Rate" value={`${avgRate}%`} color="amber" />
      </> : undefined}
      chart={data && data.length > 0 ? (
        <BarChart labels={data.map((d) => (d.technicianName || "Unknown").slice(0, 15))} datasets={[{ label: 'Revenue', data: data.map((d) => d.totalRevenue) }]} height={250} color="blue" />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Technician</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Completed</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Rate</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Avg Job Value</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.technicianName}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-green-600 dark:text-green-400">{row.jobsCompleted}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.jobsTotal}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-semibold ${row.completionRate >= 80 ? 'text-green-600 dark:text-green-400' : row.completionRate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{row.completionRate}%</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-600 dark:text-gray-400">{formatCurrency(row.avgJobValue)}</td>
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
