'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Clock, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'

interface AgedPayableRow {
  supplierId: string
  supplierName: string
  current: number
  days30: number
  days60: number
  days90Plus: number
  total: number
}

interface AgedPayablesData {
  data: AgedPayableRow[]
  summary: {
    current: number
    days30: number
    days60: number
    days90Plus: number
    total: number
    supplierCount: number
  }
  asOfDate: string
}

export default function AgedPayablesPage() {
  const { tenantSlug, currency } = useCompany()
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10))
  const [data, setData] = useState<AgedPayablesData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (asOfDate) params.set('asOfDate', asOfDate)
      const res = await fetch(`/api/reports/aged-payables?${params}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to generate report')
      }
    } catch {
      toast.error('Error generating report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    handleGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/buying`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Buying
        </Link>
        <ChevronRight size={14} />
        <span>Aged Payables</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded">
            <Clock size={20} className="text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Aged Payables</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Outstanding supplier balances by aging period</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">As of Date</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Generate
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Current (0-30d)</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">{formatCurrency(data.summary.current, currency)}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">31-60 Days</div>
            <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400 mt-1">{formatCurrency(data.summary.days30, currency)}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">61-90 Days</div>
            <div className="text-lg font-bold text-orange-600 dark:text-orange-400 mt-1">{formatCurrency(data.summary.days60, currency)}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Over 90 Days</div>
            <div className="text-lg font-bold text-red-600 dark:text-red-400 mt-1">{formatCurrency(data.summary.days90Plus, currency)}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Total Payables</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">{formatCurrency(data.summary.total, currency)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{data.summary.supplierCount} supplier{data.summary.supplierCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Supplier</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Current (0-30d)</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">31-60 Days</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">61-90 Days</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Over 90 Days</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.data.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                      No outstanding payables
                    </td>
                  </tr>
                ) : (
                  <>
                    {data.data.map((row) => (
                      <tr key={row.supplierId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/c/${tenantSlug}/suppliers`}
                            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                          >
                            {row.supplierName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{row.current > 0 ? formatCurrency(row.current, currency) : '-'}</td>
                        <td className="px-4 py-3 text-right text-yellow-600 dark:text-yellow-400">{row.days30 > 0 ? formatCurrency(row.days30, currency) : '-'}</td>
                        <td className="px-4 py-3 text-right text-orange-600 dark:text-orange-400">{row.days60 > 0 ? formatCurrency(row.days60, currency) : '-'}</td>
                        <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{row.days90Plus > 0 ? formatCurrency(row.days90Plus, currency) : '-'}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">{formatCurrency(row.total, currency)}</td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="bg-gray-50 dark:bg-gray-900/50 font-bold border-t-2 border-gray-300 dark:border-gray-600">
                      <td className="px-4 py-3 text-gray-900 dark:text-white">Total</td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrency(data.summary.current, currency)}</td>
                      <td className="px-4 py-3 text-right text-yellow-600 dark:text-yellow-400">{formatCurrency(data.summary.days30, currency)}</td>
                      <td className="px-4 py-3 text-right text-orange-600 dark:text-orange-400">{formatCurrency(data.summary.days60, currency)}</td>
                      <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{formatCurrency(data.summary.days90Plus, currency)}</td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrency(data.summary.total, currency)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Loader2 size={24} className="animate-spin mx-auto text-gray-400" />
          <p className="text-sm text-gray-500 mt-2">Generating report...</p>
        </div>
      )}
    </div>
  )
}
