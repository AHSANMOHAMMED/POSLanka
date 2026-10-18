'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Warehouse, Check, Loader2 } from 'lucide-react'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import type { UserRole } from '@/lib/auth/roles'

interface WarehouseData {
  id: string
  name: string
  code: string
  isDefault: boolean
}

interface User {
  id: string
  email: string
  fullName: string
  role: UserRole
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  warehouses?: { warehouseId: string; warehouse: WarehouseData }[]
}

interface StaffFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  editUser?: User | null
  currentUserId?: string
}

const initialFormData = {
  fullName: '',
  email: '',
  password: '',
  role: 'cashier' as UserRole,
}

export function StaffFormModal({ isOpen, onClose, onSaved, editUser, currentUserId }: StaffFormModalProps) {
  const company = useCompanyOptional()
  const businessType = company?.businessType
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(initialFormData)
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([])
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState<string[]>([])
  const [loadingWarehouses, setLoadingWarehouses] = useState(false)

  const fetchWarehouses = useCallback(async () => {
    try {
      const res = await fetch('/api/warehouses?all=true&activeOnly=true')
      if (res.ok) {
        const data = await res.json()
        setWarehouses(data)
        return data
      }
    } catch (err) {
      console.error('Error fetching warehouses:', err)
    }
    return []
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchWarehouses().then((warehousesList) => {
        if (editUser) {
          setFormData({
            fullName: editUser.fullName,
            email: editUser.email,
            password: '',
            role: editUser.role,
          })
          // Load user's warehouse assignments
          setLoadingWarehouses(true)
          fetch(`/api/users/${editUser.id}/warehouses`)
            .then(res => res.ok ? res.json() : Promise.reject())
            .then(data => {
              setSelectedWarehouseIds(data.map((uw: { warehouseId: string }) => uw.warehouseId))
            })
            .catch(() => {
              setSelectedWarehouseIds(editUser.warehouses?.map(uw => uw.warehouseId) || [])
            })
            .finally(() => setLoadingWarehouses(false))
        } else {
          setFormData(initialFormData)
          // Default to all warehouses for new users
          setSelectedWarehouseIds(warehousesList.map((w: WarehouseData) => w.id))
        }
      })
      setError('')
    }
  }, [isOpen, editUser, fetchWarehouses])

  function handleClose() {
    setFormData(initialFormData)
    setSelectedWarehouseIds([])
    setError('')
    onClose()
  }

  function toggleWarehouse(warehouseId: string) {
    setSelectedWarehouseIds(prev =>
      prev.includes(warehouseId)
        ? prev.filter(id => id !== warehouseId)
        : [...prev, warehouseId]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.fullName.trim()) {
      setError('Full name is required')
      return
    }
    if (!formData.email.trim()) {
      setError('Email is required')
      return
    }
    if (!editUser && !formData.password) {
      setError('Password is required for new users')
      return
    }
    if (formData.password && formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setSaving(true)
    setError('')

    try {
      if (editUser) {
        const updateData: Record<string, unknown> = {
          fullName: formData.fullName,
          email: formData.email,
          role: formData.role,
          expectedUpdatedAt: editUser.updatedAt,
        }
        if (formData.password) {
          updateData.password = formData.password
        }

        const res = await fetch(`/api/users/${editUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        })

        if (res.status === 409) {
          setError('User was modified by another user. Please refresh.')
          return
        }

        if (res.ok) {
          // Update warehouse assignments
          await fetch(`/api/users/${editUser.id}/warehouses`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ warehouseIds: selectedWarehouseIds }),
          })

          toast.success('Staff member updated')
          onSaved()
          handleClose()
        } else {
          const data = await res.json()
          setError(data.error || 'Failed to update')
        }
      } else {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            warehouseIds: selectedWarehouseIds,
          }),
        })

        if (res.ok) {
          toast.success('Staff member created')
          onSaved()
          handleClose()
        } else {
          const data = await res.json()
          setError(data.error || 'Failed to create')
        }
      }
    } catch {
      setError('Error saving staff member')
    } finally {
      setSaving(false)
    }
  }

  const isOwnAccount = editUser?.id === currentUserId

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editUser ? 'Edit Staff Member' : 'Add Staff Member'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Full Name *</label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Email *</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">
              Password {editUser ? '(leave blank to keep current)' : '*'}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              minLength={8}
              required={!editUser}
              placeholder={editUser ? 'Leave blank to keep current' : ''}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minimum 8 characters</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Role *</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as typeof formData.role })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              disabled={isOwnAccount}
            >
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
              {businessType === 'auto_service' && <option value="technician">Technician</option>}
              {businessType === 'restaurant' && <option value="chef">Chef</option>}
              {businessType === 'restaurant' && <option value="waiter">Waiter</option>}
              {!businessType && <option value="technician">Technician</option>}
              <option value="system_manager">System Manager</option>
              <option value="accounts_manager">Accounts Manager</option>
              <option value="sales_manager">Sales Manager</option>
              <option value="purchase_manager">Purchase Manager</option>
              <option value="hr_manager">HR Manager</option>
              <option value="stock_manager">Stock Manager</option>
              <option value="pos_user">POS User</option>
              <option value="report_user">Report User</option>
              <option value="dealer_sales">Dealer Sales</option>
            </select>
            {isOwnAccount && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">You cannot change your own role</p>
            )}
          </div>
        </div>

        {/* Warehouse Assignments */}
        {warehouses.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">
              <Warehouse size={14} className="inline mr-1" />
              Warehouse Access
            </label>
            {formData.role === 'owner' ? (
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded p-3">
                <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
                  <Check size={16} />
                  <span className="font-medium">Full Access</span>
                </div>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                  Owners automatically have access to all warehouses
                </p>
              </div>
            ) : loadingWarehouses ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                <div className="border dark:border-gray-700 rounded divide-y dark:divide-gray-700 max-h-48 overflow-y-auto">
                  {warehouses.map((warehouse) => (
                    <label
                      key={warehouse.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedWarehouseIds.includes(warehouse.id)}
                        onChange={() => toggleWarehouse(warehouse.id)}
                        className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      <Warehouse size={16} className="text-gray-400" />
                      <span className="flex-1 dark:text-gray-300">{warehouse.name}</span>
                      <span className="text-xs text-gray-400">{warehouse.code}</span>
                      {warehouse.isDefault && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                          Default
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Select which warehouses this user can access
                </p>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {editUser ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
