'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, Layers, Check, Loader2, AlertCircle } from 'lucide-react'
import { useCurrency } from '@/hooks/useCurrency'
import type { Item } from './types'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface VariantPickerModalProps {
  isOpen: boolean
  parentItem: Item | null
  warehouseId: string | null
  onClose: () => void
  onSelectVariant: (variantItem: Item) => void
}

interface VariantResponse {
  parent: Item
  variants: Item[]
  attributeKeys: string[]
  attributeValues: Record<string, string[]>
}

export function VariantPickerModal({
  isOpen,
  parentItem,
  warehouseId,
  onClose,
  onSelectVariant,
}: VariantPickerModalProps) {
  const { currency: currencyCode } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<VariantResponse | null>(null)
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string>>({})
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !parentItem) {
      return
    }

    let isMounted = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setData(null)
    setSelectedAttributes({})
    setSelectedVariantId(null)

    const url = `/api/items/${parentItem.id}/variants${warehouseId ? `?warehouseId=${warehouseId}` : ''}`
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((res: VariantResponse | null) => {
        if (!isMounted) return
        if (res && res.variants.length > 0) {
          setData(res)
          // Default selection to first variant's attributes
          const firstVariant = res.variants[0]
          setSelectedVariantId(firstVariant.id)
          if (firstVariant.variantAttributes) {
            setSelectedAttributes(firstVariant.variantAttributes as Record<string, string>)
          }
        } else {
          setData(res)
        }
      })
      .catch(() => {
        if (isMounted) setData(null)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, parentItem, warehouseId])

  useEscapeKey(isOpen && !!parentItem, onClose)

  // Find exact matching variant based on selected attributes
  const matchedVariant = useMemo(() => {
    if (!data || !data.variants.length) return null
    if (selectedVariantId) {
      const found = data.variants.find((v) => v.id === selectedVariantId)
      if (found) return found
    }
    return (
      data.variants.find((v) => {
        const vAttrs = (v.variantAttributes || {}) as Record<string, string>
        return Object.entries(selectedAttributes).every(([k, val]) => vAttrs[k] === val)
      }) || data.variants[0]
    )
  }, [data, selectedAttributes, selectedVariantId])

  if (!isOpen || !parentItem) return null

  function handleAttributeClick(key: string, value: string) {
    const updated = { ...selectedAttributes, [key]: value }
    setSelectedAttributes(updated)
    // Find matching variant
    if (data?.variants) {
      const matched = data.variants.find((v) => {
        const vAttrs = (v.variantAttributes || {}) as Record<string, string>
        return Object.entries(updated).every(([k, val]) => vAttrs[k] === val)
      })
      if (matched) {
        setSelectedVariantId(matched.id)
      } else {
        setSelectedVariantId(null)
      }
    }
  }

  function handleDirectVariantClick(v: Item) {
    setSelectedVariantId(v.id)
    if (v.variantAttributes) {
      setSelectedAttributes(v.variantAttributes as Record<string, string>)
    }
  }

  function handleConfirm() {
    if (!matchedVariant) return
    onSelectVariant(matchedVariant)
    onClose()
  }

  const isOutOfStock =
    matchedVariant?.trackStock &&
    parseFloat(matchedVariant.availableStock || '0') <= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-auto overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
              <Layers size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base leading-tight">
                Select Product Variant
              </h3>
              <p className="text-xs text-slate-500 font-medium truncate max-w-xs">
                {parentItem.name}
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

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 size={32} className="animate-spin text-purple-600 mb-2" />
              <p className="text-sm font-medium">Loading variants...</p>
            </div>
          )}

          {!loading && (!data || data.variants.length === 0) && (
            <div className="text-center py-10">
              <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-2" />
              <p className="font-bold text-slate-800 text-sm">No variants found</p>
              <p className="text-xs text-slate-500 mt-1">
                You can add the base product directly or configure variants in inventory.
              </p>
              <button
                type="button"
                onClick={() => {
                  onSelectVariant(parentItem)
                  onClose()
                }}
                className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700 transition-colors"
              >
                Add Base Item to Cart
              </button>
            </div>
          )}

          {!loading && data && data.variants.length > 0 && (
            <>
              {/* Attribute Pickers (Size, Color, Style, etc.) */}
              {data.attributeKeys.map((attrKey) => {
                const options = data.attributeValues[attrKey] || []
                const currentVal = selectedAttributes[attrKey]

                return (
                  <div key={attrKey} className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      {attrKey}: <span className="text-purple-700 font-extrabold">{currentVal || 'Select'}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {options.map((opt) => {
                        const isSelected = currentVal === opt
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => handleAttributeClick(attrKey, opt)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all ${
                              isSelected
                                ? 'bg-purple-600 border-purple-600 text-white shadow-sm ring-2 ring-purple-200'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300'
                            }`}
                          >
                            {opt}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* All Variant list / Quick tap */}
              <div className="pt-2">
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Available Combinations ({data.variants.length})
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {data.variants.map((v) => {
                    const isSelected = matchedVariant?.id === v.id
                    const vStock = parseFloat(v.availableStock || '0')
                    const vOutOfStock = v.trackStock && vStock <= 0
                    const rawAttrs = (v.variantAttributes || {}) as Record<string, string>
                    const attrText = Object.entries(rawAttrs)
                      .map(([_k, val]) => `${val}`)
                      .join(' / ')

                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => handleDirectVariantClick(v)}
                        className={`p-2.5 text-left rounded-xl border transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-purple-50/80 border-purple-500 ring-1 ring-purple-400'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="font-bold text-slate-900 text-xs truncate">
                            {attrText || v.name}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                            {v.barcode ? `EAN: ${v.barcode}` : v.sku || 'ITEM'}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-xs text-slate-800 font-mono">
                            {currencyCode} {parseFloat(v.sellingPrice).toFixed(0)}
                          </p>
                          {v.trackStock && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${
                                vOutOfStock
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {vOutOfStock ? 'Out' : `${vStock.toFixed(0)} in stock`}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Selected Variant Summary Card */}
              {matchedVariant && (
                <div className="bg-purple-50/80 border border-purple-200/80 rounded-xl p-3.5 flex items-center justify-between mt-2">
                  <div>
                    <span className="text-[12px] font-bold text-purple-900 uppercase tracking-wider block">
                      Ready to Add
                    </span>
                    <span className="text-sm font-bold text-slate-900 block mt-0.5">
                      {matchedVariant.name}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      {matchedVariant.barcode || matchedVariant.sku || ''}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-extrabold text-purple-900 font-mono block">
                      {currencyCode} {parseFloat(matchedVariant.sellingPrice).toFixed(2)}
                    </span>
                    {matchedVariant.trackStock && (
                      <span className="text-xs font-semibold text-slate-600 block">
                        Stock: {parseFloat(matchedVariant.availableStock || '0').toFixed(0)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-2.5 p-4 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl font-semibold text-sm hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!matchedVariant || isOutOfStock}
            className="flex-1 py-2.5 px-4 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
          >
            <Check size={16} />
            {isOutOfStock ? 'Out of Stock' : 'Add Variant to Cart'}
          </button>
        </div>
      </div>
    </div>
  )
}
