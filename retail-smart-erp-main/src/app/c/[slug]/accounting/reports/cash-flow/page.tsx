'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { DollarSign, Loader2 } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { toast } from '@/components/ui/toast'
import { ReportExportButton } from '@/components/reports/ReportExportButton'

interface CashFlowLineItem {
  label: string
  amount: number
}

interface CashFlowSection {
  items: CashFlowLineItem[]
  total: number
}

interface CashFlowData {
  operating: CashFlowSection
  investing: CashFlowSection
  financing: CashFlowSection
  netCashFlow: number
  openingBalance: number
  closingBalance: number
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatAmount(amount: number): string {
  if (amount < 0) {
    return `(${formatCurrency(Math.abs(amount))})`
  }
  return formatCurrency(amount)
}

export default function CashFlowPage() {
  const params = useParams()
  const _slug = params.slug as string

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [data, setData] = useState<CashFlowData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!fromDate || !toDate) {
      toast.error('Please select both from and to dates')
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate })
      const res = await fetch(`/api/accounting/reports/cash-flow?${params}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to generate cash flow statement')
      }
    } catch {
      toast.error('Error generating cash flow statement')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Cash Flow Statement"
    >
      <div className="p-4 space-y-4 max-w-5xl mx-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
        {/* Export Button */}
        {data && (
          <div className="flex justify-end">
            <ReportExportButton
              data={[
                ...data.operating.items.map(i => ({ section: 'Operating', label: i.label, amount: i.amount })),
                { section: '', label: 'Net Cash from Operating', amount: data.operating.total },
                ...data.investing.items.map(i => ({ section: 'Investing', label: i.label, amount: i.amount })),
                { section: '', label: 'Net Cash from Investing', amount: data.investing.total },
                ...data.financing.items.map(i => ({ section: 'Financing', label: i.label, amount: i.amount })),
                { section: '', label: 'Net Cash from Financing', amount: data.financing.total },
                { section: '', label: 'Net Cash Flow', amount: data.netCashFlow },
                { section: '', label: 'Opening Cash Balance', amount: data.openingBalance },
                { section: '', label: 'Closing Cash Balance', amount: data.closingBalance },
              ]}
              columns={[
                { key: 'section', header: 'Section', width: 15 },
                { key: 'label', header: 'Description', width: 30 },
                { key: 'amount', header: 'Amount', format: 'currency' as const, width: 15 },
              ]}
              reportName="Cash Flow Statement"
            />
          </div>
        )}
        {/* Filter Bar */}
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />}
              Generate
            </button>
          </div>
        </div>

        {/* Report Content */}
        {data && (
          <div className="space-y-4">
            {/* Operating Activities */}
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="px-4 py-3 border-b dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20 rounded-t-lg">
                <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                  A. Cash Flow from Operating Activities
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">Operating activities cash flow</caption>
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                        Description
                      </th>
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400 w-48">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.operating.items.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                          No operating activity items for this period.
                        </td>
                      </tr>
                    ) : (
                      data.operating.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                            {item.label}
                          </td>
                          <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${
                            item.amount >= 0
                              ? 'text-gray-900 dark:text-white'
                              : 'text-red-600 dark:text-red-400'
                          }`}>
                            {formatAmount(item.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10">
                      <td className="px-4 py-3 text-sm font-semibold text-blue-800 dark:text-blue-300">
                        Net Cash from Operating Activities
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums ${
                        data.operating.total >= 0
                          ? 'text-blue-800 dark:text-blue-300'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {formatAmount(data.operating.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Investing Activities */}
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="px-4 py-3 border-b dark:border-gray-700 bg-purple-50 dark:bg-purple-900/20 rounded-t-lg">
                <h2 className="text-sm font-semibold text-purple-800 dark:text-purple-300">
                  B. Cash Flow from Investing Activities
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">Investing activities cash flow</caption>
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                        Description
                      </th>
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400 w-48">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.investing.items.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                          No investing activity items for this period.
                        </td>
                      </tr>
                    ) : (
                      data.investing.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                            {item.label}
                          </td>
                          <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${
                            item.amount >= 0
                              ? 'text-gray-900 dark:text-white'
                              : 'text-red-600 dark:text-red-400'
                          }`}>
                            {formatAmount(item.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10">
                      <td className="px-4 py-3 text-sm font-semibold text-purple-800 dark:text-purple-300">
                        Net Cash from Investing Activities
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums ${
                        data.investing.total >= 0
                          ? 'text-purple-800 dark:text-purple-300'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {formatAmount(data.investing.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Financing Activities */}
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="px-4 py-3 border-b dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20 rounded-t-lg">
                <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  C. Cash Flow from Financing Activities
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">Financing activities cash flow</caption>
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                        Description
                      </th>
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400 w-48">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.financing.items.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                          No financing activity items for this period.
                        </td>
                      </tr>
                    ) : (
                      data.financing.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                            {item.label}
                          </td>
                          <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${
                            item.amount >= 0
                              ? 'text-gray-900 dark:text-white'
                              : 'text-red-600 dark:text-red-400'
                          }`}>
                            {formatAmount(item.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
                      <td className="px-4 py-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
                        Net Cash from Financing Activities
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums ${
                        data.financing.total >= 0
                          ? 'text-amber-800 dark:text-amber-300'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {formatAmount(data.financing.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Net Cash Flow Summary */}
            <div className={`rounded border p-4 ${
              data.netCashFlow >= 0
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}>
              <div className="flex items-center justify-between">
                <span className={`text-base font-semibold ${
                  data.netCashFlow >= 0
                    ? 'text-green-800 dark:text-green-300'
                    : 'text-red-800 dark:text-red-300'
                }`}>
                  Net Cash Flow (A + B + C)
                </span>
                <span className={`text-lg font-bold font-mono tabular-nums ${
                  data.netCashFlow >= 0
                    ? 'text-green-800 dark:text-green-300'
                    : 'text-red-800 dark:text-red-300'
                }`}>
                  {formatAmount(data.netCashFlow)}
                </span>
              </div>
            </div>

            {/* Cash Balance Summary */}
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">Cash balance summary</caption>
                  <tbody>
                    <tr className="border-b border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        Opening Cash Balance
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white w-48">
                        {formatCurrency(data.openingBalance)}
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        Net Cash Flow
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-mono tabular-nums w-48 ${
                        data.netCashFlow >= 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {formatAmount(data.netCashFlow)}
                      </td>
                    </tr>
                    <tr className="bg-gray-50 dark:bg-gray-900">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">
                        Closing Cash Balance
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-right font-mono tabular-nums text-gray-900 dark:text-white w-48">
                        {formatCurrency(data.closingBalance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!data && !loading && (
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
            <DollarSign size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 dark:text-gray-400">
              Select a date range and click Generate to view the cash flow statement.
            </p>
          </div>
        )}
      </div>
    </ListPageLayout>
  )
}
