'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'

interface CategoryModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (category: { id: string; name: string }) => void
  initialName?: string
}

export function CategoryModal({ isOpen, onClose, onCreated, initialName = '' }: CategoryModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: initialName,
  })

  useEffect(() => {
    if (isOpen) {
      setFormData({ name: initialName })
      setError('')
    }
  }, [isOpen, initialName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        const category = await res.json()
        onCreated(category)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create category')
      }
    } catch {
      setError('Failed to create category')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({ name: '' })
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Category" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Category Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Engine Parts, Brake Parts, Accessories"
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
            {saving ? 'Creating...' : 'Create Category'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
