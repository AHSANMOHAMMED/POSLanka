'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Search, X, Tag, Package, ShoppingCart, AlertCircle, Loader2 } from 'lucide-react'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useCurrency } from '@/hooks/useCurrency'
import type { Item } from './types'

interface PriceCheckModalProps {
  isOpen: boolean
  onClose: () => void
  warehouseId?: string
  onAddToCart?: (item: Item) => void
}

export function PriceCheckModal({
  isOpen,
  onClose,
  warehouseId,
  onAddToCart,
}: PriceCheckModalProps) {
  const { currency: currencyCode } = useCurrency()
  const [barcode, setBarcode] = useState('')
  const [loading, setLoading] = useState(false)
  const [item, setItem] = useState<Item | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEscapeKey(isOpen, onClose)

  useEffect(() => {
    if (isOpen) {
      setBarcode('')
      setItem(null)
      setError(null)
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [isOpen])

  async function handleLookup(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      const url = `/api/items/barcode-lookup?barcode=${encodeURIComponent(trimmed)}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`
      const res = await fetch(url)
      if (res.ok) {
        const foundItem: Item & { category?: { name: string } } = await res.json()
        if (foundItem.category?.name && !foundItem.categoryName) {
          foundItem.categoryName = foundItem.category.name
        }
        setItem(foundItem)
        setError(null)
      } else {
        setItem(null)
        setError(`No product found for barcode "${trimmed}"`)
      }
    } catch {
      setItem(null)
      setError('Network error checking price')
    } finally {
      setLoading(false)
      setBarcode('')
      inputRef.current?.focus()
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (barcode) {
      handleLookup(barcode)
    }
  }

  if (!isOpen) return null

  const unitPrice = item ? parseFloat(item.sellingPrice) : 0
  const stock = item ? parseFloat(item.availableStock) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col">
        {/* Header Strip */}
        <div className="bg-indigo-700 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Tag className="w-6 h-6 text-indigo-200" />
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-indigo-200 font-bold block">
                Counter Price Verification
              </span>
              <h2 className="text-lg font-bold leading-tight">
                Price Check & Inquiry
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-indigo-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-6 pb-2">
          <form onSubmit={handleSubmit} className="relative">
            <input
              ref={inputRef}
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Scan or type barcode / SKU / PLU..."
              className="w-full pl-11 pr-24 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono text-base placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
            <button
              type="submit"
              disabled={loading || !barcode.trim()}
              className="absolute right-2 top-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
            </button>
          </form>
          <p className="text-xs text-slate-500 mt-2">
            Tip: Scan any item barcode to check price without adding it to the current customer order.
          </p>
        </div>

        {/* Content Result */}
        <div className="p-6 pt-2">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 flex items-center gap-3 text-red-700 dark:text-red-300 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {item && (
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/80 p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-xs uppercase font-semibold text-slate-500 dark:text-slate-400">
                    {item.categoryName || 'General Retail'}
                  </span>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
                    {item.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5 text-xs font-mono text-slate-500 dark:text-slate-400">
                    {item.sku && <span>SKU: {item.sku}</span>}
                    {item.sku && item.barcode && <span>•</span>}
                    {item.barcode && <span>Barcode: {item.barcode}</span>}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-xs text-slate-500 block uppercase font-semibold">Retail Price</span>
                  <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    {currencyCode} {unitPrice.toFixed(2)}
                  </span>
                  {item.isWeighable && (
                    <span className="text-xs text-slate-500 block">/ kg</span>
                  )}
                </div>
              </div>

              {/* Badges / Availability */}
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-3 text-sm">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Stock:{' '}
                    <strong className={stock > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                      {stock > 0 ? `${stock} available` : 'Out of stock'}
                    </strong>
                  </span>
                </div>

                {onAddToCart && (
                  <button
                    type="button"
                    onClick={() => {
                      onAddToCart(item)
                      onClose()
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-all"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    Add to Cart
                  </button>
                )}
              </div>
            </div>
          )}

          {!item && !error && (
            <div className="py-8 text-center text-slate-400">
              <Tag className="w-12 h-12 mx-auto stroke-[1.2] text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm">Ready for scanner input...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 dark:bg-slate-800/80 px-6 py-3 border-t border-slate-200 dark:border-slate-700/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl text-sm font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
