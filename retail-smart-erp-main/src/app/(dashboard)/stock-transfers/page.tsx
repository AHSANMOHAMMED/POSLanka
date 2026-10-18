'use client'

import { useState } from 'react'
import { ArrowRightLeft, Plus, Search, Eye, Warehouse, ArrowRight, Filter, Pencil } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { PageLoading } from '@/components/ui/loading-spinner'
import { StockTransferFormModal, StockTransferDetailModal } from '@/components/modals'

interface StockTransfer {
  id: string
  transferNo: string
  status: 'draft' | 'pending_approval' | 'approved' | 'in_transit' | 'completed' | 'cancelled'
  fromWarehouse: { id: string; name: string; code: string }
  toWarehouse: { id: string; name: string; code: string }
  requestedBy: { id: string; fullName: string } | null
  approvedBy: { id: string; fullName: string } | null
  notes: string | null
  createdAt: string
  approvedAt: string | null
  shippedAt: string | null
  receivedAt: string | null
  _itemCount?: number
}

// Full transfer type for edit mode
interface StockTransferFull extends StockTransfer {
  fromWarehouseId: string
  toWarehouseId: string
  updatedAt: string | null
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  in_transit: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  in_transit: 'In Transit',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export default function StockTransfersPage() {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [showModal, setShowModal] = useState(false)
  const [editTransfer, setEditTransfer] = useState<StockTransferFull | null>(null)
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null)
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null)

  const {
    data: transfers,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<StockTransfer>({
    endpoint: '/api/stock-transfers',
    entityType: 'stock-transfer',
    storageKey: 'stock-transfers-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : undefined,
  })

  // Fetch full transfer for edit mode
  async function handleEditClick(transferId: string) {
    setLoadingEditId(transferId)
    try {
      const res = await fetch(`/api/stock-transfers/${transferId}`)
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}))
        throw new Error(errorBody.error || `Failed to fetch transfer (${res.status})`)
      }
      const data = await res.json()
      // Map the response to include fromWarehouseId and toWarehouseId
      setEditTransfer({
        ...data,
        fromWarehouseId: data.fromWarehouse?.id || data.fromWarehouseId,
        toWarehouseId: data.toWarehouse?.id || data.toWarehouseId,
      })
      setShowModal(true)
    } catch (err) {
      console.error('Failed to load transfer for editing:', err)
    } finally {
      setLoadingEditId(null)
    }
  }

  function handleModalClose() {
    setShowModal(false)
    setEditTransfer(null)
  }

  function handleModalSaved() {
    refresh()
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (loading && transfers.length === 0) {
    return <PageLoading text="Loading transfers..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 dark:text-white">
            <ArrowRightLeft size={24} />
            Stock Transfers
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Transfer inventory between warehouses
          </p>
        </div>
        <button
          onClick={() => {
            setEditTransfer(null)
            setShowModal(true)
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          <Plus size={18} />
          New Transfer
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by transfer number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="in_transit">In Transit</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Transfer #</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">From / To</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Requested By</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {transfers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search || statusFilter ? 'No transfers match your filters' : 'No transfers yet. Create your first transfer!'}
                </td>
              </tr>
            ) : (
              transfers.map((transfer) => (
                <tr key={transfer.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleEditClick(transfer.id)}
                      disabled={loadingEditId === transfer.id}
                      className="font-medium text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {loadingEditId === transfer.id ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                          {transfer.transferNo}
                        </span>
                      ) : (
                        transfer.transferNo
                      )}
                    </button>
                    {transfer._itemCount !== undefined && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        ({transfer._itemCount} items)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex items-center gap-1 dark:text-gray-300">
                        <Warehouse size={14} className="text-gray-400" />
                        {transfer.fromWarehouse?.code || '-'}
                      </span>
                      <ArrowRight size={14} className="text-gray-400" />
                      <span className="flex items-center gap-1 dark:text-gray-300">
                        <Warehouse size={14} className="text-gray-400" />
                        {transfer.toWarehouse?.code || '-'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[transfer.status]}`}>
                      {statusLabels[transfer.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {transfer.requestedBy?.fullName || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(transfer.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {transfer.status === 'draft' && (
                        <button
                          onClick={() => handleEditClick(transfer.id)}
                          disabled={loadingEditId === transfer.id}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600 rounded inline-flex disabled:opacity-50"
                          title="Edit"
                        >
                          {loadingEditId === transfer.id ? (
                            <span className="w-[18px] h-[18px] border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                          ) : (
                            <Pencil size={18} />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedTransferId(transfer.id)}
                        className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600 rounded inline-flex"
                        title="View Details"
                      >
                        <Eye size={18} />
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
          className="border-t dark:border-gray-700 px-4"
        />
      </div>

      {/* Stock Transfer Form Modal */}
      <StockTransferFormModal
        isOpen={showModal}
        onClose={handleModalClose}
        onSaved={handleModalSaved}
        editTransfer={editTransfer}
      />

      {/* Stock Transfer Detail Modal */}
      <StockTransferDetailModal
        isOpen={!!selectedTransferId}
        onClose={() => setSelectedTransferId(null)}
        transferId={selectedTransferId}
        onUpdated={() => refresh()}
      />
    </div>
  )
}
