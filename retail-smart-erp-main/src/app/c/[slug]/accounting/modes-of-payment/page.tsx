'use client'

import { useState, useEffect } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CreditCard,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { ConfirmModal } from '@/components/ui/confirm-modal'

interface ModeOfPayment {
  id: string
  name: string
  type: 'cash' | 'bank' | 'general'
  defaultAccountId: string | null
  isEnabled: boolean
  sortOrder: number
  createdAt: string
  account?: { id: string; name: string; accountNumber: string } | null
}

interface Account {
  id: string
  accountNumber: string
  name: string
}

const emptyForm = {
  name: '',
  type: 'cash' as 'cash' | 'bank' | 'general',
  defaultAccountId: '',
  isEnabled: true,
  sortOrder: 0,
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

export default function ModesOfPaymentPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingMode, setEditingMode] = useState<ModeOfPayment | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteMode, setDeleteMode] = useState<ModeOfPayment | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])

  const {
    data: modes,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<ModeOfPayment>({
    endpoint: '/api/accounting/modes-of-payment',
    entityType: 'mode-of-payment',
    storageKey: 'modes-of-payment-page-size',
  })

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch('/api/accounting/accounts?all=true')
        if (res.ok) {
          const data = await res.json()
          const list = Array.isArray(data) ? data : data.data || []
          setAccounts(list.filter((a: { isGroup?: boolean }) => !a.isGroup))
        }
      } catch { /* silent */ }
    }
    fetchAccounts()
  }, [])

  function handleAdd() {
    setEditingMode(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function handleEdit(mode: ModeOfPayment) {
    setEditingMode(mode)
    setForm({
      name: mode.name,
      type: mode.type,
      defaultAccountId: mode.defaultAccountId || '',
      isEnabled: mode.isEnabled,
      sortOrder: mode.sortOrder,
    })
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingMode(null)
    setForm(emptyForm)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }

    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        type: form.type,
        defaultAccountId: form.defaultAccountId || null,
        isEnabled: form.isEnabled,
        sortOrder: form.sortOrder,
      }

      const url = editingMode
        ? `/api/accounting/modes-of-payment/${editingMode.id}`
        : '/api/accounting/modes-of-payment'
      const method = editingMode ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(editingMode ? 'Mode of payment updated' : 'Mode of payment created')
        handleCloseModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save')
      }
    } catch {
      toast.error('Error saving mode of payment')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteMode) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/accounting/modes-of-payment/${deleteMode.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Mode of payment deleted')
        setDeleteMode(null)
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete')
      }
    } catch {
      toast.error('Error deleting mode of payment')
    } finally {
      setDeleting(false)
    }
  }

  if (loading && modes.length === 0) {
    return <PageLoading text="Loading modes of payment..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Modes of Payment"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search modes..."
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Mode
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Modes of Payment</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Name</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Type</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Default Account</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {modes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <CreditCard size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No modes of payment found. Add your first mode to get started.</p>
                  </div>
                </td>
              </tr>
            ) : (
              modes.map((mode) => (
                <tr
                  key={mode.id}
                  onClick={() => handleEdit(mode)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900 dark:text-white text-sm">{mode.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 capitalize">
                      {mode.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {mode.account ? `${mode.account.accountNumber} - ${mode.account.name}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={mode.isEnabled ? 'active' : 'inactive'} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleEdit(mode)}
                        className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteMode(mode)}
                        className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      >
                        <Trash2 size={16} />
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

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingMode ? 'Edit Mode of Payment' : 'Add Mode of Payment'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Cash, Bank Transfer"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type *</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as 'cash' | 'bank' | 'general' })}
                  className={selectClass}
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="general">General</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default Account</label>
                <select
                  value={form.defaultAccountId}
                  onChange={(e) => setForm({ ...form, defaultAccountId: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Select account</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountNumber} - {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                  className={inputClass}
                  min="0"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isEnabled"
                  checked={form.isEnabled}
                  onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isEnabled" className="text-sm text-gray-700 dark:text-gray-300">Enabled</label>
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
                  {editingMode ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteMode}
        onClose={() => setDeleteMode(null)}
        onConfirm={handleDelete}
        title="Delete Mode of Payment"
        message={`Are you sure you want to delete "${deleteMode?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
