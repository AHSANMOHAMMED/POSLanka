'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'

interface Supplier {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  taxId: string | null
  taxInclusive: boolean
  isActive: boolean
}

interface SupplierModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (supplier: Supplier) => void
  initialName?: string
}

export function SupplierModal({ isOpen, onClose, onCreated, initialName = '' }: SupplierModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: initialName,
    email: '',
    phone: '',
    address: '',
    taxId: '',
    taxInclusive: false,
  })

  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: initialName,
        email: '',
        phone: '',
        address: '',
        taxId: '',
        taxInclusive: false,
      })
      setError('')
    }
  }, [isOpen, initialName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email || null,
          phone: formData.phone || null,
          address: formData.address || null,
          taxId: formData.taxId || null,
          taxInclusive: formData.taxInclusive,
        }),
      })

      if (res.ok) {
        const supplier = await res.json()
        onCreated(supplier)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create supplier')
      }
    } catch {
      setError('Failed to create supplier')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({
      name: '',
      email: '',
      phone: '',
      address: '',
      taxId: '',
      taxInclusive: false,
    })
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Supplier" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/50 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">Supplier Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="e.g., ABC Trading, XYZ Supplies"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="supplier@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">Phone</label>
            <input
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="+94 77 123 4567"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">Tax ID</label>
            <input
              type="text"
              value={formData.taxId}
              onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="Tax registration number"
            />
          </div>

          <div className="flex items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.taxInclusive}
                onChange={(e) => setFormData({ ...formData, taxInclusive: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm dark:text-gray-200">Tax Inclusive Pricing</span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">Address</label>
            <textarea
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="Full address"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Supplier'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
