'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react'
import { FinancingOptionFormModal } from '@/components/modals/FinancingOptionFormModal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface FinancingOption {
  id: string
  lenderName: string
  contactInfo: string | null
  loanType: string
  minAmount: string | null
  maxAmount: string | null
  minTermMonths: number | null
  maxTermMonths: number | null
  minInterestRate: string | null
  maxInterestRate: string | null
  isActive: boolean
  notes: string | null
  createdAt: string
}

const loanTypeLabels: Record<string, string> = {
  new_vehicle: 'New Vehicle',
  used_vehicle: 'Used Vehicle',
  refinance: 'Refinance',
  lease: 'Lease',
  balloon: 'Balloon',
}

export default function FinancingOptionsPage() {
  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingItem, setEditingItem] = useState<FinancingOption | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const {
    data: options,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<FinancingOption>({
    endpoint: '/api/financing-options',
    entityType: 'financing-option',
    storageKey: 'financing-options-page-size',
  })

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/financing-options/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        toast.success('Financing option deleted')
      } else {
        toast.error('Failed to delete financing option')
      }
    } catch (error) {
      console.error('Error deleting financing option:', error)
      toast.error('Error deleting financing option')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  function handleEdit(item: FinancingOption) {
    setEditingItem(item)
    setShowFormModal(true)
  }

  function handleAdd() {
    setEditingItem(null)
    setShowFormModal(true)
  }

  if (loading && options.length === 0) {
    return <PageLoading text="Loading financing options..." />
  }

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Financing Options"
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Lender
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Lender name..."
    >
      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 list-container-xl overflow-x-auto mx-4">
        <table className="w-full">
          <caption className="sr-only">Financing options list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Lender</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Loan Type</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Rate Range</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Term Range</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Amount Range</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {options.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No financing options match your search' : 'No financing options yet. Add your first lender!'}
                </td>
              </tr>
            ) : (
              options.map((opt) => (
                <tr key={opt.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-gray-400 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{opt.lenderName}</div>
                        {opt.contactInfo && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{opt.contactInfo}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {loanTypeLabels[opt.loanType] || opt.loanType}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {opt.minInterestRate && opt.maxInterestRate
                      ? `${parseFloat(opt.minInterestRate).toFixed(1)}% - ${parseFloat(opt.maxInterestRate).toFixed(1)}%`
                      : opt.minInterestRate
                        ? `From ${parseFloat(opt.minInterestRate).toFixed(1)}%`
                        : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {opt.minTermMonths && opt.maxTermMonths
                      ? `${opt.minTermMonths} - ${opt.maxTermMonths} mo`
                      : opt.maxTermMonths
                        ? `Up to ${opt.maxTermMonths} mo`
                        : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {opt.minAmount && opt.maxAmount
                      ? `${parseFloat(opt.minAmount).toLocaleString()} - ${parseFloat(opt.maxAmount).toLocaleString()}`
                      : opt.maxAmount
                        ? `Up to ${parseFloat(opt.maxAmount).toLocaleString()}`
                        : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      opt.isActive
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {opt.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(opt)}
                      aria-label={`Edit ${opt.lenderName}`}
                      className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={() => setDeleteId(opt.id)}
                      aria-label={`Delete ${opt.lenderName}`}
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
      <FinancingOptionFormModal
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
        title="Delete Financing Option"
        message="Are you sure you want to delete this financing option? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
