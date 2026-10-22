'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, Scale, Droplet, Ruler, Package, Check } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import type { Item } from './types'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface WeightInputModalProps {
  isOpen: boolean
  item: Item | null
  onClose: () => void
  onConfirm: (weight: number, displayLabel?: string) => void
}

type UnitFamily = 'weight' | 'volume' | 'length' | 'count'

export function WeightInputModal({ isOpen, item, onClose, onConfirm }: WeightInputModalProps) {
  const { currency: currencyCode } = useCurrency()
  const [inputValue, setInputValue] = useState('')
  const [inputUnit, setInputUnit] = useState<string>('kg')
  const inputRef = useRef<HTMLInputElement>(null)

  // Normalize base item unit
  const baseUnit = useMemo(() => {
    if (!item) return 'kg'
    const raw = (item.unit || (item.isWeighable ? 'kg' : 'pcs')).toLowerCase().trim()
    if (['kg', 'kilo', 'kilogram', 'kilograms'].includes(raw)) return 'kg'
    if (['g', 'gram', 'grams'].includes(raw)) return 'g'
    if (['l', 'ltr', 'liter', 'liters', 'litre', 'litres'].includes(raw)) return 'l'
    if (['ml', 'milliliter', 'milliliters'].includes(raw)) return 'ml'
    if (['m', 'meter', 'meters', 'metre', 'metres'].includes(raw)) return 'm'
    return raw || 'pcs'
  }, [item])

  const unitFamily: UnitFamily = useMemo(() => {
    if (baseUnit === 'kg' || baseUnit === 'g') return 'weight'
    if (baseUnit === 'l' || baseUnit === 'ml') return 'volume'
    if (baseUnit === 'm') return 'length'
    return 'count'
  }, [baseUnit])

  useEffect(() => {
    if (isOpen) {
      setInputValue('')
      // Default input unit matches baseUnit
      setInputUnit(baseUnit)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, baseUnit])

  useEscapeKey(isOpen && !!item, onClose)

  if (!isOpen || !item) return null

  const unitPrice = parseFloat(item.sellingPrice) || 0
  const enteredNum = parseFloat(inputValue) || 0

  // Convert entered number into the base unit's decimal equivalent
  let baseQuantity = 0
  let displayLabel = ''

  if (unitFamily === 'weight') {
    if (baseUnit === 'kg') {
      if (inputUnit === 'g') {
        baseQuantity = enteredNum / 1000
        displayLabel = `${enteredNum} g (= ${baseQuantity.toFixed(3)} kg)`
      } else {
        baseQuantity = enteredNum
        displayLabel = `${baseQuantity.toFixed(3)} kg`
      }
    } else {
      // base is 'g'
      if (inputUnit === 'kg') {
        baseQuantity = enteredNum * 1000
        displayLabel = `${enteredNum} kg (= ${baseQuantity} g)`
      } else {
        baseQuantity = enteredNum
        displayLabel = `${baseQuantity} g`
      }
    }
  } else if (unitFamily === 'volume') {
    if (baseUnit === 'l') {
      if (inputUnit === 'ml') {
        baseQuantity = enteredNum / 1000
        displayLabel = `${enteredNum} ml (= ${baseQuantity.toFixed(3)} L)`
      } else {
        baseQuantity = enteredNum
        displayLabel = `${baseQuantity.toFixed(3)} L`
      }
    } else {
      // base is 'ml'
      if (inputUnit === 'l') {
        baseQuantity = enteredNum * 1000
        displayLabel = `${enteredNum} L (= ${baseQuantity} ml)`
      } else {
        baseQuantity = enteredNum
        displayLabel = `${baseQuantity} ml`
      }
    }
  } else {
    // length or count
    baseQuantity = enteredNum
    displayLabel = `${baseQuantity} ${baseUnit}`
  }

  const total = baseQuantity * unitPrice

  function handleSelectChip(val: number, unit: string) {
    setInputUnit(unit)
    setInputValue(String(val))
    inputRef.current?.focus()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (baseQuantity <= 0) return
    onConfirm(Number(baseQuantity.toFixed(4)), displayLabel)
  }

  // Quick preset chips based on unit family
  const chips: Array<{ label: string; val: number; unit: string }> = (() => {
    if (unitFamily === 'weight') {
      if (baseUnit === 'kg') {
        return [
          { label: '100g', val: 100, unit: 'g' },
          { label: '250g', val: 250, unit: 'g' },
          { label: '500g', val: 500, unit: 'g' },
          { label: '750g', val: 750, unit: 'g' },
          { label: '1 kg', val: 1, unit: 'kg' },
          { label: '1.5 kg', val: 1.5, unit: 'kg' },
          { label: '2 kg', val: 2, unit: 'kg' },
          { label: '5 kg', val: 5, unit: 'kg' },
        ]
      }
      return [
        { label: '50g', val: 50, unit: 'g' },
        { label: '100g', val: 100, unit: 'g' },
        { label: '250g', val: 250, unit: 'g' },
        { label: '500g', val: 500, unit: 'g' },
        { label: '1000g', val: 1000, unit: 'g' },
      ]
    }
    if (unitFamily === 'volume') {
      return [
        { label: '100ml', val: 100, unit: 'ml' },
        { label: '250ml', val: 250, unit: 'ml' },
        { label: '500ml', val: 500, unit: 'ml' },
        { label: '750ml', val: 750, unit: 'ml' },
        { label: '1 L', val: 1, unit: 'l' },
        { label: '1.5 L', val: 1.5, unit: 'l' },
        { label: '2 L', val: 2, unit: 'l' },
        { label: '5 L', val: 5, unit: 'l' },
      ]
    }
    if (unitFamily === 'length') {
      return [
        { label: '0.5m', val: 0.5, unit: 'm' },
        { label: '1m', val: 1, unit: 'm' },
        { label: '1.5m', val: 1.5, unit: 'm' },
        { label: '2m', val: 2, unit: 'm' },
        { label: '3m', val: 3, unit: 'm' },
        { label: '5m', val: 5, unit: 'm' },
      ]
    }
    return [
      { label: '1', val: 1, unit: baseUnit },
      { label: '2', val: 2, unit: baseUnit },
      { label: '3', val: 3, unit: baseUnit },
      { label: '5', val: 5, unit: baseUnit },
      { label: '6', val: 6, unit: baseUnit },
      { label: '10', val: 10, unit: baseUnit },
      { label: '12 (Dozen)', val: 12, unit: baseUnit },
      { label: '24', val: 24, unit: baseUnit },
    ]
  })()

  const IconComponent =
    unitFamily === 'weight'
      ? Scale
      : unitFamily === 'volume'
      ? Droplet
      : unitFamily === 'length'
      ? Ruler
      : Package

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-auto overflow-hidden border border-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-bold">
              <IconComponent size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base leading-tight">
                {unitFamily === 'weight'
                  ? 'Weigh / Measure Item'
                  : unitFamily === 'volume'
                  ? 'Measure Volume'
                  : unitFamily === 'length'
                  ? 'Measure Length'
                  : 'Enter Quantity'}
              </h3>
              <p className="text-xs text-slate-500 font-medium capitalize">
                Unit of Measure: <span className="font-bold text-slate-700">{baseUnit}</span>
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Item info banner */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex items-center justify-between">
            <div className="min-w-0 flex-1 pr-3">
              <p className="font-bold text-slate-900 text-sm truncate">{item.name}</p>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">
                {item.barcode ? `Barcode: ${item.barcode}` : item.sku ? `SKU: ${item.sku}` : ''}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="text-xs text-slate-500 block">Base Price</span>
              <span className="font-bold text-slate-800 text-sm font-mono">
                {currencyCode} {unitPrice.toFixed(2)} <span className="text-xs font-normal text-slate-400">/{baseUnit}</span>
              </span>
            </div>
          </div>

          {/* Quick preset chips */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
              Quick Presets
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {chips.map((chip) => {
                const isSelected =
                  inputValue === String(chip.val) && inputUnit.toLowerCase() === chip.unit.toLowerCase()
                return (
                  <button
                    key={`${chip.val}-${chip.unit}`}
                    type="button"
                    onClick={() => handleSelectChip(chip.val, chip.unit)}
                    className={`py-2 px-1 text-xs font-bold rounded-lg border transition-all text-center ${
                      isSelected
                        ? 'bg-teal-700 border-teal-700 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    {chip.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Input field + Unit selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Custom Quantity
              </label>
              {/* Unit toggle pills for convertible units */}
              {unitFamily === 'weight' && (
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setInputUnit('kg')}
                    className={`px-2.5 py-0.5 text-xs font-bold rounded-md transition-all ${
                      inputUnit === 'kg' ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    kg
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputUnit('g')}
                    className={`px-2.5 py-0.5 text-xs font-bold rounded-md transition-all ${
                      inputUnit === 'g' ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    g (Grams)
                  </button>
                </div>
              )}
              {unitFamily === 'volume' && (
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setInputUnit('l')}
                    className={`px-2.5 py-0.5 text-xs font-bold rounded-md transition-all ${
                      inputUnit === 'l' ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    L
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputUnit('ml')}
                    className={`px-2.5 py-0.5 text-xs font-bold rounded-md transition-all ${
                      inputUnit === 'ml' ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ml (Milliliters)
                  </button>
                </div>
              )}
            </div>

            <div className="relative">
              <FormInput
                ref={inputRef}
                type="number"
                step="any"
                min="0.001"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={inputUnit === 'g' || inputUnit === 'ml' ? 'e.g. 250' : 'e.g. 0.500'}
                inputSize="lg"
                autoFocus
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 font-mono pointer-events-none">
                {inputUnit}
              </span>
            </div>
          </div>

          {/* Calculated summary */}
          {baseQuantity > 0 && (
            <div className="bg-teal-50/80 border border-teal-100 rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-teal-900 block">Total Calculated</span>
                <span className="text-xs text-teal-700 font-mono mt-0.5 block">
                  {displayLabel} &times; {currencyCode} {unitPrice.toFixed(2)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold text-teal-800 font-mono block">
                  {currencyCode} {total.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl font-semibold text-sm hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={baseQuantity <= 0}
              className="flex-1 py-2.5 px-4 bg-teal-700 text-white rounded-xl font-bold text-sm hover:bg-teal-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Check size={16} />
              Add to Cart
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
