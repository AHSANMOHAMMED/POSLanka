'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormSelect, FormTextarea, FormField } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { Loader2 } from 'lucide-react'
import { bodyTypeDisplayNames } from '@/lib/data/default-vehicle-types'
import { useIsMobile } from '@/hooks/useResponsive'

interface VehicleType {
  id: string
  name: string
  description: string | null
  bodyType: string
  wheelCount: number
  isActive: boolean
  isDefault?: boolean
  isSystemDefault?: boolean
}

interface VehicleTypeFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  editType?: VehicleType | null
}

const initialFormData = {
  name: '',
  description: '',
  bodyType: 'sedan',
  wheelCount: 4,
}

export function VehicleTypeFormModal({ isOpen, onClose, onSaved, editType }: VehicleTypeFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(initialFormData)

  useEffect(() => {
    if (isOpen) {
      if (editType) {
        setFormData({
          name: editType.name,
          description: editType.description || '',
          bodyType: editType.bodyType,
          wheelCount: editType.wheelCount,
        })
      } else {
        setFormData(initialFormData)
      }
      setError('')
    }
  }, [isOpen, editType])

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

    setSaving(true)
    setError('')

    try {
      const url = editType ? `/api/vehicle-types/${editType.id}` : '/api/vehicle-types'
      const method = editType ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          bodyType: formData.bodyType,
          wheelCount: formData.wheelCount,
        }),
      })

      if (res.ok) {
        toast.success(editType ? 'Vehicle type updated' : 'Vehicle type created')
        onSaved()
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save vehicle type')
      }
    } catch {
      setError('Failed to save vehicle type')
    } finally {
      setSaving(false)
    }
  }

  const isMobile = useIsMobile()

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editType ? 'Edit Vehicle Type' : 'Create Vehicle Type'}
      size={isMobile ? 'full' : 'md'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <FormField label="Name *" required>
          <FormInput
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Electric Scooter"
            required
          />
        </FormField>

        <FormField label="Body Type">
          <FormSelect
            value={formData.bodyType}
            onChange={(e) => setFormData({ ...formData, bodyType: e.target.value })}
            disabled={!!editType}
          >
            {Object.entries(bodyTypeDisplayNames).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </FormSelect>
          {editType && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Body type cannot be changed after creation</p>
          )}
        </FormField>

        <FormField label="Wheel Count">
          <div className="flex items-center gap-2">
            <FormInput
              type="number"
              value={formData.wheelCount}
              onChange={(e) => setFormData({ ...formData, wheelCount: parseInt(e.target.value) || 4 })}
              min={1}
              max={20}
              className="w-24"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">wheels</span>
          </div>
        </FormField>

        <FormField label="Description">
          <FormTextarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
            placeholder="Optional description"
          />
        </FormField>

        <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300 touch-target"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 justify-center touch-target"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {editType ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
