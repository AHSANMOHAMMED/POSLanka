'use client'

import { useState, useEffect, useRef } from 'react'
import { X, PlusCircle, Loader2, Sparkles, AlertCircle } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import type { Item, Category } from './types'
import { toast } from '@/components/ui/toast'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface QuickItemAddModalProps {
  isOpen: boolean
  initialBarcode?: string
  warehouseId: string | null
  categories: Category[]
  onClose: () => void
  onItemCreated: (newItem: Item) => void
}

const COMMON_UNITS = [
  { value: 'pcs', label: 'Pieces (pcs)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'g', label: 'Grams (g)' },
  { value: 'l', label: 'Liters (L)' },
  { value: 'ml', label: 'Milliliters (ml)' },
  { value: 'm', label: 'Meters (m)' },
  { value: 'box', label: 'Box' },
  { value: 'pack', label: 'Pack' },
  { value: 'pair', label: 'Pair (Apparel)' },
]

export function QuickItemAddModal({
  isOpen,
  initialBarcode = '',
  warehouseId: _warehouseId,
  categories,
  onClose,
  onItemCreated,
}: QuickItemAddModalProps) {
  const { currency: currencyCode } = useCurrency()
  const nameInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [barcode, setBarcode] = useState('')
  const [sellingPrice, setSellingPrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [unit, setUnit] = useState('pcs')
  const [initialStock, setInitialStock] = useState('10')
  const [isWeighable, setIsWeighable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setName('')
      setBarcode(initialBarcode.trim())
      setSellingPrice('')
      setCostPrice('')
      setCategoryId(categories.length > 0 ? categories[0].id : '')
      setUnit('pcs')
      setInitialStock('10')
      setIsWeighable(false)
      setError(null)
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [isOpen, initialBarcode, categories])

  useEscapeKey(isOpen, onClose)

  if (!isOpen) return null

  // Auto-toggle weighable if unit is kg or g
  function handleUnitChange(newUnit: string) {
    setUnit(newUnit)
    if (newUnit === 'kg' || newUnit === 'g') {
      setIsWeighable(true)
    } else {
      setIsWeighable(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Please enter item name')
      return
    }
    const priceNum = parseFloat(sellingPrice)
    if (isNaN(priceNum) || priceNum < 0) {
      setError('Please enter a valid selling price')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        sellingPrice: priceNum,
        unit,
        trackStock: true,
        currentStock: parseFloat(initialStock) || 0,
        isWeighable,
      }

      if (barcode.trim()) {
        payload.barcode = barcode.trim()
        payload.sku = barcode.trim()
      }
      if (categoryId) {
        payload.categoryId = categoryId
      }
      const costNum = parseFloat(costPrice)
      if (!isNaN(costNum) && costNum >= 0) {
        payload.costPrice = costNum
      }

      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || 'Failed to create item')
      }

      const created = await res.json()
      toast.success(`"${name}" added to inventory & cart!`)

      // Construct item matching POS Item interface
      const newItem: Item = {
        id: created.id,
        name: created.name,
        sku: created.sku || null,
        barcode: created.barcode || null,
        sellingPrice: String(created.sellingPrice),
        currentStock: String(created.currentStock || initialStock || '0'),
        reservedStock: '0',
        availableStock: String(created.currentStock || initialStock || '0'),
        trackStock: true,
        unit: created.unit || unit,
        isWeighable: created.isWeighable || isWeighable,
        categoryId: created.categoryId || null,
        categoryName: categories.find((c) => c.id === created.categoryId)?.name || null,
        oemPartNumber: null,
        supplierPartNumber: null,
        alternatePartNumbers: null,
      }

      onItemCreated(newItem)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating item'
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-auto overflow-hidden border border-slate-100 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-bold">
              <PlusCircle size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base leading-tight">
                  Quick Add Item
                </h3>
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 font-bold">
                  F4
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Create new item on the fly & add directly to active cart
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200/60 text-slate-500 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Item Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
              Item Name <span className="text-red-500">*</span>
            </label>
            <FormInput
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cotton T-Shirt, Apple Gala, Fancy Pen"
              inputSize="md"
              required
            />
          </div>

          {/* Barcode & SKU */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Barcode / EAN
              </label>
              <FormInput
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Scan or leave blank for auto"
                inputSize="md"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Category
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 font-medium text-slate-800"
              >
                <option value="">No Category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Pricing: Selling Price & Cost Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Selling Price ({currencyCode}) <span className="text-red-500">*</span>
              </label>
              <FormInput
                type="number"
                step="0.01"
                min="0"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder="0.00"
                inputSize="md"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Cost Price ({currencyCode})
              </label>
              <FormInput
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0.00 (optional)"
                inputSize="md"
              />
            </div>
          </div>

          {/* Unit & Initial Stock */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Unit of Measure
              </label>
              <select
                value={unit}
                onChange={(e) => handleUnitChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 font-medium text-slate-800"
              >
                {COMMON_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Initial Stock Qty
              </label>
              <FormInput
                type="number"
                step="any"
                min="0"
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
                placeholder="10"
                inputSize="md"
              />
            </div>
          </div>

          {/* Weighable Checkbox */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
            <div>
              <label
                htmlFor="quick-is-weighable"
                className="font-bold text-xs text-slate-800 block cursor-pointer"
              >
                Weighable / Measured Item
              </label>
              <p className="text-[12px] text-slate-500">
                Prompts for scale weight or volume when selected at POS
              </p>
            </div>
            <input
              id="quick-is-weighable"
              type="checkbox"
              checked={isWeighable}
              onChange={(e) => setIsWeighable(e.target.checked)}
              className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 cursor-pointer"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl font-semibold text-sm hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !sellingPrice}
              className="flex-1 py-2.5 px-4 bg-teal-700 text-white rounded-xl font-bold text-sm hover:bg-teal-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Save & Add to Cart
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
