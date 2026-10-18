'use client'

import { useState } from 'react'
import { Wallet, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import PieChart from '@/components/workspace/charts/PieChart'

interface PaymentCollectionData {
  data: { method: string; totalAmount: number; transactionCount: number; percentage: number }[]
  grandTotal: number
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

const exportColumns: ExportColumn[] = [
  { key: 'method', header: 'Payment Method', width: 20 },
  { key: 'totalAmount', header: 'Amount', format: 'currency', width: 15 },
  { key: 'transactionCount', header: 'Transactions', format: 'number', width: 12 },
  { key: 'percentage', header: 'Percentage', format: 'percent', width: 12 },
]

export default function PaymentCollectionPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<PaymentCollectionData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/reports/payment-collection?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'
  const totalTxn = data?.data.reduce((s, d) => s + d.transactionCount, 0) || 0

  return (
    <ReportPageLayout
      title="Payment Collection"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data && data.data.length > 0}
      emptyIcon={<Wallet size={40} />}
      emptyMessage="Select a date range to view payment collection breakdown."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data.map(d => ({ ...d, method: METHOD_LABELS[d.method] || d.method, percentage: d.percentage / 100 })) as any}
      exportColumns={exportColumns}
      exportName="Payment Collection"
      summaryCards={data ? <>
        <SummaryCard label="Total Collected" value={formatCurrency(data.grandTotal)} color="green" />
        <SummaryCard label="Transactions" value={totalTxn.toString()} color="blue" />
        <SummaryCard label="Payment Methods" value={data.data.length.toString()} color="purple" />
      </> : undefined}
      chart={data && data.data.length > 0 ? (
        <PieChart
          labels={data.data.map((d) => METHOD_LABELS[d.method] || d.method)}
          datasets={[{ label: 'Amount', data: data.data.map((d) => d.totalAmount) }]}
          height={250}
        />
      ) : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Payment Method</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Amount</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Transactions</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">%</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white capitalize">{METHOD_LABELS[row.method] || row.method}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{formatCurrency(row.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.transactionCount}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-500 dark:text-gray-400">{(Number(row.percentage) || 0).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">Total</td>
                  <td className="px-4 py-3 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatCurrency(data.grandTotal)}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-gray-700 dark:text-gray-300">{totalTxn}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
