'use client'

import { useState, useMemo } from 'react'
import { CalendarDays, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface DailyRow {
  date: string
  totalSales: number
  orderCount: number
  avgOrder: number
  payments: Record<string, number>
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  credit: 'Credit',
  gift_card: 'Gift Card',
}

export default function DailySalesPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<DailyRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/daily-sales?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  const totalSales = data?.reduce((s, d) => s + d.totalSales, 0) || 0
  const totalOrders = data?.reduce((s, d) => s + d.orderCount, 0) || 0

  // Collect all unique payment methods from data dynamically
  const paymentMethods = useMemo(() => {
    if (!data) return []
    const methods = new Set<string>()
    for (const row of data) {
      for (const method of Object.keys(row.payments)) {
        if (row.payments[method] > 0) methods.add(method)
      }
    }
    // Sort with known methods first, then alphabetical for any new ones
    const knownOrder = ['cash', 'card', 'bank_transfer', 'credit', 'gift_card']
    return Array.from(methods).sort((a, b) => {
      const ai = knownOrder.indexOf(a)
      const bi = knownOrder.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
  }, [data])

  // Build export columns dynamically
  const exportColumns: ExportColumn[] = useMemo(() => {
    const base: ExportColumn[] = [
      { key: 'date', header: 'Date', width: 15 },
      { key: 'totalSales', header: 'Total Sales', format: 'currency', width: 15 },
      { key: 'orderCount', header: 'Orders', format: 'number', width: 10 },
      { key: 'avgOrder', header: 'Avg Order', format: 'currency', width: 15 },
    ]
    for (const method of paymentMethods) {
      base.push({ key: method, header: METHOD_LABELS[method] || method, format: 'currency', width: 15 })
    }
    return base
  }, [paymentMethods])

  // Flatten payments for export
  const exportData = data?.map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = { ...d }
    for (const method of paymentMethods) {
      row[method] = d.payments[method] || 0
    }
    return row
  })

  return (
    <ReportPageLayout
      title="Daily Sales"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.length > 0}
      emptyIcon={<CalendarDays size={40} />}
      emptyMessage="Select a date range to view daily sales breakdown."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={exportData as any}
      exportColumns={exportColumns}
      exportName="Daily Sales"
      summaryCards={data ? <>
        <SummaryCard label="Total Sales" value={formatCurrency(totalSales)} color="blue" />
        <SummaryCard label="Total Orders" value={totalOrders.toString()} color="green" />
        <SummaryCard label="Avg Daily Sales" value={formatCurrency(data.length > 0 ? totalSales / data.length : 0)} color="purple" />
        <SummaryCard label="Days" value={data.length.toString()} color="amber" />
      </> : undefined}
      chart={data && data.length > 0 && paymentMethods.length > 0 ? (
        <BarChart
          labels={data.map((d) => d.date.slice(5))}
          datasets={paymentMethods.map((method) => ({
            label: METHOD_LABELS[method] || method,
            data: data.map((d) => d.payments[method] || 0),
          }))}
          height={250}
        />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total Sales</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Orders</th>
                  {paymentMethods.map((method) => (
                    <th key={method} className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">{METHOD_LABELS[method] || method}</th>
                  ))}
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Avg Order</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.date}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalSales)}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.orderCount}</td>
                    {paymentMethods.map((method) => (
                      <td key={method} className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(row.payments[method] || 0)}</td>
                    ))}
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">{formatCurrency(row.avgOrder)}</td>
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
