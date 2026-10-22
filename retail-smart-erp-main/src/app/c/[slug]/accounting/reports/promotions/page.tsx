'use client'

// H5: promotion effectiveness — redemptions, discount given and sales value per promotion.
import { useState } from 'react'
import { BadgePercent, Loader2 } from 'lucide-react'
import { ReportPageLayout } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'
import BarChart from '@/components/workspace/charts/BarChart'

interface PromotionRow {
  promotionId: string
  name: string
  type: string
  couponCode: string | null
  isActive: boolean
  redemptions: number
  customers: number
  discountGiven: number
  salesValue: number
  avgDiscount: number
  discountPercentOfSales: number
}
interface Report { totals: { redemptions: number; discountGiven: number; salesValue: number }; data: PromotionRow[] }

const TYPE_LABELS: Record<string, string> = {
  percent_off: '% off', fixed_off: 'Amount off', buy_x_get_y: 'Buy X get Y', bundle_price: 'Bundle', min_spend: 'Spend & save',
}

function fmt(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'name', header: 'Promotion', width: 28 },
  { key: 'type', header: 'Type', width: 14 },
  { key: 'couponCode', header: 'Coupon', width: 12 },
  { key: 'redemptions', header: 'Redemptions', format: 'number', width: 12 },
  { key: 'customers', header: 'Customers', format: 'number', width: 10 },
  { key: 'discountGiven', header: 'Discount Given', format: 'currency', width: 15 },
  { key: 'salesValue', header: 'Sales Value', format: 'currency', width: 15 },
  { key: 'avgDiscount', header: 'Avg Discount', format: 'currency', width: 13 },
  { key: 'discountPercentOfSales', header: 'Discount %', format: 'number', width: 10 },
]

export default function PromotionReportPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/reports/promotions?${new URLSearchParams({ fromDate, toDate })}`)
      if (res.ok) setReport(await res.json())
      else toast.error((await res.json().catch(() => ({}))).error || 'Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'
  const data = report?.data || []
  const top10 = data.slice(0, 10)

  return (
    <ReportPageLayout
      title="Promotion Report"
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <BadgePercent size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={data.length > 0}
      emptyIcon={<BadgePercent size={40} />}
      emptyMessage="Select a date range to see how your promotions performed."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data as any}
      exportColumns={exportColumns}
      exportName="Promotion Report"
      chart={top10.length > 0 ? (
        <BarChart
          labels={top10.map((d) => d.name.slice(0, 20))}
          datasets={[{ label: 'Discount Given', data: top10.map((d) => d.discountGiven) }]}
          height={250}
          color="violet"
        />
      ) : undefined}
    >
      {report && data.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  {['Promotion', 'Redemptions', 'Customers', 'Discount Given', 'Sales Value', 'Avg Discount', 'Discount %'].map((h, i) => (
                    <th key={h} className={`px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.promotionId} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                      {row.name}
                      <div className="text-xs text-gray-500">{TYPE_LABELS[row.type] || row.type}{row.couponCode ? ` · ${row.couponCode}` : ''}{row.isActive ? '' : ' · inactive'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.redemptions}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.customers}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{fmt(row.discountGiven)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{fmt(row.salesValue)}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{fmt(row.avgDiscount)}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">{row.discountPercentOfSales.toFixed(1)}%</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 dark:border-gray-600 font-semibold">
                  <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">Total</td>
                  <td className="px-4 py-2.5 text-sm text-right">{report.totals.redemptions}</td>
                  <td />
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">{fmt(report.totals.discountGiven)}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">{fmt(report.totals.salesValue)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
