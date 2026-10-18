'use client'

import { useState, useCallback } from 'react'
import { CalendarDays, TrendingUp, TrendingDown, DollarSign, Receipt, AlertTriangle, Printer, ChevronDown, ChevronRight } from 'lucide-react'
import { useRealtimeData, useCurrency } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { formatCurrency } from '@/lib/utils/currency'

interface ReconciliationItem {
  paymentMethod: string
  openingAmount: number
  expectedAmount: number
  actualAmount: number
  variance: number
}

interface ShiftSummary {
  id: string
  entryNumber: string
  posProfile: { id: string; name: string } | null
  user: { id: string; name: string } | null
  openingTime: string
  closingTime: string
  totalSales: number
  totalReturns: number
  netSales: number
  totalTransactions: number
  status: string
  reconciliation: ReconciliationItem[]
}

interface DailySummaryData {
  date: string
  totalShifts: number
  summary: {
    totalSales: number
    totalReturns: number
    netSales: number
    totalTransactions: number
    totalVariance: number
  }
  paymentMethodBreakdown: ReconciliationItem[]
  shifts: ShiftSummary[]
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  credit: 'Credit',
  gift_card: 'Gift Card',
  mobile_payment: 'Mobile Payment',
}

export default function DailySummaryPage() {
  const { currency } = useCurrency()
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [data, setData] = useState<DailySummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedShifts, setExpandedShifts] = useState<Set<string>>(new Set())

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`/api/pos-daily-summary?date=${selectedDate}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (error) {
      console.error('Error fetching daily summary:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useRealtimeData(fetchSummary, { entityType: ['pos-shift', 'pos-closing'] })

  function toggleShift(shiftId: string) {
    setExpandedShifts(prev => {
      const next = new Set(prev)
      if (next.has(shiftId)) {
        next.delete(shiftId)
      } else {
        next.add(shiftId)
      }
      return next
    })
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSelectedDate(e.target.value)
    setLoading(true)
  }

  if (loading && !data) {
    return <PageLoading text="Loading daily summary..." />
  }

  const summary = data?.summary

  return (
    <ListPageLayout
      module="Selling"
      moduleHref="/selling"
      title="Daily Summary"
      onRefresh={fetchSummary}
    >
      {/* Date Picker & Print */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <CalendarDays size={18} className="text-gray-500" />
          <input
            type="date"
            value={selectedDate}
            onChange={handleDateChange}
            className="px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
          />
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-3 py-1.5 text-sm border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300 print:hidden"
        >
          <Printer size={14} /> Print Summary
        </button>
      </div>

      <div>
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <div className="bg-white dark:bg-gray-800 border rounded p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <DollarSign size={14} /> Total Sales
              </div>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(summary.totalSales, currency)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 border rounded p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <TrendingDown size={14} /> Returns
              </div>
              <p className="text-xl font-bold text-red-600">
                {formatCurrency(summary.totalReturns, currency)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 border rounded p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <TrendingUp size={14} /> Net Sales
              </div>
              <p className="text-xl font-bold text-green-600">
                {formatCurrency(summary.netSales, currency)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 border rounded p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <Receipt size={14} /> Transactions
              </div>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {summary.totalTransactions}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 border rounded p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <AlertTriangle size={14} /> Variance
              </div>
              <p className={`text-xl font-bold ${
                summary.totalVariance === 0 ? 'text-gray-900 dark:text-white' :
                summary.totalVariance > 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {summary.totalVariance >= 0 ? '+' : ''}{formatCurrency(summary.totalVariance, currency)}
              </p>
            </div>
          </div>
        )}

        {/* Payment Method Breakdown */}
        {data && data.paymentMethodBreakdown.length > 0 && (
          <div className="bg-white dark:bg-gray-800 border rounded mb-6">
            <div className="p-4 border-b dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">Payment Method Reconciliation</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                    <th className="text-left p-3 font-medium text-gray-600 dark:text-gray-400">Method</th>
                    <th className="text-right p-3 font-medium text-gray-600 dark:text-gray-400">Opening</th>
                    <th className="text-right p-3 font-medium text-gray-600 dark:text-gray-400">Expected</th>
                    <th className="text-right p-3 font-medium text-gray-600 dark:text-gray-400">Actual</th>
                    <th className="text-right p-3 font-medium text-gray-600 dark:text-gray-400">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.paymentMethodBreakdown.map(pm => (
                    <tr key={pm.paymentMethod} className="border-b dark:border-gray-700 last:border-0">
                      <td className="p-3 font-medium text-gray-900 dark:text-white">
                        {PAYMENT_METHOD_LABELS[pm.paymentMethod] || pm.paymentMethod}
                      </td>
                      <td className="p-3 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(pm.openingAmount, currency)}
                      </td>
                      <td className="p-3 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(pm.expectedAmount, currency)}
                      </td>
                      <td className="p-3 text-right text-gray-900 dark:text-white font-medium">
                        {formatCurrency(pm.actualAmount, currency)}
                      </td>
                      <td className={`p-3 text-right font-medium ${
                        pm.variance === 0 ? 'text-gray-600 dark:text-gray-400' :
                        pm.variance > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {pm.variance >= 0 ? '+' : ''}{formatCurrency(pm.variance, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Individual Shifts */}
        <div className="bg-white dark:bg-gray-800 border rounded">
          <div className="p-4 border-b dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Shifts ({data?.totalShifts || 0})
            </h3>
          </div>

          {(!data || data.shifts.length === 0) ? (
            <div className="p-8 text-center text-gray-500">
              No closed shifts found for this date.
            </div>
          ) : (
            <div className="divide-y dark:divide-gray-700">
              {data.shifts.map(shift => {
                const isExpanded = expandedShifts.has(shift.id)
                const shiftVariance = shift.reconciliation.reduce(
                  (sum, r) => sum + r.variance, 0
                )

                return (
                  <div key={shift.id}>
                    <button
                      onClick={() => toggleShift(shift.id)}
                      className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 dark:text-white">{shift.entryNumber}</span>
                            <span className={`px-2 py-0.5 text-xs rounded-full ${
                              shift.status === 'submitted' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                              shift.status === 'draft' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {shift.status}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {shift.user?.name || 'Unknown'} {shift.posProfile ? `- ${shift.posProfile.name}` : ''}
                            <span className="mx-2">|</span>
                            {formatTime(shift.openingTime)} - {formatTime(shift.closingTime)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Net Sales</div>
                          <div className="font-medium text-gray-900 dark:text-white">{formatCurrency(shift.netSales, currency)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Txns</div>
                          <div className="font-medium text-gray-900 dark:text-white">{shift.totalTransactions}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Variance</div>
                          <div className={`font-medium ${
                            shiftVariance === 0 ? 'text-gray-600' :
                            shiftVariance > 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {shiftVariance >= 0 ? '+' : ''}{formatCurrency(shiftVariance, currency)}
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Expanded reconciliation */}
                    {isExpanded && shift.reconciliation.length > 0 && (
                      <div className="px-4 pb-4 pl-12">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-gray-500 border-b dark:border-gray-700">
                              <th className="text-left py-2 font-medium">Method</th>
                              <th className="text-right py-2 font-medium">Opening</th>
                              <th className="text-right py-2 font-medium">Expected</th>
                              <th className="text-right py-2 font-medium">Actual</th>
                              <th className="text-right py-2 font-medium">Variance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shift.reconciliation.map((rec, idx) => (
                              <tr key={idx} className="border-b dark:border-gray-700 last:border-0">
                                <td className="py-2 text-gray-900 dark:text-white">
                                  {PAYMENT_METHOD_LABELS[rec.paymentMethod] || rec.paymentMethod}
                                </td>
                                <td className="py-2 text-right text-gray-500">{formatCurrency(rec.openingAmount, currency)}</td>
                                <td className="py-2 text-right text-gray-500">{formatCurrency(rec.expectedAmount, currency)}</td>
                                <td className="py-2 text-right text-gray-900 dark:text-white">{formatCurrency(rec.actualAmount, currency)}</td>
                                <td className={`py-2 text-right font-medium ${
                                  rec.variance === 0 ? 'text-gray-500' :
                                  rec.variance > 0 ? 'text-green-600' : 'text-red-600'
                                }`}>
                                  {rec.variance >= 0 ? '+' : ''}{formatCurrency(rec.variance, currency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </ListPageLayout>
  )
}
