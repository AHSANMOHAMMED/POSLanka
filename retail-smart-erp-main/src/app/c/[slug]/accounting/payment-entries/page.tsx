'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRightLeft,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData, useCurrency } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { formatCurrency } from '@/lib/utils/currency'
import { format } from 'date-fns'

interface PaymentEntry {
  id: string
  entryNumber: string
  paymentType: 'receive' | 'pay' | 'internal_transfer'
  postingDate: string
  partyType: string | null
  partyName: string | null
  paidAmount: string
  totalAllocatedAmount: string
  unallocatedAmount: string
  status: 'draft' | 'submitted' | 'cancelled'
  referenceNo: string | null
  modeName: string | null
  createdAt: string
}

const typeIcons = {
  receive: ArrowDownRight,
  pay: ArrowUpRight,
  internal_transfer: ArrowRightLeft,
}

const typeLabels = {
  receive: 'Receive',
  pay: 'Pay',
  internal_transfer: 'Internal Transfer',
}

const typeColors = {
  receive: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20',
  pay: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
  internal_transfer: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20',
}

export default function PaymentEntriesPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const {
    data: entries,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<PaymentEntry>({
    endpoint: '/api/accounting/payment-entries',
    entityType: 'payment-entry',
    storageKey: 'payment-entries-page-size',
    additionalParams: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(typeFilter ? { paymentType: typeFilter } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    },
  })

  if (loading && entries.length === 0) {
    return <PageLoading text="Loading payment entries..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Payment Entries"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search entries..."
      actionContent={
        <button
          onClick={() => router.push(`/c/${tenantSlug}/accounting/payment-entries/new`)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Payment Entry
        </button>
      }
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
          className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">All Types</option>
          <option value="receive">Receive</option>
          <option value="pay">Pay</option>
          <option value="internal_transfer">Internal Transfer</option>
        </select>
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <span>From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1) }}
            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <span>To</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1) }}
            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
        {(statusFilter || typeFilter || fromDate || toDate) && (
          <button
            onClick={() => { setStatusFilter(''); setTypeFilter(''); setFromDate(''); setToDate(''); setPage(1) }}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Payment Entries</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Entry #</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Type</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Party</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Mode</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Amount</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Unallocated</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <ArrowRightLeft size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No payment entries found.</p>
                  </div>
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const TypeIcon = typeIcons[entry.paymentType]
                return (
                  <tr
                    key={entry.id}
                    onClick={() => router.push(`/c/${tenantSlug}/accounting/payment-entries/${entry.id}`)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-blue-600 dark:text-blue-400 text-sm">{entry.entryNumber}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[entry.paymentType]}`}>
                        <TypeIcon size={12} />
                        {typeLabels[entry.paymentType]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {format(new Date(entry.postingDate), 'MMM dd, yyyy')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {entry.partyName || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {entry.modeName || '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-white">
                      {formatCurrency(Number(entry.paidAmount), currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                      {Number(entry.unallocatedAmount) > 0 ? formatCurrency(Number(entry.unallocatedAmount), currency) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={entry.status} size="sm" />
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
          className="border-t dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>
    </ListPageLayout>
  )
}
