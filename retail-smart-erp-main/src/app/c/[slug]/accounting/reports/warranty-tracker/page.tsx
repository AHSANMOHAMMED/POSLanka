'use client'

import { useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface WarrantyRow {
  id: string
  warrantyType: string
  provider: string
  policyNumber: string
  startDate: string
  endDate: string
  mileageLimit: number | null
  coverageDetails: string | null
  price: number
  status: string
  createdAt: string
  invoiceNo: string
  customerName: string
  vehicleInfo: string
  vin: string
}

interface WarrantyData {
  summary: {
    totalClaims: number
    totalCost: number
    avgCostPerClaim: number
  }
  byType: Record<string, number>
  data: WarrantyRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
  expired: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20',
  claimed: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
  cancelled: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
}

const exportColumns: ExportColumn[] = [
  { key: 'createdAt', header: 'Date', format: 'date', width: 15 },
  { key: 'invoiceNo', header: 'Invoice', width: 15 },
  { key: 'customerName', header: 'Customer', width: 20 },
  { key: 'vehicleInfo', header: 'Vehicle', width: 25 },
  { key: 'vin', header: 'VIN', width: 20 },
  { key: 'warrantyType', header: 'Warranty Type', width: 18 },
  { key: 'provider', header: 'Provider', width: 18 },
  { key: 'price', header: 'Cost', format: 'currency', width: 12 },
  { key: 'status', header: 'Status', width: 12 },
]

export default function WarrantyTrackerPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<WarrantyData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/warranty-tracker?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const chartLabels = data ? Object.keys(data.byType) : []
  const chartValues = data ? Object.values(data.byType) : []

  return (
    <ReportPageLayout
      title="Warranty Tracker"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<ShieldCheck size={40} />}
      emptyMessage="Select a date range to view warranty claims."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Warranty Tracker"
      summaryCards={data ? <>
        <SummaryCard label="Total Claims" value={data.summary.totalClaims.toString()} color="blue" />
        <SummaryCard label="Total Cost" value={formatCurrency(data.summary.totalCost)} color="red" />
        <SummaryCard label="Avg Cost / Claim" value={formatCurrency(data.summary.avgCostPerClaim)} color="amber" />
        <SummaryCard label="Warranty Types" value={Object.keys(data.byType).length.toString()} color="purple" />
      </> : undefined}
      chart={chartLabels.length > 0 ? (
        <BarChart labels={chartLabels} datasets={[{ label: 'Claims by Type', data: chartValues }]} height={250} color="blue" />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Customer</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Type</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Provider</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Cost</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{new Date(row.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.customerName}
                      <span className="ml-2 text-xs text-gray-500 font-mono">{row.invoiceNo}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.vehicleInfo}
                      {row.vin && <span className="ml-2 text-xs text-gray-500 font-mono">{row.vin}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 capitalize">{row.warrantyType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{row.provider}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(row.price)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${STATUS_COLORS[row.status] || ''}`}>
                        {row.status}
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
