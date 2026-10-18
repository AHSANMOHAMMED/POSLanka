'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Calendar,
  X,
  FileText,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { ConfirmModal } from '@/components/ui/confirm-modal'

interface PaymentTerm {
  id: string
  name: string
  invoicePortion: string
  dueDateBasedOn: string
  creditDays: number
  discountType: string | null
  discount: string | null
  discountValidityDays: number | null
  description: string | null
  isActive: boolean
  createdAt: string
}

interface PaymentTermsTemplate {
  id: string
  name: string
  isActive: boolean
  items?: { id: string; paymentTermId: string; sortOrder: number; paymentTerm?: PaymentTerm }[]
  createdAt: string
}

const emptyTermForm = {
  name: '',
  invoicePortion: '100',
  dueDateBasedOn: 'days_after_invoice',
  creditDays: 30,
  discountType: '',
  discount: '',
  discountValidityDays: '',
  description: '',
  isActive: true,
}

const emptyTemplateForm = {
  name: '',
  isActive: true,
  items: [] as { paymentTermId: string; sortOrder: number }[],
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

export default function PaymentTermsPage() {
  const [activeTab, setActiveTab] = useState<'terms' | 'templates'>('terms')

  // Terms state
  const [showTermModal, setShowTermModal] = useState(false)
  const [editingTerm, setEditingTerm] = useState<PaymentTerm | null>(null)
  const [termForm, setTermForm] = useState(emptyTermForm)
  const [savingTerm, setSavingTerm] = useState(false)
  const [deleteTerm, setDeleteTerm] = useState<PaymentTerm | null>(null)
  const [deletingTerm, setDeletingTerm] = useState(false)

  // Templates state
  const [templates, setTemplates] = useState<PaymentTermsTemplate[]>([])
  const [_templatesLoading, setTemplatesLoading] = useState(true)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PaymentTermsTemplate | null>(null)
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [deleteTemplate, setDeleteTemplate] = useState<PaymentTermsTemplate | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)

  // All terms for template dropdowns
  const [allTerms, setAllTerms] = useState<PaymentTerm[]>([])

  const {
    data: terms,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: refreshTerms,
  } = usePaginatedData<PaymentTerm>({
    endpoint: '/api/accounting/payment-terms',
    entityType: 'payment-term',
    storageKey: 'payment-terms-page-size',
  })

  // Fetch all terms for template selector
  useEffect(() => {
    async function fetchAllTerms() {
      try {
        const res = await fetch('/api/accounting/payment-terms?all=true')
        if (res.ok) {
          const data = await res.json()
          setAllTerms(Array.isArray(data) ? data : data.data || [])
        }
      } catch { /* silent */ }
    }
    fetchAllTerms()
  }, [terms])

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/accounting/payment-terms-templates?all=true')
      if (res.ok) {
        const data = await res.json()
        setTemplates(Array.isArray(data) ? data : data.data || [])
      }
    } catch {
      toast.error('Failed to load templates')
    } finally {
      setTemplatesLoading(false)
    }
  }, [])

  const { refresh: refreshTemplates } = useRealtimeData(fetchTemplates, { entityType: 'payment-terms-template' })

  // Term handlers
  function handleAddTerm() {
    setEditingTerm(null)
    setTermForm(emptyTermForm)
    setShowTermModal(true)
  }

  function handleEditTerm(term: PaymentTerm) {
    setEditingTerm(term)
    setTermForm({
      name: term.name,
      invoicePortion: String(term.invoicePortion),
      dueDateBasedOn: term.dueDateBasedOn,
      creditDays: term.creditDays,
      discountType: term.discountType || '',
      discount: term.discount ? String(term.discount) : '',
      discountValidityDays: term.discountValidityDays ? String(term.discountValidityDays) : '',
      description: term.description || '',
      isActive: term.isActive,
    })
    setShowTermModal(true)
  }

  async function handleSaveTerm(e: React.FormEvent) {
    e.preventDefault()
    if (!termForm.name.trim()) { toast.error('Name is required'); return }

    setSavingTerm(true)
    try {
      const body = {
        name: termForm.name.trim(),
        invoicePortion: parseFloat(termForm.invoicePortion),
        dueDateBasedOn: termForm.dueDateBasedOn,
        creditDays: termForm.creditDays,
        discountType: termForm.discountType || null,
        discount: termForm.discount ? parseFloat(termForm.discount) : null,
        discountValidityDays: termForm.discountValidityDays ? parseInt(termForm.discountValidityDays) : null,
        description: termForm.description || null,
        isActive: termForm.isActive,
      }

      const url = editingTerm ? `/api/accounting/payment-terms/${editingTerm.id}` : '/api/accounting/payment-terms'
      const res = await fetch(url, {
        method: editingTerm ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(editingTerm ? 'Payment term updated' : 'Payment term created')
        setShowTermModal(false)
        setEditingTerm(null)
        refreshTerms()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save')
      }
    } catch {
      toast.error('Error saving payment term')
    } finally {
      setSavingTerm(false)
    }
  }

  async function handleDeleteTerm() {
    if (!deleteTerm) return
    setDeletingTerm(true)
    try {
      const res = await fetch(`/api/accounting/payment-terms/${deleteTerm.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Payment term deleted')
        setDeleteTerm(null)
        refreshTerms()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete')
      }
    } catch {
      toast.error('Error deleting payment term')
    } finally {
      setDeletingTerm(false)
    }
  }

  // Template handlers
  function handleAddTemplate() {
    setEditingTemplate(null)
    setTemplateForm({ ...emptyTemplateForm, items: [{ paymentTermId: '', sortOrder: 1 }] })
    setShowTemplateModal(true)
  }

  async function handleEditTemplate(template: PaymentTermsTemplate) {
    setEditingTemplate(template)
    try {
      const res = await fetch(`/api/accounting/payment-terms-templates/${template.id}`)
      if (res.ok) {
        const data = await res.json()
        const t = data.data || data
        setTemplateForm({
          name: t.name,
          isActive: t.isActive,
          items: t.items?.length > 0
            ? t.items.map((item: { paymentTermId: string; sortOrder: number }) => ({ paymentTermId: item.paymentTermId, sortOrder: item.sortOrder }))
            : [{ paymentTermId: '', sortOrder: 1 }],
        })
        setShowTemplateModal(true)
      }
    } catch {
      toast.error('Failed to load template details')
    }
  }

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault()
    if (!templateForm.name.trim()) { toast.error('Name is required'); return }

    const validItems = templateForm.items.filter((item) => item.paymentTermId)
    if (validItems.length === 0) {
      toast.error('At least one payment term is required')
      return
    }

    setSavingTemplate(true)
    try {
      const body = {
        name: templateForm.name.trim(),
        isActive: templateForm.isActive,
        items: validItems,
      }

      const url = editingTemplate
        ? `/api/accounting/payment-terms-templates/${editingTemplate.id}`
        : '/api/accounting/payment-terms-templates'

      const res = await fetch(url, {
        method: editingTemplate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(editingTemplate ? 'Template updated' : 'Template created')
        setShowTemplateModal(false)
        setEditingTemplate(null)
        refreshTemplates()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save')
      }
    } catch {
      toast.error('Error saving template')
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleDeleteTemplate() {
    if (!deleteTemplate) return
    setDeletingTemplate(true)
    try {
      const res = await fetch(`/api/accounting/payment-terms-templates/${deleteTemplate.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Template deleted')
        setDeleteTemplate(null)
        refreshTemplates()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete')
      }
    } catch {
      toast.error('Error deleting template')
    } finally {
      setDeletingTemplate(false)
    }
  }

  if (loading && terms.length === 0) {
    return <PageLoading text="Loading payment terms..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Payment Terms"
      search={activeTab === 'terms' ? search : undefined}
      setSearch={activeTab === 'terms' ? setSearch : undefined}
      onRefresh={activeTab === 'terms' ? refreshTerms : refreshTemplates}
      searchPlaceholder="Search payment terms..."
      actionContent={
        <button
          onClick={activeTab === 'terms' ? handleAddTerm : handleAddTemplate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          {activeTab === 'terms' ? 'Add Term' : 'Add Template'}
        </button>
      }
    >
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4">
        <button
          onClick={() => setActiveTab('terms')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'terms'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          Payment Terms
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'templates'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          Templates
        </button>
      </div>

      {activeTab === 'terms' ? (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Payment Terms</caption>
            <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Name</th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Portion (%)</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Due Date Based On</th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Credit Days</th>
                <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {terms.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <Calendar size={32} className="text-gray-300 dark:text-gray-600" />
                      <p>No payment terms found. Add your first term to get started.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                terms.map((term) => (
                  <tr
                    key={term.id}
                    onClick={() => handleEditTerm(term)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white text-sm">{term.name}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">{term.invoicePortion}%</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 capitalize">
                      {term.dueDateBasedOn.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">{term.creditDays}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={term.isActive ? 'active' : 'inactive'} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleEditTerm(term)} className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setDeleteTerm(term)} className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
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
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Payment Terms Templates</caption>
            <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Name</th>
                <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Terms</th>
                <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <FileText size={32} className="text-gray-300 dark:text-gray-600" />
                      <p>No templates found. Add your first template to get started.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                templates.map((template) => (
                  <tr
                    key={template.id}
                    onClick={() => handleEditTemplate(template)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white text-sm">{template.name}</td>
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
                        <button onClick={() => handleEditTemplate(template)} className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setDeleteTemplate(template)} className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Term Modal */}
      {showTermModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingTerm ? 'Edit Payment Term' : 'Add Payment Term'}
            </h2>
            <form onSubmit={handleSaveTerm} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                <input type="text" value={termForm.name} onChange={(e) => setTermForm({ ...termForm, name: e.target.value })} className={inputClass} placeholder="e.g. Net 30" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Portion (%)</label>
                  <input type="number" step="0.01" min="0" max="100" value={termForm.invoicePortion} onChange={(e) => setTermForm({ ...termForm, invoicePortion: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Credit Days</label>
                  <input type="number" min="0" value={termForm.creditDays} onChange={(e) => setTermForm({ ...termForm, creditDays: parseInt(e.target.value) || 0 })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date Based On</label>
                <select value={termForm.dueDateBasedOn} onChange={(e) => setTermForm({ ...termForm, dueDateBasedOn: e.target.value })} className={selectClass}>
                  <option value="days_after_invoice">Days After Invoice</option>
                  <option value="days_after_month_end">Days After Month End</option>
                  <option value="months_after_month_end">Months After Month End</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount Type</label>
                  <select value={termForm.discountType} onChange={(e) => setTermForm({ ...termForm, discountType: e.target.value })} className={selectClass}>
                    <option value="">None</option>
                    <option value="percentage">Percentage</option>
                    <option value="amount">Amount</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount</label>
                  <input type="number" step="0.01" min="0" value={termForm.discount} onChange={(e) => setTermForm({ ...termForm, discount: e.target.value })} className={inputClass} placeholder="0.00" disabled={!termForm.discountType} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Validity (days)</label>
                  <input type="number" min="0" value={termForm.discountValidityDays} onChange={(e) => setTermForm({ ...termForm, discountValidityDays: e.target.value })} className={inputClass} disabled={!termForm.discountType} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea value={termForm.description} onChange={(e) => setTermForm({ ...termForm, description: e.target.value })} className={inputClass} rows={2} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="termActive" checked={termForm.isActive} onChange={(e) => setTermForm({ ...termForm, isActive: e.target.checked })} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                <label htmlFor="termActive" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setShowTermModal(false); setEditingTerm(null) }} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                <button type="submit" disabled={savingTerm} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {savingTerm && <Loader2 size={14} className="animate-spin" />}
                  {editingTerm ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingTemplate ? 'Edit Template' : 'Add Template'}
            </h2>
            <form onSubmit={handleSaveTemplate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                <input type="text" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} className={inputClass} placeholder="e.g. Standard Net 30" required />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="templateActive" checked={templateForm.isActive} onChange={(e) => setTemplateForm({ ...templateForm, isActive: e.target.checked })} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                <label htmlFor="templateActive" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Payment Terms</label>
                  <button
                    type="button"
                    onClick={() => setTemplateForm({ ...templateForm, items: [...templateForm.items, { paymentTermId: '', sortOrder: templateForm.items.length + 1 }] })}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                  >
                    <Plus size={14} /> Add Term
                  </button>
                </div>
                <div className="space-y-2">
                  {templateForm.items.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-6">{index + 1}.</span>
                      <select
                        value={item.paymentTermId}
                        onChange={(e) => {
                          const newItems = [...templateForm.items]
                          newItems[index] = { ...newItems[index], paymentTermId: e.target.value }
                          setTemplateForm({ ...templateForm, items: newItems })
                        }}
                        className={selectClass + ' flex-1'}
                      >
                        <option value="">Select term</option>
                        {allTerms.filter((t) => t.isActive).map((t) => (
                          <option key={t.id} value={t.id}>{t.name} ({t.invoicePortion}%)</option>
                        ))}
                      </select>
                      {templateForm.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setTemplateForm({ ...templateForm, items: templateForm.items.filter((_, i) => i !== index) })}
                          className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setShowTemplateModal(false); setEditingTemplate(null) }} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                <button type="submit" disabled={savingTemplate} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {savingTemplate && <Loader2 size={14} className="animate-spin" />}
                  {editingTemplate ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal isOpen={!!deleteTerm} onClose={() => setDeleteTerm(null)} onConfirm={handleDeleteTerm} title="Delete Payment Term" message={`Delete "${deleteTerm?.name}"? This cannot be undone.`} confirmText="Delete" variant="danger" processing={deletingTerm} />
      <ConfirmModal isOpen={!!deleteTemplate} onClose={() => setDeleteTemplate(null)} onConfirm={handleDeleteTemplate} title="Delete Template" message={`Delete "${deleteTemplate?.name}"? This cannot be undone.`} confirmText="Delete" variant="danger" processing={deletingTemplate} />
    </ListPageLayout>
  )
}
