'use client'

import { useState } from 'react'
import { UtensilsCrossed, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface TableRow {
  tableId: string | null
  tableName: string
  capacity: number
  orderCount: number
  totalRevenue: number
  avgOrderValue: number
  totalCustomers: number
  revenuePerSeat: number
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'tableName', header: 'Table', width: 20 },
  { key: 'capacity', header: 'Capacity', format: 'number', width: 10 },
  { key: 'orderCount', header: 'Orders', format: 'number', width: 10 },
  { key: 'totalCustomers', header: 'Customers', format: 'number', width: 10 },
  { key: 'totalRevenue', header: 'Revenue', format: 'currency', width: 15 },
  { key: 'avgOrderValue', header: 'Avg Order', format: 'currency', width: 15 },
  { key: 'revenuePerSeat', header: 'Rev/Seat', format: 'currency', width: 12 },
]

export default function TableTurnoverPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<TableRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/table-turnover?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const totalRevenue = data?.reduce((s, d) => s + d.totalRevenue, 0) || 0
  const totalOrders = data?.reduce((s, d) => s + d.orderCount, 0) || 0
  const totalCustomers = data?.reduce((s, d) => s + d.totalCustomers, 0) || 0

  return (
    <ReportPageLayout
      title="Table Turnover"
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
      hasData={!!data && data.length > 0}
      emptyIcon={<UtensilsCrossed size={40} />}
      emptyMessage="Select a date range to view table turnover."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data as any}
      exportColumns={exportColumns}
      exportName="Table Turnover"
      summaryCards={data ? <>
        <SummaryCard label="Total Revenue" value={formatCurrency(totalRevenue)} color="blue" />
        <SummaryCard label="Total Orders" value={totalOrders.toString()} color="purple" />
        <SummaryCard label="Total Customers" value={totalCustomers.toString()} color="green" />
        <SummaryCard label="Tables" value={(data?.length || 0).toString()} color="amber" />
      </> : undefined}
      chart={data && data.length > 0 ? (
        <BarChart labels={data.map((d) => d.tableName)} datasets={[{ label: 'Revenue', data: data.map((d) => d.totalRevenue) }]} height={250} color="emerald" />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Table</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Capacity</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Orders</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Customers</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Avg Order</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Rev/Seat</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white font-medium">{row.tableName}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-600 dark:text-gray-400">{row.capacity}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.orderCount}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.totalCustomers}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-600 dark:text-gray-400">{formatCurrency(row.avgOrderValue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-blue-600 dark:text-blue-400">{formatCurrency(row.revenuePerSeat)}</td>
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
