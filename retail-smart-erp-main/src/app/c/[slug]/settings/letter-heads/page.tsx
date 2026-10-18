'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Plus, Star, Pencil, Trash2, Eye, Loader2, Sparkles } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { AITemplateDesigner } from '@/components/print/AITemplateDesigner'
import { sanitizeHtml } from '@/lib/utils/sanitize-html'

interface LetterHead {
  id: string
  name: string
  isDefault: boolean
  headerHtml: string | null
  footerHtml: string | null
  headerImage: string | null
  footerImage: string | null
  headerHeight: number
  footerHeight: number
  alignment: 'left' | 'center' | 'right'
  isActive: boolean
  createdAt: string
}

export default function LetterHeadsPage() {
  const { tenantSlug, tenantName } = useCompany()
  const [letterHeads, setLetterHeads] = useState<LetterHead[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showAIDesigner, setShowAIDesigner] = useState(false)

  // Form state
  const [form, setForm] = useState({
    name: '',
    headerHtml: '',
    footerHtml: '',
    headerImage: '',
    footerImage: '',
    headerHeight: 60,
    footerHeight: 30,
    alignment: 'center' as 'left' | 'center' | 'right',
    isDefault: false,
  })

  const fetchLetterHeads = useCallback(async () => {
    try {
      const res = await fetch('/api/letter-heads')
      if (res.ok) {
        const data = await res.json()
        setLetterHeads(data)
      }
    } catch (err) {
      console.error('Failed to load letter heads:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useRealtimeData(fetchLetterHeads, { entityType: 'letter-head' })

  function resetForm() {
    setForm({
      name: '',
      headerHtml: '',
      footerHtml: '',
      headerImage: '',
      footerImage: '',
      headerHeight: 60,
      footerHeight: 30,
      alignment: 'center',
      isDefault: false,
    })
    setEditingId(null)
  }

  function openCreate() {
    resetForm()
    setShowModal(true)
  }

  function openEdit(lh: LetterHead) {
    setForm({
      name: lh.name,
      headerHtml: lh.headerHtml || '',
      footerHtml: lh.footerHtml || '',
      headerImage: lh.headerImage || '',
      footerImage: lh.footerImage || '',
      headerHeight: lh.headerHeight,
      footerHeight: lh.footerHeight,
      alignment: lh.alignment,
      isDefault: lh.isDefault,
    })
    setEditingId(lh.id)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }

    setSaving(true)
    try {
      const url = editingId ? `/api/letter-heads/${editingId}` : '/api/letter-heads'
      const method = editingId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (res.ok) {
        toast.success(editingId ? 'Letter head updated' : 'Letter head created')
        setShowModal(false)
        resetForm()
        fetchLetterHeads()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
      }
    } catch {
      toast.error('Error saving letter head')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this letter head?')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/letter-heads/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Letter head deleted')
        fetchLetterHeads()
      } else {
        toast.error('Failed to delete')
      }
    } catch {
      toast.error('Error deleting')
    } finally {
      setDeleting(null)
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/letter-heads/${id}/set-default`, { method: 'POST' })
      if (res.ok) {
        toast.success('Default letter head updated')
        fetchLetterHeads()
      }
    } catch {
      toast.error('Error setting default')
    }
  }

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  return (
    <div className="space-y-4 p-4 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/settings`} className="hover:text-blue-600 dark:hover:text-blue-400">Settings</Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">Letter Heads</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Letter Heads</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure company branding for printed documents</p>
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
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} />
            New Letter Head
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-8 text-center">
          <Loader2 size={24} className="animate-spin mx-auto text-gray-400" />
        </div>
      ) : letterHeads.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">No letter heads configured. Create one to add branding to your printed documents.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {letterHeads.map((lh) => (
            <div key={lh.id} className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center text-gray-500 dark:text-gray-400">
                  <Eye size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">{lh.name}</span>
                    {lh.isDefault && (
                      <span className="px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-full">Default</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {lh.alignment} aligned | Header: {lh.headerHeight}mm | Footer: {lh.footerHeight}mm
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!lh.isDefault && (
                  <button
                    onClick={() => handleSetDefault(lh.id)}
                    className="p-2 text-gray-400 hover:text-yellow-500 transition-colors"
                    title="Set as default"
                  >
                    <Star size={16} />
                  </button>
                )}
                <button
                  onClick={() => openEdit(lh)}
                  className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                  title="Edit"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => handleDelete(lh.id)}
                  disabled={deleting === lh.id}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-md shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingId ? 'Edit Letter Head' : 'New Letter Head'}
              </h2>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputClass}
                    placeholder="e.g. Standard Header"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Alignment</label>
                  <select
                    value={form.alignment}
                    onChange={(e) => setForm({ ...form, alignment: e.target.value as 'left' | 'center' | 'right' })}
                    className={inputClass}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Header HTML</label>
                <textarea
                  value={form.headerHtml}
                  onChange={(e) => setForm({ ...form, headerHtml: e.target.value })}
                  className={inputClass}
                  rows={3}
                  placeholder="Company name, address, contact info..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Header Image URL</label>
                <input
                  value={form.headerImage}
                  onChange={(e) => setForm({ ...form, headerImage: e.target.value })}
                  className={inputClass}
                  placeholder="https://... or /uploads/logos/..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Header Height (mm)</label>
                  <input
                    type="number"
                    value={form.headerHeight}
                    onChange={(e) => setForm({ ...form, headerHeight: parseInt(e.target.value) || 60 })}
                    className={inputClass}
                    min={0}
                    max={150}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Footer Height (mm)</label>
                  <input
                    type="number"
                    value={form.footerHeight}
                    onChange={(e) => setForm({ ...form, footerHeight: parseInt(e.target.value) || 30 })}
                    className={inputClass}
                    min={0}
                    max={100}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Footer HTML</label>
                <textarea
                  value={form.footerHtml}
                  onChange={(e) => setForm({ ...form, footerHtml: e.target.value })}
                  className={inputClass}
                  rows={2}
                  placeholder="Terms, thank you message, website..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Footer Image URL</label>
                <input
                  value={form.footerImage}
                  onChange={(e) => setForm({ ...form, footerImage: e.target.value })}
                  className={inputClass}
                  placeholder="https://... or /uploads/..."
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Set as default letter head</span>
              </label>

              {/* Live Preview */}
              {(form.headerHtml || form.headerImage || form.footerHtml || form.footerImage) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Preview</label>
                  <div className="border dark:border-gray-600 rounded bg-white p-4" style={{ minHeight: 200 }}>
                    {/* Header */}
                    <div
                      className="border-b border-dashed border-gray-300 pb-2 mb-4"
                      style={{ minHeight: form.headerHeight / 3, textAlign: form.alignment }}
                    >
                      {form.headerImage && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={form.headerImage} alt="Header" className="max-h-16 inline-block" />
                      )}
                      {form.headerHtml && (
                        <div className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(form.headerHtml) }} />
                      )}
                    </div>
                    {/* Body placeholder */}
                    <div className="text-center text-gray-400 text-sm py-6">
                      [Document content will appear here]
                    </div>
                    {/* Footer */}
                    <div
                      className="border-t border-dashed border-gray-300 pt-2 mt-4"
                      style={{ minHeight: form.footerHeight / 3, textAlign: form.alignment }}
                    >
                      {form.footerImage && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={form.footerImage} alt="Footer" className="max-h-12 inline-block" />
                      )}
                      {form.footerHtml && (
                        <div className="text-xs text-gray-500" dangerouslySetInnerHTML={{ __html: sanitizeHtml(form.footerHtml) }} />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowModal(false); resetForm() }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Designer Modal */}
      <AITemplateDesigner
        mode="letterhead"
        companyName={tenantName || 'My Business'}
        isOpen={showAIDesigner}
        onClose={() => setShowAIDesigner(false)}
        onApplyLetterhead={(design) => {
          setForm({
            name: design.name,
            headerHtml: design.headerHtml,
            footerHtml: design.footerHtml,
            headerImage: '',
            footerImage: '',
            headerHeight: design.headerHeight,
            footerHeight: design.footerHeight,
            alignment: 'center',
            isDefault: false,
          })
          setEditingId(null)
          setShowModal(true)
        }}
      />
    </div>
  )
}
