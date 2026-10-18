'use client'

import { useState } from 'react'
import { Plus, Trash2, Receipt } from 'lucide-react'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { CancellationReasonModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface VehicleSale {
  id: string
  invoiceNo: string
  saleDate: string
  customerName: string | null
  vehicleName: string | null
  salePrice: string | null
  tradeInValue: string | null
  financeAmount: string | null
  salesperson: string | null
  status: string
  cancellationReason: string | null
  createdAt: string
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  delivered: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
  delivered: 'Delivered',
}

export default function VehicleSalesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modal states
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showCancellationModal, setShowCancellationModal] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const {
    data: sales,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<VehicleSale>({
    endpoint: '/api/vehicle-sales',
    entityType: 'vehicle-sale',
    storageKey: 'vehicle-sales-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
    },
  })

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/vehicle-sales/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        toast.success('Vehicle sale deleted')
      } else {
        toast.error('Failed to delete vehicle sale')
      }
    } catch (error) {
      console.error('Error deleting sale:', error)
      toast.error('Error deleting vehicle sale')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  async function handleCancel(reason: string) {
    if (!cancellingId) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/vehicle-sales/${cancellingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason }),
      })
      if (res.ok) {
        refresh()
        toast.success('Vehicle sale cancelled')
      } else {
        toast.error('Failed to cancel vehicle sale')
      }
    } catch (error) {
      console.error('Error cancelling sale:', error)
      toast.error('Error cancelling vehicle sale')
    } finally {
      setCancelling(false)
      setCancellingId(null)
      setShowCancellationModal(false)
    }
  }

  if (loading && sales.length === 0) {
    return <PageLoading text="Loading vehicle sales..." />
  }

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'pending', label: 'Pending' },
    { key: 'completed', label: 'Completed' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Vehicle Sales"
      actionContent={
        <button
          onClick={() => toast.info('Vehicle sale creation coming soon')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Sale
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Invoice #, customer, vehicle..."
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
          <caption className="sr-only">Vehicle sales list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Invoice #</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Customer</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Sale Price</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Trade-In</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Finance Amt</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Salesperson</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No sales match your search' : 'No vehicle sales yet.'}
                </td>
              </tr>
            ) : (
              sales.map((sale) => (
                <tr key={sale.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Receipt size={14} className="text-gray-400 flex-shrink-0" />
                      <span className="font-medium text-blue-600 dark:text-blue-400">{sale.invoiceNo}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {new Date(sale.saleDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {sale.customerName || '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {sale.vehicleName || '-'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                    {sale.salePrice ? parseFloat(sale.salePrice).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {sale.tradeInValue ? parseFloat(sale.tradeInValue).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {sale.financeAmount ? parseFloat(sale.financeAmount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {sale.salesperson || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[sale.status] || 'bg-gray-100 text-gray-700'}`}>
                      {statusLabels[sale.status] || sale.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {(sale.status === 'draft' || sale.status === 'pending') && (
                        <button
                          onClick={() => {
                            setCancellingId(sale.id)
                            setShowCancellationModal(true)
                          }}
                          aria-label="Cancel sale"
                          className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteId(sale.id)}
                        aria-label={`Delete sale ${sale.invoiceNo}`}
                        className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
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

      {/* Delete Confirm */}
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Vehicle Sale"
        message="Are you sure you want to delete this sale record? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />

      {/* Cancellation Modal */}
      <CancellationReasonModal
        isOpen={showCancellationModal}
        onClose={() => {
          setShowCancellationModal(false)
          setCancellingId(null)
        }}
        onConfirm={handleCancel}
        title="Cancel Vehicle Sale"
        itemName="this vehicle sale"
        processing={cancelling}
      />
    </ListPageLayout>
  )
}
