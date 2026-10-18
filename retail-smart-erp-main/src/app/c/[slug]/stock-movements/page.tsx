'use client'

import { useState } from 'react'
import { ExternalLink, Download, X } from 'lucide-react'
import { usePaginatedData, useTerminology } from '@/hooks'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { useExport } from '@/hooks/useExport'
import { Pagination } from '@/components/ui/pagination'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { PermissionGuard } from '@/components/auth/PermissionGuard'

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
  itemBarcode: string | null
  itemOemPartNumber: string | null
  warehouseId: string | null
  warehouseName: string | null
  createdBy: string | null
  createdByName: string | null
}

const typeColors: Record<string, string> = {
  in: 'bg-green-100 text-green-700',
  out: 'bg-red-100 text-red-700',
  adjustment: 'bg-blue-100 text-blue-700',
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

const typeOptions: [string, string][] = [
  ['in', 'In'],
  ['out', 'Out'],
  ['adjustment', 'Adjustment'],
]

const referenceTypeOptions: [string, string][] = [
  ['purchase', 'Purchase'],
  ['purchase_order_receive', 'PO Receive'],
  ['sale', 'Sale'],
  ['sale_void', 'Sale Void'],
  ['return', 'Return'],
  ['stock_transfer', 'Stock Transfer'],
  ['stock_transfer_cancelled', 'Transfer Cancelled'],
  ['work_order', 'Work Order'],
  ['manual_adjustment', 'Manual Adjustment'],
]

export default function StockMovementsPage() {
  const t = useTerminology()
  const { tenantSlug } = useCompany()
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
    refresh,
  } = usePaginatedData<StockMovement>({
    endpoint: '/api/stock-movements',
    entityType: ['item', 'purchase', 'sale', 'warehouse-stock'],
    storageKey: 'stock-movements-page-size',
    additionalParams,
  })

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
    const prefix = `/c/${tenantSlug}`
    switch (refType) {
      case 'purchase': return `${prefix}/purchases/${refId}`
      case 'purchase_order_receive': return `${prefix}/purchase-orders/${refId}`
      case 'sale':
      case 'sale_void':
      case 'return': return `${prefix}/sales/${refId}`
      case 'stock_transfer':
      case 'stock_transfer_cancelled': return `${prefix}/stock-transfers/${refId}`
      case 'work_order': return `${prefix}/work-orders/${refId}`
      default: return null
    }
  }

  const hasFilters = typeFilter || warehouseFilter || referenceTypeFilter || startDate || endDate

  function clearAllFilters() {
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
    <PermissionGuard permission="manageInventory">
    <ListPageLayout
      module={t.stockModule}
      moduleHref="/stock"
      title="Stock Ledger"
      actionContent={
        <button
          onClick={openExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Download size={14} />
          Export
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search by item name, SKU, barcode, OEM part #..."
      filterContent={
        <>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Types</option>
            {typeOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={referenceTypeFilter}
            onChange={(e) => { setReferenceTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Sources</option>
            {referenceTypeOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={warehouseFilter}
            onChange={(e) => { setWarehouseFilter(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Warehouses</option>
            {warehouseOptions.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
          {hasFilters && (
            <button onClick={clearAllFilters} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      {/* Table */}
      <div className="bg-white rounded border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Barcode</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">OEM Part #</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Warehouse</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Qty</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Reference</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Notes</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">By</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {movements.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                  {search || hasFilters ? 'No movements match your filters' : 'No stock movements yet'}
                </td>
              </tr>
            ) : (
              movements.map((movement) => {
                const refLink = getReferenceLink(movement.referenceType, movement.referenceId)
                return (
                  <tr key={movement.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {formatDate(movement.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium">{movement.itemName || '-'}</div>
                      {movement.itemSku && (
                        <div className="text-xs text-gray-500">{movement.itemSku}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {movement.itemBarcode || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {movement.itemOemPartNumber || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {movement.warehouseName || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${typeColors[movement.type]}`}>
                        {typeLabels[movement.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono">
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
                        <span className="text-gray-500">
                          {referenceTypeLabels[movement.referenceType || ''] || movement.referenceType || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate" title={movement.notes || ''}>
                      {movement.notes || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
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
          className="border-t px-4"
        />
      </div>
    </ListPageLayout>

    <ExportDialog
      isOpen={showExportDialog}
      onClose={closeExport}
      entity="stock-movements"
      currentFilters={{ search, type: typeFilter || '', warehouseId: warehouseFilter || '', referenceType: referenceTypeFilter || '', startDate: startDate || '', endDate: endDate || '' }}
    />
    </PermissionGuard>
  )
}
