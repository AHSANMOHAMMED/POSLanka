'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Eye, RefreshCw } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'

interface RecurringTemplate {
  id: string
  name: string
  entryType: string
  recurrencePattern: string
  startDate: string
  endDate: string | null
  nextRunDate: string | null
  isActive: boolean
  lastGeneratedAt: string | null
  createdAt: string
}

const patternLabels: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

export default function RecurringEntriesPage() {
  const { tenantSlug } = useCompany()
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState('')

  const {
    data: templates,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<RecurringTemplate>({
    endpoint: '/api/accounting/recurring-entries',
    entityType: 'recurring-entry',
    storageKey: 'recurring-entries-page-size',
    additionalParams: {
      ...(statusFilter ? { status: statusFilter } : {}),
    },
  })

  if (loading && templates.length === 0 && !search) {
    return <PageLoading text="Loading recurring entries..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Recurring Entries"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search recurring entries..."
      actionContent={
        <Link
          href={`/c/${tenantSlug}/accounting/recurring-entries/new`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Template
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
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {statusFilter && (
          <button
            onClick={() => { setStatusFilter(''); setPage(1) }}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Recurring journal entry templates</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Recurrence
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Next Run Date
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Last Generated
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
            {templates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>{search || statusFilter
                      ? 'No recurring entries match your filters'
                      : 'No recurring entries yet. Create your first template to get started.'}</p>
                  </div>
                </td>
              </tr>
            ) : (
              templates.map((template) => (
                <tr
                  key={template.id}
                  className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => router.push(`/c/${tenantSlug}/accounting/recurring-entries/${template.id}`)}
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/c/${tenantSlug}/accounting/recurring-entries/${template.id}`}
                      className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {template.name}
                    </Link>
                    <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                      {template.entryType}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400">
                    {patternLabels[template.recurrencePattern] || template.recurrencePattern}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {template.nextRunDate
                      ? new Date(template.nextRunDate + 'T00:00:00').toLocaleDateString()
                      : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {template.lastGeneratedAt
                      ? new Date(template.lastGeneratedAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={template.isActive ? 'active' : 'inactive'} size="sm" />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/c/${tenantSlug}/accounting/recurring-entries/${template.id}`}
                      className="inline-flex items-center gap-1 p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Eye size={16} />
                    </Link>
                  </td>
                </tr>
              ))
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
