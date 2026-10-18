'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Car } from 'lucide-react'
import { VehicleInventoryFormModal } from '@/components/modals/VehicleInventoryFormModal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface VehicleInventoryItem {
  id: string
  stockNo: string
  vin: string | null
  make: string
  model: string
  year: number | null
  trim: string | null
  exteriorColor: string | null
  interiorColor: string | null
  mileage: number | null
  condition: string
  bodyType: string | null
  engine: string | null
  transmission: string | null
  fuelType: string | null
  drivetrain: string | null
  purchasePrice: string | null
  askingPrice: string | null
  minimumPrice: string | null
  location: string | null
  description: string | null
  status: string
  createdAt: string
}

const statusColors: Record<string, string> = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  reserved: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  sold: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  in_transit: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  in_preparation: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
}

const statusLabels: Record<string, string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  in_transit: 'In Transit',
  in_preparation: 'In Preparation',
}

export default function VehicleInventoryPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingItem, setEditingItem] = useState<VehicleInventoryItem | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const {
    data: vehicles,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<VehicleInventoryItem>({
    endpoint: '/api/vehicle-inventory',
    entityType: 'vehicle-inventory',
    storageKey: 'vehicle-inventory-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
    },
  })

  // Fetch stats
  const [stats, setStats] = useState({ total: 0, available: 0, reserved: 0, sold: 0 })
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-inventory/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    }
  }, [])

  // Fetch stats on mount and on data changes
  useState(() => { fetchStats() })

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)

    try {
      const res = await fetch(`/api/vehicle-inventory/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        fetchStats()
        toast.success('Vehicle deleted successfully')
      } else {
        toast.error('Failed to delete vehicle')
      }
    } catch (error) {
      console.error('Error deleting vehicle:', error)
      toast.error('Error deleting vehicle')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  function handleEdit(item: VehicleInventoryItem) {
    setEditingItem(item)
    setShowFormModal(true)
  }

  function handleAdd() {
    setEditingItem(null)
    setShowFormModal(true)
  }

  function handleModalSaved() {
    refresh()
    fetchStats()
  }

  function handleRowClick(id: string) {
    router.push(`/c/${tenantSlug}/dealership/inventory/${id}`)
  }

  if (loading && vehicles.length === 0) {
    return <PageLoading text="Loading vehicle inventory..." />
  }

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'available', label: 'Available' },
    { key: 'reserved', label: 'Reserved' },
    { key: 'in_preparation', label: 'In Preparation' },
    { key: 'sold', label: 'Sold' },
  ]

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Vehicle Inventory"
      actionContent={
        <div className="flex items-center gap-2">
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Vehicle
          </button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Stock #, VIN, Make, Model..."
    >
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3">
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3 text-center">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.available}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Available</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.reserved}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Reserved</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3 text-center">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.sold}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Sold</div>
        </div>
      </div>

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
          <caption className="sr-only">Vehicle inventory list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Stock #</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">VIN</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Condition</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Mileage</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Asking Price</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No vehicles match your search' : 'No vehicles yet. Add your first vehicle!'}
                </td>
              </tr>
            ) : (
              vehicles.map((vehicle) => (
                <tr
                  key={vehicle.id}
                  className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => handleRowClick(vehicle.id)}
                >
                  <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">{vehicle.stockNo}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Car size={16} className="text-gray-400 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {vehicle.make} {vehicle.model}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {vehicle.year}{vehicle.trim ? ` ${vehicle.trim}` : ''}
                          {vehicle.exteriorColor ? ` - ${vehicle.exteriorColor}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-mono text-sm">
                    {vehicle.vin ? `...${vehicle.vin.slice(-6)}` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize text-gray-700 dark:text-gray-300">{vehicle.condition}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {vehicle.mileage != null ? vehicle.mileage.toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                    {vehicle.askingPrice ? parseFloat(vehicle.askingPrice).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[vehicle.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {statusLabels[vehicle.status] || vehicle.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleEdit(vehicle)}
                      aria-label={`Edit ${vehicle.make} ${vehicle.model}`}
                      className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={() => setDeleteId(vehicle.id)}
                      aria-label={`Delete ${vehicle.make} ${vehicle.model}`}
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

      {/* Vehicle Form Modal */}
      <VehicleInventoryFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false)
          setEditingItem(null)
        }}
        onSuccess={handleModalSaved}
        editItem={editingItem}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Vehicle"
        message="Are you sure you want to delete this vehicle from inventory? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
