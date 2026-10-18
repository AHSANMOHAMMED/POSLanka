'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, ChevronRight, Plus, ClipboardCheck, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils/date-format'

interface StockTake {
  id: string
  countNo: string
  warehouseId: string
  warehouseName: string | null
  status: string
  countType: string
  totalItems: number
  itemsCounted: number
  varianceCount: number
  totalVarianceValue: string
  createdByName: string | null
  createdAt: string
  completedAt: string | null
}

interface WarehouseOption {
  id: string
  name: string
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
  in_progress: { label: 'In Progress', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  pending_review: { label: 'Pending Review', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  completed: { label: 'Completed', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700' },
}

export default function StockTakesPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [warehouseFilter, _setWarehouseFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createWarehouseId, setCreateWarehouseId] = useState('')

  const {
    data: stockTakes,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: _refresh,
  } = usePaginatedData<StockTake>({
    endpoint: '/api/stock-takes',
    entityType: 'stock-take',
    storageKey: 'stock-takes-page-size',
    additionalParams: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
    },
  })

  // Fetch warehouses for filter and create form
  const fetchWarehouses = useCallback(async () => {
    const res = await fetch('/api/warehouses?all=true')
    if (res.ok) {
      const data = await res.json()
      setWarehouses(Array.isArray(data) ? data : data.data || [])
    }
  }, [])

  useState(() => { fetchWarehouses() })

  async function handleCreate() {
    if (!createWarehouseId) {
      toast.error('Please select a warehouse')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/stock-takes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId: createWarehouseId }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Stock take ${data.countNo} created`)
        router.push(`/c/${tenantSlug}/stock-takes/${data.id}`)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create stock take')
      }
    } catch {
      toast.error('Error creating stock take')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400"><Home size={14} /></Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/stock`} className="hover:text-blue-600 dark:hover:text-blue-400">Stock</Link>
        <ChevronRight size={14} />
        <span>Stock Takes</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded">
            <ClipboardCheck size={20} className="text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Stock Takes</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Physical inventory counts and reconciliation</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          <Plus size={16} />
          New Stock Take
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">New Stock Take</h3>
          <div className="flex items-end gap-4">
            <div className="flex-1 max-w-xs">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Warehouse</label>
              <select
                value={createWarehouseId}
                onChange={(e) => setCreateWarehouseId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select warehouse...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !createWarehouseId}
              className="px-4 py-2 bg-teal-600 text-white rounded text-sm hover:bg-teal-700 disabled:opacity-50 flex items-center gap-2"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
              Create
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by count number..."
          className="flex-1 max-w-xs border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">All Statuses</option>
          {Object.entries(statusConfig).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Count No</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Warehouse</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Progress</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Variance</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading && stockTakes.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500"><Loader2 size={20} className="animate-spin mx-auto" /></td></tr>
              ) : stockTakes.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No stock takes found</td></tr>
              ) : (
                stockTakes.map((st) => {
                  const status = statusConfig[st.status] || statusConfig.draft
                  const progress = st.totalItems > 0 ? Math.round((st.itemsCounted / st.totalItems) * 100) : 0
                  return (
                    <tr key={st.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onClick={() => router.push(`/c/${tenantSlug}/stock-takes/${st.id}`)}>
                      <td className="px-4 py-3">
                        <span className="text-blue-600 dark:text-blue-400 font-medium">{st.countNo}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white">{st.warehouseName || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>{status.label}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-20 bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                            <div className="bg-teal-500 h-1.5 rounded-full" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{st.itemsCounted}/{st.totalItems}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {st.varianceCount > 0 ? (
                          <span className="text-orange-600 dark:text-orange-400 text-xs">{st.varianceCount} items</span>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(st.createdAt)}
                        {st.createdByName && <span className="block text-gray-400">{st.createdByName}</span>}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
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
    </div>
  )
}
