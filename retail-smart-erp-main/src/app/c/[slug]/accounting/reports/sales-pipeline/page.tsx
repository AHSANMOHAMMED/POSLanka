'use client'

import { useState } from 'react'
import { Filter, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface FunnelStage {
  stage: string
  count: number
  value: number | null
}

interface PipelineData {
  summary: {
    totalInventoryAdded: number
    totalTestDrives: number
    totalSales: number
    totalSalesValue: number
    testDriveConversionRate: number
    closeRate: number
    overallConversionRate: number
  }
  funnel: FunnelStage[]
  testDrivesByStatus: Record<string, number>
  inventoryByStatus: Record<string, number>
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const FUNNEL_COLORS = ['#3b82f6', '#f59e0b', '#22c55e']

const exportColumns: ExportColumn[] = [
  { key: 'stage', header: 'Stage', width: 25 },
  { key: 'count', header: 'Count', format: 'number', width: 12 },
  { key: 'value', header: 'Value', format: 'currency', width: 18 },
]

export default function SalesPipelinePage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/sales-pipeline?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  return (
    <ReportPageLayout
      title="Sales Pipeline"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data}
      emptyIcon={<Filter size={40} />}
      emptyMessage="Select a date range to view the sales pipeline funnel."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.funnel as any}
      exportColumns={exportColumns}
      exportName="Sales Pipeline"
      summaryCards={data ? <>
        <SummaryCard label="Vehicles Listed" value={data.summary.totalInventoryAdded.toString()} color="blue" />
        <SummaryCard label="Test Drives" value={data.summary.totalTestDrives.toString()} color="amber" />
        <SummaryCard label="Sales Closed" value={data.summary.totalSales.toString()} color="green" />
        <SummaryCard label="Overall Conversion" value={`${data.summary.overallConversionRate}%`} color="purple" />
      </> : undefined}
      chart={data ? (
        <BarChart
          labels={data.funnel.map(f => f.stage)}
          datasets={[{
            label: 'Count',
            data: data.funnel.map(f => f.count),
            colors: FUNNEL_COLORS,
          }]}
          height={250}
          color="blue"
        />
      ) : undefined}
    >
      {data && (
        <>
          {/* Funnel Table */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 mb-4">
            <div className="p-4 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Conversion Funnel</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Stage</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Count</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Conversion Rate</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funnel.map((stage, i) => {
                    const prevCount = i > 0 ? data.funnel[i - 1].count : stage.count
                    const rate = prevCount > 0 && i > 0 ? ((stage.count / prevCount) * 100).toFixed(1) : '-'
                    return (
                      <tr key={stage.stage} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-2.5 text-sm font-medium text-gray-900 dark:text-white">{stage.stage}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{stage.count}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-blue-600 dark:text-blue-400">{rate === '-' ? '-' : `${rate}%`}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{stage.value !== null ? formatCurrency(stage.value) : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Breakdown Tables */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Test Drives by Status */}
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="p-4 border-b dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Test Drives by Status</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.testDrivesByStatus).map(([status, count]) => (
                      <tr key={status} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white capitalize">{status.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{count}</td>
                      </tr>
                    ))}
                    {Object.keys(data.testDrivesByStatus).length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-4 text-sm text-center text-gray-500 dark:text-gray-400">No test drives in this period</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Current Inventory by Status */}
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="p-4 border-b dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Current Inventory by Status</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.inventoryByStatus).map(([status, count]) => (
                      <tr key={status} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white capitalize">{status.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{count}</td>
                      </tr>
                    ))}
                    {Object.keys(data.inventoryByStatus).length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-4 text-sm text-center text-gray-500 dark:text-gray-400">No inventory data</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </ReportPageLayout>
  )
}
