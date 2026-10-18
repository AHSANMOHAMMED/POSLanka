'use client'

import { useState } from 'react'
import { Wrench, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface ServiceRevenueData {
  services: {
    description: string
    jobCount: number
    totalHours: number
    totalRevenue: number
  }[]
  totalServiceRevenue: number
  totalPartsRevenue: number
  grandTotal: number
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'description', header: 'Service', width: 30 },
  { key: 'jobCount', header: 'Jobs', format: 'number', width: 10 },
  { key: 'totalHours', header: 'Hours', format: 'number', width: 10 },
  { key: 'totalRevenue', header: 'Revenue', format: 'currency', width: 15 },
]

export default function ServiceRevenuePage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<ServiceRevenueData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/service-revenue?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'
  const top10 = data?.services.slice(0, 10) || []

  return (
    <ReportPageLayout
      title="Service Revenue"
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
      hasData={!!data}
      emptyIcon={<Wrench size={40} />}
      emptyMessage="Select a date range to view service revenue."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.services as any}
      exportColumns={exportColumns}
      exportName="Service Revenue"
      summaryCards={data ? <>
        <SummaryCard label="Service Revenue" value={formatCurrency(data.totalServiceRevenue)} color="blue" />
        <SummaryCard label="Parts Revenue" value={formatCurrency(data.totalPartsRevenue)} color="amber" />
        <SummaryCard label="Grand Total" value={formatCurrency(data.grandTotal)} color="green" />
        <SummaryCard label="Services" value={(data.services.length).toString()} color="purple" />
      </> : undefined}
      chart={top10.length > 0 ? (
        <BarChart labels={top10.map((d) => (d.description || "Unknown").slice(0, 20))} datasets={[{ label: 'Revenue', data: top10.map((d) => d.totalRevenue) }]} height={250} color="blue" />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Service</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Jobs</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Hours</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.description}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.jobCount}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.totalHours}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900">
                <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                  <td colSpan={3} className="px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-white">Parts Revenue</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(data.totalPartsRevenue)}</td>
                </tr>
                <tr className="border-t border-gray-200 dark:border-gray-700">
                  <td colSpan={3} className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white">Grand Total</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-green-600 dark:text-green-400">{formatCurrency(data.grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
