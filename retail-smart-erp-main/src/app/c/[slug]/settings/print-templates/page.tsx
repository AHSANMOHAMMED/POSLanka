'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Plus, Star, Pencil, Trash2, Loader2, FileText, Sparkles } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { AITemplateDesigner } from '@/components/print/AITemplateDesigner'
import { PAPER_SIZES, type PaperSize } from '@/lib/print/types'

interface PrintTemplate {
  id: string
  name: string
  documentType: string
  letterHeadId: string | null
  paperSize: string
  orientation: string
  margins: { top: number; right: number; bottom: number; left: number } | null
  showLogo: boolean
  showHeader: boolean
  showFooter: boolean
  customCss: string | null
  headerFields: string[] | null
  bodyFields: string[] | null
  footerFields: string[] | null
  isDefault: boolean
  isActive: boolean
}

interface LetterHead {
  id: string
  name: string
  isDefault: boolean
}

const DOCUMENT_TYPES = [
  { value: 'receipt', label: 'Receipt' },
  { value: 'work_order', label: 'Work Order' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'purchase_invoice', label: 'Purchase Invoice' },
  { value: 'stock_transfer', label: 'Stock Transfer' },
]

export default function PrintTemplatesPage() {
  const { tenantSlug, tenantName } = useCompany()
  const [templates, setTemplates] = useState<PrintTemplate[]>([])
  const [letterHeads, setLetterHeads] = useState<LetterHead[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filterDocType, setFilterDocType] = useState('')
  const [showAIDesigner, setShowAIDesigner] = useState(false)

  const [form, setForm] = useState({
    name: '',
    documentType: 'receipt',
    letterHeadId: '',
    paperSize: 'a4',
    orientation: 'portrait',
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    showLogo: true,
    showHeader: true,
    showFooter: true,
    customCss: '',
    isDefault: false,
  })

  const fetchData = useCallback(async () => {
    try {
      const [templatesRes, lhRes] = await Promise.all([
        fetch('/api/print-templates'),
        fetch('/api/letter-heads'),
      ])
      if (templatesRes.ok) setTemplates(await templatesRes.json())
      if (lhRes.ok) setLetterHeads(await lhRes.json())
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useRealtimeData(fetchData, { entityType: 'print-template' })

  function resetForm() {
    setForm({
      name: '',
      documentType: 'receipt',
      letterHeadId: '',
      paperSize: 'a4',
      orientation: 'portrait',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      showLogo: true,
      showHeader: true,
      showFooter: true,
      customCss: '',
      isDefault: false,
    })
    setEditingId(null)
  }

  function openEdit(t: PrintTemplate) {
    setForm({
      name: t.name,
      documentType: t.documentType,
      letterHeadId: t.letterHeadId || '',
      paperSize: t.paperSize,
      orientation: t.orientation,
      margins: t.margins || { top: 10, right: 10, bottom: 10, left: 10 },
      showLogo: t.showLogo,
      showHeader: t.showHeader,
      showFooter: t.showFooter,
      customCss: t.customCss || '',
      isDefault: t.isDefault,
    })
    setEditingId(t.id)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Name is required'); return }

    setSaving(true)
    try {
      const url = editingId ? `/api/print-templates/${editingId}` : '/api/print-templates'
      const method = editingId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          letterHeadId: form.letterHeadId || null,
        }),
      })

      if (res.ok) {
        toast.success(editingId ? 'Template updated' : 'Template created')
        setShowModal(false)
        resetForm()
        fetchData()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
      }
    } catch {
      toast.error('Error saving template')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return
    try {
      const res = await fetch(`/api/print-templates/${id}`, { method: 'DELETE' })
      if (res.ok) { toast.success('Deleted'); fetchData() }
    } catch { toast.error('Error deleting') }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/print-templates/${id}/set-default`, { method: 'POST' })
      if (res.ok) { toast.success('Default updated'); fetchData() }
    } catch { toast.error('Error setting default') }
  }

  const filtered = filterDocType ? templates.filter((t) => t.documentType === filterDocType) : templates

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  return (
    <div className="space-y-4 p-4 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400"><Home size={14} /></Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/settings`} className="hover:text-blue-600 dark:hover:text-blue-400">Settings</Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">Print Templates</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Print Templates</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure print layouts for different document types</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAIDesigner(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium rounded hover:from-purple-700 hover:to-blue-700 transition-all"
          >
            <Sparkles size={14} />
            Design with AI
          </button>
          <button
            onClick={() => { resetForm(); setShowModal(true) }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} />
            New Template
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterDocType('')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${!filterDocType ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >
          All
        </button>
        {DOCUMENT_TYPES.map((dt) => (
          <button
            key={dt.value}
            onClick={() => setFilterDocType(dt.value)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${filterDocType === dt.value ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {dt.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-8 text-center">
          <Loader2 size={24} className="animate-spin mx-auto text-gray-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">No print templates found. Create one to customize your print layouts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => {
            const docLabel = DOCUMENT_TYPES.find((d) => d.value === t.documentType)?.label || t.documentType
            return (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded flex items-center justify-center">
                    <FileText size={18} className="text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white">{t.name}</span>
                      <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">{docLabel}</span>
                      {t.isDefault && (
                        <span className="px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-full">Default</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {PAPER_SIZES[t.paperSize as PaperSize]?.label || t.paperSize} | {t.orientation}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!t.isDefault && (
                    <button onClick={() => handleSetDefault(t.id)} className="p-2 text-gray-400 hover:text-yellow-500 transition-colors" title="Set as default">
                      <Star size={16} />
                    </button>
                  )}
                  <button onClick={() => openEdit(t)} className="p-2 text-gray-400 hover:text-blue-500 transition-colors" title="Edit">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-md shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingId ? 'Edit Print Template' : 'New Print Template'}
              </h2>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="e.g. Standard Invoice" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Document Type</label>
                  <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} className={inputClass}>
                    {DOCUMENT_TYPES.map((dt) => (
                      <option key={dt.value} value={dt.value}>{dt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Letter Head</label>
                <select value={form.letterHeadId} onChange={(e) => setForm({ ...form, letterHeadId: e.target.value })} className={inputClass}>
                  <option value="">None</option>
                  {letterHeads.map((lh) => (
                    <option key={lh.id} value={lh.id}>{lh.name}{lh.isDefault ? ' (Default)' : ''}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Paper Size</label>
                  <select value={form.paperSize} onChange={(e) => setForm({ ...form, paperSize: e.target.value })} className={inputClass}>
                    {Object.entries(PAPER_SIZES).map(([key, { label }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Orientation</label>
                  <select value={form.orientation} onChange={(e) => setForm({ ...form, orientation: e.target.value })} className={inputClass}>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Margins (mm)</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <div key={side}>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 capitalize">{side}</label>
                      <input
                        type="number"
                        value={form.margins[side]}
                        onChange={(e) => setForm({ ...form, margins: { ...form.margins, [side]: parseInt(e.target.value) || 0 } })}
                        min={0}
                        className={inputClass}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Display Options</label>
                {[
                  { key: 'showLogo', label: 'Show Logo' },
                  { key: 'showHeader', label: 'Show Header' },
                  { key: 'showFooter', label: 'Show Footer' },
                  { key: 'isDefault', label: 'Set as default for this document type' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form[key as keyof typeof form] as boolean}
                      onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  </label>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Custom CSS (Advanced)</label>
                <textarea
                  value={form.customCss}
                  onChange={(e) => setForm({ ...form, customCss: e.target.value })}
                  className={`${inputClass} font-mono text-xs`}
                  rows={3}
                  placeholder=".print-content { font-size: 10px; }"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-end gap-3">
              <button onClick={() => { setShowModal(false); resetForm() }} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors text-sm">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Designer Modal */}
      <AITemplateDesigner
        mode="print-template"
        companyName={tenantName || 'My Business'}
        documentType={filterDocType || 'receipt'}
        isOpen={showAIDesigner}
        onClose={() => setShowAIDesigner(false)}
        onApplyTemplate={(design) => {
          setForm(prev => ({
            ...prev,
            name: design.name,
            customCss: design.customCss,
          }))
          setEditingId(null)
          setShowModal(true)
        }}
      />
    </div>
  )
}
