'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Search, RefreshCw, ChevronDown, ChevronRight,
  X, Heart, Home, ArrowUp, ArrowDown, ArrowUpDown,
  Printer, Download, Trash2, Edit3
} from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { useExport } from '@/hooks/useExport'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date-format'
import { useCompany } from '@/components/providers/CompanyContextProvider'

interface Purchase {
  id: string
  purchaseNo: string
  purchaseOrderId: string | null
  purchaseOrderNo: string | null
  supplierId: string
  supplierName: string | null
  warehouseId: string
  warehouseName: string | null
  subtotal: string
  taxAmount: string
  total: string
  paidAmount: string
  status: 'pending' | 'partial' | 'paid' | 'cancelled'
  notes: string | null
  isReturn: boolean
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

interface Supplier {
  id: string
  name: string
}

interface Warehouse {
  id: string
  name: string
}

// ERPNext-style status configuration
const statusConfig: Record<string, { label: string; color: string; bgColor: string; borderColor: string; dotColor: string }> = {
  draft: {
    label: 'Draft',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-l-gray-400',
    dotColor: 'bg-gray-400',
  },
  pending: {
    label: 'Unpaid',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-l-red-500',
    dotColor: 'bg-red-500',
  },
  partial: {
    label: 'Partly Paid',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
    borderColor: 'border-l-orange-500',
    dotColor: 'bg-orange-500',
  },
  paid: {
    label: 'Paid',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    borderColor: 'border-l-green-500',
    dotColor: 'bg-green-500',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    borderColor: 'border-l-gray-400',
    dotColor: 'bg-gray-400',
  },
}

function SortIcon({ field, sortField, sortOrder }: { field: string; sortField: string; sortOrder: string }) {
  if (sortField !== field) {
    return <ArrowUpDown size={14} className="text-gray-400" />
  }
  return sortOrder === 'asc'
    ? <ArrowUp size={14} className="text-blue-600" />
    : <ArrowDown size={14} className="text-blue-600" />
}

export default function PurchasesPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const { showExportDialog, openExport, closeExport } = useExport()

  // Filters state
  const [statusFilter, setStatusFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  // Sort state
  const [sortField, setSortField] = useState<string>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())

  // Dropdown states
  const [showActionsMenu, setShowActionsMenu] = useState(false)

  // Paginated purchases with server-side search
  const {
    data: purchaseList,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    setAdditionalParams,
    refresh,
  } = usePaginatedData<Purchase>({
    endpoint: '/api/purchases',
    entityType: 'purchase',
    storageKey: 'purchases-page-size',
  })

  // Fetch suppliers and warehouses for filters
  useEffect(() => {
    async function fetchData() {
      try {
        const [suppliersRes, warehousesRes] = await Promise.all([
          fetch('/api/suppliers?all=true'),
          fetch('/api/warehouses?all=true'),
        ])
        if (suppliersRes.ok) {
          const data = await suppliersRes.json()
          setSuppliers(data)
        }
        if (warehousesRes.ok) {
          const data = await warehousesRes.json()
          setWarehouses(data)
        }
      } catch (error) {
        console.error('Error fetching filter data:', error)
      }
    }
    fetchData()
  }, [])

  // Apply filters and sort
  const applyFilters = useCallback(() => {
    const params: Record<string, string> = {}
    if (statusFilter) params.status = statusFilter
    if (supplierFilter) params.supplierId = supplierFilter
    if (warehouseFilter) params.warehouseId = warehouseFilter
    if (sortField) params.sortBy = sortField
    if (sortOrder) params.sortOrder = sortOrder
    setAdditionalParams(params)
  }, [statusFilter, supplierFilter, warehouseFilter, sortField, sortOrder, setAdditionalParams])

  useEffect(() => {
    applyFilters()
  }, [applyFilters])

  // Handle column sort
  function handleSort(field: string) {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  function handleRowClick(purchaseId: string) {
    router.push(tenantSlug ? `/c/${tenantSlug}/purchases/${purchaseId}` : `/purchases/${purchaseId}`)
  }

  function clearFilters() {
    setStatusFilter('')
    setSupplierFilter('')
    setWarehouseFilter('')
    setSortField('createdAt')
    setSortOrder('desc')
  }

  function toggleSelect(id: string) {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  function toggleSelectAll() {
    if (selectedIds.size === purchaseList.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(purchaseList.map(p => p.id)))
    }
  }

  function toggleLike(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const newLiked = new Set(likedIds)
    if (newLiked.has(id)) {
      newLiked.delete(id)
    } else {
      newLiked.add(id)
    }
    setLikedIds(newLiked)
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  const hasFilters = statusFilter || supplierFilter || warehouseFilter
  const hasSelection = selectedIds.size > 0

  if (loading && purchaseList.length === 0) {
    return <PageLoading text="Loading purchase invoices..." />
  }

  return (
    <div className="h-full flex flex-col -m-5">
      {/* Breadcrumb */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link href={tenantSlug ? `/c/${tenantSlug}/dashboard` : '/dashboard'} className="hover:text-blue-600 dark:hover:text-blue-400">
            <Home size={14} />
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-400">Buying</span>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium">Purchase Invoice</span>
        </div>
      </div>

      {/* Title Bar */}
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Purchase Invoice</h1>
          <button
            onClick={() => router.push(tenantSlug ? `/c/${tenantSlug}/purchases/new` : '/purchases/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Purchase Invoice
          </button>
        </div>
      </div>

      {/* Bulk Action Bar (when items selected) */}
      {hasSelection && (
        <div className="px-4 py-2 bg-blue-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-medium">{selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowActionsMenu(!showActionsMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded text-sm transition-colors"
              >
                Actions
                <ChevronDown size={14} />
              </button>
              {showActionsMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                  <button className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2">
                    <Edit3 size={14} />
                    Edit
                  </button>
                  <button className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2">
                    <Printer size={14} />
                    Print
                  </button>
                  <button className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2">
                    <Download size={14} />
                    Export
                  </button>
                  <hr className="my-1 border-gray-200 dark:border-gray-700" />
                  <button className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2">
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={clearSelection}
              className="p-1.5 hover:bg-white/20 rounded transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      {!hasSelection && (
        <div className="px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4">
          {/* Refresh */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              onClick={openExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <Download size={14} />
              Export
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Invoice No, Supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            />
          </div>
        </div>
      )}

      {/* Inline Filters */}
      {!hasSelection && (
        <div className="px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Statuses</option>
            {Object.entries(statusConfig).map(([status, config]) => (
              <option key={status} value={status}>{config.label}</option>
            ))}
          </select>
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Suppliers</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Warehouses</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
            ))}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-900">
          {/* Table Header */}
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <div className="w-12 px-4 py-3 flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={purchaseList.length > 0 && selectedIds.size === purchaseList.length}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={() => handleSort('purchaseNo')}
                className="flex-1 px-4 py-3 flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
              >
                Name
                <SortIcon field="purchaseNo" sortField={sortField} sortOrder={sortOrder} />
              </button>
              <button
                onClick={() => handleSort('status')}
                className="w-32 px-4 py-3 flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
              >
                Status
                <SortIcon field="status" sortField={sortField} sortOrder={sortOrder} />
              </button>
              <button
                onClick={() => handleSort('supplierName')}
                className="w-48 px-4 py-3 flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
              >
                Supplier
                <SortIcon field="supplierName" sortField={sortField} sortOrder={sortOrder} />
              </button>
              <button
                onClick={() => handleSort('total')}
                className="w-32 px-4 py-3 flex items-center gap-1 justify-end hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
              >
                Grand Total
                <SortIcon field="total" sortField={sortField} sortOrder={sortOrder} />
              </button>
              <div className="w-32 px-4 py-3 text-right">
                Outstanding
              </div>
            </div>
          </div>

          {/* Table Body */}
          <div className="flex-1 overflow-y-auto">
            {purchaseList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No Purchase Invoices</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {search || hasFilters ? 'No invoices match your search criteria' : 'Get started by creating your first purchase invoice'}
                </p>
                {!search && !hasFilters && (
                  <button
                    onClick={() => router.push(tenantSlug ? `/c/${tenantSlug}/purchases/new` : '/purchases/new')}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    <Plus size={18} />
                    Create Purchase Invoice
                  </button>
                )}
              </div>
            ) : (
              purchaseList.map((purchase) => {
                const status = statusConfig[purchase.status] || {
                  label: purchase.status || 'Unknown',
                  color: 'text-gray-600',
                  bgColor: 'bg-gray-100',
                  borderColor: 'border-l-gray-400',
                  dotColor: 'bg-gray-400',
                }
                const isSelected = selectedIds.has(purchase.id)
                const isLiked = likedIds.has(purchase.id)
                const outstanding = parseFloat(purchase.total) - parseFloat(purchase.paidAmount)

                return (
                  <div
                    key={purchase.id}
                    onClick={() => handleRowClick(purchase.id)}
                    className={`flex items-center bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 border-l-4 ${status.borderColor} hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <div className="w-12 px-4 py-3 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(purchase.id)}
                        className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => toggleLike(purchase.id, e)}
                          className={`flex-shrink-0 transition-colors ${
                            isLiked ? 'text-red-500' : 'text-gray-300 dark:text-gray-600 hover:text-red-400'
                          }`}
                        >
                          <Heart size={14} fill={isLiked ? 'currentColor' : 'none'} />
                        </button>
                        <div>
                          <span className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                            {purchase.purchaseNo}
                          </span>
                          {purchase.purchaseOrderNo && (
                            <span className="ml-2 text-xs text-gray-500">
                              from {purchase.purchaseOrderNo}
                            </span>
                          )}
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {formatDate(purchase.createdAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="w-32 px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status.color}`}>
                        <span className={`w-2 h-2 rounded-full ${status.dotColor}`} />
                        {status.label}
                      </span>
                    </div>
                    <div className="w-48 px-4 py-3">
                      <span className="text-sm text-gray-900 dark:text-white truncate block">
                        {purchase.supplierName || 'Unknown'}
                      </span>
                    </div>
                    <div className="w-32 px-4 py-3 text-right">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatCurrency(parseFloat(purchase.total))}
                      </span>
                    </div>
                    <div className="w-32 px-4 py-3 text-right">
                      <span className={`text-sm font-medium ${outstanding > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {formatCurrency(outstanding)}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer / Pagination */}
          {purchaseList.length > 0 && (
            <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center justify-between">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Showing {((pagination.page - 1) * pagination.pageSize) + 1} - {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
              </div>
              <div className="flex items-center gap-4">
                <select
                  value={pagination.pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:text-white"
                  >
                    ←
                  </button>
                  {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => {
                    const pageNum = i + 1
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`px-3 py-1 text-sm rounded transition-colors ${
                          pagination.page === pageNum
                            ? 'bg-blue-600 text-white'
                            : 'border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setPage(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:text-white"
                  >
                    →
                  </button>
                </div>
              </div>
            </div>
          )}
      </div>

      {/* Click outside to close dropdowns */}
      {showActionsMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowActionsMenu(false)}
        />
      )}

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="purchases"
        currentFilters={{ search, status: statusFilter, supplierId: supplierFilter || '', warehouseId: warehouseFilter || '' }}
      />
    </div>
  )
}
