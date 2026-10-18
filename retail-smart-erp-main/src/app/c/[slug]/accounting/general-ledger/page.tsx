'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination } from '@/components/ui'

interface Account {
  id: string
  accountNumber: string
  name: string
  isGroup: boolean
}

interface GLEntry {
  id: string
  postingDate: string
  accountId: string
  accountNumber: string
  accountName: string
  debit: string
  credit: string
  voucherType: string
  voucherNumber: string | null
  remarks: string | null
  createdAt: string
}

const voucherTypes = [
  { value: '', label: 'All Types' },
  { value: 'sale', label: 'Sale' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'payment', label: 'Payment' },
  { value: 'payment_entry', label: 'Payment Entry' },
  { value: 'refund', label: 'Refund' },
  { value: 'journal_entry', label: 'Journal Entry' },
  { value: 'opening', label: 'Opening Balance' },
  { value: 'stock_adjustment', label: 'Stock Adjustment' },
  { value: 'stock_transfer', label: 'Stock Transfer' },
  { value: 'work_order_part', label: 'Work Order Part' },
  { value: 'work_order_invoice', label: 'Work Order Invoice' },
  { value: 'period_closing', label: 'Period Closing' },
  { value: 'payroll', label: 'Payroll' },
]

export default function GeneralLedgerPage() {
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [costCenterId, setCostCenterId] = useState('')
  const [costCentersList, setCostCentersList] = useState<{ id: string; name: string }[]>([])
  const [accountFilter, setAccountFilter] = useState(searchParams.get('accountId') || '')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [voucherType, setVoucherType] = useState('')
  // Fetch accounts for filter dropdown - refreshes when accounts change
  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounting/accounts?all=true')
      if (res.ok) {
        const data = await res.json()
        const list = Array.isArray(data) ? data : data.data || []
        setAccounts(list.filter((a: Account) => !a.isGroup))
      }
    } catch {
      // Silently fail - filter will just have no options
    }
  }, [])

  useRealtimeData(loadAccounts, { entityType: 'account' })

  // Fetch cost centers for filter dropdown
  useEffect(() => {
    async function loadCostCenters() {
      try {
        const res = await fetch('/api/accounting/cost-centers?all=true')
        if (res.ok) {
          const data = await res.json()
          setCostCentersList(Array.isArray(data) ? data : data.data || [])
        }
      } catch {
        // Silently fail
      }
    }
    loadCostCenters()
  }, [])

  const additionalParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (accountFilter) params.accountId = accountFilter
    if (fromDate) params.fromDate = fromDate
    if (toDate) params.toDate = toDate
    if (voucherType) params.voucherType = voucherType
    if (costCenterId) params.costCenterId = costCenterId
    return params
  }, [accountFilter, fromDate, toDate, voucherType, costCenterId])

  const {
    data: entries,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<GLEntry>({
    endpoint: '/api/accounting/gl-entries',
    entityType: 'gl-entry',
    storageKey: 'gl-entries-page-size',
    additionalParams,
  })

  function clearFilters() {
    setAccountFilter('')
    setCostCenterId('')
    setFromDate('')
    setToDate('')
    setVoucherType('')
  }

  const hasFilters = !!accountFilter || !!fromDate || !!toDate || !!voucherType || !!costCenterId

  if (loading && entries.length === 0 && !search && !hasFilters) {
    return <PageLoading text="Loading general ledger..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="General Ledger"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search remarks, voucher..."
      filterContent={
        <>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white max-w-[200px]"
          >
            <option value="">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} - {a.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            placeholder="From"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            placeholder="To"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
          <select
            value={voucherType}
            onChange={(e) => setVoucherType(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            {voucherTypes.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
          <select
            value={costCenterId}
            onChange={(e) => setCostCenterId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Cost Centers</option>
            {costCentersList.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.name}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">General ledger entries</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Date
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Account
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Debit
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Credit
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Voucher Type
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Voucher #
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Remarks
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  {search || hasFilters
                    ? 'No entries match your search or filters'
                    : 'No general ledger entries yet.'}
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const debit = parseFloat(entry.debit || '0')
                const credit = parseFloat(entry.credit || '0')
                return (
                  <tr
                    key={entry.id}
                    className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {new Date(entry.postingDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {entry.accountName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {entry.accountNumber}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                      {debit > 0 ? (
                        <span className="text-gray-900 dark:text-white">{debit.toFixed(2)}</span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                      {credit > 0 ? (
                        <span className="text-gray-900 dark:text-white">{credit.toFixed(2)}</span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400">
                      {entry.voucherType || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 font-mono">
                      {entry.voucherNumber || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 max-w-[200px] truncate">
                      {entry.remarks || '-'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>

        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t px-4"
        />
      </div>
    </ListPageLayout>
  )
}
