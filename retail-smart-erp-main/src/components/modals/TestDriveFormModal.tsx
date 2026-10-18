'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'

interface VehicleOption {
  id: string
  stockNo: string
  make: string
  model: string
  year: number | null
}

interface TestDrive {
  id: string
  vehicleInventoryId: string | null
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  scheduledDate: string
  scheduledTime: string | null
  durationMinutes: number | null
  salesperson: string | null
  status: string
  notes: string | null
}

interface TestDriveFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editItem?: TestDrive | null
}

const initialFormData = {
  vehicleInventoryId: '',
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  scheduledDate: '',
  scheduledTime: '',
  durationMinutes: '30',
  salesperson: '',
  notes: '',
  status: 'scheduled',
}

export function TestDriveFormModal({ isOpen, onClose, onSuccess, editItem }: TestDriveFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(initialFormData)
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-inventory?all=true&status=available')
      if (res.ok) {
        const data = await res.json()
        const items = Array.isArray(data) ? data : (data.data || [])
        setVehicles(items)
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchVehicles()
      if (editItem) {
        setFormData({
          vehicleInventoryId: editItem.vehicleInventoryId || '',
          customerName: editItem.customerName || '',
          customerPhone: editItem.customerPhone || '',
          customerEmail: editItem.customerEmail || '',
          scheduledDate: editItem.scheduledDate ? editItem.scheduledDate.split('T')[0] : '',
          scheduledTime: editItem.scheduledTime || '',
          durationMinutes: editItem.durationMinutes ? String(editItem.durationMinutes) : '30',
          salesperson: editItem.salesperson || '',
          notes: editItem.notes || '',
          status: editItem.status || 'scheduled',
        })
      } else {
        resetForm()
      }
    }
  }, [isOpen, editItem, fetchVehicles])

  function resetForm() {
    setFormData(initialFormData)
    setError('')
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.customerName.trim()) {
      setError('Customer name is required')
      return
    }
    if (!formData.scheduledDate) {
      setError('Scheduled date is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const isEdit = editItem?.id
      const url = isEdit ? `/api/test-drives/${editItem.id}` : '/api/test-drives'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleInventoryId: formData.vehicleInventoryId || null,
          customerName: formData.customerName.trim(),
          customerPhone: formData.customerPhone || null,
          customerEmail: formData.customerEmail || null,
          scheduledDate: formData.scheduledDate,
          scheduledTime: formData.scheduledTime || null,
          durationMinutes: formData.durationMinutes ? parseInt(formData.durationMinutes) : 30,
          salesperson: formData.salesperson || null,
          notes: formData.notes || null,
          status: formData.status,
        }),
      })

      if (res.ok) {
        toast.success(isEdit ? 'Test drive updated' : 'Test drive scheduled')
        onSuccess()
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save test drive')
      }
    } catch {
      setError('Failed to save test drive')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={editItem ? 'Edit Test Drive' : 'Schedule Test Drive'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Vehicle Selection */}
        <div>
          <FormLabel htmlFor="vehicleInventoryId">Vehicle</FormLabel>
          <FormSelect
            id="vehicleInventoryId"
            value={formData.vehicleInventoryId}
            onChange={(e) => setFormData(prev => ({ ...prev, vehicleInventoryId: e.target.value }))}
          >
            <option value="">Select vehicle</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.stockNo} - {v.year ? `${v.year} ` : ''}{v.make} {v.model}
              </option>
            ))}
          </FormSelect>
        </div>

        {/* Customer Info */}
        <div className="border-t dark:border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Customer Information</h3>
          <div className="space-y-3">
            <div>
              <FormLabel htmlFor="customerName">Customer Name *</FormLabel>
              <FormInput
                id="customerName"
                value={formData.customerName}
                onChange={(e) => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                placeholder="Full name"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FormLabel htmlFor="customerPhone">Phone</FormLabel>
                <FormInput
                  id="customerPhone"
                  type="tel"
                  value={formData.customerPhone}
                  onChange={(e) => setFormData(prev => ({ ...prev, customerPhone: e.target.value }))}
                  placeholder="Phone number"
                />
              </div>
              <div>
                <FormLabel htmlFor="customerEmail">Email</FormLabel>
                <FormInput
                  id="customerEmail"
                  type="email"
                  value={formData.customerEmail}
                  onChange={(e) => setFormData(prev => ({ ...prev, customerEmail: e.target.value }))}
                  placeholder="Email address"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Scheduling */}
        <div className="border-t dark:border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Schedule</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <FormLabel htmlFor="scheduledDate">Date *</FormLabel>
              <FormInput
                id="scheduledDate"
                type="date"
                value={formData.scheduledDate}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledDate: e.target.value }))}
                required
              />
            </div>
            <div>
              <FormLabel htmlFor="scheduledTime">Time</FormLabel>
              <FormInput
                id="scheduledTime"
                type="time"
                value={formData.scheduledTime}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduledTime: e.target.value }))}
              />
            </div>
            <div>
              <FormLabel htmlFor="durationMinutes">Duration (min)</FormLabel>
              <FormSelect
                id="durationMinutes"
                value={formData.durationMinutes}
                onChange={(e) => setFormData(prev => ({ ...prev, durationMinutes: e.target.value }))}
              >
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">60 min</option>
                <option value="90">90 min</option>
              </FormSelect>
            </div>
          </div>
        </div>

        {/* Salesperson & Notes */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FormLabel htmlFor="salesperson">Salesperson</FormLabel>
            <FormInput
              id="salesperson"
              value={formData.salesperson}
              onChange={(e) => setFormData(prev => ({ ...prev, salesperson: e.target.value }))}
              placeholder="Sales rep name"
            />
          </div>
          <div>
            <FormLabel htmlFor="testDriveStatus">Status</FormLabel>
            <FormSelect
              id="testDriveStatus"
              value={formData.status}
              onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
            >
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="no_show">No Show</option>
            </FormSelect>
          </div>
        </div>

        <div>
          <FormLabel htmlFor="notes">Notes</FormLabel>
          <textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Additional notes..."
            rows={3}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : editItem ? 'Update' : 'Schedule Test Drive'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
