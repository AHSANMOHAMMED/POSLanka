'use client'

// H5: units of measure (pcs, kg, box …) used by item unit conversions and price lists.
import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Ruler } from 'lucide-react'
import { StatusBadge, EmptyState } from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface UnitRow { id: string; code: string; name: string; allowFraction: boolean; isActive: boolean; inUse: number }

const cell = 'px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white'

export default function UnitsPage() {
  const [rows, setRows] = useState<UnitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({ code: '', name: '', allowFraction: false })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/units')
      setRows(res.ok ? await res.json() : [])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.details?.[0]?.message || data.error || 'Failed to add unit'); return }
    setDraft({ code: '', name: '', allowFraction: false })
    load()
  }

  async function patch(u: UnitRow, body: Partial<UnitRow>) {
    const res = await fetch(`/api/units/${u.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) toast.error('Failed to update unit')
    load()
  }

  async function remove(u: UnitRow) {
    if (!confirm(`Move unit "${u.code}" to the recycle bin? Only the platform administrator can restore it.`)) return
    const res = await fetch(`/api/units/${u.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(data.error || 'Failed to delete unit')
    else toast.success('Unit moved to recycle bin')
    load()
  }

  if (loading && rows.length === 0) return <PageLoading text="Loading units..." />

  return (
    <ListPageLayout module="Stock" moduleHref="/stock" title="Units of Measure" onRefresh={load}>
      <form onSubmit={add} className="mb-3 flex flex-wrap items-end gap-2">
        <input className={`${cell} w-28`} placeholder="Code (e.g. crate)" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} required maxLength={20} />
        <input className={`${cell} w-48`} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={50} />
        <label className="flex items-center gap-1 text-sm dark:text-gray-300">
          <input type="checkbox" checked={draft.allowFraction} onChange={(e) => setDraft({ ...draft, allowFraction: e.target.checked })} /> Decimals allowed
        </label>
        <button type="submit" className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700">
          <Plus size={14} /> Add unit
        </button>
      </form>
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              <th className="px-4 py-2 text-left">Code</th><th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-center">Decimals</th><th className="px-4 py-2 text-center">Conversions</th>
              <th className="px-4 py-2 text-center">Status</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {rows.length === 0 ? (
              <tr><td colSpan={6}><EmptyState icon={<Ruler size={24} />} title="No units" description="Add the units you sell in." /></td></tr>
            ) : rows.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-mono text-sm dark:text-white">{u.code}</td>
                <td className="px-4 py-2 text-sm dark:text-gray-300">{u.name}</td>
                <td className="px-4 py-2 text-center"><input type="checkbox" checked={u.allowFraction} onChange={(e) => patch(u, { allowFraction: e.target.checked })} /></td>
                <td className="px-4 py-2 text-center text-sm">{u.inUse}</td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => patch(u, { isActive: !u.isActive })} title="Toggle"><StatusBadge status={u.isActive ? 'active' : 'inactive'} size="sm" /></button>
                </td>
                <td className="px-4 py-2 text-right">
                  <button aria-label={`Move ${u.code} to recycle bin`} onClick={() => remove(u)} className="p-1.5 text-gray-500 hover:text-red-600"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListPageLayout>
  )
}
