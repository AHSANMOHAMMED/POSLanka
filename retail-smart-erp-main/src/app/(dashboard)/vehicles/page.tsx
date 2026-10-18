'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Car, User, Download, Upload } from 'lucide-react'
import { VehicleFormModal } from '@/components/modals'
import { usePaginatedData } from '@/hooks'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { ImportWizard } from '@/components/import-export/ImportWizard'
import { useExport } from '@/hooks/useExport'
import { useImport } from '@/hooks/useImport'
import {
  Pagination,
  ListPageHeader,
  SearchInput,
  EmptyState,
  Button,
  ConfirmModal,
} from '@/components/ui'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface VehicleType {
  id: string
  name: string
  bodyType: string
}

interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  vin: string | null
  licensePlate: string | null
  color: string | null
  currentMileage: number | null
  notes: string | null
  customerId: string | null
  vehicleTypeId: string | null
  customer: Customer | null
  vehicleType: VehicleType | null
  createdAt: string
}

export default function VehiclesPage() {
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()
  const [showModal, setShowModal] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })

  const {
    data: vehicles,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Vehicle>({
    endpoint: '/api/vehicles',
    entityType: 'vehicle',
    storageKey: 'vehicles-page-size',
  })

  async function handleDelete() {
    if (!deleteConfirm.id) return

    try {
      const res = await fetch(`/api/vehicles/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        toast.success('Vehicle deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete vehicle')
      }
    } catch (error) {
      console.error('Error deleting vehicle:', error)
      toast.error('Failed to delete vehicle')
    } finally {
      setDeleteConfirm({ open: false, id: null, name: '' })
    }
  }

  function handleEdit(vehicle: Vehicle) {
    setEditingVehicle(vehicle)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingVehicle(null)
  }

  if (loading && vehicles.length === 0) {
    return <PageLoading text="Loading vehicles..." />
  }

  return (
    <div>
      <ListPageHeader
        title="Vehicles"
        count={pagination.total}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={openImport}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Upload size={16} />
              Import
            </button>
            <button
              onClick={openExport}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Download size={16} />
              Export
            </button>
            <Button onClick={() => setShowModal(true)}>
              <Plus size={18} className="mr-1" />
              Add Vehicle
            </Button>
          </div>
        }
      />

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search vehicles..."
          className="max-w-md"
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl">
        <table className="w-full">
          <caption className="sr-only">List of vehicles</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">License Plate</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {vehicles.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    icon={<Car size={24} />}
                    title={search ? 'No vehicles found' : 'No vehicles yet'}
                    description={search ? 'Try adjusting your search terms' : 'Add your first vehicle to get started'}
                    action={
                      !search && (
                        <Button onClick={() => setShowModal(true)} size="sm">
                          <Plus size={16} className="mr-1" />
                          Add Vehicle
                        </Button>
                      )
                    }
                  />
                </td>
              </tr>
            ) : (
              vehicles.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                        <Car className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {vehicle.year ? `${vehicle.year} ` : ''}{vehicle.make} {vehicle.model}
                        </div>
                        {vehicle.color && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{vehicle.color}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {vehicle.vehicleType ? (
                      <Badge variant="secondary" size="sm">{vehicle.vehicleType.name}</Badge>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {vehicle.licensePlate ? (
                      <span className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">
                        {vehicle.licensePlate}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {vehicle.customer ? (
                      <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                        <User size={14} className="text-gray-400" />
                        {vehicle.customer.name}
                      </div>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {new Date(vehicle.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(vehicle)}
                      aria-label={`Edit ${vehicle.make} ${vehicle.model}`}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm({ open: true, id: vehicle.id, name: `${vehicle.make} ${vehicle.model}` })}
                      aria-label={`Delete ${vehicle.make} ${vehicle.model}`}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded ml-1 transition-colors"
                    >
                      <Trash2 size={16} />
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
          className="border-t dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>

      <VehicleFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          refresh()
          handleCloseModal()
        }}
        editVehicle={editingVehicle}
      />

      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDelete}
        title="Delete Vehicle"
        message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="vehicles"
        currentFilters={{ search }}
      />

      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="vehicles"
        onComplete={() => refresh()}
      />
    </div>
  )
}
