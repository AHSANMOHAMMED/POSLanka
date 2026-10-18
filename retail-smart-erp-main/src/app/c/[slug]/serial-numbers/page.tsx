'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import {
  Search,
  ChevronDown,
  ChevronRight,
  Hash,
  ArrowRight,
  RefreshCw,
  Loader2,
  Package,
} from 'lucide-react'
import { useRealtimeData, useDebouncedValue } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SerialResult {
  id: string
  serialNumber: string
  status: string
  itemId: string
  itemName: string
  itemSku: string | null
  warehouseId: string | null
  warehouseName: string | null
  warrantyStartDate: string | null
  warrantyEndDate: string | null
  createdAt: string
  updatedAt: string
}

interface Movement {
  id: string
  fromStatus: string | null
  toStatus: string
  fromWarehouseId: string | null
  fromWarehouseName: string | null
  toWarehouseId: string | null
  toWarehouseName: string | null
  referenceType: string | null
  referenceId: string | null
  changedBy: string | null
  changedByName: string | null
  notes: string | null
  createdAt: string
}

interface PaginationData {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// ---------------------------------------------------------------------------
// Status badge constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'available', label: 'Available' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'sold', label: 'Sold' },
  { value: 'returned', label: 'Returned' },
  { value: 'defective', label: 'Defective' },
  { value: 'scrapped', label: 'Scrapped' },
  { value: 'lost', label: 'Lost' },
] as const

const statusStyles: Record<string, string> = {
  available:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  reserved:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  sold: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  returned:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  defective:
    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  scrapped:
    'bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-400',
  lost: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}

function getStatusBadge(status: string) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
        statusStyles[status] || 'bg-gray-100 text-gray-700'
      }`}
    >
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateString: string | null | undefined) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(dateString: string | null | undefined) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const referenceTypeLabels: Record<string, string> = {
  purchase: 'Purchase',
  purchase_order_receive: 'PO Receive',
  sale: 'Sale',
  sale_return: 'Sale Return',
  work_order: 'Work Order',
  stock_transfer: 'Stock Transfer',
  manual_adjustment: 'Manual Adjustment',
  initial: 'Initial Entry',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SerialNumbersPage() {
  const { slug } = useParams()
  void slug // silence unused param warning

  // Search & filter state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)

  // Data state
  const [results, setResults] = useState<SerialResult[]>([])
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Expanded row state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [movements, setMovements] = useState<Record<string, Movement[]>>({})
  const [movementsLoading, setMovementsLoading] = useState<string | null>(null)

  // Page size persistence
  const [pageSize, setPageSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('serial-numbers-page-size')
      const parsed = parseInt(saved || '', 10)
      return !isNaN(parsed) && parsed > 0 ? parsed : 25
    }
    return 25
  })

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!debouncedSearch.trim()) {
      setResults([])
      setPagination({ page: 1, pageSize, total: 0, totalPages: 0 })
      setHasSearched(false)
      return
    }

    setLoading(true)
    setHasSearched(true)
    try {
      const params = new URLSearchParams({
        search: debouncedSearch.trim(),
        page: String(pagination.page),
        pageSize: String(pageSize),
      })
      if (statusFilter) {
        params.set('status', statusFilter)
      }

      const res = await fetch(`/api/serial-numbers/search?${params}`)
      if (!res.ok) {
        throw new Error('Failed to search serial numbers')
      }
      const json = await res.json()
      setResults(json.data || [])
      setPagination(json.pagination || { page: 1, pageSize, total: 0, totalPages: 0 })
    } catch {
      setResults([])
      setPagination({ page: 1, pageSize, total: 0, totalPages: 0 })
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, pagination.page, pageSize, statusFilter])

  // Real-time subscription
  useRealtimeData(fetchData, {
    entityType: 'serial-number',
    refreshOnMount: false,
  })

  // Trigger fetch when debounced search, status filter, page, or pageSize change
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Reset page to 1 when search or status changes
  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }))
  }, [debouncedSearch, statusFilter])

  // Page change handlers
  function handlePageChange(page: number) {
    setPagination((prev) => ({ ...prev, page }))
  }

  function handlePageSizeChange(newSize: number) {
    setPageSize(newSize)
    localStorage.setItem('serial-numbers-page-size', String(newSize))
    setPagination((prev) => ({ ...prev, page: 1, pageSize: newSize }))
  }

  // Expand / collapse row
  function toggleRow(serialId: string) {
    if (expandedId === serialId) {
      setExpandedId(null)
    } else {
      setExpandedId(serialId)
      loadMovements(serialId)
    }
  }

  // Fetch movement history on demand
  async function loadMovements(serialId: string) {
    if (movements[serialId]) return
    setMovementsLoading(serialId)
    try {
      const res = await fetch(
        `/api/serial-numbers/${serialId}/movements?pageSize=10`
      )
      if (!res.ok) throw new Error('Failed to load movements')
      const data = await res.json()
      setMovements((prev) => ({
        ...prev,
        [serialId]: data.data || [],
      }))
    } catch {
      setMovements((prev) => ({
        ...prev,
        [serialId]: [],
      }))
    } finally {
      setMovementsLoading(null)
    }
  }

  return (
    <div className="p-6 space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded">
            <Hash className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              Serial Numbers
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Search and track serial numbers across all items
            </p>
          </div>
        </div>
        {hasSearched && (
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        )}
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search by serial number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
          />
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white sm:w-44"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Results */}
      {!hasSearched && !loading ? (
        /* Empty state before search */
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 py-16 flex flex-col items-center justify-center text-center">
          <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-full mb-4">
            <Package className="h-8 w-8 text-gray-400 dark:text-gray-500" />
          </div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
            Search for serial numbers
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
            Enter a serial number above to search across all items in your
            inventory. You can also filter by status.
          </p>
        </div>
      ) : (
        /* Results table */
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto list-container-xl">
            <table className="w-full">
              <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="w-8 px-3 py-3" />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Serial Number
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">
                    Warehouse
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell">
                    Warranty Expiry
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && results.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Searching...
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : results.length === 0 && hasSearched ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                    >
                      No serial numbers found matching &quot;{debouncedSearch}&quot;
                      {statusFilter && ` with status "${statusFilter}"`}
                    </td>
                  </tr>
                ) : (
                  results.map((serial) => (
                    <>
                      {/* Main row */}
                      <tr
                        key={serial.id}
                        onClick={() => toggleRow(serial.id)}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-3 text-gray-400 dark:text-gray-500">
                          {expandedId === serial.id ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                            {serial.serialNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {serial.itemName || '-'}
                          </div>
                          {serial.itemSku && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              SKU: {serial.itemSku}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 hidden md:table-cell">
                          {serial.warehouseName || '-'}
                        </td>
                        <td className="px-4 py-3">
                          {getStatusBadge(serial.status)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 hidden lg:table-cell">
                          {formatDate(serial.warrantyEndDate)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 hidden lg:table-cell">
                          {formatDate(serial.createdAt)}
                        </td>
                      </tr>

                      {/* Expanded movement history */}
                      {expandedId === serial.id && (
                        <tr key={`${serial.id}-movements`}>
                          <td
                            colSpan={7}
                            className="bg-gray-50 dark:bg-gray-900/40 px-4 py-0"
                          >
                            <div className="py-3 pl-8">
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                                Recent Movement History
                              </h4>

                              {movementsLoading === serial.id ? (
                                <div className="flex items-center gap-2 py-3">
                                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                  <span className="text-sm text-gray-500 dark:text-gray-400">
                                    Loading movements...
                                  </span>
                                </div>
                              ) : (movements[serial.id] || []).length === 0 ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
                                  No movement history recorded.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {(movements[serial.id] || []).map(
                                    (movement) => (
                                      <div
                                        key={movement.id}
                                        className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 px-3 py-2"
                                      >
                                        {/* Timestamp */}
                                        <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap min-w-[140px]">
                                          {formatDateTime(movement.createdAt)}
                                        </span>

                                        {/* Status transition */}
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          {movement.fromStatus ? (
                                            <>
                                              {getStatusBadge(movement.fromStatus)}
                                              <ArrowRight
                                                size={12}
                                                className="text-gray-400"
                                              />
                                            </>
                                          ) : null}
                                          {getStatusBadge(movement.toStatus)}
                                        </div>

                                        {/* Warehouse transition */}
                                        {(movement.fromWarehouseName ||
                                          movement.toWarehouseName) && (
                                          <span className="text-xs text-gray-500 dark:text-gray-400">
                                            {movement.fromWarehouseName && movement.toWarehouseName
                                              ? `${movement.fromWarehouseName} \u2192 ${movement.toWarehouseName}`
                                              : movement.toWarehouseName
                                                ? `\u2192 ${movement.toWarehouseName}`
                                                : `${movement.fromWarehouseName} \u2192`}
                                          </span>
                                        )}

                                        {/* Reference */}
                                        {movement.referenceType && (
                                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                                            {referenceTypeLabels[movement.referenceType] ||
                                              movement.referenceType}
                                          </span>
                                        )}

                                        {/* Notes */}
                                        {movement.notes && (
                                          <span
                                            className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]"
                                            title={movement.notes}
                                          >
                                            {movement.notes}
                                          </span>
                                        )}

                                        {/* Changed by - pushed to end */}
                                        {movement.changedByName && (
                                          <span className="text-xs text-gray-400 dark:text-gray-500 sm:ml-auto">
                                            by {movement.changedByName}
                                          </span>
                                        )}
                                      </div>
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.total > 0 && (
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              className="border-t border-gray-200 dark:border-gray-700 px-4"
            />
          )}
        </div>
      )}
    </div>
  )
}
