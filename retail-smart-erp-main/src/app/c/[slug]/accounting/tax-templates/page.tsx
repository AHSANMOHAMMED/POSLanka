'use client'

import { useState, useEffect } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Receipt,
  X,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { ConfirmModal } from '@/components/ui/confirm-modal'

interface TaxTemplateItem {
  id?: string
  taxName: string
  rate: string
  accountId: string | null
  includedInPrice: boolean
}

interface TaxTemplate {
  id: string
  name: string
  isActive: boolean
  items?: TaxTemplateItem[]
  createdAt: string
  updatedAt: string
}

interface Account {
  id: string
  accountNumber: string
  name: string
  rootType: string
  accountType: string
}

const emptyItem: TaxTemplateItem = {
  taxName: '',
  rate: '',
  accountId: null,
  includedInPrice: false,
}

const emptyForm = {
  name: '',
  isActive: true,
  items: [{ ...emptyItem }] as TaxTemplateItem[],
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

export default function TaxTemplatesPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TaxTemplate | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteTemplate, setDeleteTemplate] = useState<TaxTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])

  const {
    data: templates,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<TaxTemplate>({
    endpoint: '/api/accounting/tax-templates',
    entityType: 'tax-template',
    storageKey: 'tax-templates-page-size',
  })

  // Fetch accounts for the dropdown
  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch('/api/accounting/accounts?all=true')
        if (res.ok) {
          const data = await res.json()
          const list = Array.isArray(data) ? data : data.data || []
          setAccounts(list.filter((a: { isGroup?: boolean }) => !a.isGroup))
        }
      } catch {
        // silent fail - accounts dropdown will be empty
      }
    }
    fetchAccounts()
  }, [])

  function handleAdd() {
    setEditingTemplate(null)
    setForm({ ...emptyForm, items: [{ ...emptyItem }] })
    setShowModal(true)
  }

  function handleEdit(template: TaxTemplate) {
    setEditingTemplate(template)
    // Fetch the full template with items
    fetch(`/api/accounting/tax-templates/${template.id}`)
      .then((res) => res.json())
      .then((data) => {
        const t = data.data || data
        setForm({
          name: t.name,
          isActive: t.isActive,
          items:
            t.items && t.items.length > 0
              ? t.items.map((item: TaxTemplateItem) => ({
                  id: item.id,
                  taxName: item.taxName,
                  rate: String(item.rate),
                  accountId: item.accountId || null,
                  includedInPrice: item.includedInPrice,
                }))
              : [{ ...emptyItem }],
        })
        setShowModal(true)
      })
      .catch(() => {
        toast.error('Failed to load tax template details')
      })
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingTemplate(null)
    setForm({ ...emptyForm, items: [{ ...emptyItem }] })
  }

  function addItem() {
    setForm({ ...form, items: [...form.items, { ...emptyItem }] })
  }

  function removeItem(index: number) {
    if (form.items.length <= 1) return
    const newItems = form.items.filter((_, i) => i !== index)
    setForm({ ...form, items: newItems })
  }

  function updateItem(index: number, field: keyof TaxTemplateItem, value: string | boolean | null) {
    const newItems = [...form.items]
    newItems[index] = { ...newItems[index], [field]: value }
    setForm({ ...form, items: newItems })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Template name is required')
      return
    }

    // Validate items
    const validItems = form.items.filter((item) => item.taxName.trim() && item.rate)
    if (validItems.length === 0) {
      toast.error('At least one tax item with name and rate is required')
      return
    }

    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        isActive: form.isActive,
        items: validItems.map((item) => ({
          id: item.id,
          taxName: item.taxName.trim(),
          rate: parseFloat(item.rate),
          accountId: item.accountId || null,
          includedInPrice: item.includedInPrice,
        })),
      }

      const url = editingTemplate
        ? `/api/accounting/tax-templates/${editingTemplate.id}`
        : '/api/accounting/tax-templates'
      const method = editingTemplate ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(editingTemplate ? 'Tax template updated' : 'Tax template created')
        handleCloseModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save tax template')
      }
    } catch {
      toast.error('Error saving tax template')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTemplate) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/accounting/tax-templates/${deleteTemplate.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Tax template deleted')
        setDeleteTemplate(null)
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete tax template')
      }
    } catch {
      toast.error('Error deleting tax template')
    } finally {
      setDeleting(false)
    }
  }

  if (loading && templates.length === 0) {
    return <PageLoading text="Loading tax templates..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Tax Templates"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search tax templates..."
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Tax Template
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Tax Templates</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                Tax Items
              </th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {templates.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <Receipt size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No tax templates found. Add your first tax template to get started.</p>
                  </div>
                </td>
              </tr>
            ) : (
              templates.map((template) => (
                <tr
                  key={template.id}
                  onClick={() => handleEdit(template)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900 dark:text-white text-sm">
                      {template.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                      {template.items?.length || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={template.isActive ? 'active' : 'inactive'} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleEdit(template)}
                        aria-label={`Edit ${template.name}`}
                        className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteTemplate(template)}
                        aria-label={`Delete ${template.name}`}
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

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingTemplate ? 'Edit Tax Template' : 'Add Tax Template'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Template Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputClass}
                    placeholder="e.g. VAT 15%"
                    required
                  />
                </div>
                <div className="flex items-end">
                  <div className="flex items-center gap-2 pb-2">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={form.isActive}
                      onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="isActive" className="text-sm text-gray-700 dark:text-gray-300">
                      Active
                    </label>
                  </div>
                </div>
              </div>

              {/* Tax Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Tax Items
                  </label>
                  <button
                    type="button"
                    onClick={addItem}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                  >
                    <Plus size={14} />
                    Add Item
                  </button>
                </div>

                <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                          Tax Name *
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-24">
                          Rate (%) *
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                          Account
                        </th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 w-20">
                          Incl.
                        </th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {form.items.map((item, index) => (
                        <tr key={index} className="bg-white dark:bg-gray-800">
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={item.taxName}
                              onChange={(e) => updateItem(index, 'taxName', e.target.value)}
                              className={inputClass}
                              placeholder="e.g. VAT"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={item.rate}
                              onChange={(e) => updateItem(index, 'rate', e.target.value)}
                              className={inputClass}
                              placeholder="0.00"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={item.accountId || ''}
                              onChange={(e) => updateItem(index, 'accountId', e.target.value || null)}
                              className={selectClass}
                            >
                              <option value="">Select account</option>
                              {accounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.accountNumber} - {acc.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={item.includedInPrice}
                              onChange={(e) => updateItem(index, 'includedInPrice', e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            {form.items.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeItem(index)}
                                className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                aria-label="Remove item"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                  {editingTemplate ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmModal
        isOpen={!!deleteTemplate}
        onClose={() => setDeleteTemplate(null)}
        onConfirm={handleDelete}
        title="Delete Tax Template"
        message={`Are you sure you want to delete "${deleteTemplate?.name}"? This will also remove all associated tax items. This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
