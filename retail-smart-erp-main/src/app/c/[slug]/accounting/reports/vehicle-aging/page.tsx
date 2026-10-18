'use client'

import { useState } from 'react'
import { Car, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface VehicleAgingRow {
  id: string
  make: string
  model: string
  year: number
  vin: string
  stockNo: string
  status: string
  vehicleCondition: string
  acquiredDate: string
  listPrice: number
  purchasePrice: number
  daysInInventory: number
}

interface AgingBucket {
  label: string
  count: number
  totalValue: number
}

interface VehicleAgingData {
  summary: {
    totalVehicles: number
    avgDaysInInventory: number
    totalInventoryValue: number
  }
  agingBuckets: AgingBucket[]
  data: VehicleAgingRow[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_COLORS: Record<string, string> = {
  available: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
  reserved: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
  in_transit: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
  in_preparation: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20',
}

const AGING_COLORS: Record<string, string> = {
  '0-30 days': 'text-green-600 dark:text-green-400',
  '31-60 days': 'text-blue-600 dark:text-blue-400',
  '61-90 days': 'text-amber-600 dark:text-amber-400',
  '91-120 days': 'text-orange-600 dark:text-orange-400',
  '120+ days': 'text-red-600 dark:text-red-400',
}

const exportColumns: ExportColumn[] = [
  { key: 'stockNo', header: 'Stock #', width: 12 },
  { key: 'make', header: 'Make', width: 15 },
  { key: 'model', header: 'Model', width: 15 },
  { key: 'year', header: 'Year', format: 'number', width: 8 },
  { key: 'vin', header: 'VIN', width: 20 },
  { key: 'status', header: 'Status', width: 15 },
  { key: 'vehicleCondition', header: 'Condition', width: 12 },
  { key: 'acquiredDate', header: 'Acquired', format: 'date', width: 15 },
  { key: 'daysInInventory', header: 'Days', format: 'number', width: 8 },
  { key: 'listPrice', header: 'List Price', format: 'currency', width: 15 },
]

export default function VehicleAgingPage() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0])
  const [data, setData] = useState<VehicleAgingData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ asOfDate })
      const res = await fetch(`/api/reports/vehicle-aging?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  function getAgingBucketLabel(days: number): string {
    if (days <= 30) return '0-30 days'
    if (days <= 60) return '31-60 days'
    if (days <= 90) return '61-90 days'
    if (days <= 120) return '91-120 days'
    return '120+ days'
  }

  return (
    <ReportPageLayout
      title="Vehicle Aging Report"
      filterBar={
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">As of Date</label>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={inputClass} />
          </div>
          <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Car size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<Car size={40} />}
      emptyMessage="Click Generate to view vehicle aging inventory."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="Vehicle Aging Report"
      summaryCards={data ? <>
        <SummaryCard label="Total Vehicles" value={data.summary.totalVehicles.toString()} color="blue" />
        <SummaryCard label="Avg Days in Inventory" value={data.summary.avgDaysInInventory.toString()} color="amber" />
        <SummaryCard label="Total Inventory Value" value={formatCurrency(data.summary.totalInventoryValue)} color="green" />
        <SummaryCard label="120+ Days" value={(data.agingBuckets.find(b => b.label === '120+ days')?.count || 0).toString()} color="red" />
      </> : undefined}
      chart={data && data.agingBuckets.length > 0 ? (
        <BarChart
          labels={data.agingBuckets.map(b => b.label)}
          datasets={[{ label: 'Vehicles', data: data.agingBuckets.map(b => b.count) }]}
          height={250}
          color="blue"
        />
      ) : undefined}
    >
      {data && (
        <>
          {/* Aging Buckets Summary Table */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 mb-4">
            <div className="p-4 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Aging Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Aging Bucket</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Vehicles</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agingBuckets.map((bucket) => (
                    <tr key={bucket.label} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-2.5 text-sm font-medium text-gray-900 dark:text-white">{bucket.label}</td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{bucket.count}</td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(bucket.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail Table */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="overflow-x-auto list-container-xl">
              <table className="w-full">
                <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Stock #</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">VIN</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Acquired</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Days</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">List Price</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row) => (
                    <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-2.5 text-sm font-mono text-gray-700 dark:text-gray-300">{row.stockNo || '-'}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                        {[row.year, row.make, row.model].filter(Boolean).join(' ')}
                        <span className="ml-2 text-xs text-gray-500 capitalize">{row.vehicleCondition}</span>
                      </td>
                      <td className="px-4 py-2.5 text-sm font-mono text-gray-600 dark:text-gray-400">{row.vin || '-'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${STATUS_COLORS[row.status] || ''}`}>
                          {row.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{row.acquiredDate ? new Date(row.acquiredDate).toLocaleDateString() : '-'}</td>
                      <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${AGING_COLORS[getAgingBucketLabel(row.daysInInventory)] || ''}`}>
                        {row.daysInInventory}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatCurrency(row.listPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </ReportPageLayout>
  )
}
