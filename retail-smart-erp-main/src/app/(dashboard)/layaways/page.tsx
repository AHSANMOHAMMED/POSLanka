'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Calendar, CreditCard } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useCurrency } from '@/hooks/useCurrency'
import { CreateLayawayModal } from '@/components/modals/CreateLayawayModal'

interface Layaway {
  id: string
  layawayNo: string
  customerId: string
  customerName: string | null
  subtotal: string
  taxAmount: string
  total: string
  depositAmount: string
  paidAmount: string
  balanceDue: string
  status: 'active' | 'completed' | 'cancelled' | 'forfeited'
  dueDate: string | null
  notes: string | null
  cancellationReason: string | null
  createdByName: string | null
  createdAt: string
}

const statusColors: Record<string, string> = {
  active: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  forfeited: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  forfeited: 'Forfeited',
}

export default function LayawaysPage() {
  const { currency: currencyCode } = useCurrency()
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Memoize additionalParams to prevent infinite re-renders
  const additionalParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (statusFilter !== 'all') params.status = statusFilter
    return params
  }, [statusFilter])

  const {
    data: layaways,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Layaway>({
    endpoint: '/api/layaways',
    entityType: 'layaway',
    storageKey: 'layaways-page-size',
    additionalParams,
  })

  function handleRowClick(layawayId: string) {
    router.push(`/layaways/${layawayId}`)
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function formatDateTime(dateString: string) {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function isDueSoon(dueDate: string | null) {
    if (!dueDate) return false
    const due = new Date(dueDate)
    const now = new Date()
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return diffDays <= 7 && diffDays >= 0
  }

  function isOverdue(dueDate: string | null) {
    if (!dueDate) return false
    return new Date(dueDate) < new Date()
  }

  if (loading && layaways.length === 0) {
    return <PageLoading text="Loading layaways..." />
  }

  const activeCount = layaways.filter(l => l.status === 'active').length
  const overdueCount = layaways.filter(l => l.status === 'active' && isOverdue(l.dueDate)).length

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Layaways</h1>
          {activeCount > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {activeCount} active layaway{activeCount !== 1 ? 's' : ''}
              {overdueCount > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {' '}({overdueCount} overdue)
                </span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          aria-label="Create new layaway"
        >
          <Plus size={20} aria-hidden="true" />
          New Layaway
        </button>
      </div>

      <div className="flex gap-4 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by layaway number or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="forfeited">Forfeited</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of layaways</caption>
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Layaway #</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Customer</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Total</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Paid</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Balance</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300 hidden md:table-cell">Due Date</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300 hidden lg:table-cell">Created</th>
            </tr>
          </thead>
          <tbody>
            {layaways.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search || statusFilter !== 'all'
                    ? 'No layaways match your filters'
                    : 'No layaways yet. Create your first layaway!'}
                </td>
              </tr>
            ) : (
              layaways.map((layaway) => (
                <tr
                  key={layaway.id}
                  onClick={() => handleRowClick(layaway.id)}
                  className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <CreditCard size={16} className="text-gray-400" />
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {layaway.layawayNo}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {layaway.customerName || 'Unknown Customer'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium dark:text-white">
                    {currencyCode} {parseFloat(layaway.total).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-green-600 dark:text-green-400">
                    {currencyCode} {parseFloat(layaway.paidAmount).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {parseFloat(layaway.balanceDue) > 0 ? (
                      <span className="text-orange-600 dark:text-orange-400 font-medium">
                        {currencyCode} {parseFloat(layaway.balanceDue).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[layaway.status]}`}>
                      {statusLabels[layaway.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {layaway.dueDate ? (
                      <div className="flex items-center gap-1">
                        <Calendar size={14} className="text-gray-400" />
                        <span className={`text-sm ${
                          layaway.status === 'active' && isOverdue(layaway.dueDate)
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : layaway.status === 'active' && isDueSoon(layaway.dueDate)
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-gray-600 dark:text-gray-400'
                        }`}>
                          {formatDate(layaway.dueDate)}
                          {layaway.status === 'active' && isOverdue(layaway.dueDate) && ' (Overdue)'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm hidden lg:table-cell">
                    {formatDateTime(layaway.createdAt)}
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
          className="border-t dark:border-gray-700 px-4"
        />
      </div>

      {/* Create Layaway Modal */}
      <CreateLayawayModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          setShowCreateModal(false)
          refresh()
        }}
      />
    </div>
  )
}
