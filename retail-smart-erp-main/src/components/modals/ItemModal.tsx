'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { CategoryModal } from './CategoryModal'

interface Category {
  id: string
  name: string
}

interface ItemModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (item: { id: string; name: string; sellingPrice: string }) => void
  categories: Category[]
  onCategoriesUpdated?: () => void
  initialName?: string
  initialCategoryId?: string
}

export function ItemModal({
  isOpen,
  onClose,
  onCreated,
  categories,
  onCategoriesUpdated,
  initialName = '',
  initialCategoryId = '',
}: ItemModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [localCategories, setLocalCategories] = useState<Category[]>(categories || [])
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [pendingCategoryName, setPendingCategoryName] = useState('')
  const [formData, setFormData] = useState({
    name: initialName,
    sku: '',
    barcode: '',
    categoryId: initialCategoryId,
    costPrice: '',
    sellingPrice: '',
    currentStock: '0',
    minStock: '0',
    unit: 'pcs',
  })

  useEffect(() => {
    setLocalCategories(categories || [])
  }, [categories])

  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: initialName,
        sku: '',
        barcode: '',
        categoryId: initialCategoryId,
        costPrice: '',
        sellingPrice: '',
        currentStock: '0',
        minStock: '0',
        unit: 'pcs',
      })
      setError('')
    }
  }, [isOpen, initialName, initialCategoryId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          categoryId: formData.categoryId || null,
          costPrice: formData.costPrice ? parseFloat(formData.costPrice) : 0,
          sellingPrice: parseFloat(formData.sellingPrice),
          currentStock: parseFloat(formData.currentStock) || 0,
          minStock: parseFloat(formData.minStock) || 0,
        }),
      })

      if (res.ok) {
        const item = await res.json()
        onCreated(item)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create item')
      }
    } catch {
      setError('Failed to create item')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({
      name: '',
      sku: '',
      barcode: '',
      categoryId: '',
      costPrice: '',
      sellingPrice: '',
      currentStock: '0',
      minStock: '0',
      unit: 'pcs',
    })
    setError('')
    onClose()
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} title="New Item" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Item Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Engine Oil 5W-30"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <CreatableSelect
                options={localCategories.map(c => ({ value: c.id, label: c.name }))}
                value={formData.categoryId}
                onChange={(value) => setFormData({ ...formData, categoryId: value })}
                onCreateNew={(name) => {
                  setPendingCategoryName(name)
                  setShowCategoryModal(true)
                }}
                placeholder="Select Category"
                createLabel="Add category"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Unit</label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="pcs">Pieces (pcs)</option>
                <option value="kg">Kilogram (kg)</option>
                <option value="g">Gram (g)</option>
                <option value="l">Liter (l)</option>
                <option value="ml">Milliliter (ml)</option>
                <option value="m">Meter (m)</option>
                <option value="box">Box</option>
                <option value="set">Set</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">SKU</label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., OIL-5W30-001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Barcode</label>
              <input
                type="text"
                value={formData.barcode}
                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Scan or enter barcode"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Cost Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.costPrice}
                onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Selling Price *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.sellingPrice}
                onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Current Stock</label>
              <input
                type="number"
                min="0"
                value={formData.currentStock}
                onChange={(e) => setFormData({ ...formData, currentStock: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Min Stock Alert</label>
              <input
                type="number"
                min="0"
                value={formData.minStock}
                onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              {saving ? 'Creating...' : 'Create Item'}
            </button>
          </div>
        </form>
      </Modal>

      <CategoryModal
        isOpen={showCategoryModal}
        onClose={() => {
          setShowCategoryModal(false)
          setPendingCategoryName('')
        }}
        onCreated={(category) => {
          setLocalCategories([...localCategories, category])
          setFormData({ ...formData, categoryId: category.id })
          onCategoriesUpdated?.()
        }}
        initialName={pendingCategoryName}
      />
    </>
  )
}
