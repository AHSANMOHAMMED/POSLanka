'use client'

import { useState } from 'react'
import { History, Search, Filter, ExternalLink, Download } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { useExport } from '@/hooks/useExport'
import { Pagination } from '@/components/ui/pagination'
import { PageLoading } from '@/components/ui/loading-spinner'

interface StockMovement {
  id: string
  type: 'in' | 'out' | 'adjustment'
  quantity: string
  referenceType: string | null
  referenceId: string | null
  notes: string | null
  createdAt: string
  itemId: string
  itemName: string | null
  itemSku: string | null
  warehouseId: string | null
  warehouseName: string | null
  createdBy: string | null
  createdByName: string | null
}

const typeColors: Record<string, string> = {
  in: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  out: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  adjustment: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
}

const typeLabels: Record<string, string> = {
  in: 'In',
  out: 'Out',
  adjustment: 'Adjustment',
}

const referenceTypeLabels: Record<string, string> = {
  purchase: 'Purchase',
  purchase_order_receive: 'PO Receive',
  sale: 'Sale',
  sale_void: 'Sale Void',
  return: 'Return',
  stock_transfer: 'Stock Transfer',
  stock_transfer_cancelled: 'Transfer Cancelled',
  work_order: 'Work Order',
  manual_adjustment: 'Manual Adjustment',
}

export default function StockMovementsPage() {
  const { showExportDialog, openExport, closeExport } = useExport()
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('')
  const [referenceTypeFilter, setReferenceTypeFilter] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const additionalParams: Record<string, string> = {}
  if (typeFilter) additionalParams.type = typeFilter
  if (warehouseFilter) additionalParams.warehouseId = warehouseFilter
  if (referenceTypeFilter) additionalParams.referenceType = referenceTypeFilter
  if (startDate) additionalParams.startDate = startDate
  if (endDate) additionalParams.endDate = endDate

  const {
    data: movements,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
  } = usePaginatedData<StockMovement>({
    endpoint: '/api/stock-movements',
    entityType: ['item', 'purchase', 'sale', 'warehouse-stock'],
    storageKey: 'stock-movements-page-size',
    additionalParams,
  })

  // Fetch warehouses for filter dropdown
  const {
    data: warehouseOptions,
  } = usePaginatedData<{ id: string; name: string }>({
    endpoint: '/api/warehouses',
    entityType: 'warehouse',
    defaultPageSize: 100,
    realtimeEnabled: false,
  })

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function getReferenceLink(refType: string | null, refId: string | null): string | null {
    if (!refType || !refId) return null
    switch (refType) {
      case 'purchase': return `/purchases/${refId}`
      case 'purchase_order_receive': return `/purchase-orders/${refId}`
      case 'sale':
      case 'sale_void':
      case 'return': return `/sales/${refId}`
      case 'stock_transfer':
      case 'stock_transfer_cancelled': return `/stock-transfers/${refId}`
      case 'work_order': return `/work-orders/${refId}`
      default: return null
    }
  }

  const hasFilters = typeFilter || warehouseFilter || referenceTypeFilter || startDate || endDate

  function clearFilters() {
    setTypeFilter('')
    setWarehouseFilter('')
    setReferenceTypeFilter('')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  if (loading && movements.length === 0) {
    return <PageLoading text="Loading stock movements..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 dark:text-white">
            <History size={24} />
            Stock Ledger
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View all stock movements across warehouses
          </p>
        </div>
        <button
          onClick={openExport}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Download size={16} />
          Export
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by item name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-gray-400" />
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Types</option>
            <option value="in">In</option>
            <option value="out">Out</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </div>
        <select
          value={warehouseFilter}
          onChange={(e) => { setWarehouseFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Warehouses</option>
          {warehouseOptions.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <select
          value={referenceTypeFilter}
          onChange={(e) => { setReferenceTypeFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Sources</option>
          <option value="purchase">Purchase</option>
          <option value="purchase_order_receive">PO Receive</option>
          <option value="sale">Sale</option>
          <option value="sale_void">Sale Void</option>
          <option value="return">Return</option>
          <option value="stock_transfer">Stock Transfer</option>
          <option value="stock_transfer_cancelled">Transfer Cancelled</option>
          <option value="work_order">Work Order</option>
          <option value="manual_adjustment">Manual Adjustment</option>
        </select>
      </div>

      {/* Date Range Filters */}
      <div className="mb-4 flex gap-4 flex-wrap items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">From:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
            className="px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">To:</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
            className="px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
          />
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Item</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Warehouse</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Type</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Qty</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Reference</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Notes</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">By</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {movements.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search || hasFilters ? 'No movements match your filters' : 'No stock movements yet'}
                </td>
              </tr>
            ) : (
              movements.map((movement) => {
                const refLink = getReferenceLink(movement.referenceType, movement.referenceId)
                return (
                  <tr key={movement.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(movement.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium dark:text-white">{movement.itemName || '-'}</div>
                      {movement.itemSku && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{movement.itemSku}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {movement.warehouseName || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${typeColors[movement.type]}`}>
                        {typeLabels[movement.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono dark:text-white">
                      {movement.type === 'out' ? '-' : ''}{parseFloat(movement.quantity).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {refLink ? (
                        <a
                          href={refLink}
                          className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          {referenceTypeLabels[movement.referenceType || ''] || movement.referenceType}
                          <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">
                          {referenceTypeLabels[movement.referenceType || ''] || movement.referenceType || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 max-w-[200px] truncate" title={movement.notes || ''}>
                      {movement.notes || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {movement.createdByName || '-'}
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
          className="border-t dark:border-gray-700 px-4"
        />
      </div>

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="stock-movements"
        currentFilters={{ search, type: typeFilter || '', warehouseId: warehouseFilter || '', referenceType: referenceTypeFilter || '', startDate: startDate || '', endDate: endDate || '' }}
      />
    </div>
  )
}
