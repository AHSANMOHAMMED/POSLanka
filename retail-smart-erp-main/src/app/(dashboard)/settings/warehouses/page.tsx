'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { WarehouseFormModal } from '@/components/modals'
import { toast } from '@/components/ui/toast'
import { Warehouse, Plus, Edit2, Eye, EyeOff, Loader2, MapPin, Users, Package, Star } from 'lucide-react'
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/page-header'

interface WarehouseData {
  id: string
  name: string
  code: string
  address: string | null
  phone: string | null
  email: string | null
  isDefault: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  _summary?: {
    stockItems: number
    assignedUsers: number
  }
}

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseData | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const fetchWarehouses = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('all', 'true')
      if (!showInactive) params.set('activeOnly', 'true')
      const res = await fetch(`/api/warehouses?${params}`)
      if (res.ok) {
        const data = await res.json()
        setWarehouses(data)
      } else {
        toast.error('Failed to load warehouses')
      }
    } catch (err) {
      console.error('Error fetching warehouses:', err)
      toast.error('Failed to load warehouses')
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  useRealtimeData(fetchWarehouses, { entityType: 'warehouse', refreshOnMount: false })

  useEffect(() => {
    fetchWarehouses()
  }, [fetchWarehouses])

  function handleEdit(warehouse: WarehouseData) {
    setEditingWarehouse(warehouse)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingWarehouse(null)
  }

  async function handleToggleActive(warehouse: WarehouseData) {
    try {
      const res = await fetch(`/api/warehouses/${warehouse.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: !warehouse.isActive,
          name: warehouse.name,
          code: warehouse.code,
        }),
      })

      if (res.ok) {
        toast.success(warehouse.isActive ? 'Warehouse deactivated' : 'Warehouse activated')
        fetchWarehouses()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update warehouse')
      }
    } catch {
      toast.error('Error updating warehouse')
    }
  }

  async function handleDelete() {
    if (!deletingId) return

    setShowDeleteConfirm(false)
    try {
      const res = await fetch(`/api/warehouses/${deletingId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        toast.success('Warehouse deleted')
        fetchWarehouses()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete warehouse')
      }
    } catch {
      toast.error('Error deleting warehouse')
    } finally {
      setDeletingId(null)
    }
  }

  const warehouseToDelete = warehouses.find(w => w.id === deletingId)

  return (
    <div className="max-w-4xl mx-auto">
      <Breadcrumb
        items={[
          { label: 'Settings', href: '/settings' },
          { label: 'Warehouses' }
        ]}
        className="mb-4"
      />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Warehouses</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage inventory locations</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded dark:border-gray-600"
            />
            Show inactive
          </label>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={16} />
            Add Warehouse
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : warehouses.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 border-dashed rounded-md p-8 text-center">
          <Warehouse size={32} className="mx-auto mb-3 text-gray-400" />
          <p className="text-gray-500 dark:text-gray-400">No warehouses yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Create your first warehouse to manage inventory
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create Warehouse
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {warehouses.map((warehouse) => (
            <div
              key={warehouse.id}
              className={`bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-md p-4 ${
                !warehouse.isActive ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded flex items-center justify-center ${
                  warehouse.isDefault ? 'bg-blue-100 dark:bg-blue-900' : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  <Warehouse size={24} className={warehouse.isDefault ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold dark:text-white">{warehouse.name}</span>
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded font-mono dark:text-gray-300">
                      {warehouse.code}
                    </span>
                    {warehouse.isDefault && (
                      <span className="flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                        <Star size={12} />
                        Default
                      </span>
                    )}
                    {!warehouse.isActive && (
                      <span className="text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 px-2 py-0.5 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  {warehouse.address && (
                    <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1">
                      <MapPin size={14} />
                      <span className="truncate">{warehouse.address}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {warehouse._summary && (
                      <>
                        <span className="flex items-center gap-1">
                          <Package size={12} />
                          {warehouse._summary.stockItems} items
                        </span>
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {warehouse._summary.assignedUsers} users
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/settings/warehouses/${warehouse.id}/stock`}
                    className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded"
                    title="Manage Stock"
                  >
                    <Package size={18} />
                  </Link>
                  <button
                    onClick={() => handleEdit(warehouse)}
                    className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title="Edit"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleToggleActive(warehouse)}
                    className={`p-2 rounded ${
                      warehouse.isActive
                        ? 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                        : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/50'
                    }`}
                    title={warehouse.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {warehouse.isActive ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warehouse Form Modal */}
      <WarehouseFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          fetchWarehouses()
          handleCloseModal()
        }}
        editWarehouse={editingWarehouse}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false)
          setDeletingId(null)
        }}
        onConfirm={handleDelete}
        title="Delete Warehouse"
        message={`Are you sure you want to delete "${warehouseToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
