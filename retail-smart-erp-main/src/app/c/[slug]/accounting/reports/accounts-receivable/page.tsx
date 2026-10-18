'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Home, ChevronRight as ChevronRightIcon, ChevronDown, Users, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { ReportExportButton } from '@/components/reports/ReportExportButton'

interface ARInvoice {
  id: string
  invoiceNo: string | null
  date: string
  total: number
  paidAmount: number
  outstanding: number
  status: string | null
  agingBucket: string
}

interface ARPayment {
  id: string
  entryNumber: string
  sourceType: 'payment_entry' | 'journal_entry'
  date: string
  totalAmount: number
  allocatedAmount: number
  unallocated: number
  agingBucket: string
}

interface ARRow {
  customerId: string
  customerName: string
  current: number
  days31to60: number
  days61to90: number
  over90: number
  total: number
  invoices: ARInvoice[]
  payments: ARPayment[]
}

interface AgingTotals {
  current: number
  days31to60: number
  days61to90: number
  over90: number
  total: number
}

interface ARData {
  rows: ARRow[]
  totals: AgingTotals
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatNetAmount(amount: number): string {
  if (amount < 0) return `(${formatCurrency(Math.abs(amount))})`
  return formatCurrency(amount)
}

export default function AccountsReceivablePage() {
  const { tenantSlug } = useCompany()
  const [asOfDate, setAsOfDate] = useState('')
  const [data, setData] = useState<ARData | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  async function handleGenerate() {
    if (!asOfDate) {
      toast.error('Please select an as-of date')
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ asOfDate })
      const res = await fetch(`/api/accounting/reports/accounts-receivable?${params}`)
      if (res.ok) {
        const result = await res.json()
        setData({
          rows: result.data || [],
          totals: result.totals || { current: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 },
        })
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to generate AR aging report')
      }
    } catch {
      toast.error('Error generating AR aging report')
    } finally {
      setLoading(false)
    }
  }

  function toggleRow(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRightIcon size={14} />
        <Link href={`/c/${tenantSlug}/accounting`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Accounting
        </Link>
        <ChevronRightIcon size={14} />
        <span className="text-gray-500 dark:text-gray-400">Reports</span>
        <ChevronRightIcon size={14} />
        <span className="text-gray-900 dark:text-white font-medium">Accounts Receivable</span>
      </div>

      {/* Title + Export */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Accounts Receivable Aging</h1>
        {data && data.rows.length > 0 && <ReportExportButton
          data={data.rows.flatMap(row => [
            { customerName: row.customerName, type: '', ref: '', date: '', amount: '', paid: '', outstanding: '', status: '', current: row.current, days31to60: row.days31to60, days61to90: row.days61to90, over90: row.over90, total: row.total },
            ...row.invoices.map(inv => ({ customerName: '', type: 'Invoice', ref: inv.invoiceNo || '-', date: inv.date, amount: inv.total, paid: inv.paidAmount, outstanding: inv.outstanding, status: inv.status || '', current: '', days31to60: '', days61to90: '', over90: '', total: '' })),
            ...row.payments.map(pmt => ({ customerName: '', type: 'Credit', ref: pmt.entryNumber, date: pmt.date, amount: pmt.totalAmount, paid: pmt.allocatedAmount, outstanding: -pmt.unallocated, status: pmt.sourceType === 'journal_entry' ? 'JE' : 'PE', current: '', days31to60: '', days61to90: '', over90: '', total: '' })),
          ]) as unknown as Record<string, unknown>[]}
          columns={[
            { key: 'customerName', header: 'Customer', width: 20 },
            { key: 'type', header: 'Type', width: 8 },
            { key: 'ref', header: 'Reference #', width: 12 },
            { key: 'date', header: 'Date', width: 10 },
            { key: 'amount', header: 'Amount', format: 'currency' as const, width: 12 },
            { key: 'paid', header: 'Paid/Allocated', format: 'currency' as const, width: 12 },
            { key: 'outstanding', header: 'Outstanding', format: 'currency' as const, width: 12 },
            { key: 'status', header: 'Status', width: 10 },
            { key: 'current', header: 'Current (0-30)', format: 'currency' as const, width: 12 },
            { key: 'days31to60', header: '31-60', format: 'currency' as const, width: 10 },
            { key: 'days61to90', header: '61-90', format: 'currency' as const, width: 10 },
            { key: 'over90', header: 'Over 90', format: 'currency' as const, width: 10 },
            { key: 'total', header: 'Net Total', format: 'currency' as const, width: 12 },
          ]}
          reportName="Accounts Receivable Aging"
        />}
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[180px] max-w-xs">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              As of Date
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
            Generate
          </button>
        </div>
      </div>

      {/* Report Content */}
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Accounts Receivable Aging Report</caption>
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th scope="col" className="w-8 px-2 py-3"></th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                  Customer Name
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                  Current (0-30)
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                  31-60
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                  61-90
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                  Over 90
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                  Net Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    No outstanding receivables as of the selected date.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => {
                  const key = row.customerId || 'walk-in'
                  const isExpanded = expandedRows.has(key)
                  const hasCredits = row.payments.length > 0
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                        onClick={() => toggleRow(key)}
                      >
                        <td className="w-8 px-2 py-2.5 text-center">
                          {isExpanded
                            ? <ChevronDown size={14} className="inline text-gray-500 dark:text-gray-400" />
                            : <ChevronRightIcon size={14} className="inline text-gray-500 dark:text-gray-400" />
                          }
                        </td>
                        <td className="px-4 py-2.5 text-sm font-medium text-gray-900 dark:text-white">
                          {row.customerName}
                          {hasCredits && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                              has credits
                            </span>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${row.current < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                          {row.current !== 0 ? formatNetAmount(row.current) : '-'}
                        </td>
                        <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${row.days31to60 < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                          {row.days31to60 !== 0 ? formatNetAmount(row.days31to60) : '-'}
                        </td>
                        <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${row.days61to90 < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                          {row.days61to90 !== 0 ? formatNetAmount(row.days61to90) : '-'}
                        </td>
                        <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums ${row.over90 < 0 ? 'text-green-600 dark:text-green-400' : row.over90 > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                          {row.over90 !== 0 ? formatNetAmount(row.over90) : '-'}
                        </td>
                        <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.total < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                          {formatNetAmount(row.total)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="px-0 py-0">
                            <div className="bg-gray-50 dark:bg-gray-900/50 px-8 py-3 border-t border-gray-100 dark:border-gray-700">
                              <table className="w-full">
                                <thead>
                                  <tr className="text-xs text-gray-500 dark:text-gray-400">
                                    <th className="text-left py-1.5 px-3 font-medium">Type</th>
                                    <th className="text-left py-1.5 px-3 font-medium">Reference #</th>
                                    <th className="text-left py-1.5 px-3 font-medium">Date</th>
                                    <th className="text-left py-1.5 px-3 font-medium">Aging</th>
                                    <th className="text-right py-1.5 px-3 font-medium">Amount</th>
                                    <th className="text-right py-1.5 px-3 font-medium">Paid / Allocated</th>
                                    <th className="text-right py-1.5 px-3 font-medium">Outstanding</th>
                                    <th className="text-left py-1.5 px-3 font-medium">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {/* Invoice rows */}
                                  {row.invoices.map((inv) => (
                                    <tr key={inv.id} className="border-t border-gray-200 dark:border-gray-700/50 text-xs">
                                      <td className="py-1.5 px-3 text-gray-700 dark:text-gray-300">Invoice</td>
                                      <td className="py-1.5 px-3 text-gray-700 dark:text-gray-300">{inv.invoiceNo || '-'}</td>
                                      <td className="py-1.5 px-3 text-gray-700 dark:text-gray-300">{inv.date}</td>
                                      <td className="py-1.5 px-3">
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                          inv.agingBucket === 'current' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                          inv.agingBucket === '31-60' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                          inv.agingBucket === '61-90' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                                          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                        }`}>
                                          {inv.agingBucket === 'current' ? '0-30' : inv.agingBucket === 'over90' ? '90+' : inv.agingBucket}
                                        </span>
                                      </td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(inv.total)}</td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(inv.paidAmount)}</td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums font-medium text-gray-900 dark:text-white">{formatCurrency(inv.outstanding)}</td>
                                      <td className="py-1.5 px-3 text-gray-700 dark:text-gray-300 capitalize">{inv.status || '-'}</td>
                                    </tr>
                                  ))}
                                  {/* Payment credit rows */}
                                  {row.payments.map((pmt) => (
                                    <tr key={pmt.id} className="border-t border-gray-200 dark:border-gray-700/50 text-xs bg-green-50/50 dark:bg-green-900/10">
                                      <td className="py-1.5 px-3 text-green-700 dark:text-green-400 font-medium">Credit</td>
                                      <td className="py-1.5 px-3 text-green-700 dark:text-green-400">
                                        {pmt.entryNumber}
                                        <span className={`ml-1.5 inline-block px-1 py-0.5 rounded text-[10px] font-medium ${
                                          pmt.sourceType === 'journal_entry'
                                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                        }`}>
                                          {pmt.sourceType === 'journal_entry' ? 'JE' : 'PE'}
                                        </span>
                                      </td>
                                      <td className="py-1.5 px-3 text-green-700 dark:text-green-400">{pmt.date}</td>
                                      <td className="py-1.5 px-3">
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                          pmt.agingBucket === 'current' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                          pmt.agingBucket === '31-60' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                          pmt.agingBucket === '61-90' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                                          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                        }`}>
                                          {pmt.agingBucket === 'current' ? '0-30' : pmt.agingBucket === 'over90' ? '90+' : pmt.agingBucket}
                                        </span>
                                      </td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-green-700 dark:text-green-400">{formatCurrency(pmt.totalAmount)}</td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-green-700 dark:text-green-400">{formatCurrency(pmt.allocatedAmount)}</td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums font-medium text-green-700 dark:text-green-400">({formatCurrency(pmt.unallocated)})</td>
                                      <td className="py-1.5 px-3 text-green-600 dark:text-green-400 text-[10px]">Unallocated</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                  <td className="w-8 px-2 py-3"></td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">
                    Net Totals
                  </td>
                  <td className={`px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums ${data.totals.current < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                    {formatNetAmount(data.totals.current)}
                  </td>
                  <td className={`px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums ${data.totals.days31to60 < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                    {formatNetAmount(data.totals.days31to60)}
                  </td>
                  <td className={`px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums ${data.totals.days61to90 < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                    {formatNetAmount(data.totals.days61to90)}
                  </td>
                  <td className={`px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums ${data.totals.over90 < 0 ? 'text-green-600 dark:text-green-400' : data.totals.over90 > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                    {formatNetAmount(data.totals.over90)}
                  </td>
                  <td className={`px-4 py-3 text-sm font-bold text-right font-mono tabular-nums ${data.totals.total < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
                    {formatNetAmount(data.totals.total)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {!data && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <Users size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400">
            Select an as-of date and click Generate to view the accounts receivable aging report.
          </p>
        </div>
      )}
    </div>
  )
}
