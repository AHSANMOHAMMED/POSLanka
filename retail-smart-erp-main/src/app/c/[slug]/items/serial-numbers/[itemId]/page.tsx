'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Plus,
  Hash,
  Shield,
  Calendar,
  Pencil,
  RefreshCw,
  Search,
  Package,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  Trash2,
  MapPin,
} from 'lucide-react'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'

// ============================================
// TYPES
// ============================================

interface SerialNumber {
  id: string
  serialNumber: string
  status: string
  warehouseId: string | null
  warehouseName: string | null
  warrantyStartDate: string | null
  warrantyEndDate: string | null
  warrantyNotes: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface Warehouse {
  id: string
  name: string
}

interface ItemInfo {
  id: string
  name: string
  sku: string | null
  trackSerialNumbers: boolean
}

// ============================================
// STATUS HELPERS
// ============================================

const STATUS_OPTIONS = [
  'available',
  'reserved',
  'sold',
  'returned',
  'defective',
  'scrapped',
  'lost',
] as const

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
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
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${styles[status] || 'bg-gray-100 text-gray-700'}`}
    >
      {status}
    </span>
  )
}

function getStatusIcon(status: string) {
  const iconProps = { size: 16, className: 'flex-shrink-0' }
  switch (status) {
    case 'available':
      return <CheckCircle {...iconProps} className="text-green-500" />
    case 'reserved':
      return <Clock {...iconProps} className="text-yellow-500" />
    case 'sold':
      return <Package {...iconProps} className="text-blue-500" />
    case 'returned':
      return <RotateCcw {...iconProps} className="text-purple-500" />
    case 'defective':
      return <AlertTriangle {...iconProps} className="text-red-500" />
    case 'scrapped':
      return <Trash2 {...iconProps} className="text-gray-500" />
    case 'lost':
      return <XCircle {...iconProps} className="text-orange-500" />
    default:
      return <Hash {...iconProps} className="text-gray-400" />
  }
}

function getStatusCardStyle(status: string) {
  const styles: Record<string, string> = {
    available:
      'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
    reserved:
      'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800',
    sold: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
    returned:
      'bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800',
    defective:
      'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
    scrapped:
      'bg-gray-50 border-gray-200 dark:bg-gray-800/50 dark:border-gray-700',
    lost: 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800',
  }
  return styles[status] || 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
}

function getStatusCountColor(status: string) {
  const colors: Record<string, string> = {
    available: 'text-green-700 dark:text-green-400',
    reserved: 'text-yellow-700 dark:text-yellow-400',
    sold: 'text-blue-700 dark:text-blue-400',
    returned: 'text-purple-700 dark:text-purple-400',
    defective: 'text-red-700 dark:text-red-400',
    scrapped: 'text-gray-700 dark:text-gray-400',
    lost: 'text-orange-700 dark:text-orange-400',
  }
  return colors[status] || 'text-gray-700 dark:text-gray-400'
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

export default function ItemSerialNumbersPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>
}) {
  const { slug, itemId } = use(params)
  void slug // Used by layout for tenant validation
  const router = useRouter()

  // Item info
  const [item, setItem] = useState<ItemInfo | null>(null)
  const [itemLoading, setItemLoading] = useState(true)

  // Warehouses for filter + modals
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')

  // Status counts
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [totalCount, setTotalCount] = useState(0)

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [bulkInput, setBulkInput] = useState('')
  const [addWarehouseId, setAddWarehouseId] = useState('')
  const [warrantyStart, setWarrantyStart] = useState('')
  const [warrantyEnd, setWarrantyEnd] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [adding, setAdding] = useState(false)

  // Edit modal state
  const [editSerial, setEditSerial] = useState<SerialNumber | null>(null)
  const [editStatus, setEditStatus] = useState('')
  const [editWarehouseId, setEditWarehouseId] = useState('')
  const [editWarrantyStart, setEditWarrantyStart] = useState('')
  const [editWarrantyEnd, setEditWarrantyEnd] = useState('')
  const [editWarrantyNotes, setEditWarrantyNotes] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Paginated data
  const {
    data: serials,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<SerialNumber>({
    endpoint: `/api/items/${itemId}/serial-numbers`,
    entityType: 'serial-number',
    storageKey: 'item-serials-page-size',
    additionalParams: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
    },
  })

  // Fetch item details
  useEffect(() => {
    setItemLoading(true)
    fetch(`/api/items/${itemId}`)
      .then((r) => r.json())
      .then((d) => setItem(d))
      .catch(() => toast.error('Failed to load item details'))
      .finally(() => setItemLoading(false))
  }, [itemId])

  // Fetch warehouses
  useEffect(() => {
    fetch('/api/warehouses?all=true')
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.data || []
        setWarehouses(list)
      })
      .catch(() => {
        /* warehouses not critical */
      })
  }, [])

  // Fetch status counts
  const fetchStatusCounts = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/items/${itemId}/serial-numbers?all=true`
      )
      if (!res.ok) return
      const data = await res.json()
      const arr = Array.isArray(data) ? data : data.data || []
      const counts: Record<string, number> = {}
      let total = 0
      arr.forEach((s: { status: string }) => {
        counts[s.status] = (counts[s.status] || 0) + 1
        total++
      })
      setStatusCounts(counts)
      setTotalCount(total)
    } catch {
      /* non-critical */
    }
  }, [itemId])

  useEffect(() => {
    fetchStatusCounts()
  }, [fetchStatusCounts])

  // Realtime updates for status counts
  useRealtimeData(fetchStatusCounts, {
    entityType: 'serial-number',
    refreshOnMount: false,
  })

  // ============================================
  // ADD SERIAL NUMBERS
  // ============================================

  function openAddModal() {
    setBulkInput('')
    setAddWarehouseId('')
    setWarrantyStart('')
    setWarrantyEnd('')
    setAddNotes('')
    setShowAddModal(true)
  }

  async function handleBulkAdd() {
    if (!bulkInput.trim()) return
    setAdding(true)
    try {
      const res = await fetch(`/api/items/${itemId}/serial-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialNumbers: bulkInput,
          warehouseId: addWarehouseId || undefined,
          warrantyStartDate: warrantyStart || undefined,
          warrantyEndDate: warrantyEnd || undefined,
          notes: addNotes || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to add serial numbers')
        return
      }
      toast.success(`${data.count} serial number(s) added`)
      setShowAddModal(false)
      refresh()
      fetchStatusCounts()
    } catch {
      toast.error('Failed to add serial numbers')
    } finally {
      setAdding(false)
    }
  }

  // ============================================
  // EDIT SERIAL NUMBER
  // ============================================

  function openEditModal(serial: SerialNumber) {
    setEditSerial(serial)
    setEditStatus(serial.status)
    setEditWarehouseId(serial.warehouseId || '')
    setEditWarrantyStart(serial.warrantyStartDate || '')
    setEditWarrantyEnd(serial.warrantyEndDate || '')
    setEditWarrantyNotes(serial.warrantyNotes || '')
    setEditNotes(serial.notes || '')
  }

  async function handleSaveEdit() {
    if (!editSerial) return
    setSaving(true)
    try {
      const res = await fetch(`/api/serial-numbers/${editSerial.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus || undefined,
          warehouseId: editWarehouseId || null,
          warrantyStartDate: editWarrantyStart || null,
          warrantyEndDate: editWarrantyEnd || null,
          warrantyNotes: editWarrantyNotes || null,
          notes: editNotes || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to update serial number')
        return
      }
      toast.success('Serial number updated')
      setEditSerial(null)
      refresh()
      fetchStatusCounts()
    } catch {
      toast.error('Failed to update serial number')
    } finally {
      setSaving(false)
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '-'
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  function isWarrantyExpired(endDate: string | null) {
    if (!endDate) return false
    return new Date(endDate) < new Date()
  }

  function isWarrantyExpiringSoon(endDate: string | null) {
    if (!endDate) return false
    const end = new Date(endDate)
    const now = new Date()
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    return end >= now && end <= thirtyDays
  }

  // ============================================
  // LOADING STATE
  // ============================================

  if (itemLoading) {
    return <PageLoading text="Loading item details..." />
  }

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => router.back()}
            className="mt-0.5 p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Serial Numbers
            </h1>
            {item && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {item.name}
                {item.sku && (
                  <span className="ml-2 text-gray-400 dark:text-gray-500">
                    SKU: {item.sku}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={openAddModal}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors self-start sm:self-auto"
        >
          <Plus size={16} />
          Add Serial Numbers
        </button>
      </div>

      {/* Status Summary Cards */}
      {totalCount > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {STATUS_OPTIONS.map((status) => {
            const count = statusCounts[status] || 0
            return (
              <button
                key={status}
                onClick={() => {
                  if (statusFilter === status) {
                    setStatusFilter('')
                  } else {
                    setStatusFilter(status)
                  }
                  setPage(1)
                }}
                className={`p-3 rounded border transition-all text-left ${getStatusCardStyle(status)} ${
                  statusFilter === status
                    ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-900'
                    : 'hover:shadow-sm'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {getStatusIcon(status)}
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400 capitalize">
                    {status}
                  </span>
                </div>
                <div
                  className={`text-lg font-bold ${getStatusCountColor(status)}`}
                >
                  {count}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by serial number..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setPage(1)
          }}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        {/* Warehouse filter */}
        <select
          value={warehouseFilter}
          onChange={(e) => {
            setWarehouseFilter(e.target.value)
            setPage(1)
          }}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>

        {/* Refresh button */}
        <button
          onClick={() => {
            refresh()
            fetchStatusCounts()
          }}
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Active filters indicator */}
      {(statusFilter || warehouseFilter) && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            Filtered by:
          </span>
          {statusFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-medium">
              Status: {statusFilter}
              <button
                onClick={() => {
                  setStatusFilter('')
                  setPage(1)
                }}
                className="ml-0.5 hover:text-blue-900 dark:hover:text-blue-200"
                aria-label="Clear status filter"
              >
                <XCircle size={12} />
              </button>
            </span>
          )}
          {warehouseFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-medium">
              Warehouse:{' '}
              {warehouses.find((w) => w.id === warehouseFilter)?.name || '...'}
              <button
                onClick={() => {
                  setWarehouseFilter('')
                  setPage(1)
                }}
                className="ml-0.5 hover:text-blue-900 dark:hover:text-blue-200"
                aria-label="Clear warehouse filter"
              >
                <XCircle size={12} />
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setStatusFilter('')
              setWarehouseFilter('')
              setPage(1)
            }}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Serial Numbers Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">
            Serial numbers for {item?.name || 'item'}
          </caption>
          <thead className="bg-gray-50 dark:bg-gray-700/50 table-sticky-header">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                Serial Number
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                Status
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                Warehouse
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                Warranty Expiry
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                Notes
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                Created
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && serials.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
                >
                  <RefreshCw
                    size={24}
                    className="animate-spin mx-auto mb-2 text-blue-500"
                  />
                  Loading serial numbers...
                </td>
              </tr>
            ) : serials.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
                >
                  <Hash
                    size={32}
                    className="mx-auto mb-2 text-gray-300 dark:text-gray-600"
                  />
                  {search || statusFilter || warehouseFilter
                    ? 'No serial numbers match your filters'
                    : 'No serial numbers yet. Add your first serial numbers!'}
                </td>
              </tr>
            ) : (
              serials.map((serial) => (
                <tr
                  key={serial.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Hash
                        size={14}
                        className="text-gray-400 dark:text-gray-500 flex-shrink-0"
                      />
                      <span className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                        {serial.serialNumber}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {getStatusBadge(serial.status)}
                  </td>
                  <td className="px-4 py-3">
                    {serial.warehouseName ? (
                      <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                        <MapPin size={14} className="flex-shrink-0" />
                        {serial.warehouseName}
                      </div>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">
                        -
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {serial.warrantyEndDate ? (
                      <div className="flex items-center gap-1.5 text-sm">
                        {isWarrantyExpired(serial.warrantyEndDate) ? (
                          <span className="text-red-600 dark:text-red-400 font-medium">
                            Expired {formatDate(serial.warrantyEndDate)}
                          </span>
                        ) : isWarrantyExpiringSoon(serial.warrantyEndDate) ? (
                          <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                            {formatDate(serial.warrantyEndDate)}
                          </span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400">
                            {formatDate(serial.warrantyEndDate)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">
                        -
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-[200px] block">
                      {serial.notes || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formatDate(serial.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEditModal(serial)}
                      aria-label={`Edit serial number ${serial.serialNumber}`}
                      className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))
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
          className="border-t border-gray-200 dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>

      {/* ============================================ */}
      {/* ADD SERIAL NUMBERS MODAL */}
      {/* ============================================ */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={
          <span className="flex items-center gap-2">
            <Plus size={18} className="text-blue-600" />
            Add Serial Numbers
          </span>
        }
        size="lg"
      >
        <div className="space-y-4">
          {/* Bulk input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Serial Numbers <span className="text-red-500">*</span>
            </label>
            <textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={
                'Enter serial numbers, one per line or comma-separated.\nRanges are also supported: SN-001..SN-010'
              }
              rows={6}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Supports one per line, comma-separated, or ranges (e.g.
              SN-001..SN-010). Max 1000 at once.
            </p>
          </div>

          {/* Warehouse */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Warehouse
            </label>
            <select
              value={addWarehouseId}
              onChange={(e) => setAddWarehouseId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- No Warehouse --</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Warranty dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Calendar size={14} className="inline mr-1" />
                Warranty Start
              </label>
              <input
                type="date"
                value={warrantyStart}
                onChange={(e) => setWarrantyStart(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Shield size={14} className="inline mr-1" />
                Warranty End
              </label>
              <input
                type="date"
                value={warrantyEnd}
                onChange={(e) => setWarrantyEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes
            </label>
            <input
              type="text"
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="Optional notes for all serial numbers..."
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Add modal footer */}
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setShowAddModal(false)}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleBulkAdd}
            disabled={adding || !bulkInput.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding && (
              <RefreshCw size={14} className="animate-spin" />
            )}
            {adding ? 'Adding...' : 'Add Serial Numbers'}
          </button>
        </div>
      </Modal>

      {/* ============================================ */}
      {/* EDIT SERIAL NUMBER MODAL */}
      {/* ============================================ */}
      <Modal
        isOpen={!!editSerial}
        onClose={() => setEditSerial(null)}
        title={
          <span className="flex items-center gap-2">
            <Hash size={18} className="text-blue-600" />
            Edit Serial Number
          </span>
        }
        size="lg"
      >
        {editSerial && (
          <>
            <div className="space-y-4">
              {/* Serial Number (read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Serial Number
                </label>
                <div className="px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md text-gray-900 dark:text-white">
                  {editSerial.serialNumber}
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Warehouse */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Warehouse
                </label>
                <select
                  value={editWarehouseId}
                  onChange={(e) => setEditWarehouseId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">-- No Warehouse --</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Warranty dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Calendar size={14} className="inline mr-1" />
                    Warranty Start
                  </label>
                  <input
                    type="date"
                    value={editWarrantyStart}
                    onChange={(e) =>
                      setEditWarrantyStart(e.target.value)
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Shield size={14} className="inline mr-1" />
                    Warranty End
                  </label>
                  <input
                    type="date"
                    value={editWarrantyEnd}
                    onChange={(e) =>
                      setEditWarrantyEnd(e.target.value)
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Warranty Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Warranty Notes
                </label>
                <input
                  type="text"
                  value={editWarrantyNotes}
                  onChange={(e) =>
                    setEditWarrantyNotes(e.target.value)
                  }
                  placeholder="Warranty details or terms..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Notes
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Additional notes..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Edit modal footer */}
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setEditSerial(null)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving && (
                  <RefreshCw size={14} className="animate-spin" />
                )}
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
