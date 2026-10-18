'use client'

import { useState } from 'react'
import { Building2, Loader2 } from 'lucide-react'
import { ReportPageLayout } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'

interface SupplierRow {
  supplierId: string | null
  supplierName: string
  orderCount: number
  totalAmount: number
  outstanding: number
  lastPurchaseDate: string
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'supplierName', header: 'Supplier', width: 25 },
  { key: 'orderCount', header: 'Orders', format: 'number', width: 10 },
  { key: 'totalAmount', header: 'Total Amount', format: 'currency', width: 15 },
  { key: 'outstanding', header: 'Outstanding', format: 'currency', width: 15 },
  { key: 'lastPurchaseDate', header: 'Last Purchase', width: 15 },
]

export default function PurchaseBySupplierPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<SupplierRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/purchase-by-supplier?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  return (
    <ReportPageLayout
      title="Purchase by Supplier"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.length > 0}
      emptyIcon={<Building2 size={40} />}
      emptyMessage="Select a date range to view purchases by supplier."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data as any}
      exportColumns={exportColumns}
      exportName="Purchase by Supplier"
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Supplier</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Orders</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total Amount</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Outstanding</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Last Purchase</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.supplierName}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.orderCount}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalAmount)}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${row.outstanding > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>{formatCurrency(row.outstanding)}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-500 dark:text-gray-400">{row.lastPurchaseDate ? new Date(row.lastPurchaseDate).toLocaleDateString() : '-'}</td>
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
