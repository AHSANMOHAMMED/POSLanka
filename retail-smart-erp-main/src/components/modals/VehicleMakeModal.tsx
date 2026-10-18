'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'

interface VehicleMakeModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (make: { id: string; name: string }) => void
  initialName?: string
}

export function VehicleMakeModal({ isOpen, onClose, onCreated, initialName = '' }: VehicleMakeModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: initialName,
    country: '',
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
      const res = await fetch('/api/vehicle-makes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        const make = await res.json()
        onCreated(make)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create make')
      }
    } catch {
      setError('Failed to create make')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({ name: '', country: '' })
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Vehicle Make" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Make Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Honda, Yamaha, Suzuki"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Country</label>
          <input
            type="text"
            value={formData.country}
            onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Japan, USA, India"
          />
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
            {saving ? 'Creating...' : 'Create Make'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
