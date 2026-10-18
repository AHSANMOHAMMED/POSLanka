'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormTextarea, FormField } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { Loader2 } from 'lucide-react'
import { useIsMobile } from '@/hooks/useResponsive'

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
}

interface WarehouseFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  editWarehouse?: WarehouseData | null
}

const initialFormData = {
  name: '',
  code: '',
  address: '',
  phone: '',
  email: '',
  isDefault: false,
}

export function WarehouseFormModal({ isOpen, onClose, onSaved, editWarehouse }: WarehouseFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(initialFormData)

  useEffect(() => {
    if (isOpen) {
      if (editWarehouse) {
        setFormData({
          name: editWarehouse.name,
          code: editWarehouse.code,
          address: editWarehouse.address || '',
          phone: editWarehouse.phone || '',
          email: editWarehouse.email || '',
          isDefault: editWarehouse.isDefault,
        })
      } else {
        setFormData(initialFormData)
      }
      setError('')
    }
  }, [isOpen, editWarehouse])

  function handleClose() {
    setFormData(initialFormData)
    setError('')
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }
    if (!formData.code.trim()) {
      setError('Code is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editWarehouse ? `/api/warehouses/${editWarehouse.id}` : '/api/warehouses'
      const method = editWarehouse ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          code: formData.code,
          address: formData.address || null,
          phone: formData.phone || null,
          email: formData.email || null,
          isDefault: formData.isDefault,
        }),
      })

      if (res.ok) {
        toast.success(editWarehouse ? 'Warehouse updated' : 'Warehouse created')
        onSaved()
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save warehouse')
      }
    } catch {
      setError('Failed to save warehouse')
    } finally {
      setSaving(false)
    }
  }

  const isMobile = useIsMobile()

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editWarehouse ? 'Edit Warehouse' : 'Create Warehouse'}
      size={isMobile ? 'full' : 'lg'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Name *" required>
            <FormInput
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Main Warehouse"
              required
            />
          </FormField>
          <FormField label="Code *" required hint="Short code for quick reference">
            <FormInput
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="e.g., MAIN"
              maxLength={20}
              required
              className="font-mono"
            />
          </FormField>
        </div>

        <FormField label="Address">
          <FormTextarea
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            rows={2}
            placeholder="Optional address"
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Phone">
            <FormInput
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="Optional"
            />
          </FormField>
          <FormField label="Email">
            <FormInput
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="Optional"
            />
          </FormField>
        </div>

        <FormField>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.isDefault}
              onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 touch-target h-5 w-5"
            />
            <span className="text-sm dark:text-gray-300">Set as default warehouse</span>
          </div>
        </FormField>

        <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t dark:border-gray-700">
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
            {editWarehouse ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
