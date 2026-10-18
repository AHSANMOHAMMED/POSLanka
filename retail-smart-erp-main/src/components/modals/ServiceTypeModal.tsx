'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'

interface ServiceTypeModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (serviceType: { id: string; name: string; defaultHours: string | null; defaultRate: string | null }) => void
  initialName?: string
}

export function ServiceTypeModal({ isOpen, onClose, onCreated, initialName = '' }: ServiceTypeModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: initialName,
    description: '',
    defaultHours: '',
    defaultRate: '',
  })

  useEffect(() => {
    if (isOpen) {
      setFormData(prev => ({ ...prev, name: initialName }))
      setError('')
    }
  }, [isOpen, initialName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/service-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          defaultHours: formData.defaultHours ? parseFloat(formData.defaultHours) : null,
          defaultRate: formData.defaultRate ? parseFloat(formData.defaultRate) : null,
        }),
      })

      if (res.ok) {
        const serviceType = await res.json()
        onCreated(serviceType)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create service type')
      }
    } catch {
      setError('Failed to create service type')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({ name: '', description: '', defaultHours: '', defaultRate: '' })
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Service Type" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Service Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Oil Change, Brake Service, Full Service"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Default Hours</label>
            <input
              type="number"
              step="0.25"
              min="0"
              value={formData.defaultHours}
              onChange={(e) => setFormData({ ...formData, defaultHours: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., 1.5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Default Rate</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.defaultRate}
              onChange={(e) => setFormData({ ...formData, defaultRate: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., 500.00"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Service Type'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
