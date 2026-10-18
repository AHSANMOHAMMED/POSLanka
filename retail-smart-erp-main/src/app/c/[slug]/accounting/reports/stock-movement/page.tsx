'use client'

import { useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { ReportPageLayout } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'

interface MovementRow {
  id: string
  date: string
  itemName: string
  sku: string
  type: string
  qtyIn: number
  qtyOut: number
  adjustment: number
  referenceType: string
  notes: string | null
}

const TYPE_LABELS: Record<string, string> = { in: 'In', out: 'Out', adjustment: 'Adjustment' }
const TYPE_COLORS: Record<string, string> = {
  in: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
  out: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  adjustment: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
}

const exportColumns: ExportColumn[] = [
  { key: 'date', header: 'Date', format: 'date', width: 18 },
  { key: 'itemName', header: 'Item', width: 25 },
  { key: 'sku', header: 'SKU', width: 15 },
  { key: 'type', header: 'Type', width: 12 },
  { key: 'qtyIn', header: 'Qty In', format: 'number', width: 10 },
  { key: 'qtyOut', header: 'Qty Out', format: 'number', width: 10 },
  { key: 'referenceType', header: 'Reference', width: 15 },
]

export default function StockMovementPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [movementType, setMovementType] = useState('')
  const [data, setData] = useState<MovementRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      if (movementType) params.set('movementType', movementType)
      const res = await fetch(`/api/reports/stock-movement?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  return (
    <ReportPageLayout
      title="Stock Movement"
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
          <div className="flex-1 min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
            <select value={movementType} onChange={(e) => setMovementType(e.target.value)} className={inputClass}>
              <option value="">All</option>
              <option value="in">Stock In</option>
              <option value="out">Stock Out</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </div>
          <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.length > 0}
      emptyIcon={<History size={40} />}
      emptyMessage="Select a date range to view stock movements."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data as any}
      exportColumns={exportColumns}
      exportName="Stock Movement"
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Item</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Type</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Qty In</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Qty Out</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Reference</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.itemName}
                      <span className="ml-2 text-xs text-gray-500 font-mono">{row.sku}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${TYPE_COLORS[row.type] || ''}`}>
                        {TYPE_LABELS[row.type] || row.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono text-green-600 dark:text-green-400">{row.qtyIn || '-'}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono text-red-600 dark:text-red-400">{row.qtyOut || '-'}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">{row.referenceType}</td>
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
