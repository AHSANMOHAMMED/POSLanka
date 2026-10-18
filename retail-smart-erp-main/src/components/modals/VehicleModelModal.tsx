'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'

interface VehicleMake {
  id: string
  name: string
}

interface VehicleModelModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (model: { id: string; name: string; makeId: string }) => void
  initialName?: string
  makes: VehicleMake[]
  selectedMakeId?: string
}

export function VehicleModelModal({
  isOpen,
  onClose,
  onCreated,
  initialName = '',
  makes,
  selectedMakeId = ''
}: VehicleModelModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: initialName,
    makeId: selectedMakeId,
  })

  useEffect(() => {
    if (isOpen) {
      setFormData({ name: initialName, makeId: selectedMakeId })
      setError('')
    }
  }, [isOpen, initialName, selectedMakeId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    if (!formData.makeId) {
      setError('Please select a make')
      setSaving(false)
      return
    }

    try {
      const res = await fetch('/api/vehicle-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        const model = await res.json()
        onCreated(model)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create model')
      }
    } catch {
      setError('Failed to create model')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({ name: '', makeId: '' })
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Vehicle Model" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Make *</label>
          <select
            value={formData.makeId}
            onChange={(e) => setFormData({ ...formData, makeId: e.target.value })}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="">Select Make</option>
            {makes.map(make => (
              <option key={make.id} value={make.id}>{make.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Model Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., CBR 150R, FZ-S, Pulsar"
            required
            autoFocus
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
            {saving ? 'Creating...' : 'Create Model'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
