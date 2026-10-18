'use client'

import { Plus, FileSpreadsheet } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'

interface Budget {
  id: string
  name: string
  status: 'draft' | 'active' | 'cancelled'
  createdAt: string
  updatedAt: string
  fiscalYear?: {
    id: string
    name: string
  } | null
  costCenter?: {
    id: string
    name: string
  } | null
}

export default function BudgetsPage() {
  const params = useParams()
  const slug = params.slug as string
  const router = useRouter()

  const {
    data: budgets,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Budget>({
    endpoint: '/api/accounting/budgets',
    entityType: 'budget',
    storageKey: 'budgets-page-size',
  })

  function formatDate(dateStr: string) {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (loading && budgets.length === 0) {
    return <PageLoading text="Loading budgets..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Budgets"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search budgets..."
      actionContent={
        <button
          onClick={() => router.push(`/c/${slug}/accounting/budgets/new`)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Budget
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Budgets</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Fiscal Year
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Cost Center
              </th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {budgets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <FileSpreadsheet size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No budgets found. Create your first budget to track spending.</p>
                  </div>
                </td>
              </tr>
            ) : (
              budgets.map((budget) => (
                <tr
                  key={budget.id}
                  onClick={() => router.push(`/c/${slug}/accounting/budgets/${budget.id}`)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900 dark:text-white text-sm">
                      {budget.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {budget.fiscalYear?.name || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {budget.costCenter?.name || '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={budget.status} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(budget.createdAt)}
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
          className="border-t dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>
    </ListPageLayout>
  )
}
