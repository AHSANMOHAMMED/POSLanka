'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Search, Eye, RefreshCw, Warehouse, Download, Upload } from 'lucide-react'
import { ItemFormModal } from '@/components/modals'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { ImportWizard } from '@/components/import-export/ImportWizard'
import { useExport } from '@/hooks/useExport'
import { useImport } from '@/hooks/useImport'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { useRealtimeData, usePaginatedData, useTerminology } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Pagination } from '@/components/ui/pagination'
import { WarehouseSelector } from '@/components/ui/warehouse-selector'

interface Category {
  id: string
  name: string
}

interface Supplier {
  id: string
  name: string
}

interface Item {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  categoryId: string | null
  costPrice: string
  sellingPrice: string
  currentStock: string
  reservedStock: string
  availableStock: string
  minStock: string
  unit: string
  isActive: boolean
  trackStock: boolean
  trackBatches: boolean
  trackSerialNumbers: boolean
  category: Category | null
  // Auto parts fields
  oemPartNumber: string | null
  alternatePartNumbers: string[] | null
  brand: string | null
  condition: 'new' | 'refurbished' | 'used' | null
  reorderQty: string | null
  binLocation: string | null
  supplierId: string | null
  supplierPartNumber: string | null
  leadTimeDays: number | null
  weight: string | null
  dimensions: string | null
  warrantyMonths: number | null
  imageUrl: string | null
  supersededBy: string | null
  supplier: Supplier | null
  // Restaurant fields
  preparationTime: number | null
  allergens: string[] | null
  calories: number | null
  isVegetarian: boolean
  isVegan: boolean
  isGlutenFree: boolean
  spiceLevel: string | null
  availableFrom: string | null
  availableTo: string | null
  // Supermarket fields
  pluCode: string | null
  shelfLifeDays: number | null
  storageTemp: string | null
  expiryDate: string | null
  isGiftCard: boolean
  taxTemplateId: string | null
}

interface Reservation {
  id: string
  type: 'work_order' | 'held_sale' | 'estimate'
  quantity: number
  referenceId: string
  referenceNo: string
  customer: string
  vehicle: string | null
  createdAt: string | null
}

interface ReservationDetails {
  item: { id: string; name: string; currentStock: string }
  totalReserved: number
  availableStock: number
  reservations: Reservation[]
}

interface WarehouseStockDetail {
  warehouseId: string
  warehouseName: string
  warehouseCode: string | null
  isDefault: boolean
  currentStock: string
  minStock: string
  binLocation: string | null
  lastUpdated: string | null
}

interface WarehouseStockDetails {
  item: { id: string; name: string; sku: string | null; unit: string; trackStock: boolean }
  totalStock: string
  warehouses: WarehouseStockDetail[]
}

export default function ItemsPage() {
  const t = useTerminology()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()
  const urlFilter = searchParams.get('filter')
  const isLowStockFilter = urlFilter === 'low-stock'

  const [warehouseFilter, setWarehouseFilter] = useState<string | null>(null)

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Paginated data for normal view
  const {
    data: paginatedItems,
    pagination,
    loading: paginatedLoading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: refreshPaginated,
  } = usePaginatedData<Item>({
    endpoint: '/api/items',
    entityType: ['item', 'warehouse-stock'],
    storageKey: 'items-page-size',
    realtimeEnabled: !isLowStockFilter,
    additionalParams: {
      includeInactive: 'true',
      ...(warehouseFilter && { warehouseId: warehouseFilter }),
    },
  })

  // All items for low-stock filter (needs full dataset for available stock calculation)
  const [allItems, setAllItems] = useState<Item[]>([])
  const [allItemsLoading, setAllItemsLoading] = useState(false)
  const [localSearch, setLocalSearch] = useState('')

  // Reservation modal states
  const [showReservations, setShowReservations] = useState(false)
  const [reservationDetails, setReservationDetails] = useState<ReservationDetails | null>(null)
  const [loadingReservations, setLoadingReservations] = useState(false)

  // Warehouse stock modal states
  const [showWarehouseStock, setShowWarehouseStock] = useState(false)
  const [warehouseStockDetails, setWarehouseStockDetails] = useState<WarehouseStockDetails | null>(null)
  const [loadingWarehouseStock, setLoadingWarehouseStock] = useState(false)

  // Fetch all items for low-stock filter
  const fetchAllItems = useCallback(async () => {
    if (!isLowStockFilter) return
    setAllItemsLoading(true)
    try {
      const params = new URLSearchParams({ all: 'true', includeInactive: 'true' })
      if (warehouseFilter) params.set('warehouseId', warehouseFilter)
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const data = await res.json()
        setAllItems(data)
      }
    } catch (error) {
      console.error('Error fetching items:', error)
    } finally {
      setAllItemsLoading(false)
    }
  }, [isLowStockFilter, warehouseFilter])

  // Track currently viewed item for reservation auto-refresh
  const currentReservationItemId = useRef<string | null>(null)

  useEffect(() => {
    if (isLowStockFilter) {
      fetchAllItems()
    }
  }, [isLowStockFilter, fetchAllItems])

  // Real-time updates for low-stock view
  useRealtimeData(fetchAllItems, { entityType: ['item', 'warehouse-stock'], enabled: isLowStockFilter, refreshOnMount: false })

  // Choose which items to use based on filter
  const items = isLowStockFilter ? allItems : paginatedItems
  const loading = isLowStockFilter ? allItemsLoading : paginatedLoading

  // Auto-refresh reservations when modal is open
  const fetchCurrentReservations = useCallback(async () => {
    if (currentReservationItemId.current && showReservations) {
      try {
        const res = await fetch(`/api/items/${currentReservationItemId.current}/reservations`)
        if (res.ok) {
          const data = await res.json()
          setReservationDetails(data)
        }
      } catch (error) {
        console.error('Error refreshing reservations:', error)
      }
    }
  }, [showReservations])

  useRealtimeData(fetchCurrentReservations, { entityType: ['item', 'warehouse-stock'], enabled: showReservations, refreshOnMount: false })

  async function viewReservations(itemId: string) {
    currentReservationItemId.current = itemId
    setLoadingReservations(true)
    setShowReservations(true)
    try {
      const res = await fetch(`/api/items/${itemId}/reservations`)
      if (res.ok) {
        const data = await res.json()
        setReservationDetails(data)
      }
    } catch (error) {
      console.error('Error fetching reservations:', error)
    } finally {
      setLoadingReservations(false)
    }
  }

  async function viewWarehouseStock(itemId: string) {
    setLoadingWarehouseStock(true)
    setShowWarehouseStock(true)
    try {
      const res = await fetch(`/api/items/${itemId}/warehouse-stock`)
      if (res.ok) {
        const data = await res.json()
        setWarehouseStockDetails(data)
      }
    } catch (error) {
      console.error('Error fetching warehouse stock:', error)
    } finally {
      setLoadingWarehouseStock(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)

    try {
      const res = await fetch(`/api/items/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        if (isLowStockFilter) {
          setAllItems(allItems.filter(i => i.id !== deleteId))
        } else {
          refreshPaginated()
        }
        toast.success('Item deleted successfully')
      } else {
        toast.error('Failed to delete item')
      }
    } catch (error) {
      console.error('Error deleting item:', error)
      toast.error('Error deleting item')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  function handleEdit(item: Item) {
    setEditingItem(item)
    setShowFormModal(true)
  }

  function handleAdd() {
    setEditingItem(null)
    setShowFormModal(true)
  }

  function handleModalSaved() {
    if (isLowStockFilter) {
      fetchAllItems()
    } else {
      refreshPaginated()
    }
  }

  const filteredItems = useMemo(() => {
    // For paginated view (normal), items are already filtered by server-side search
    if (!isLowStockFilter) {
      return items
    }

    // For low-stock view, filter client-side
    const searchLower = localSearch.toLowerCase()
    return items.filter(item => {
      // Search filter
      const matchesSearch = !localSearch ||
        item.name.toLowerCase().includes(searchLower) ||
        item.sku?.toLowerCase().includes(searchLower) ||
        item.barcode?.toLowerCase().includes(searchLower)

      // Low-stock filter
      const isLowStock = item.trackStock && parseFloat(item.availableStock) <= parseFloat(item.minStock)

      return matchesSearch && isLowStock
    })
  }, [items, localSearch, isLowStockFilter])

  if (loading && items.length === 0) {
    return <PageLoading text={`Loading ${t.items.toLowerCase()}...`} />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t.items}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={openImport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Upload size={16} />
            Import
          </button>
          <button
            onClick={openExport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={20} />
            {t.addItem}
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search items..."
            value={isLowStockFilter ? localSearch : search}
            onChange={(e) => isLowStockFilter ? setLocalSearch(e.target.value) : setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-48">
          <WarehouseSelector
            value={warehouseFilter}
            onChange={(id) => {
              setWarehouseFilter(id)
              setPage(1) // Reset to first page when changing warehouse
            }}
            placeholder="All Warehouses"
            size="md"
          />
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded">
          <button
            onClick={() => router.push(tenantSlug ? `/c/${tenantSlug}/items` : '/items')}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              !isLowStockFilter ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All
          </button>
          <button
            onClick={() => router.push(tenantSlug ? `/c/${tenantSlug}/items?filter=low-stock` : '/items?filter=low-stock')}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              isLowStockFilter ? 'bg-orange-500 text-white shadow' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Low Stock
          </button>
        </div>
      </div>

      <div className="bg-white rounded border list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of items</caption>
          <thead className="bg-gray-50 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Name</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 hidden sm:table-cell">SKU</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 hidden lg:table-cell">{t.category}</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 hidden xl:table-cell">Cost</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Price</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 hidden md:table-cell">Stock</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 hidden lg:table-cell">Reserved</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Available</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'No items match your search' : 'No items yet. Add your first item!'}
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{item.name}</div>
                    {(item.isVegetarian || item.isVegan || item.isGlutenFree || (item.allergens && item.allergens.length > 0)) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.isVegan && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-800">Vegan</span>
                        )}
                        {item.isVegetarian && !item.isVegan && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">Vegetarian</span>
                        )}
                        {item.isGlutenFree && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">GF</span>
                        )}
                        {item.allergens && item.allergens.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700" title={item.allergens.join(', ')}>
                            {item.allergens.join(', ')}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{item.sku || '-'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{item.category?.name || '-'}</td>
                  <td className="px-4 py-3 text-right hidden xl:table-cell">{parseFloat(item.costPrice).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-medium">{parseFloat(item.sellingPrice).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    {item.trackStock ? (
                      <button
                        onClick={() => viewWarehouseStock(item.id)}
                        aria-label={`View warehouse stock for ${item.name}`}
                        className="text-blue-600 font-medium hover:underline flex items-center gap-1 ml-auto"
                      >
                        {parseFloat(item.currentStock).toFixed(0)}
                        <Warehouse size={14} />
                      </button>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    {parseFloat(item.reservedStock) > 0 ? (
                      <button
                        onClick={() => viewReservations(item.id)}
                        aria-label={`View reservations for ${item.name}`}
                        className="text-orange-600 font-medium hover:underline flex items-center gap-1 ml-auto"
                      >
                        {parseFloat(item.reservedStock).toFixed(0)}
                        <Eye size={14} />
                      </button>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={parseFloat(item.availableStock) <= parseFloat(item.minStock) ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                      {parseFloat(item.availableStock).toFixed(0)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(item)}
                      aria-label={`Edit ${item.name}`}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={() => setDeleteId(item.id)}
                      aria-label={`Delete ${item.name}`}
                      className="p-2 text-red-600 hover:bg-red-50 rounded ml-1"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination - only for normal view */}
        {!isLowStockFilter && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            className="border-t px-4 pagination-sticky"
          />
        )}
      </div>

      {/* Item Form Modal */}
      <ItemFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false)
          setEditingItem(null)
        }}
        onSaved={handleModalSaved}
        editItem={editingItem}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />

      {/* Reservations Modal */}
      <Modal
        isOpen={showReservations}
        onClose={() => {
          setShowReservations(false)
          setReservationDetails(null)
          currentReservationItemId.current = null
        }}
        title={`Stock Reservations ${reservationDetails?.item ? `- ${reservationDetails.item.name}` : ''}`}
        size="lg"
      >
        <div className="overflow-y-auto max-h-[60vh]">
          {loadingReservations ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={24} className="animate-spin text-blue-600" />
            </div>
          ) : reservationDetails ? (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-center">
                  <div className="text-2xl font-bold dark:text-white">{parseFloat(reservationDetails.item.currentStock).toFixed(0)}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Current Stock</div>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded text-center">
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{reservationDetails.totalReserved.toFixed(0)}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Reserved</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded text-center">
                  <div className={`text-2xl font-bold ${reservationDetails.availableStock < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {reservationDetails.availableStock.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Available</div>
                </div>
              </div>

              {reservationDetails.reservations.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-4">No reservations found</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Type</th>
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Reference</th>
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Customer</th>
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Vehicle</th>
                      <th className="px-3 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="dark:divide-gray-700">
                    {reservationDetails.reservations.map((r) => (
                      <tr key={r.id} className="border-t dark:border-gray-700">
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.type === 'work_order' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                            r.type === 'held_sale' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' :
                            'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                          }`}>
                            {r.type === 'work_order' ? 'Work Order' :
                             r.type === 'held_sale' ? 'Held Sale' : 'Estimate'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.type === 'work_order' ? (
                            <Link
                              href={tenantSlug ? `/c/${tenantSlug}/work-orders/${r.referenceId}` : `/work-orders/${r.referenceId}`}
                              className="text-blue-600 hover:underline font-medium"
                              onClick={() => setShowReservations(false)}
                            >
                              {r.referenceNo}
                            </Link>
                          ) : r.type === 'estimate' ? (
                            <Link
                              href={tenantSlug ? `/c/${tenantSlug}/insurance-estimates/${r.referenceId}` : `/insurance-estimates/${r.referenceId}`}
                              className="text-blue-600 hover:underline font-medium"
                              onClick={() => setShowReservations(false)}
                            >
                              {r.referenceNo}
                            </Link>
                          ) : (
                            <span className="font-medium text-gray-700 dark:text-gray-300">{r.referenceNo}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.customer}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.vehicle || '-'}</td>
                        <td className="px-3 py-2 text-right font-medium text-orange-600 dark:text-orange-400">
                          {r.quantity.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
        </div>

        <div className="pt-4 mt-4 border-t dark:border-gray-700">
          <button
            onClick={() => {
              setShowReservations(false)
              setReservationDetails(null)
              currentReservationItemId.current = null
            }}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 dark:text-gray-300"
          >
            Close
          </button>
        </div>
      </Modal>

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="items"
        currentFilters={{ search: isLowStockFilter ? localSearch : search, warehouseId: warehouseFilter || '' }}
      />

      {/* Import Wizard */}
      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="items"
        onComplete={() => isLowStockFilter ? fetchAllItems() : refreshPaginated()}
      />

      {/* Warehouse Stock Modal */}
      <Modal
        isOpen={showWarehouseStock}
        onClose={() => {
          setShowWarehouseStock(false)
          setWarehouseStockDetails(null)
        }}
        title={
          <span className="flex items-center gap-2">
            <Warehouse size={20} className="text-blue-600" />
            Stock by Warehouse {warehouseStockDetails?.item ? `- ${warehouseStockDetails.item.name}` : ''}
          </span>
        }
        size="lg"
      >
        <div className="overflow-y-auto max-h-[60vh]">
          {loadingWarehouseStock ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={24} className="animate-spin text-blue-600" />
            </div>
          ) : warehouseStockDetails ? (
            <>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {parseFloat(warehouseStockDetails.totalStock).toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Total Stock</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded">
                  <div className="text-2xl font-bold dark:text-white">
                    {warehouseStockDetails.warehouses.filter(w => parseFloat(w.currentStock) > 0).length}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Warehouses with Stock</div>
                </div>
              </div>

              {warehouseStockDetails.item.sku && (
                <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                  SKU: <span className="font-medium text-gray-700 dark:text-gray-300">{warehouseStockDetails.item.sku}</span>
                  <span className="mx-2">|</span>
                  Unit: <span className="font-medium text-gray-700 dark:text-gray-300">{warehouseStockDetails.item.unit}</span>
                </div>
              )}

              {warehouseStockDetails.warehouses.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-4">No warehouses configured</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Warehouse</th>
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Bin Location</th>
                      <th className="px-3 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Stock</th>
                      <th className="px-3 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Min Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehouseStockDetails.warehouses.map((ws) => (
                      <tr key={ws.warehouseId} className="border-t dark:border-gray-700">
                        <td className="px-3 py-2">
                          <span className="font-medium dark:text-white">{ws.warehouseName}</span>
                          {ws.warehouseCode && (
                            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">({ws.warehouseCode})</span>
                          )}
                          {ws.isDefault && (
                            <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                              Default
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                          {ws.binLocation || '-'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={parseFloat(ws.currentStock) <= parseFloat(ws.minStock) && parseFloat(ws.minStock) > 0
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : parseFloat(ws.currentStock) > 0
                              ? 'text-green-600 dark:text-green-400 font-medium'
                              : 'text-gray-400 dark:text-gray-500'
                          }>
                            {parseFloat(ws.currentStock).toFixed(0)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">
                          {parseFloat(ws.minStock) > 0 ? parseFloat(ws.minStock).toFixed(0) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700 font-medium">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-right dark:text-gray-300">Total:</td>
                      <td className="px-3 py-2 text-right text-blue-600 dark:text-blue-400">
                        {parseFloat(warehouseStockDetails.totalStock).toFixed(0)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </>
          ) : null}
        </div>

        <div className="pt-4 mt-4 border-t dark:border-gray-700">
          <button
            onClick={() => {
              setShowWarehouseStock(false)
              setWarehouseStockDetails(null)
            }}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 dark:text-gray-300"
          >
            Close
          </button>
        </div>
      </Modal>
    </div>
  )
}
