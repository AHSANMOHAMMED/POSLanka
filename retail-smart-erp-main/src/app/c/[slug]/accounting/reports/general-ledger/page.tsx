'use client'

import { useState, useEffect } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'
import type { ExportColumn } from '@/lib/reports/export'

interface AccountOption {
  id: string
  name: string
  accountNumber: string
}

interface GLEntry {
  id: string
  postingDate: string
  voucherType: string
  voucherNumber: string
  debit: number
  credit: number
  balance: number
  remarks: string
  partyType: string
}

interface GeneralLedgerData {
  account: {
    id: string
    name: string
    accountNumber: string
    rootType: string
  }
  summary: {
    openingBalance: number
    totalDebit: number
    totalCredit: number
    closingBalance: number
  }
  data: GLEntry[]
}

function formatCurrency(amount: number): string {
  return (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const exportColumns: ExportColumn[] = [
  { key: 'postingDate', header: 'Date', width: 12 },
  { key: 'voucherType', header: 'Voucher Type', width: 15 },
  { key: 'voucherNumber', header: 'Voucher #', width: 15 },
  { key: 'debit', header: 'Debit', format: 'currency', width: 15 },
  { key: 'credit', header: 'Credit', format: 'currency', width: 15 },
  { key: 'balance', header: 'Balance', format: 'currency', width: 15 },
  { key: 'remarks', header: 'Remarks', width: 25 },
]

export default function GeneralLedgerPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [accountId, setAccountId] = useState('')
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [data, setData] = useState<GeneralLedgerData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch('/api/chart-of-accounts?all=true')
        if (res.ok) {
          const result = await res.json()
          const list = Array.isArray(result) ? result : result.data || []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setAccounts(list.filter((a: any) => !a.isGroup).map((a: any) => ({
            id: a.id,
            name: a.name,
            accountNumber: a.accountNumber,
          })))
        }
      } catch { /* ignore */ }
    }
    fetchAccounts()
  }, [])

  async function handleGenerate() {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    if (!accountId) { toast.error('Please select an account'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ fromDate, toDate, accountId })
      const res = await fetch(`/api/reports/general-ledger?${params}`)
      if (res.ok) setData(await res.json())
      else toast.error('Failed to generate report')
    } catch { toast.error('Error generating report') }
    finally { setLoading(false) }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'

  return (
    <ReportPageLayout
      title="General Ledger"
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
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.accountNumber} - {a.name}</option>
              ))}
            </select>
          </div>
          <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
            Generate
          </button>
        </div>
      }
      loading={loading}
      hasData={!!data}
      emptyIcon={<BookOpen size={40} />}
      emptyMessage="Select a date range and account, then click Generate to view the general ledger."
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exportData={data?.data as any}
      exportColumns={exportColumns}
      exportName="General Ledger"
      summaryCards={data ? <>
        <SummaryCard label="Opening Balance" value={formatCurrency(data.summary.openingBalance)} color="blue" />
        <SummaryCard label="Total Debit" value={formatCurrency(data.summary.totalDebit)} color="green" />
        <SummaryCard label="Total Credit" value={formatCurrency(data.summary.totalCredit)} color="red" />
        <SummaryCard label="Closing Balance" value={formatCurrency(data.summary.closingBalance)} color="purple" />
      </> : undefined}
    >
      {data && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="px-4 py-3 border-b dark:border-gray-700">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {data.account.accountNumber} - {data.account.name}
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">({data.account.rootType})</span>
            </p>
          </div>
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Voucher Type</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Voucher #</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Debit</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Credit</th>
                  <th className="px-4 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Balance</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening balance row */}
                <tr className="bg-blue-50 dark:bg-blue-900/20">
                  <td colSpan={5} className="px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-white">Opening Balance</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-300">{formatCurrency(data.summary.openingBalance)}</td>
                  <td></td>
                </tr>
                {data.data.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">{row.postingDate}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 capitalize">{row.voucherType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{row.voucherNumber}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                    <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-semibold ${row.balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(row.balance)}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 max-w-[200px] truncate">{row.remarks}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900">
                <tr className="border-t-2 border-gray-300 dark:border-gray-600">
                  <td colSpan={3} className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white">Closing Balance</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalDebit)}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalCredit)}</td>
                  <td className={`px-4 py-2.5 text-sm text-right font-mono tabular-nums font-bold ${data.summary.closingBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(data.summary.closingBalance)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ReportPageLayout>
  )
}
