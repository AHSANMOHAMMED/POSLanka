'use client'

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { Search, ScanBarcode, Package, RotateCcw, Loader2, Warehouse, ChevronLeft, ChevronRight, Scale } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { ShiftStatus } from './ShiftStatus'
import { useCurrency } from '@/hooks/useCurrency'
import type { Item, Category, ActiveShift, POSBusinessConfig } from './types'
import { POS_ITEMS_LIMIT } from './types'
import { useTerminology } from '@/hooks/useTerminology'
import { getItemPartNumber } from '@/lib/utils/item-display'

interface ProductGridProps {
  items: Item[]
  categories: Category[]
  search: string
  onSearchChange: (value: string) => void
  selectedCategory: string | null
  onCategoryChange: (categoryId: string | null) => void
  onAddToCart: (item: Item) => void
  isReturnMode: boolean
  searchingItems: boolean
  hasMoreItems: boolean
  activeShift: ActiveShift | null
  posWarehouseName: string | null
  onOpenShift: () => void
  onCloseShift: () => void
  onOpenReturnLookup: () => void
  cartHasItems: boolean
  onReturnModeConfirm: () => void
  config: POSBusinessConfig
  businessType?: string
}

function CategoryPillBar({ categories, selectedCategory, onCategoryChange, allLabel }: {
  categories: Category[]
  selectedCategory: string | null
  onCategoryChange: (id: string | null) => void
  allLabel: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowLeftArrow(el.scrollLeft > 0)
    setShowRightArrow(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (el) {
      const observer = new ResizeObserver(checkScroll)
      observer.observe(el)
      return () => observer.disconnect()
    }
  }, [checkScroll, categories.length])

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' })
  }

  const pillClasses = (active: boolean) =>
    `px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
      active ? 'bg-teal-700 text-white shadow-md font-semibold' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
    }`

  return (
    <div className="relative bg-white border-b">
      {showLeftArrow && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-0 z-10 h-full px-1 bg-gradient-to-r from-white via-white/90 to-transparent"
        >
          <ChevronLeft size={16} className="text-gray-500" />
        </button>
      )}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar"
        onScroll={checkScroll}
      >
        <button onClick={() => onCategoryChange(null)} className={pillClasses(selectedCategory === null)}>
          {allLabel}
        </button>
        {categories.map(cat => (
          <button key={cat.id} onClick={() => onCategoryChange(cat.id)} className={pillClasses(selectedCategory === cat.id)}>
            {cat.name}
          </button>
        ))}
      </div>
      {showRightArrow && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-0 z-10 h-full px-1 bg-gradient-to-l from-white via-white/90 to-transparent"
        >
          <ChevronRight size={16} className="text-gray-500" />
        </button>
      )}
    </div>
  )
}

export function ProductGrid({
  items,
  categories,
  search,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  onAddToCart,
  isReturnMode,
  searchingItems,
  hasMoreItems,
  activeShift,
  posWarehouseName,
  onOpenShift,
  onCloseShift,
  onOpenReturnLookup,
  cartHasItems,
  onReturnModeConfirm,
  config,
  businessType,
}: ProductGridProps) {
  const terms = useTerminology()
  const { currency: currencyCode } = useCurrency()

  const filteredItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    return items.filter(item => {
      const matchesSearch = !search ||
        item.name.toLowerCase().includes(searchLower) ||
        item.sku?.toLowerCase().includes(searchLower) ||
        item.barcode?.toLowerCase().includes(searchLower) ||
        item.oemPartNumber?.toLowerCase().includes(searchLower) ||
        item.supplierPartNumber?.toLowerCase().includes(searchLower) ||
        item.alternatePartNumbers?.some(pn => pn.toLowerCase().includes(searchLower))
      return matchesSearch
    })
  }, [items, search])

  return (
    <div className="w-full lg:w-[60%] flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50/50">
      {/* Search Header */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Shift Status */}
          {activeShift && (
            <ShiftStatus
              shift={activeShift}
              hasOpenShift={!!activeShift}
              onOpenShift={onOpenShift}
              onCloseShift={onCloseShift}
              compact
            />
          )}

          {/* Warehouse Badge */}
          {posWarehouseName && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-md text-sm font-medium flex-shrink-0">
              <Warehouse size={16} />
              <span>{posWarehouseName}</span>
            </div>
          )}

          {/* Search */}
          <div className="flex-1 min-w-0">
            <FormInput
              type="text"
              placeholder={terms.searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              leftIcon={<Search size={20} />}
              rightIcon={<ScanBarcode size={20} />}
              inputSize="lg"
              autoFocus
            />
          </div>

          {/* Return Button */}
          {!isReturnMode && (
            <button
              onClick={() => cartHasItems ? onReturnModeConfirm() : onOpenReturnLookup()}
              className="flex items-center gap-2 px-4 py-3 bg-red-50 text-red-700 rounded-md font-medium hover:bg-red-100 transition-colors flex-shrink-0"
            >
              <RotateCcw size={18} />
              Return
            </button>
          )}
        </div>
      </div>

      {/* Category Filter */}
      <CategoryPillBar
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={onCategoryChange}
        allLabel={`All ${terms.items}`}
      />

      {/* Products Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {searchingItems && (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={20} className="animate-spin text-blue-500 mr-2" />
            <span className="text-gray-500">Searching...</span>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredItems.map(item => {
            const stock = parseFloat(item.availableStock)
            const isLowStock = item.trackStock && stock <= 5 && stock > 0
            const isOutOfStock = item.trackStock && stock <= 0

            return (
              <button
                key={item.id}
                onClick={() => onAddToCart(item)}
                disabled={isOutOfStock && !isReturnMode}
                className={`bg-white rounded-xl border p-3.5 text-left transition-all hover:shadow-md hover:border-teal-600 group relative ${
                  isOutOfStock && !isReturnMode
                    ? 'opacity-50 cursor-not-allowed border-slate-200'
                    : 'border-slate-200 hover:-translate-y-0.5'
                }`}
              >
                {/* Stock Tag on Top Right */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">
                    {item.barcode ? `EAN: ${item.barcode.slice(-6)}` : item.sku || 'ITEM'}
                  </span>
                  {item.trackStock && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isOutOfStock
                          ? 'bg-red-100 text-red-700'
                          : isLowStock
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {isOutOfStock ? 'Out' : `${stock.toFixed(0)} in stock`}
                    </span>
                  )}
                </div>

                <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2 min-h-[36px] mb-1 group-hover:text-teal-800 transition-colors">
                  {item.name}
                </h3>

                {(() => {
                  const partNum = getItemPartNumber(item, businessType)
                  return partNum ? <p className="text-[11px] text-slate-400 mb-1 font-mono">{partNum}</p> : null
                })()}

                {item.categoryName && (
                  <p className="text-[11px] text-slate-400 truncate mb-2">{item.categoryName}</p>
                )}

                {/* Weighable / Core charge indicators */}
                {(config.enableWeighableItems && item.isWeighable) && (
                  <div className="flex items-center gap-1 mb-1">
                    <Scale size={12} className="text-amber-600" />
                    <span className="text-xs text-amber-700 font-medium">Weighable (PLU)</span>
                  </div>
                )}
                {(config.enableCoreChargeDisplay && item.coreCharge && parseFloat(item.coreCharge) > 0) && (
                  <div className="text-xs text-purple-600 font-medium mb-1">
                    +Core: {currencyCode} {parseFloat(item.coreCharge).toFixed(0)}
                  </div>
                )}

                <div className="flex items-end justify-between pt-2 border-t border-slate-100 mt-2">
                  <span className="text-base font-bold text-teal-800 font-mono">
                    {currencyCode} {parseFloat(item.sellingPrice).toFixed(0)}
                    {config.enableWeighableItems && item.isWeighable && (
                      <span className="text-xs font-normal text-slate-400">/kg</span>
                    )}
                  </span>
                  <span className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-teal-700 group-hover:text-white flex items-center justify-center text-slate-700 text-xs font-bold transition-colors">
                    +
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {filteredItems.length === 0 && !searchingItems && (
          <div className="text-center py-16">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">No {terms.items.toLowerCase()} found</p>
            <p className="text-gray-400 text-sm mt-1">Try a different search term</p>
          </div>
        )}

        {hasMoreItems && !search && (
          <div className="text-center py-4 text-sm text-gray-500">
            Showing first {POS_ITEMS_LIMIT} items. Use search to find more.
          </div>
        )}
      </div>
    </div>
  )
}
