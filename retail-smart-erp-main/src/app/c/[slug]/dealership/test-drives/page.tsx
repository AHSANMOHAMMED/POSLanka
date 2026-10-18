'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Calendar, Clock } from 'lucide-react'
import { TestDriveFormModal } from '@/components/modals/TestDriveFormModal'
import { CancellationReasonModal } from '@/components/modals'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface TestDrive {
  id: string
  vehicleInventoryId: string | null
  vehicleName: string | null
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  scheduledDate: string
  scheduledTime: string | null
  durationMinutes: number | null
  salesperson: string | null
  status: string
  notes: string | null
  cancellationReason: string | null
  createdAt: string
}

const statusColors: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  no_show: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400',
}

const statusLabels: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

export default function TestDrivesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingItem, setEditingItem] = useState<TestDrive | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showCancellationModal, setShowCancellationModal] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const {
    data: testDrives,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<TestDrive>({
    endpoint: '/api/test-drives',
    entityType: 'test-drive',
    storageKey: 'test-drives-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
    },
  })

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/test-drives/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        toast.success('Test drive deleted successfully')
      } else {
        toast.error('Failed to delete test drive')
      }
    } catch (error) {
      console.error('Error deleting test drive:', error)
      toast.error('Error deleting test drive')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  async function handleCancel(reason: string) {
    if (!cancellingId) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/test-drives/${cancellingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason }),
      })
      if (res.ok) {
        refresh()
        toast.success('Test drive cancelled')
      } else {
        toast.error('Failed to cancel test drive')
      }
    } catch (error) {
      console.error('Error cancelling test drive:', error)
      toast.error('Error cancelling test drive')
    } finally {
      setCancelling(false)
      setCancellingId(null)
      setShowCancellationModal(false)
    }
  }

  function handleEdit(item: TestDrive) {
    setEditingItem(item)
    setShowFormModal(true)
  }

  function handleAdd() {
    setEditingItem(null)
    setShowFormModal(true)
  }

  if (loading && testDrives.length === 0) {
    return <PageLoading text="Loading test drives..." />
  }

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Test Drives"
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Schedule Test Drive
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Customer, vehicle..."
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
          <caption className="sr-only">Test drives list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date/Time</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Customer</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Salesperson</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Duration</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {testDrives.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No test drives match your search' : 'No test drives scheduled yet.'}
                </td>
              </tr>
            ) : (
              testDrives.map((td) => (
                <tr key={td.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {new Date(td.scheduledDate).toLocaleDateString()}
                        </div>
                        {td.scheduledTime && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <Clock size={10} />
                            {td.scheduledTime}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{td.customerName}</div>
                    {td.customerPhone && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{td.customerPhone}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {td.vehicleName || '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {td.salesperson || '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {td.durationMinutes ? `${td.durationMinutes} min` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[td.status] || 'bg-gray-100 text-gray-700'}`}>
                      {statusLabels[td.status] || td.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {td.status === 'scheduled' && (
                        <button
                          onClick={() => {
                            setCancellingId(td.id)
                            setShowCancellationModal(true)
                          }}
                          aria-label="Cancel test drive"
                          className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(td)}
                        aria-label={`Edit test drive for ${td.customerName}`}
                        className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteId(td.id)}
                        aria-label={`Delete test drive for ${td.customerName}`}
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

      {/* Form Modal */}
      <TestDriveFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false)
          setEditingItem(null)
        }}
        onSuccess={refresh}
        editItem={editingItem}
      />

      {/* Delete Confirm */}
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Test Drive"
        message="Are you sure you want to delete this test drive record? This action cannot be undone."
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
        title="Cancel Test Drive"
        itemName="this test drive"
        processing={cancelling}
      />
    </ListPageLayout>
  )
}
