'use client'

import { useState } from 'react'
import {
  Plus,
  Loader2,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination } from '@/components/ui'

interface DunningType {
  id: string
  name: string
  startDay: number
  endDay: number
  dunningFee: string
  interestRate: string
  bodyText: string | null
  isActive: boolean
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

const initialForm = {
  name: '',
  startDay: 0,
  endDay: 30,
  dunningFee: '0',
  interestRate: '0',
  bodyText: '',
  isActive: true,
}

export default function DunningTypesPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const {
    data: types,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<DunningType>({
    endpoint: '/api/accounting/dunning-types',
    entityType: 'dunning-type',
    storageKey: 'dunning-types-page-size',
  })

  function openCreate() {
    setEditingId(null)
    setForm(initialForm)
    setShowModal(true)
  }

  function openEdit(dt: DunningType) {
    setEditingId(dt.id)
    setForm({
      name: dt.name,
      startDay: dt.startDay,
      endDay: dt.endDay,
      dunningFee: dt.dunningFee,
      interestRate: dt.interestRate,
      bodyText: dt.bodyText || '',
      isActive: dt.isActive,
    })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }

    setSaving(true)
    try {
      const url = editingId
        ? `/api/accounting/dunning-types/${editingId}`
        : '/api/accounting/dunning-types'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          startDay: Number(form.startDay),
          endDay: Number(form.endDay),
          dunningFee: Number(form.dunningFee),
          interestRate: Number(form.interestRate),
        }),
      })

      if (res.ok) {
        toast.success(editingId ? 'Dunning type updated' : 'Dunning type created')
        setShowModal(false)
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save')
      }
    } catch {
      toast.error('Error saving dunning type')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this dunning type?')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/accounting/dunning-types/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Dunning type deleted')
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete')
      }
    } catch {
      toast.error('Error deleting')
    } finally {
      setDeleting(null)
    }
  }

  if (loading && types.length === 0) {
    return <PageLoading text="Loading dunning types..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Dunning Types"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search dunning types..."
      actionContent={
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Dunning Type
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Dunning Types</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Name</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Day Range</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Fee</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Interest Rate (%)</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Active</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {types.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <AlertTriangle size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No dunning types found. Create one to get started.</p>
                  </div>
                </td>
              </tr>
            ) : (
              types.map((dt) => (
                <tr key={dt.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{dt.name}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-600 dark:text-gray-400">
                    Day {dt.startDay} - {dt.endDay}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">
                    {Number(dt.dunningFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">
                    {Number(dt.interestRate).toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${dt.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(dt)}
                        className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                        title="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(dt.id)}
                        disabled={deleting === dt.id}
                        className="p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        {deleting === dt.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
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
          className="border-t dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingId ? 'Edit Dunning Type' : 'New Dunning Type'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="e.g., First Reminder, Final Notice"
                  autoFocus
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Day (after due)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.startDay}
                    onChange={(e) => setForm({ ...form, startDay: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Day (after due)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.endDay}
                    onChange={(e) => setForm({ ...form, endDay: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dunning Fee</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.dunningFee}
                    onChange={(e) => setForm({ ...form, dunningFee: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Interest Rate (% p.a.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.interestRate}
                    onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email Body Text</label>
                <textarea
                  value={form.bodyText}
                  onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
                  rows={3}
                  className={inputClass}
                  placeholder="Email template text for this dunning level..."
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Active</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ListPageLayout>
  )
}
