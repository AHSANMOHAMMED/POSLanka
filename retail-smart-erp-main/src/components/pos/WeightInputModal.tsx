'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Scale } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import type { Item } from './types'

interface WeightInputModalProps {
  isOpen: boolean
  item: Item | null
  onClose: () => void
  onConfirm: (weight: number) => void
}

export function WeightInputModal({ isOpen, item, onClose, onConfirm }: WeightInputModalProps) {
  const { currency: currencyCode } = useCurrency()
  const [weight, setWeight] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWeight('')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  if (!isOpen || !item) return null

  const unitPrice = parseFloat(item.sellingPrice)
  const weightNum = parseFloat(weight) || 0
  const total = weightNum * unitPrice
  const unit = 'kg'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (weightNum <= 0) return
    onConfirm(weightNum)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Scale size={20} className="text-blue-600" />
            <h3 className="font-bold text-lg">Enter Weight</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Item info */}
          <div className="bg-gray-50 rounded-md p-3">
            <p className="font-semibold text-gray-900">{item.name}</p>
            <p className="text-sm text-gray-500 mt-1">
              {currencyCode} {unitPrice.toFixed(2)} / {unit}
            </p>
          </div>

          {/* Weight input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Weight ({unit})
            </label>
            <FormInput
              ref={inputRef}
              type="number"
              step="0.001"
              min="0.001"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="0.000"
              inputSize="lg"
              autoFocus
            />
          </div>

          {/* Calculated total */}
          {weightNum > 0 && (
            <div className="flex justify-between items-center bg-blue-50 rounded-md p-3">
              <span className="text-sm text-gray-600">
                {weightNum.toFixed(3)} {unit} x {currencyCode} {unitPrice.toFixed(2)}
              </span>
              <span className="text-lg font-bold text-blue-600">
                {currencyCode} {total.toFixed(2)}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-md font-medium hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={weightNum <= 0}
              className="flex-1 py-3 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              Add to Cart
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
