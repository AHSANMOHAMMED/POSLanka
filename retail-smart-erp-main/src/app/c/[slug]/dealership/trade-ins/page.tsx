'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { TradeInFormModal } from '@/components/modals/TradeInFormModal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface TradeIn {
  id: string
  make: string
  model: string
  year: number | null
  vin: string | null
  mileage: number | null
  condition: string
  color: string | null
  appraisalValue: string | null
  tradeInAllowance: string | null
  status: string
  conditionNotes: string | null
  createdAt: string
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  appraised: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  accepted: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  completed: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  appraised: 'Appraised',
  accepted: 'Accepted',
  rejected: 'Rejected',
  completed: 'Completed',
}

export default function TradeInsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingItem, setEditingItem] = useState<TradeIn | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const {
    data: tradeIns,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<TradeIn>({
    endpoint: '/api/trade-ins',
    entityType: 'trade-in',
    storageKey: 'trade-ins-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
    },
  })

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/trade-ins/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        toast.success('Trade-in valuation deleted')
      } else {
        toast.error('Failed to delete trade-in valuation')
      }
    } catch (error) {
      console.error('Error deleting trade-in:', error)
      toast.error('Error deleting trade-in valuation')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  function handleEdit(item: TradeIn) {
    setEditingItem(item)
    setShowFormModal(true)
  }

  function handleAdd() {
    setEditingItem(null)
    setShowFormModal(true)
  }

  if (loading && tradeIns.length === 0) {
    return <PageLoading text="Loading trade-in valuations..." />
  }

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'appraised', label: 'Appraised' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'rejected', label: 'Rejected' },
  ]

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Trade-In Valuations"
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Valuation
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Make, model, VIN..."
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
          <caption className="sr-only">Trade-in valuations list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">VIN</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Mileage</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Condition</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Appraisal Value</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Trade-In Allowance</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tradeIns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No trade-ins match your search' : 'No trade-in valuations yet.'}
                </td>
              </tr>
            ) : (
              tradeIns.map((ti) => (
                <tr key={ti.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {ti.make} {ti.model}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {ti.year || '-'}{ti.color ? ` - ${ti.color}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-mono text-sm">
                    {ti.vin ? `...${ti.vin.slice(-6)}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {ti.mileage != null ? ti.mileage.toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize text-gray-700 dark:text-gray-300">{ti.condition}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                    {ti.appraisalValue ? parseFloat(ti.appraisalValue).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-green-600 dark:text-green-400">
                    {ti.tradeInAllowance ? parseFloat(ti.tradeInAllowance).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[ti.status] || 'bg-gray-100 text-gray-700'}`}>
                      {statusLabels[ti.status] || ti.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(ti)}
                      aria-label={`Edit trade-in for ${ti.make} ${ti.model}`}
                      className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={() => setDeleteId(ti.id)}
                      aria-label={`Delete trade-in for ${ti.make} ${ti.model}`}
                      className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded ml-2"
                    >
                      <Trash2 size={18} />
                    </button>
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
      <TradeInFormModal
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
        title="Delete Trade-In Valuation"
        message="Are you sure you want to delete this trade-in valuation? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
