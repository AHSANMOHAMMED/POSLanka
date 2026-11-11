'use client'

import { useEffect, useRef, useState } from 'react'
import { Percent, DollarSign, Trash2, X, Tag } from 'lucide-react'
import { useCurrency } from '@/hooks/useCurrency'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { calcLineDiscount, lineGross } from './price-quote'
import type { CartItem } from './types'

const PERCENT_PRESETS = [5, 10, 15, 20, 25]

interface ItemDiscountPopoverProps {
  item: CartItem | null
  isOpen: boolean
  onClose: () => void
  onApply: (cartLineId: string, discount: { type: 'percentage' | 'fixed'; value: number } | null) => void
  maxDiscountPercent: number
  allowDiscountChange: boolean
  /** Triggered when counter forbids discounts or value exceeds maxDiscountPercent */
  onRequestOverride?: (cartLineId: string, discount: { type: 'percentage' | 'fixed'; value: number }) => void
}

export function ItemDiscountPopover({
  item,
  isOpen,
  onClose,
  onApply,
  maxDiscountPercent,
  allowDiscountChange,
  onRequestOverride,
}: ItemDiscountPopoverProps) {
  const { currency } = useCurrency()
  const [type, setType] = useState<'percentage' | 'fixed'>('percentage')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen || !item) return
    const nextType = item.discountType || 'percentage'
    const nextVal = item.discountValue && item.discountValue > 0
      ? String(item.discountValue)
      : item.discount && item.discount > 0 && !item.discountType
        ? String(item.discount)
        : ''
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setType(item.discount && !item.discountType ? 'fixed' : nextType)
    setValue(nextVal)
    setError('')
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 10)
    return () => window.clearTimeout(id)
  }, [isOpen, item])

  useEscapeKey(isOpen, onClose)

  if (!isOpen || !item) return null

  const gross = Math.max(0, lineGross(item))
  const promo = Math.max(0, item.promotionDiscount || 0)
  const maxAllowedAmount = Math.max(0, Math.round((gross - promo) * 100) / 100)
  const numericValue = parseFloat(value) || 0

  const previewDiscount = calcLineDiscount(gross, type, numericValue, maxAllowedAmount)
  const previewNet = Math.max(0, Math.round((gross - promo - previewDiscount) * 100) / 100)
  const unitDisplayQty = item.isWeighable && item.weight ? item.weight : item.quantity
  const unitNet = unitDisplayQty > 0 ? previewNet / unitDisplayQty : previewNet
  const hasExisting = (item.discount || 0) > 0

  function applyDiscountValue(nextType: 'percentage' | 'fixed', nextValue: number) {
    if (!item) return
    setError('')
    if (!(nextValue > 0)) {
      setError('Enter a discount greater than 0')
      return
    }
    if (nextType === 'percentage' && nextValue > 100) {
      setError('Percentage cannot exceed 100%')
      return
    }
    if (nextType === 'fixed' && nextValue > maxAllowedAmount + 0.004) {
      setError(`Discount cannot exceed ${currency} ${maxAllowedAmount.toFixed(2)}`)
      return
    }
    const amt = calcLineDiscount(gross, nextType, nextValue, maxAllowedAmount)
    const effectivePct = gross > 0 ? (amt / gross) * 100 : 0
    const exceeds = !allowDiscountChange || (Number.isFinite(maxDiscountPercent) && effectivePct > maxDiscountPercent + 0.01)

    if (exceeds) {
      if (onRequestOverride) {
        onRequestOverride(item.cartLineId, { type: nextType, value: nextValue })
        onClose()
        return
      }
      setError(
        !allowDiscountChange
          ? 'Discounts are disabled on this counter'
          : `Maximum counter discount is ${maxDiscountPercent}%`
      )
      return
    }

    onApply(item.cartLineId, { type: nextType, value: nextValue })
    onClose()
  }

  function handleClear() {
    if (!item) return
    onApply(item.cartLineId, null)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Item discount for ${item.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Tag size={16} className="theme-text-primary shrink-0" />
              Item Discount
            </h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 truncate mt-0.5">
              {item.name} · {item.isWeighable && item.weight ? `${item.weight} ${item.unit || 'kg'}` : `${item.quantity} × ${currency} ${item.unitPrice.toFixed(2)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!allowDiscountChange && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {onRequestOverride
                ? 'Supervisor PIN will be required to apply this discount.'
                : 'Discounts are disabled on this counter.'}
            </div>
          )}

          {/* Type Toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setType('percentage'); setValue(''); setError(''); inputRef.current?.focus() }}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                type === 'percentage'
                  ? 'theme-border-primary theme-bg-subtle theme-text-primary'
                  : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:border-slate-300'
              }`}
            >
              <Percent size={15} />
              Percentage
            </button>
            <button
              type="button"
              onClick={() => { setType('fixed'); setValue(''); setError(''); inputRef.current?.focus() }}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                type === 'fixed'
                  ? 'theme-border-primary theme-bg-subtle theme-text-primary'
                  : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:border-slate-300'
              }`}
            >
              <DollarSign size={15} />
              Amount ({currency})
            </button>
          </div>

          {/* 1-click quick percentage presets */}
          {type === 'percentage' && (
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Quick Select (1-Click Apply)
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {PERCENT_PRESETS.map((pct) => {
                  const active = item.discountType === 'percentage' && item.discountValue === pct
                  return (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applyDiscountValue('percentage', pct)}
                      className={`py-2 rounded-lg text-sm font-bold border transition-all active:scale-95 ${
                        active
                          ? 'theme-btn-primary text-white border-transparent shadow-sm'
                          : 'bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {pct}%
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Custom Value Input */}
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-gray-300 mb-1.5">
              {type === 'percentage'
                ? `Custom %${maxDiscountPercent < 100 ? ` (counter max ${maxDiscountPercent}%)` : ''}`
                : `Amount off line (max ${currency} ${maxAllowedAmount.toFixed(2)})`}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="number"
                step={type === 'percentage' ? '0.1' : '0.01'}
                min="0"
                max={type === 'percentage' ? 100 : maxAllowedAmount}
                value={value}
                onChange={(e) => { setValue(e.target.value); setError('') }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyDiscountValue(type, numericValue)
                  }
                }}
                placeholder={type === 'percentage' ? 'e.g. 10' : 'e.g. 500.00'}
                className="w-full px-3.5 py-2.5 pr-12 text-lg font-mono font-bold rounded-xl border-2 border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 theme-ring-primary"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                {type === 'percentage' ? '%' : currency}
              </span>
            </div>
          </div>

          {/* Live Calculation Preview */}
          <div className="rounded-xl bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 p-3 space-y-1 text-sm">
            <div className="flex justify-between text-slate-600 dark:text-gray-300">
              <span>Selling total</span>
              <span className="font-mono">{currency} {gross.toFixed(2)}</span>
            </div>
            {promo > 0 && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400 text-xs">
                <span>Promotion</span>
                <span className="font-mono">-{currency} {promo.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
              <span>Discount{type === 'percentage' && numericValue > 0 ? ` (${numericValue}%)` : ''}</span>
              <span className="font-mono">-{currency} {previewDiscount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-slate-200 dark:border-gray-700 font-bold text-slate-900 dark:text-white">
              <span>Net amount</span>
              <span className="font-mono text-base">{currency} {previewNet.toFixed(2)}</span>
            </div>
            {item.quantity > 1 && !item.isWeighable && (
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Effective net per unit</span>
                <span className="font-mono">{currency} {unitNet.toFixed(2)}</span>
              </div>
            )}
          </div>

          {error && <p className="text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 dark:bg-gray-800/60 border-t border-slate-100 dark:border-gray-800 flex items-center gap-2">
          {hasExisting && (
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-2.5 rounded-xl border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm font-semibold flex items-center gap-1"
              title="Remove discount and restore selling price"
            >
              <Trash2 size={15} />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-200 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => applyDiscountValue(type, numericValue)}
            disabled={!(numericValue > 0)}
            className="flex-1 py-2.5 rounded-xl theme-btn-primary text-white text-sm font-bold disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
