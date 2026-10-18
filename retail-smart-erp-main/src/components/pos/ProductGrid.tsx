'use client'

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { Search, ScanBarcode, Package, RotateCcw, Loader2, Warehouse, ChevronLeft, ChevronRight, Scale } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { ShiftStatus } from './ShiftStatus'
import { Badge } from '@/components/ui/badge'
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
    `px-4 py-2 rounded text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
      active ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredItems.map(item => {
            const stock = parseFloat(item.availableStock)
            const isLowStock = item.trackStock && stock <= 5 && stock > 0
            const isOutOfStock = item.trackStock && stock <= 0

            return (
              <button
                key={item.id}
                onClick={() => onAddToCart(item)}
                disabled={isOutOfStock && !isReturnMode}
                className={`bg-white rounded-2xl border-2 p-4 text-left transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                  isOutOfStock && !isReturnMode
                    ? 'opacity-50 cursor-not-allowed border-gray-200'
                    : 'border-gray-100 hover:border-blue-400'
                }`}
              >
                {/* Product placeholder with letter */}
                <div className="w-full aspect-square bg-gradient-to-br from-blue-50 to-blue-100 rounded-md flex items-center justify-center mb-3">
                  <span className="text-2xl font-bold text-blue-300">
                    {item.name.charAt(0).toUpperCase()}
                  </span>
                </div>

                {item.barcode && (
                  <p className="text-xs text-gray-400 mb-0.5 truncate">{item.barcode}</p>
                )}

                <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2 mb-1">
                  {item.name}
                </h3>

                {(() => {
                  const partNum = getItemPartNumber(item, businessType)
                  return partNum ? <p className="text-xs text-gray-400 mb-1">{partNum}</p> : null
                })()}

                {item.categoryName && (
                  <p className="text-xs text-gray-400 truncate mb-2">{item.categoryName}</p>
                )}

                {/* Weighable / Core charge indicators */}
                {(config.enableWeighableItems && item.isWeighable) && (
                  <div className="flex items-center gap-1 mb-1">
                    <Scale size={12} className="text-orange-500" />
                    <span className="text-xs text-orange-600 font-medium">Weighable</span>
                  </div>
                )}
                {(config.enableCoreChargeDisplay && item.coreCharge && parseFloat(item.coreCharge) > 0) && (
                  <div className="text-xs text-purple-600 font-medium mb-1">
                    +Core: {currencyCode} {parseFloat(item.coreCharge).toFixed(0)}
                  </div>
                )}

                <div className="flex items-end justify-between">
                  <span className="text-lg font-bold text-blue-600">
                    {currencyCode} {parseFloat(item.sellingPrice).toFixed(0)}
                    {config.enableWeighableItems && item.isWeighable && (
                      <span className="text-xs font-normal text-gray-400">/kg</span>
                    )}
                  </span>
                  {item.trackStock && (
                    <Badge
                      variant={isOutOfStock ? 'danger' : isLowStock ? 'warning' : 'success'}
                      size="sm"
                    >
                      {isOutOfStock ? 'Out' : stock.toFixed(0)}
                    </Badge>
                  )}
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
