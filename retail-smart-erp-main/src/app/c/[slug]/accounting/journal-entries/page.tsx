'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Eye, FileText } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData, useCurrency } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { formatCurrency } from '@/lib/utils/currency'

interface JournalEntry {
  id: string
  entryNumber: string
  postingDate: string
  entryType: string
  totalDebit: string
  totalCredit: string
  status: string
  remarks: string | null
  createdAt: string
}

export default function JournalEntriesPage() {
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState('')
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
  } = usePaginatedData<JournalEntry>({
    endpoint: '/api/accounting/journal-entries',
    entityType: 'journal-entry',
    storageKey: 'journal-entries-page-size',
    additionalParams: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    },
  })

  if (loading && entries.length === 0 && !search) {
    return <PageLoading text="Loading journal entries..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Journal Entries"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search journal entries..."
      actionContent={
        <Link
          href={`/c/${tenantSlug}/accounting/journal-entries/new`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Journal Entry
        </Link>
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
        {(statusFilter || fromDate || toDate) && (
          <button
            onClick={() => { setStatusFilter(''); setFromDate(''); setToDate(''); setPage(1) }}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Journal entries</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Entry #
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Date
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Type
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Total Debit
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Total Credit
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <FileText size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>{search || statusFilter || fromDate || toDate
                      ? 'No journal entries match your filters'
                      : 'No journal entries yet. Create your first journal entry to get started.'}</p>
                  </div>
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const totalDebit = parseFloat(entry.totalDebit || '0')
                const totalCredit = parseFloat(entry.totalCredit || '0')
                return (
                  <tr
                    key={entry.id}
                    className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    onClick={() => router.push(`/c/${tenantSlug}/accounting/journal-entries/${entry.id}`)}
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/c/${tenantSlug}/accounting/journal-entries/${entry.id}`}
                        className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {entry.entryNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {new Date(entry.postingDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 capitalize">
                      {entry.entryType}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {formatCurrency(totalDebit, currency)}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums text-gray-900 dark:text-white">
                      {formatCurrency(totalCredit, currency)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={entry.status} size="sm" />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/c/${tenantSlug}/accounting/journal-entries/${entry.id}`}
                        className="inline-flex items-center gap-1 p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Eye size={16} />
                      </Link>
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
