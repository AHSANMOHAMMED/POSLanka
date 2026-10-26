'use client'

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { Search, ScanBarcode, Package, RotateCcw, Loader2, Warehouse, ChevronLeft, ChevronRight, Scale, Layers, PlusCircle, LayoutGrid, List, ArrowUpDown } from 'lucide-react'
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
  onCashMovement?: () => void
  onOpenReturnLookup: () => void
  cartHasItems: boolean
  onReturnModeConfirm: () => void
  config: POSBusinessConfig
  businessType?: string
  /** Enter in the search box: immediate exact barcode/PLU lookup (bypasses debounce). Return true when handled. */
  onScanSubmit?: (code: string) => Promise<boolean> | boolean
  /** Quick-Add item directly from POS (F4) */
  onOpenQuickAdd?: () => void
}

/** DOM id of the POS search box so keyboard shortcuts can focus it */
export const POS_SEARCH_INPUT_ID = 'pos-search-input'

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
      active ? 'theme-btn-primary shadow-md font-semibold' : 'bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gray-700'
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

export type POSSortOption = 'default' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'stock-desc'

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
  onCashMovement,
  onOpenReturnLookup,
  cartHasItems,
  onReturnModeConfirm,
  config,
  businessType,
  onScanSubmit,
  onOpenQuickAdd,
}: ProductGridProps) {
  const [scanBusy, setScanBusy] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<POSSortOption>('default')

  async function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !onScanSubmit) return
    const code = search.trim()
    if (!code) return
    e.preventDefault()
    setScanBusy(true)
    try {
      await onScanSubmit(code)
    } finally {
      setScanBusy(false)
    }
  }
  const terms = useTerminology()
  const { currency: currencyCode } = useCurrency()

  const filteredItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    const result = items.filter(item => {
      const matchesSearch = !search ||
        item.name.toLowerCase().includes(searchLower) ||
        item.sku?.toLowerCase().includes(searchLower) ||
        item.barcode?.toLowerCase().includes(searchLower) ||
        item.oemPartNumber?.toLowerCase().includes(searchLower) ||
        item.supplierPartNumber?.toLowerCase().includes(searchLower) ||
        item.genericName?.toLowerCase().includes(searchLower) ||
        item.pluCode?.toLowerCase() === searchLower ||
        item.itemCode?.toLowerCase().includes(searchLower) ||
        item.alternatePartNumbers?.some(pn => pn.toLowerCase().includes(searchLower))
      return matchesSearch
    })

    if (sortBy === 'name-asc') {
      result.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sortBy === 'name-desc') {
      result.sort((a, b) => b.name.localeCompare(a.name))
    } else if (sortBy === 'price-asc') {
      result.sort((a, b) => (parseFloat(a.sellingPrice) || 0) - (parseFloat(b.sellingPrice) || 0))
    } else if (sortBy === 'price-desc') {
      result.sort((a, b) => (parseFloat(b.sellingPrice) || 0) - (parseFloat(a.sellingPrice) || 0))
    } else if (sortBy === 'stock-desc') {
      result.sort((a, b) => (parseFloat(b.availableStock) || 0) - (parseFloat(a.availableStock) || 0))
    }

    return result
  }, [items, search, sortBy])

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-slate-50/50 dark:bg-gray-900">
      {/* Search Header */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Shift Status */}
          {activeShift && (
            <ShiftStatus
              shift={activeShift}
              hasOpenShift={!!activeShift}
              onOpenShift={onOpenShift}
              onCloseShift={onCloseShift}
              onCashMovement={onCashMovement}
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

          {/* Search: wraps to its own full-width line when the panel is narrow */}
          <div className="flex-1 min-w-[16rem] order-last 2xl:order-none basis-full 2xl:basis-0">
            <FormInput
              id={POS_SEARCH_INPUT_ID}
              type="text"
              placeholder={`${terms.searchPlaceholder}  (F1)`}
              title="Search / scan (F1 or Esc). ↓ = results or cart · * = cart · ? = all shortcuts"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              leftIcon={<Search size={20} />}
              rightIcon={scanBusy ? <Loader2 size={20} className="animate-spin" /> : <ScanBarcode size={20} />}
              inputSize="lg"
              autoComplete="off"
              autoFocus
            />
          </div>

          {/* Quick Add Button (F4) */}
          {onOpenQuickAdd && !isReturnMode && (
            <button
              type="button"
              onClick={onOpenQuickAdd}
              className="flex items-center gap-1.5 px-3.5 py-3 theme-btn-subtle border rounded-xl font-bold text-xs flex-shrink-0 shadow-sm"
              title="Quick Add unlisted item to POS (F4)"
            >
              <PlusCircle size={16} />
              <span className="hidden md:inline">Quick Add</span>
              <span className="text-[11px] px-1 py-0.5 rounded font-mono font-extrabold opacity-80">F4</span>
            </button>
          )}

          {/* Return Button */}
          {!isReturnMode && (
            <button
              onClick={() => cartHasItems ? onReturnModeConfirm() : onOpenReturnLookup()}
              title="Return / refund (F6)"
              className="flex items-center gap-2 px-4 py-3 bg-red-50 text-red-700 rounded-md font-medium hover:bg-red-100 transition-colors flex-shrink-0"
            >
              <RotateCcw size={18} />
              <span className="hidden sm:inline">Return</span>
              <kbd className="text-[11px] bg-red-200/60 text-red-900 px-1 py-0.5 rounded font-mono font-extrabold">F6</kbd>
            </button>
          )}
        </div>
      </div>

      {/* Category Filter & View Controls */}
      <div className="flex items-center justify-between border-b bg-white dark:bg-gray-800 pr-3">
        <div className="flex-1 min-w-0">
          <CategoryPillBar
            categories={categories}
            selectedCategory={selectedCategory}
            onCategoryChange={onCategoryChange}
            allLabel={`All ${terms.items}`}
          />
        </div>

        {/* View Mode & Order By Controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0 pl-2 py-1.5 border-l border-gray-100 dark:border-gray-700">
          {/* Order By Selector */}
          <div className="relative flex items-center">
            <ArrowUpDown size={13} className="absolute left-2 text-gray-400 pointer-events-none" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as POSSortOption)}
              className="text-[12px] font-semibold pl-6 pr-2 py-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-teal-500 cursor-pointer"
              title="Sort products"
            >
              <option value="default">Default Order</option>
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="stock-desc">Highest Stock</option>
            </select>
          </div>

          {/* Grid vs List View Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg border border-gray-200/80 dark:border-gray-600">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded-md transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-gray-800 text-teal-800 dark:text-teal-400 shadow-xs'
                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title="Grid View"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1 rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-800 text-teal-800 dark:text-teal-400 shadow-xs'
                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title="List View"
            >
              <List size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Products Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {searchingItems && (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={20} className="animate-spin text-blue-500 mr-2" />
            <span className="text-gray-500">Searching...</span>
          </div>
        )}

        {/* Products Grid or List */}
        {viewMode === 'grid' ? (
          <div className="grid gap-3 min-[1920px]:gap-4 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] min-[1920px]:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] min-[2560px]:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
            {filteredItems.map(item => {
              const stock = parseFloat(item.availableStock)
              const isLowStock = item.trackStock && stock <= 5 && stock > 0
              const isOutOfStock = item.trackStock && stock <= 0

              return (
                <button
                  key={item.id}
                  onClick={() => onAddToCart(item)}
                  disabled={isOutOfStock && !isReturnMode}
                  data-pos-tile="1"
                  title={`${item.name} — click or Enter to add 1`}
                  className={`bg-white dark:bg-gray-800 rounded-xl border p-3.5 min-[1920px]:p-4 text-left flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-all hover:shadow-md hover:border-teal-600 group relative ${
                    isOutOfStock && !isReturnMode
                      ? 'opacity-50 cursor-not-allowed border-slate-200 dark:border-gray-700'
                      : 'border-slate-200 dark:border-gray-700 hover:-translate-y-0.5'
                  }`}
                >
                  {/* Stock Tag on Top Right */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300 font-bold">
                      {item.barcode ? `EAN: ${item.barcode.slice(-6)}` : item.sku || 'ITEM'}
                    </span>
                    {item.trackStock && (
                      <span
                        className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                          isOutOfStock
                            ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                            : isLowStock
                            ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {isOutOfStock ? 'Out' : `${stock.toFixed(0)} in stock`}
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-slate-900 dark:text-white text-sm min-[1920px]:text-base min-[2560px]:text-lg leading-snug line-clamp-2 min-h-[2.5em] mb-1 group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors">
                    {item.name}
                  </h3>
                  {(item.genericName || item.drugSchedule === 'prescription' || item.drugSchedule === 'controlled') && (
                    <p className="text-[12px] text-slate-500 mb-1 truncate">
                      {(item.drugSchedule === 'prescription' || item.drugSchedule === 'controlled') && (
                        <span className={`mr-1 rounded px-1 font-bold ${item.drugSchedule === 'controlled' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>Rx</span>
                      )}
                      {[item.genericName, item.strength].filter(Boolean).join(' ')}
                    </p>
                  )}

                  {(() => {
                    const partNum = getItemPartNumber(item, businessType)
                    return partNum ? <p className="text-[12px] text-slate-400 mb-1 font-mono">{partNum}</p> : null
                  })()}

                  {item.categoryName && (
                    <p className="text-[12px] text-slate-400 truncate mb-2">{item.categoryName}</p>
                  )}

                  {/* Weighable / Core charge indicators */}
                  {(config.enableWeighableItems && item.isWeighable) && (
                    <div className="flex items-center gap-1 mb-1">
                      <Scale size={12} className="text-amber-600" />
                      <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Weighable (PLU)</span>
                    </div>
                  )}
                  {item.hasVariants && (
                    <div className="flex items-center gap-1 mb-1">
                      <Layers size={12} className="text-purple-600" />
                      <span className="text-xs text-purple-700 dark:text-purple-400 font-semibold">Has Variants</span>
                    </div>
                  )}
                  {(config.enableCoreChargeDisplay && item.coreCharge && parseFloat(item.coreCharge) > 0) && (
                    <div className="text-xs text-purple-600 dark:text-purple-400 font-medium mb-1">
                      +Core: {currencyCode} {parseFloat(item.coreCharge).toFixed(0)}
                    </div>
                  )}

                  <div className="flex items-end justify-between pt-2 border-t border-slate-100 dark:border-gray-700 mt-auto">
                    <span className="text-base min-[1920px]:text-lg min-[2560px]:text-xl font-bold theme-text-primary font-mono">
                      {currencyCode} {parseFloat(item.sellingPrice).toFixed(0)}
                      {config.enableWeighableItems && item.isWeighable ? (
                        <span className="text-xs font-normal text-slate-400">/{item.unit || 'kg'}</span>
                      ) : item.unit && item.unit !== 'pcs' ? (
                        <span className="text-xs font-normal text-slate-400">/{item.unit}</span>
                      ) : null}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          /* List View */
          <div className="space-y-1.5">
            {filteredItems.map(item => {
              const stock = parseFloat(item.availableStock)
              const isLowStock = item.trackStock && stock <= 5 && stock > 0
              const isOutOfStock = item.trackStock && stock <= 0

              return (
                <button
                  key={item.id}
                  onClick={() => onAddToCart(item)}
                  disabled={isOutOfStock && !isReturnMode}
                  data-pos-tile="1"
                  className={`w-full bg-white dark:bg-gray-800 rounded-xl border px-3.5 py-2.5 min-[1920px]:py-3 text-left focus:outline-none focus-visible:ring-2 theme-ring-primary transition-all hover:shadow-xs flex items-center justify-between gap-3 group ${
                    isOutOfStock && !isReturnMode
                      ? 'opacity-50 cursor-not-allowed border-slate-200 dark:border-gray-700'
                      : 'border-slate-200 dark:border-gray-700 hover:theme-bg-subtle'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-[11px] font-mono px-2 py-1 rounded bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300 font-bold flex-shrink-0">
                      {item.barcode ? item.barcode.slice(-6) : item.sku || 'ITEM'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white text-sm min-[1920px]:text-base truncate group-hover:opacity-80">
                          {item.name}
                        </span>
                        {item.categoryName && (
                          <span className="text-[12px] text-slate-400 hidden sm:inline">({item.categoryName})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[12px] text-slate-500">
                        {item.trackStock && (
                          <span className={isOutOfStock ? 'text-red-500 font-bold' : isLowStock ? 'text-amber-500 font-semibold' : 'text-emerald-600 dark:text-emerald-400'}>
                            {isOutOfStock ? 'Out of stock' : `${stock.toFixed(0)} in stock`}
                          </span>
                        )}
                        {item.isWeighable && <span className="text-amber-600 font-medium">• Weighable</span>}
                        {item.hasVariants && <span className="text-purple-600 font-medium">• Variants</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="font-mono font-bold text-sm min-[1920px]:text-base theme-text-primary">
                      {currencyCode} {parseFloat(item.sellingPrice).toFixed(0)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {filteredItems.length === 0 && !searchingItems && (
          <div className="text-center py-16">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">No {terms.items.toLowerCase()} found</p>
            {onOpenQuickAdd && (
              <button
                type="button"
                onClick={onOpenQuickAdd}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 theme-btn-primary rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                <PlusCircle size={15} />
                Quick Add {search ? `"${search}"` : 'New Item'} to POS (F4)
              </button>
            )}
            <p className="text-gray-400 text-sm mt-2">Try a different search term or add it to inventory</p>
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
