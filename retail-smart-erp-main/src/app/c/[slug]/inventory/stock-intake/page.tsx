'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, ChevronRight, Plus, FileInput, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePaginatedData, usePermission } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils/date-format'
import { INTAKE_STATUS_CONFIG as intakeStatusConfig } from '@/lib/inventory/stock-intake-status'

interface IntakeBatch {
  id: string
  batchNo: string
  warehouseId: string
  warehouseName: string | null
  status: string
  source: string
  notes: string | null
  totalLines: number
  postedLines: number
  errorLines: number
  createdByName: string | null
  createdAt: string
  postedAt: string | null
}

interface WarehouseOption {
  id: string
  name: string
}

const inputCls = 'border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

export default function StockIntakeListPage() {
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const canSubmit = usePermission('submitStockIntake')
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [mine, setMine] = useState(false)
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [createWarehouseId, setCreateWarehouseId] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [createUpdateCost, setCreateUpdateCost] = useState(false)
  const [creating, setCreating] = useState(false)

  const { data: batches, pagination, loading, setPage, setPageSize } = usePaginatedData<IntakeBatch>({
    endpoint: '/api/stock-intake',
    entityType: 'stock-intake',
    storageKey: 'stock-intake-page-size',
    additionalParams: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
      ...(mine ? { mine: 'true' } : {}),
    },
  })

  useEffect(() => {
    let alive = true
    fetch('/api/warehouses?all=true')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!alive) return
        const list: WarehouseOption[] = Array.isArray(d) ? d : d.data || []
        setWarehouses(list)
        if (list.length === 1) setCreateWarehouseId(list[0].id)
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  async function handleCreate() {
    if (!createWarehouseId) {
      toast.error('Select a branch')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/stock-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: createWarehouseId,
          notes: createNotes || undefined,
          updateCost: createUpdateCost,
          clientBatchId: crypto.randomUUID(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Failed to create batch')
        return
      }
      toast.success(`Batch ${data.batchNo} created`)
      router.push(`/c/${tenantSlug}/inventory/stock-intake/${data.id}`)
    } catch {
      toast.error('Error creating batch')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400"><Home size={14} /></Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/stock`} className="hover:text-blue-600 dark:hover:text-blue-400">Stock</Link>
        <ChevronRight size={14} />
        <span>Stock Intake</span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded">
            <FileInput size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Stock Intake</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Scan deliveries or counts into a batch, review, then sync into stock</p>
          </div>
        </div>
        {canSubmit && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            <Plus size={16} />
            New Batch
          </button>
        )}
      </div>

      {showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">New Intake Batch</h3>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="w-64">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Branch / warehouse</label>
              <select value={createWarehouseId} onChange={(e) => setCreateWarehouseId(e.target.value)} className={`w-full ${inputCls}`}>
                <option value="">Select branch...</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</label>
              <input value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} placeholder="Supplier delivery, invoice no..." className={`w-full ${inputCls}`} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2">
              <input type="checkbox" checked={createUpdateCost} onChange={(e) => setCreateUpdateCost(e.target.checked)} />
              Update cost prices
            </label>
            <button
              onClick={handleCreate}
              disabled={creating || !createWarehouseId}
              className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <FileInput size={16} />}
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
          <option value="">All statuses</option>
          {Object.entries(intakeStatusConfig).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
        </select>
        <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className={inputCls}>
          <option value="">All branches</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Only mine
        </label>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Batch</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Branch</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Lines</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Source</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading && batches.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500"><Loader2 size={20} className="animate-spin mx-auto" /></td></tr>
              ) : batches.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No intake batches yet</td></tr>
              ) : batches.map((b) => {
                const st = intakeStatusConfig[b.status] || intakeStatusConfig.draft
                return (
                  <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onClick={() => router.push(`/c/${tenantSlug}/inventory/stock-intake/${b.id}`)}>
                    <td className="px-4 py-3">
                      <span className="text-blue-600 dark:text-blue-400 font-medium">{b.batchNo}</span>
                      {b.notes && <span className="block text-xs text-gray-400 truncate max-w-xs">{b.notes}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-white">{b.warehouseName || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      <span className="text-gray-900 dark:text-white">{b.postedLines}/{b.totalLines} posted</span>
                      {b.errorLines > 0 && <span className="block text-red-600">{b.errorLines} error(s)</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 capitalize">{b.source}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(b.createdAt)}
                      {b.createdByName && <span className="block text-gray-400">{b.createdByName}</span>}
                    </td>
                  </tr>
                )
              })}
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
