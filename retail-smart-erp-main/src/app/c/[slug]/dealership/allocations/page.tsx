'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Car, Filter } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface DealerAllocation {
  id: string
  dealerId: string
  dealerName: string | null
  dealerCode: string | null
  vehicleInventoryId: string
  stockNo: string | null
  vehicleDescription: string | null
  allocatedAt: string
  allocatedByName: string | null
  returnedAt: string | null
  returnReason: string | null
  status: string
  askingPrice: string | null
  minimumPrice: string | null
  notes: string | null
  createdAt: string
}

interface DealerOption {
  id: string
  name: string
  code: string
}

const statusColors: Record<string, string> = {
  allocated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  returned: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  sold: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
}

const statusLabels: Record<string, string> = {
  allocated: 'Allocated',
  returned: 'Returned',
  sold: 'Sold',
}

export default function DealerAllocationsPage() {
  const { tenantSlug } = useCompany()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dealerFilter, setDealerFilter] = useState<string>('')
  const [dealerOptions, setDealerOptions] = useState<DealerOption[]>([])

  const {
    data: allocations,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<DealerAllocation>({
    endpoint: '/api/dealer-allocations',
    entityType: 'dealer-allocation',
    storageKey: 'dealer-allocations-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
      ...(dealerFilter && { dealerId: dealerFilter }),
    },
  })

  // Fetch dealer options for filter dropdown
  const fetchDealers = useCallback(async () => {
    try {
      const res = await fetch('/api/dealers?all=true')
      if (res.ok) {
        const data = await res.json()
        const list = Array.isArray(data) ? data : data.data || []
        setDealerOptions(list.map((d: DealerOption) => ({ id: d.id, name: d.name, code: d.code })))
      }
    } catch {
      // Silently fail - dropdown just won't have options
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDealers()
  }, [fetchDealers])

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'allocated', label: 'Allocated' },
    { key: 'returned', label: 'Returned' },
    { key: 'sold', label: 'Sold' },
  ]

  function formatCurrency(value: string | null): string {
    if (!value) return '-'
    return parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function formatDate(value: string | null): string {
    if (!value) return '-'
    return new Date(value).toLocaleDateString()
  }

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Dealer Allocations"
      actionContent={
        <div className="flex items-center gap-2">
          <Link
            href={`/c/${tenantSlug}/dealership/allocations/new`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            New Allocation
          </Link>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search by stock #, dealer..."
    >
      {/* Filter Tabs + Dealer Filter */}
      <div className="px-4 pb-2 space-y-2">
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
        {dealerOptions.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-gray-400 flex-shrink-0" />
            <select
              value={dealerFilter}
              onChange={(e) => {
                setDealerFilter(e.target.value)
                setPage(1)
              }}
              className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Dealers</option>
              {dealerOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} - {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 list-container-xl overflow-x-auto mx-4">
        <table className="w-full">
          <caption className="sr-only">Dealer allocations list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Dealer</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Allocated Date</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Asking Price</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {loading ? 'Loading...' : search ? 'No allocations match your search' : 'No dealer allocations yet. Create your first allocation!'}
                </td>
              </tr>
            ) : (
              allocations.map((alloc) => (
                <tr
                  key={alloc.id}
                  className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Car size={16} className="text-gray-400 flex-shrink-0" />
                      <div>
                        <Link
                          href={`/c/${tenantSlug}/dealership/inventory/${alloc.vehicleInventoryId}`}
                          className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {alloc.stockNo || 'N/A'}
                        </Link>
                        {alloc.vehicleDescription && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{alloc.vehicleDescription}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{alloc.dealerName || '-'}</div>
                    {alloc.dealerCode && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{alloc.dealerCode}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(alloc.allocatedAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(alloc.askingPrice)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[alloc.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {statusLabels[alloc.status] || alloc.status}
                    </span>
                    {alloc.status === 'returned' && alloc.returnedAt && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Returned {formatDate(alloc.returnedAt)}
                      </div>
                    )}
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
