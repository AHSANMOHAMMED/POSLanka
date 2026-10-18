'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, CreditCard, X } from 'lucide-react'
import { usePaginatedData, useTerminology, useDateFormat } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useCurrency } from '@/hooks/useCurrency'
import { CreateLayawayModal } from '@/components/modals/CreateLayawayModal'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

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

const statusOptions: [string, string][] = [
  ['active', 'Active'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['forfeited', 'Forfeited'],
]

export default function LayawaysPage() {
  const t = useTerminology()
  const { currency: currencyCode } = useCurrency()
  const { tenantSlug } = useCompany()
  const { fDate, fDateTime } = useDateFormat()
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [showCreateModal, setShowCreateModal] = useState(false)

  const additionalParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (statusFilter) params.status = statusFilter
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
    router.push(`/c/${tenantSlug}/layaways/${layawayId}`)
  }

  // Date formatting now uses tenant settings via useDateFormat hook

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

  const hasFilters = !!statusFilter

  return (
    <ListPageLayout
      module={t.sellingModule}
      moduleHref="/selling"
      title="Layaway"
      actionButton={{ label: 'New Layaway', onClick: () => setShowCreateModal(true) }}
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search by layaway number or customer..."
      filterContent={
        <>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Statuses</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {hasFilters && (
            <button onClick={() => { setStatusFilter(''); setPage(1) }} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Layaway #</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Customer</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Total</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Paid</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Balance</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300 hidden md:table-cell">Due Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300 hidden lg:table-cell">Created</th>
            </tr>
          </thead>
          <tbody>
            {layaways.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search || hasFilters
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
                          {fDate(layaway.dueDate)}
                          {layaway.status === 'active' && isOverdue(layaway.dueDate) && ' (Overdue)'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm hidden lg:table-cell">
                    {fDateTime(layaway.createdAt)}
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

      <CreateLayawayModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          setShowCreateModal(false)
          refresh()
        }}
      />
    </ListPageLayout>
  )
}
