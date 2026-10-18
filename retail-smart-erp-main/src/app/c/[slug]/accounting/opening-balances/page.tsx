'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Upload, FileText, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useRealtimeData, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'

interface Account {
  id: string
  accountNumber: string
  accountName: string
  rootType: string
}

interface DataSummary {
  totalReceivables: number
  totalPayables: number
  totalInventoryValue: number
}

interface BalanceRow {
  accountId: string
  debit: string
  credit: string
}

export default function OpeningBalancesPage() {
  const params = useParams()
  const _slug = params.slug as string
  const { currency } = useCurrency()

  const [summary, setSummary] = useState<DataSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [importDate, setImportDate] = useState('')
  const [importing, setImporting] = useState(false)

  // Manual opening balances
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [rows, setRows] = useState<BalanceRow[]>([{ accountId: '', debit: '', credit: '' }])
  const [postingDate, setPostingDate] = useState('')
  const [posting, setPosting] = useState(false)

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/accounting/opening-balances')
      if (res.ok) {
        const data = await res.json()
        setSummary(data)
      }
    } catch {
      // Summary not available
    } finally {
      setLoadingSummary(false)
    }
  }, [])

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounting/accounts?all=true')
      if (res.ok) {
        const data = await res.json()
        const allAccounts = Array.isArray(data) ? data : data.data || []
        setAccounts(allAccounts.filter((a: { isGroup?: boolean }) => !a.isGroup))
      }
    } catch {
      toast.error('Failed to load accounts')
    } finally {
      setLoadingAccounts(false)
    }
  }, [])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  useRealtimeData(fetchSummary, { entityType: 'gl-entry' })

  // Calculate totals for manual rows
  const totalDebit = rows.reduce((sum, row) => sum + (parseFloat(row.debit) || 0), 0)
  const totalCredit = rows.reduce((sum, row) => sum + (parseFloat(row.credit) || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01

  function addRow() {
    setRows([...rows, { accountId: '', debit: '', credit: '' }])
  }

  function removeRow(index: number) {
    if (rows.length <= 1) return
    setRows(rows.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: keyof BalanceRow, value: string) {
    const updated = [...rows]
    updated[index] = { ...updated[index], [field]: value }
    setRows(updated)
  }

  async function handleImport() {
    if (!importDate) {
      toast.error('Please select a posting date for import')
      return
    }

    setImporting(true)
    try {
      const res = await fetch('/api/accounting/opening-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importFromExisting: true,
          postingDate: importDate,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(data.message || 'Opening balances imported successfully')
        fetchSummary()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to import opening balances')
      }
    } catch {
      toast.error('Error importing opening balances')
    } finally {
      setImporting(false)
    }
  }

  async function handlePost() {
    if (!postingDate) {
      toast.error('Please select a posting date')
      return
    }

    const validRows = rows.filter((r) => r.accountId && (parseFloat(r.debit) > 0 || parseFloat(r.credit) > 0))
    if (validRows.length === 0) {
      toast.error('Please add at least one balance entry')
      return
    }

    if (!isBalanced) {
      toast.error('Total debits must equal total credits')
      return
    }

    setPosting(true)
    try {
      const res = await fetch('/api/accounting/opening-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postingDate,
          entries: validRows.map((r) => ({
            accountId: r.accountId,
            debit: parseFloat(r.debit) || 0,
            credit: parseFloat(r.credit) || 0,
          })),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(data.message || 'Opening balances posted successfully')
        setRows([{ accountId: '', debit: '', credit: '' }])
        setPostingDate('')
        fetchSummary()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to post opening balances')
      }
    } catch {
      toast.error('Error posting opening balances')
    } finally {
      setPosting(false)
    }
  }

  if (loadingSummary && loadingAccounts) {
    return <PageLoading text="Loading opening balances..." />
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Opening Balances"
    >
      <div className="p-4 space-y-6 max-w-5xl mx-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
        {/* Section 1: Import from Existing Data */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20 rounded-t-lg">
            <div className="flex items-center gap-2">
              <Upload size={16} className="text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300">Import from Existing Data</h2>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Automatically calculate opening balances from your existing customer receivables, supplier payables, and inventory data.
            </p>

            {summary && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Customer Receivables</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white font-mono tabular-nums">
                    {formatCurrency(summary.totalReceivables, currency)}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Supplier Payables</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white font-mono tabular-nums">
                    {formatCurrency(summary.totalPayables, currency)}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Inventory Value</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white font-mono tabular-nums">
                    {formatCurrency(summary.totalInventoryValue, currency)}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Posting Date *
                </label>
                <input
                  type="date"
                  value={importDate}
                  onChange={(e) => setImportDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                onClick={handleImport}
                disabled={importing || !importDate}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Import Opening Balances
              </button>
            </div>
          </div>
        </div>

        {/* Section 2: Manual Opening Balances */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-green-50 dark:bg-green-900/20 rounded-t-lg">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-green-600 dark:text-green-400" />
              <h2 className="text-sm font-semibold text-green-800 dark:text-green-300">Manual Opening Balances</h2>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manually enter opening balances for each account. Total debits must equal total credits.
            </p>

            <div className="flex-1 min-w-[200px] max-w-xs">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Posting Date *
              </label>
              <input
                type="date"
                value={postingDate}
                onChange={(e) => setPostingDate(e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Balance Entry Rows */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">Manual opening balance entries</caption>
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                      Account
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400 w-40">
                      Debit
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-400 w-40">
                      Credit
                    </th>
                    <th scope="col" className="px-3 py-2 text-center text-sm font-medium text-gray-600 dark:text-gray-400 w-16">
                      &nbsp;
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-3 py-2">
                        <select
                          value={row.accountId}
                          onChange={(e) => updateRow(index, 'accountId', e.target.value)}
                          className={inputClass}
                        >
                          <option value="">Select account</option>
                          {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.accountNumber} - {acc.accountName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.debit}
                          onChange={(e) => updateRow(index, 'debit', e.target.value)}
                          className={`${inputClass} text-right font-mono`}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.credit}
                          onChange={(e) => updateRow(index, 'credit', e.target.value)}
                          className={`${inputClass} text-right font-mono`}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => removeRow(index)}
                          disabled={rows.length <= 1}
                          className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Remove row"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                    <td className="px-3 py-2.5 text-sm font-semibold text-gray-900 dark:text-white text-right">
                      Totals
                    </td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {formatCurrency(totalDebit, currency)}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {formatCurrency(totalCredit, currency)}
                    </td>
                    <td className="px-3 py-2.5">&nbsp;</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Balance warning */}
            {(totalDebit > 0 || totalCredit > 0) && !isBalanced && (
              <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-800 dark:text-yellow-300">
                <AlertTriangle size={14} className="shrink-0" />
                <span>
                  Difference of {formatCurrency(Math.abs(totalDebit - totalCredit), currency)} &mdash; debits and credits must be equal to post.
                </span>
              </div>
            )}

            {(totalDebit > 0 || totalCredit > 0) && isBalanced && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-sm text-green-800 dark:text-green-300">
                <span>Balanced &mdash; debits equal credits.</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={addRow}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <Plus size={14} />
                Add Row
              </button>
              <button
                onClick={handlePost}
                disabled={posting || !isBalanced || totalDebit === 0 || !postingDate}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {posting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                Post Opening Balances
              </button>
            </div>
          </div>
        </div>
      </div>
    </ListPageLayout>
  )
}
