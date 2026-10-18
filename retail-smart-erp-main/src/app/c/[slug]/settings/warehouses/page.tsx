'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useTerminology } from '@/hooks'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { Warehouse, Plus, Edit2, Eye, EyeOff, Loader2, MapPin, Users, Package, Star } from 'lucide-react'
import Link from 'next/link'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

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
  const t = useTerminology()
  const { tenantSlug } = useCompany()
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseData | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    isDefault: false,
  })
  const [submitting, setSubmitting] = useState(false)
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

  function openCreateModal() {
    setFormData({
      name: '',
      code: '',
      address: '',
      phone: '',
      email: '',
      isDefault: false,
    })
    setEditingWarehouse(null)
    setShowModal(true)
  }

  function openEditModal(warehouse: WarehouseData) {
    setFormData({
      name: warehouse.name,
      code: warehouse.code,
      address: warehouse.address || '',
      phone: warehouse.phone || '',
      email: warehouse.email || '',
      isDefault: warehouse.isDefault,
    })
    setEditingWarehouse(warehouse)
    setShowModal(true)
  }

  async function handleSubmit() {
    if (!formData.name.trim()) {
      toast.error('Name is required')
      return
    }

    if (!formData.code.trim()) {
      toast.error('Code is required')
      return
    }

    setSubmitting(true)
    try {
      const url = editingWarehouse
        ? `/api/warehouses/${editingWarehouse.id}`
        : '/api/warehouses'

      const res = await fetch(url, {
        method: editingWarehouse ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          expectedUpdatedAt: editingWarehouse?.updatedAt,
        }),
      })

      if (res.ok) {
        toast.success(editingWarehouse ? 'Warehouse updated' : 'Warehouse created')
        setShowModal(false)
        fetchWarehouses()
      } else {
        const data = await res.json()
        if (data.code === 'CONFLICT') {
          toast.error('Warehouse was modified by another user. Please refresh.')
        } else {
          toast.error(data.error || 'Failed to save warehouse')
        }
      }
    } catch {
      toast.error('Error saving warehouse')
    } finally {
      setSubmitting(false)
    }
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
    <ListPageLayout
      module={t.stockModule}
      moduleHref="/stock"
      title="Warehouse"
      actionContent={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Warehouse
          </button>
        </div>
      }
      onRefresh={fetchWarehouses}
    >
      <div className="p-4 overflow-y-auto flex-1">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : warehouses.length === 0 ? (
        <div className="bg-gray-50 border border-dashed rounded-md p-8 text-center">
          <Warehouse size={32} className="mx-auto mb-3 text-gray-400" />
          <p className="text-gray-500">No warehouses yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Create your first warehouse to manage inventory
          </p>
          <button
            onClick={openCreateModal}
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
              className={`bg-white border rounded-md p-4 ${
                !warehouse.isActive ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded flex items-center justify-center ${
                  warehouse.isDefault ? 'bg-blue-100' : 'bg-gray-100'
                }`}>
                  <Warehouse size={24} className={warehouse.isDefault ? 'text-blue-600' : 'text-gray-500'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{warehouse.name}</span>
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono">
                      {warehouse.code}
                    </span>
                    {warehouse.isDefault && (
                      <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        <Star size={12} />
                        Default
                      </span>
                    )}
                    {!warehouse.isActive && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  {warehouse.address && (
                    <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                      <MapPin size={14} />
                      <span className="truncate">{warehouse.address}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
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
                    href={`/c/${tenantSlug}/settings/warehouses/${warehouse.id}/stock`}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    title="Manage Stock"
                  >
                    <Package size={18} />
                  </Link>
                  <button
                    onClick={() => openEditModal(warehouse)}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded"
                    title="Edit"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleToggleActive(warehouse)}
                    className={`p-2 rounded ${
                      warehouse.isActive
                        ? 'text-gray-500 hover:bg-gray-100'
                        : 'text-green-600 hover:bg-green-50'
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

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-md shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-xl font-bold mb-4">
              {editingWarehouse ? 'Edit Warehouse' : 'Create Warehouse'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Main Warehouse"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="e.g., MAIN"
                  maxLength={20}
                />
                <p className="text-xs text-gray-500 mt-1">Short code for quick reference</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Optional address"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">Set as default warehouse</span>
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {editingWarehouse ? 'Updating...' : 'Creating...'}
                  </span>
                ) : (
                  editingWarehouse ? 'Update' : 'Create'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
    </ListPageLayout>
  )
}
