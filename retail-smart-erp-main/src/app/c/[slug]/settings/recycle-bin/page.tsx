'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Home, RotateCcw, Search, Trash2, Loader2, ShieldCheck } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

interface RecycleRow {
  id: string
  entity_type: string
  entity_table: string
  entity_id: string
  display_name: string
  label: string
  mode: 'archive' | 'delete'
  status: 'open' | 'restored' | 'purged'
  deleted_by_name: string | null
  deleted_at: string
  restored_at: string | null
}

interface RecycleResponse {
  rows: RecycleRow[]
  total: number
  page: number
  pageSize: number
  openByType: Array<{ type: string; label: string; count: number }>
  types: Array<{ type: string; label: string; mode: string }>
}

export default function VendorRecycleBinPage() {
  const { tenantSlug } = useCompany()
  const [status, setStatus] = useState<'open' | 'restored' | 'all'>('open')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])
  const [data, setData] = useState<RecycleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: '25',
      })
      if (typeFilter) params.set('type', typeFilter)
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())

      const res = await fetch(`/api/recycle-bin?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load recycle bin')
      }
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recycle bin')
    } finally {
      setLoading(false)
    }
  }, [status, typeFilter, debouncedSearch, page])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRestore(row: RecycleRow) {
    setRestoringId(row.id)
    try {
      const res = await fetch(`/api/recycle-bin/${row.id}/restore`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Could not restore item')
      }
      toast.success(`"${row.display_name}" restored successfully`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to restore item')
    } finally {
      setRestoringId(null)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <Link href={`/c/${tenantSlug}`} className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/settings`} className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
          Settings
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">Recycle Bin</span>
      </nav>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Trash2 size={22} className="text-rose-600 dark:text-rose-400" />
            Recycle Bin
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View and safely restore deleted items, categories, customers, and records.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
          <ShieldCheck size={16} className="shrink-0" />
          <span>Data protection active — permanent deletion is disabled for store accounts.</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-900">
          {([
            { key: 'open', label: 'Deleted' },
            { key: 'restored', label: 'Restored' },
            { key: 'all', label: 'All' },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => { setStatus(tab.key); setPage(1) }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                status === tab.key
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter by record type"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="">All types</option>
          {(data?.types ?? []).map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by item name or user..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {error ? (
          <div className="p-6 text-center text-sm text-red-600 dark:text-red-400">
            <p>{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : loading && !data ? (
          <div className="p-10 flex justify-center text-gray-500">
            <Loader2 className="animate-spin w-6 h-6" />
          </div>
        ) : (data?.rows.length ?? 0) === 0 ? (
          <div className="p-10 text-center text-gray-500 dark:text-gray-400">
            <Trash2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">No deleted records found</p>
            <p className="text-xs mt-1">Deleted items and records will appear here so you can restore them anytime.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Deleted By</th>
                  <th className="px-4 py-3">Deleted On</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data!.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{row.display_name}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{row.label}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.deleted_by_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {new Date(row.deleted_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.status === 'open'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                            : row.status === 'restored'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {row.status === 'open' ? 'In Recycle Bin' : row.status === 'restored' ? 'Restored' : 'Purged'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === 'open' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={restoringId === row.id}
                          onClick={() => void handleRestore(row)}
                        >
                          {restoringId === row.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          )}
                          Restore
                        </Button>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {row.restored_at ? `Restored ${new Date(row.restored_at).toLocaleDateString()}` : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500">
            <span>Page {page} of {totalPages} ({data?.total ?? 0} total)</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
