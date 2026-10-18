'use client'

import { useState, useEffect } from 'react'
import { X, Percent, DollarSign, Trash2 } from 'lucide-react'
import { useCurrency } from '@/hooks/useCurrency'

interface DiscountModalProps {
  isOpen: boolean
  onClose: () => void
  onApply: (discount: { type: 'percentage' | 'fixed'; value: number; reason: string }) => void
  onRemove: () => void
  currentDiscount: { type: 'percentage' | 'fixed'; value: number; reason: string }
  subtotal: number
  maxDiscountPercent: number
  allowDiscount: boolean
}

export function DiscountModal({
  isOpen,
  onClose,
  onApply,
  onRemove,
  currentDiscount,
  subtotal,
  maxDiscountPercent,
  allowDiscount,
}: DiscountModalProps) {
  const { currency: currencyCode } = useCurrency()
  const [type, setType] = useState<'percentage' | 'fixed'>(currentDiscount.type)
  const [value, setValue] = useState(currentDiscount.value > 0 ? String(currentDiscount.value) : '')
  const [reason, setReason] = useState(currentDiscount.reason)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setType(currentDiscount.type)
      setValue(currentDiscount.value > 0 ? String(currentDiscount.value) : '')
      setReason(currentDiscount.reason)
      setError('')
    }
  }, [isOpen, currentDiscount])

  if (!isOpen) return null

  const numericValue = parseFloat(value) || 0

  const calculatedAmount = type === 'percentage'
    ? (subtotal * numericValue) / 100
    : numericValue

  function validate(): boolean {
    if (numericValue <= 0) {
      setError('Discount value must be greater than 0')
      return false
    }
    if (!reason.trim()) {
      setError('Discount reason is required')
      return false
    }
    if (type === 'percentage' && numericValue > maxDiscountPercent) {
      setError(`Maximum discount is ${maxDiscountPercent}%`)
      return false
    }
    if (type === 'percentage' && numericValue > 100) {
      setError('Percentage cannot exceed 100%')
      return false
    }
    if (type === 'fixed' && numericValue > subtotal) {
      setError('Discount cannot exceed subtotal')
      return false
    }
    // Also check fixed amount against max percentage
    if (type === 'fixed' && subtotal > 0) {
      const effectivePercent = (numericValue / subtotal) * 100
      if (effectivePercent > maxDiscountPercent) {
        setError(`Discount exceeds maximum allowed (${maxDiscountPercent}%)`)
        return false
      }
    }
    return true
  }

  function handleApply() {
    setError('')
    if (!validate()) return
    onApply({ type, value: numericValue, reason: reason.trim() })
    onClose()
  }

  function handleRemove() {
    onRemove()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Sale Discount</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-md">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!allowDiscount && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-700">
              Discounts are disabled for this POS profile.
            </div>
          )}

          {/* Discount Type Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Discount Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setType('percentage'); setValue(''); setError('') }}
                disabled={!allowDiscount}
                className={`flex items-center justify-center gap-2 py-3 rounded-md border-2 font-medium transition-all ${
                  type === 'percentage'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                } disabled:opacity-50`}
              >
                <Percent size={18} />
                Percentage
              </button>
              <button
                onClick={() => { setType('fixed'); setValue(''); setError('') }}
                disabled={!allowDiscount}
                className={`flex items-center justify-center gap-2 py-3 rounded-md border-2 font-medium transition-all ${
                  type === 'fixed'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                } disabled:opacity-50`}
              >
                <DollarSign size={18} />
                Fixed Amount
              </button>
            </div>
          </div>

          {/* Discount Value */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {type === 'percentage' ? `Discount % (max ${maxDiscountPercent}%)` : 'Discount Amount'}
            </label>
            <div className="relative">
              <input
                type="number"
                step={type === 'percentage' ? '0.1' : '0.01'}
                min="0"
                max={type === 'percentage' ? maxDiscountPercent : subtotal}
                value={value}
                onChange={(e) => { setValue(e.target.value); setError('') }}
                disabled={!allowDiscount}
                placeholder={type === 'percentage' ? '0' : '0.00'}
                className="w-full px-4 py-3 text-lg font-bold border-2 border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">
                {type === 'percentage' ? '%' : currencyCode}
              </span>
            </div>
          </div>

          {/* Calculated Amount Preview */}
          {numericValue > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-center">
              <p className="text-sm text-blue-600">Discount Amount</p>
              <p className="text-xl font-bold text-blue-700">
                {currencyCode} {calculatedAmount.toFixed(2)}
              </p>
              {type === 'percentage' && (
                <p className="text-xs text-blue-500 mt-1">
                  {numericValue}% of {currencyCode} {subtotal.toFixed(2)}
                </p>
              )}
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Reason (required)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError('') }}
              disabled={!allowDiscount}
              placeholder="e.g., Loyal customer, Bulk purchase, Promotion"
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 font-medium">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t flex gap-3">
          {currentDiscount.value > 0 && (
            <button
              onClick={handleRemove}
              className="flex items-center gap-2 px-4 py-2.5 border-2 border-red-200 text-red-600 rounded-md font-medium hover:bg-red-50"
            >
              <Trash2 size={16} />
              Remove
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border-2 border-gray-200 text-gray-700 rounded-md font-medium hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!allowDiscount || numericValue <= 0}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
