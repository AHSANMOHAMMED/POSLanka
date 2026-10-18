'use client'

import { useState } from 'react'
import { Trash2, ShieldCheck } from 'lucide-react'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface VehicleWarranty {
  id: string
  vehicleName: string | null
  warrantyType: string
  provider: string
  policyNumber: string | null
  startDate: string | null
  endDate: string | null
  coverageDetails: string | null
  deductible: string | null
  maxCoverage: string | null
  status: string
  createdAt: string
}

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  expired: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  expired: 'Expired',
  pending: 'Pending',
  claimed: 'Claimed',
  cancelled: 'Cancelled',
}

const warrantyTypeLabels: Record<string, string> = {
  manufacturer: 'Manufacturer',
  extended: 'Extended',
  powertrain: 'Powertrain',
  bumper_to_bumper: 'Bumper to Bumper',
  certified_preowned: 'Certified Pre-Owned',
  third_party: 'Third Party',
}

export default function VehicleWarrantiesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modal states - no create modal since warranties are typically linked to sales
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const {
    data: warranties,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<VehicleWarranty>({
    endpoint: '/api/vehicle-warranties',
    entityType: 'vehicle-warranty',
    storageKey: 'vehicle-warranties-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
    },
  })

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/vehicle-warranties/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        toast.success('Warranty record deleted')
      } else {
        toast.error('Failed to delete warranty record')
      }
    } catch (error) {
      console.error('Error deleting warranty:', error)
      toast.error('Error deleting warranty record')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  if (loading && warranties.length === 0) {
    return <PageLoading text="Loading vehicle warranties..." />
  }

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'expired', label: 'Expired' },
    { key: 'pending', label: 'Pending' },
    { key: 'claimed', label: 'Claimed' },
  ]

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Vehicle Warranties"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Vehicle, provider, policy #..."
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
          <caption className="sr-only">Vehicle warranties list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Warranty Type</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Provider</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Policy #</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Start Date</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">End Date</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {warranties.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No warranties match your search' : 'No warranty records yet.'}
                </td>
              </tr>
            ) : (
              warranties.map((w) => {
                const isExpiringSoon = w.endDate && w.status === 'active' &&
                  (new Date(w.endDate).getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000

                return (
                  <tr key={w.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={16} className="text-gray-400 flex-shrink-0" />
                        <span className="font-medium text-gray-900 dark:text-white">{w.vehicleName || '-'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {warrantyTypeLabels[w.warrantyType] || w.warrantyType}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{w.provider}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-mono text-sm">
                      {w.policyNumber || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {w.startDate ? new Date(w.startDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={isExpiringSoon ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-gray-600 dark:text-gray-400'}>
                        {w.endDate ? new Date(w.endDate).toLocaleDateString() : '-'}
                        {isExpiringSoon && ' (expiring soon)'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[w.status] || 'bg-gray-100 text-gray-700'}`}>
                        {statusLabels[w.status] || w.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDeleteId(w.id)}
                        aria-label={`Delete warranty for ${w.vehicleName}`}
                        className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                )
              })
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
        title="Delete Warranty Record"
        message="Are you sure you want to delete this warranty record? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
