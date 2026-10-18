'use client'

import { useState } from 'react'
import { Plus, Loader2, Pencil, Trash2, Lock, LockOpen } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { ConfirmModal } from '@/components/ui/confirm-modal'

interface FiscalYear {
  id: string
  name: string
  startDate: string
  endDate: string
  isClosed: boolean
  createdAt: string
}

const emptyForm = {
  name: '',
  startDate: '',
  endDate: '',
}

export default function FiscalYearsPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingFY, setEditingFY] = useState<FiscalYear | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteFY, setDeleteFY] = useState<FiscalYear | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [closingId, setClosingId] = useState<string | null>(null)

  const {
    data: fiscalYears,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<FiscalYear>({
    endpoint: '/api/accounting/fiscal-years',
    entityType: 'fiscal-year',
    storageKey: 'fiscal-years-page-size',
  })

  function handleAdd() {
    setEditingFY(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function handleEdit(fy: FiscalYear) {
    setEditingFY(fy)
    setForm({
      name: fy.name,
      startDate: fy.startDate.slice(0, 10),
      endDate: fy.endDate.slice(0, 10),
    })
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingFY(null)
    setForm(emptyForm)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.startDate || !form.endDate) {
      toast.error('All fields are required')
      return
    }

    if (new Date(form.endDate) <= new Date(form.startDate)) {
      toast.error('End date must be after start date')
      return
    }

    setSaving(true)
    try {
      const url = editingFY
        ? `/api/accounting/fiscal-years/${editingFY.id}`
        : '/api/accounting/fiscal-years'
      const method = editingFY ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
        }),
      })

      if (res.ok) {
        toast.success(editingFY ? 'Fiscal year updated' : 'Fiscal year created')
        handleCloseModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save fiscal year')
      }
    } catch {
      toast.error('Error saving fiscal year')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleClose(fy: FiscalYear) {
    setClosingId(fy.id)
    try {
      const res = await fetch(`/api/accounting/fiscal-years/${fy.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isClosed: !fy.isClosed }),
      })
      if (res.ok) {
        toast.success(fy.isClosed ? 'Fiscal year reopened' : 'Fiscal year closed')
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update fiscal year')
      }
    } catch {
      toast.error('Error updating fiscal year')
    } finally {
      setClosingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteFY) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/accounting/fiscal-years/${deleteFY.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Fiscal year deleted')
        setDeleteFY(null)
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete fiscal year')
      }
    } catch {
      toast.error('Error deleting fiscal year')
    } finally {
      setDeleting(false)
    }
  }

  if (loading && fiscalYears.length === 0) {
    return <PageLoading text="Loading fiscal years..." />
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Fiscal Years"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search fiscal years..."
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Fiscal Year
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of fiscal years</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Start Date
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                End Date
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {fiscalYears.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No fiscal years match your search' : 'No fiscal years yet. Add your first fiscal year.'}
                </td>
              </tr>
            ) : (
              fiscalYears.map((fy) => (
                <tr
                  key={fy.id}
                  className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => handleEdit(fy)}
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900 dark:text-white">{fy.name}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {new Date(fy.startDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {new Date(fy.endDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={fy.isClosed ? 'closed' : 'active'} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleEdit(fy)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                        aria-label={`Edit ${fy.name}`}
                        title="Edit"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleToggleClose(fy)}
                        disabled={closingId === fy.id}
                        className={`p-1.5 rounded transition-colors ${
                          fy.isClosed
                            ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                            : 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                        }`}
                        aria-label={fy.isClosed ? `Reopen ${fy.name}` : `Close ${fy.name}`}
                        title={fy.isClosed ? 'Reopen' : 'Close'}
                      >
                        {closingId === fy.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : fy.isClosed ? (
                          <LockOpen size={15} />
                        ) : (
                          <Lock size={15} />
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteFY(fy)}
                        className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        aria-label={`Delete ${fy.name}`}
                        title="Delete"
                      >
                        <Trash2 size={15} />
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
          className="border-t px-4"
        />
      </div>

      {/* Add/Edit Fiscal Year Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingFY ? 'Edit Fiscal Year' : 'Add Fiscal Year'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. FY 2025-2026"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className={inputClass}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  End Date *
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className={inputClass}
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {editingFY ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmModal
        isOpen={!!deleteFY}
        onClose={() => setDeleteFY(null)}
        onConfirm={handleDelete}
        title="Delete Fiscal Year"
        message={`Are you sure you want to delete "${deleteFY?.name}"? This cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
