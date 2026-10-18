'use client'

import { useState } from 'react'
import { Package, Loader2, AlertTriangle } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'

interface StockRow {
  itemId: string
  itemName: string
  sku: string
  categoryName: string
  currentStock: number
  minStock: number
  costPrice: number
  sellingPrice: number
  stockValue: number
  belowReorder: boolean
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'itemName', header: 'Item', width: 25 },
  { key: 'sku', header: 'SKU', width: 15 },
  { key: 'categoryName', header: 'Category', width: 15 },
  { key: 'currentStock', header: 'Current Stock', format: 'number', width: 12 },
  { key: 'minStock', header: 'Reorder Level', format: 'number', width: 12 },
  { key: 'costPrice', header: 'Cost Price', format: 'currency', width: 12 },
  { key: 'stockValue', header: 'Stock Value', format: 'currency', width: 15 },
]

export default function StockBalancePage() {
  const [data, setData] = useState<StockRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [belowReorder, setBelowReorder] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (belowReorder) params.set('belowReorder', 'true')
      const res = await fetch(`/api/reports/stock-balance?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const totalValue = data?.reduce((s, d) => s + d.stockValue, 0) || 0
  const belowReorderCount = data?.filter((d) => d.belowReorder).length || 0
  const totalItems = data?.length || 0

  return (
    <ReportPageLayout
      title="Stock Balance"
      filterBar={
        <div className="flex items-end gap-4 flex-wrap">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={belowReorder} onChange={(e) => setBelowReorder(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Below reorder level only</span>
          </label>
          <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.length > 0}
      emptyIcon={<Package size={40} />}
      emptyMessage="Click Generate to view current stock balances."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data as any}
      exportColumns={exportColumns}
      exportName="Stock Balance"
      summaryCards={data ? <>
        <SummaryCard label="Total Items" value={totalItems.toString()} color="blue" />
        <SummaryCard label="Total Stock Value" value={formatCurrency(totalValue)} color="green" />
        <SummaryCard label="Below Reorder" value={belowReorderCount.toString()} color="red" />
      </> : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Item</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">SKU</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Category</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Stock</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Reorder Lvl</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Cost Price</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Stock Value</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className={`border-t border-gray-100 dark:border-gray-700 ${row.belowReorder ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      <div className="flex items-center gap-1.5">
                        {row.belowReorder && <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />}
                        {row.itemName}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 font-mono">{row.sku}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400">{row.categoryName}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-semibold ${row.belowReorder ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{row.currentStock}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-500 dark:text-gray-400">{row.minStock}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(row.costPrice)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.stockValue)}</td>
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
