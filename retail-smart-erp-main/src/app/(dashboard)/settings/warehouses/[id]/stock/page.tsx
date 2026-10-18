'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { usePaginatedData, useRealtimeData, useSmartWarnings } from '@/hooks'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Pagination } from '@/components/ui/pagination'
import { SmartWarningBanner } from '@/components/ai/SmartWarningBanner'
import {
  Warehouse,
  ChevronLeft,
  Search,
  Plus,
  Minus,
  Edit2,
  Package,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react'

interface WarehouseData {
  id: string
  name: string
  code: string
  isDefault: boolean
}

interface StockItem {
  id: string
  warehouseId: string
  itemId: string
  currentStock: string
  minStock: string
  reorderQty: string | null
  binLocation: string | null
  updatedAt: string
  item: {
    id: string
    name: string
    sku: string | null
    barcode: string | null
    unit: string
    sellingPrice: string
    trackStock: boolean
  }
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default function WarehouseStockPage({ params }: PageProps) {
  const resolvedParams = use(params)
  const warehouseId = resolvedParams.id
  const router = useRouter()
  const { data: session } = useSession()
  const tenantSlug = session?.user?.tenantSlug || ''

  const [warehouse, setWarehouse] = useState<WarehouseData | null>(null)
  const [loadingWarehouse, setLoadingWarehouse] = useState(true)

  // Stock adjustment modal
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null)
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'subtract' | 'set'>('add')
  const [adjustmentQty, setAdjustmentQty] = useState('')
  const [adjustmentNotes, setAdjustmentNotes] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const stockWarnings = useSmartWarnings('stock_adjustment')
  const [stockWarningBypassed, setStockWarningBypassed] = useState(false)

  // Add item modal
  const [showAddItemModal, setShowAddItemModal] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchingItems, setSearchingItems] = useState(false)
  const [newItemStock, setNewItemStock] = useState('')
  const [newItemMinStock, setNewItemMinStock] = useState('')
  const [newItemBinLocation, setNewItemBinLocation] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedNewItem, setSelectedNewItem] = useState<any | null>(null)
  const [addingItem, setAddingItem] = useState(false)

  // Paginated stock data
  const {
    data: stockItems,
    pagination,
    loading: stockLoading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: refreshStock,
  } = usePaginatedData<StockItem>({
    endpoint: `/api/warehouses/${warehouseId}/stock`,
    entityType: 'warehouse-stock',
    storageKey: 'warehouse-stock-page-size',
  })

  // Fetch warehouse details
  const fetchWarehouse = useCallback(async () => {
    try {
      const res = await fetch(`/api/warehouses/${warehouseId}`)
      if (res.ok) {
        const data = await res.json()
        setWarehouse(data)
      } else if (res.status === 404) {
        toast.error('Warehouse not found')
        router.push(`/c/${tenantSlug}/settings/warehouses`)
      }
    } catch (err) {
      console.error('Error fetching warehouse:', err)
      toast.error('Failed to load warehouse')
    } finally {
      setLoadingWarehouse(false)
    }
  }, [warehouseId, router, tenantSlug])

  useEffect(() => {
    fetchWarehouse()
  }, [fetchWarehouse])

  useRealtimeData(refreshStock, { entityType: 'warehouse-stock', refreshOnMount: false })

  // Search items to add
  async function searchItems(query: string) {
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    setSearchingItems(true)
    try {
      const res = await fetch(`/api/items?search=${encodeURIComponent(query)}&pageSize=10&all=true`)
      if (res.ok) {
        const data = await res.json()
        // Filter out items that already have stock in this warehouse
        const existingItemIds = new Set(stockItems.map(s => s.itemId))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filtered = data.filter((item: any) =>
          item.trackStock && !existingItemIds.has(item.id)
        )
        setSearchResults(filtered)
      }
    } catch (err) {
      console.error('Error searching items:', err)
    } finally {
      setSearchingItems(false)
    }
  }

  // Add item to warehouse
  async function handleAddItem() {
    if (!selectedNewItem) {
      toast.error('Please select an item')
      return
    }
    if (!newItemStock || parseFloat(newItemStock) < 0) {
      toast.error('Please enter a valid stock quantity')
      return
    }

    setAddingItem(true)
    try {
      const res = await fetch(`/api/warehouses/${warehouseId}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: selectedNewItem.id,
          quantity: parseFloat(newItemStock),
          type: 'set',
          minStock: newItemMinStock ? parseFloat(newItemMinStock) : 0,
          binLocation: newItemBinLocation || null,
          notes: 'Initial stock setup',
        }),
      })

      if (res.ok) {
        toast.success('Item added to warehouse')
        setShowAddItemModal(false)
        setSelectedNewItem(null)
        setNewItemStock('')
        setNewItemMinStock('')
        setNewItemBinLocation('')
        setItemSearch('')
        setSearchResults([])
        refreshStock()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to add item')
      }
    } catch (err) {
      console.error('Error adding item:', err)
      toast.error('Failed to add item')
    } finally {
      setAddingItem(false)
    }
  }

  // Adjust stock
  async function handleAdjustStock() {
    if (!selectedItem) return
    if (!adjustmentQty || parseFloat(adjustmentQty) < 0) {
      toast.error('Please enter a valid quantity')
      return
    }

    // AI Smart Warnings
    if (!stockWarningBypassed) {
      const currentStock = parseFloat(selectedItem.currentStock)
      const qty = parseFloat(adjustmentQty)
      let adjustmentQuantity: number
      if (adjustmentType === 'add') adjustmentQuantity = qty
      else if (adjustmentType === 'subtract') adjustmentQuantity = -qty
      else adjustmentQuantity = qty - currentStock // 'set' = difference

      const w = await stockWarnings.checkWarnings({
        itemName: selectedItem.item.name,
        adjustmentQuantity,
        currentStock,
        reason: adjustmentNotes,
      })
      if (w.length > 0) return
    }
    setStockWarningBypassed(false)

    setAdjusting(true)
    try {
      const res = await fetch(`/api/warehouses/${warehouseId}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: selectedItem.itemId,
          quantity: parseFloat(adjustmentQty),
          type: adjustmentType,
          notes: adjustmentNotes || `Stock ${adjustmentType}`,
        }),
      })

      if (res.ok) {
        toast.success('Stock updated')
        setShowAdjustModal(false)
        setSelectedItem(null)
        setAdjustmentQty('')
        setAdjustmentNotes('')
        refreshStock()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update stock')
      }
    } catch (err) {
      console.error('Error adjusting stock:', err)
      toast.error('Failed to update stock')
    } finally {
      setAdjusting(false)
    }
  }

  // Open adjustment modal
  function openAdjustModal(item: StockItem, type: 'add' | 'subtract' | 'set') {
    setSelectedItem(item)
    setAdjustmentType(type)
    setAdjustmentQty('')
    setAdjustmentNotes('')
    setShowAdjustModal(true)
  }

  if (loadingWarehouse) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!warehouse) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href={`/c/${tenantSlug}/settings/warehouses`}
            className="p-2 hover:bg-gray-100 rounded transition"
          >
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Warehouse className="text-blue-600" size={28} />
              {warehouse.name}
              {warehouse.isDefault && (
                <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                  Default
                </span>
              )}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Manage stock levels for this warehouse
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAddItemModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus size={20} />
          Add Item
        </button>
      </div>

      {/* Search and filters */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Stock table */}
      <div className="bg-white rounded border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">SKU</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Bin Location</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Current Stock</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Min Stock</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stockLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400" />
                </td>
              </tr>
            ) : stockItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  <Package size={32} className="mx-auto mb-2 text-gray-300" />
                  No items in this warehouse yet. Add items to start tracking stock.
                </td>
              </tr>
            ) : (
              stockItems.map((stock) => {
                const isLowStock = parseFloat(stock.currentStock) <= parseFloat(stock.minStock) &&
                  parseFloat(stock.minStock) > 0
                return (
                  <tr key={stock.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-medium">{stock.item.name}</span>
                      <span className="text-gray-400 text-sm ml-2">({stock.item.unit})</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{stock.item.sku || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{stock.binLocation || '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${isLowStock ? 'text-red-600' : 'text-gray-900'}`}>
                        {parseFloat(stock.currentStock).toFixed(0)}
                      </span>
                      {isLowStock && (
                        <AlertTriangle size={14} className="inline ml-1 text-red-500" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {parseFloat(stock.minStock) > 0 ? parseFloat(stock.minStock).toFixed(0) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openAdjustModal(stock, 'add')}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                          title="Add stock"
                        >
                          <Plus size={18} />
                        </button>
                        <button
                          onClick={() => openAdjustModal(stock, 'subtract')}
                          className="p-1.5 text-orange-600 hover:bg-orange-50 rounded"
                          title="Remove stock"
                        >
                          <Minus size={18} />
                        </button>
                        <button
                          onClick={() => openAdjustModal(stock, 'set')}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                          title="Set stock"
                        >
                          <Edit2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t px-4"
        />
      </div>

      {/* Stock Adjustment Modal */}
      <Modal
        isOpen={showAdjustModal && !!selectedItem}
        onClose={() => setShowAdjustModal(false)}
        title={adjustmentType === 'add' ? 'Add Stock' :
          adjustmentType === 'subtract' ? 'Remove Stock' : 'Set Stock'}
        size="md"
      >
        {selectedItem && (
          <>
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
                <div className="font-medium dark:text-white">{selectedItem.item.name}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Current stock: {parseFloat(selectedItem.currentStock).toFixed(0)} {selectedItem.item.unit}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                  {adjustmentType === 'set' ? 'New Stock Level' : 'Quantity'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={adjustmentQty}
                  onChange={(e) => setAdjustmentQty(e.target.value)}
                  className="w-full px-3 py-2 border dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  placeholder={adjustmentType === 'set' ? 'Enter new stock level' : 'Enter quantity'}
                  autoFocus
                />
                {adjustmentType !== 'set' && adjustmentQty && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    New stock will be:{' '}
                    <span className="font-medium">
                      {adjustmentType === 'add'
                        ? (parseFloat(selectedItem.currentStock) + parseFloat(adjustmentQty || '0')).toFixed(0)
                        : (parseFloat(selectedItem.currentStock) - parseFloat(adjustmentQty || '0')).toFixed(0)
                      }
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Notes (optional)</label>
                <input
                  type="text"
                  value={adjustmentNotes}
                  onChange={(e) => setAdjustmentNotes(e.target.value)}
                  className="w-full px-3 py-2 border dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  placeholder="Reason for adjustment"
                />
              </div>
            </div>

            {/* AI Smart Warnings */}
            {(stockWarnings.warnings.length > 0 || stockWarnings.loading) && (
              <div className="mt-4">
                <SmartWarningBanner
                  warnings={stockWarnings.warnings}
                  loading={stockWarnings.loading}
                  onProceed={() => {
                    setStockWarningBypassed(true)
                    stockWarnings.clearWarnings()
                    handleAdjustStock()
                  }}
                  onCancel={() => stockWarnings.clearWarnings()}
                  processing={adjusting}
                  proceedText="Adjust Anyway"
                />
              </div>
            )}

            {stockWarnings.warnings.length === 0 && (
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t dark:border-gray-700">
              <button
                onClick={() => setShowAdjustModal(false)}
                className="px-4 py-2 border dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleAdjustStock}
                disabled={adjusting || !adjustmentQty}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {adjusting && <Loader2 size={16} className="animate-spin" />}
                {adjustmentType === 'add' ? 'Add' : adjustmentType === 'subtract' ? 'Remove' : 'Set'}
              </button>
            </div>
            )}
          </>
        )}
      </Modal>

      {/* Add Item Modal */}
      <Modal
        isOpen={showAddItemModal}
        onClose={() => {
          setShowAddItemModal(false)
          setSelectedNewItem(null)
          setItemSearch('')
          setSearchResults([])
        }}
        title="Add Item to Warehouse"
        size="lg"
      >
        <div className="space-y-4">
          {!selectedNewItem ? (
            <>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Search Item</label>
                <div className="relative">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={itemSearch}
                    onChange={(e) => {
                      setItemSearch(e.target.value)
                      searchItems(e.target.value)
                    }}
                    className="w-full pl-10 pr-4 py-2 border dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                    placeholder="Search by name, SKU, or barcode..."
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto border dark:border-gray-700 rounded">
                {searchingItems ? (
                  <div className="p-4 text-center">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                    {itemSearch ? 'No items found' : 'Start typing to search items'}
                  </div>
                ) : (
                  searchResults.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedNewItem(item)}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 border-b dark:border-gray-700 last:border-b-0"
                    >
                      <div className="font-medium dark:text-white">{item.name}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {item.sku && <span>SKU: {item.sku}</span>}
                        {item.sku && item.unit && <span> | </span>}
                        <span>Unit: {item.unit}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded flex items-center justify-between">
                <div>
                  <div className="font-medium text-blue-900 dark:text-blue-200">{selectedNewItem.name}</div>
                  <div className="text-sm text-blue-700 dark:text-blue-400">
                    {selectedNewItem.sku && `SKU: ${selectedNewItem.sku} | `}
                    Unit: {selectedNewItem.unit}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNewItem(null)}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Change
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Initial Stock *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newItemStock}
                    onChange={(e) => setNewItemStock(e.target.value)}
                    className="w-full px-3 py-2 border dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Min Stock</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newItemMinStock}
                    onChange={(e) => setNewItemMinStock(e.target.value)}
                    className="w-full px-3 py-2 border dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Bin Location</label>
                <input
                  type="text"
                  value={newItemBinLocation}
                  onChange={(e) => setNewItemBinLocation(e.target.value)}
                  className="w-full px-3 py-2 border dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  placeholder="e.g., Shelf A-3, Rack B-2"
                />
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t dark:border-gray-700">
          <button
            onClick={() => {
              setShowAddItemModal(false)
              setSelectedNewItem(null)
              setItemSearch('')
              setSearchResults([])
            }}
            className="px-4 py-2 border dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300"
          >
            Cancel
          </button>
          {selectedNewItem && (
            <button
              onClick={handleAddItem}
              disabled={addingItem || !newItemStock}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {addingItem && <Loader2 size={16} className="animate-spin" />}
              Add Item
            </button>
          )}
        </div>
      </Modal>
    </div>
  )
}
