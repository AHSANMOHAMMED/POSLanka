'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Users } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface Dealer {
  id: string
  code: string
  name: string
  type: string
  contactPerson: string | null
  email: string | null
  phone: string | null
  territory: string | null
  commissionRate: string | null
  creditLimit: string | null
  currentBalance: string | null
  status: string
  contractStartDate: string | null
  contractEndDate: string | null
  createdAt: string
}

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  suspended: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  inactive: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  inactive: 'Inactive',
}

const typeLabels: Record<string, string> = {
  authorized: 'Authorized',
  sub_dealer: 'Sub Dealer',
  agent: 'Agent',
  franchise: 'Franchise',
}

export default function DealersPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const {
    data: dealers,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Dealer>({
    endpoint: '/api/dealers',
    entityType: 'dealer',
    storageKey: 'dealers-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
    },
  })

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'suspended', label: 'Suspended' },
    { key: 'inactive', label: 'Inactive' },
  ]

  function formatCurrency(value: string | null): string {
    if (!value) return '-'
    return parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function formatPercent(value: string | null): string {
    if (!value) return '-'
    return `${parseFloat(value)}%`
  }

  function handleRowClick(id: string) {
    router.push(`/c/${tenantSlug}/dealership/dealers/${id}`)
  }

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Dealer Network"
      actionContent={
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/c/${tenantSlug}/dealership/dealers/new`)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Dealer
          </button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search by name, code, territory..."
    >
      {/* Filter Tabs */}
      <div className="px-4 pb-2">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key)
                setPage(1)
              }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                statusFilter === tab.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 list-container-xl overflow-x-auto mx-4">
        <table className="w-full">
          <caption className="sr-only">Dealer network list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Code</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Name</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Type</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Territory</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Commission</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Credit Limit</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Balance</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {dealers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {loading ? 'Loading...' : search ? 'No dealers match your search' : 'No dealers yet. Add your first dealer!'}
                </td>
              </tr>
            ) : (
              dealers.map((dealer) => (
                <tr
                  key={dealer.id}
                  className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => handleRowClick(dealer.id)}
                >
                  <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">
                    {dealer.code}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Users size={16} className="text-gray-400 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{dealer.name}</div>
                        {dealer.contactPerson && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{dealer.contactPerson}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {typeLabels[dealer.type] || dealer.type}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {dealer.territory || '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    {formatPercent(dealer.commissionRate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-gray-700 dark:text-gray-300">
                    {formatCurrency(dealer.creditLimit)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {dealer.currentBalance ? (
                      <span className={parseFloat(dealer.currentBalance) < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}>
                        {formatCurrency(dealer.currentBalance)}
                      </span>
                    ) : (
                      <span className="text-gray-400">0.00</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[dealer.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {statusLabels[dealer.status] || dealer.status}
                    </span>
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
          className="border-t border-gray-200 dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>
    </ListPageLayout>
  )
}
