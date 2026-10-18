'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Star, Trash2, MoreHorizontal } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'

interface LabelTemplate {
  id: string
  name: string
  description: string | null
  widthMm: string
  heightMm: string
  isDefault: boolean
  isActive: boolean
  createdAt: string
  elements: unknown[]
}

export default function LabelTemplatesPage() {
  const { tenantSlug } = useCompany()
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/label-templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data)
      }
    } catch (error) {
      console.error('Error fetching label templates:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useRealtimeData(fetchTemplates, { entityType: 'label-template' })

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/label-templates/${id}/set-default`, { method: 'POST' })
      if (res.ok) {
        toast.success('Default template updated')
      } else {
        toast.error('Failed to set default')
      }
    } catch {
      toast.error('Failed to set default')
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/label-templates/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Template deleted')
      } else {
        toast.error('Failed to delete template')
      }
    } catch {
      toast.error('Failed to delete template')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const filtered = templates.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase())
  )

  if (loading && templates.length === 0) {
    return <PageLoading text="Loading label templates..." />
  }

  return (
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="Label Templates"
      actionContent={
        <Link
          href={`/c/${tenantSlug}/settings/label-templates/new`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Template
        </Link>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={fetchTemplates}
      searchPlaceholder="Search templates..."
    >
      <div className="bg-white rounded border list-container-xl">
        <table className="w-full">
          <caption className="sr-only">List of label templates</caption>
          <thead className="bg-gray-50 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Name</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Size</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600">Elements</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600">Default</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'No templates match your search' : 'No label templates yet. Create your first template!'}
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/c/${tenantSlug}/settings/label-templates/${t.id}`}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {t.name}
                    </Link>
                    {t.description && (
                      <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {parseFloat(t.widthMm)} x {parseFloat(t.heightMm)} mm
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600">
                    {Array.isArray(t.elements) ? t.elements.length : 0}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {t.isDefault ? (
                      <Star size={16} className="text-yellow-500 fill-yellow-500 inline" />
                    ) : (
                      <button
                        onClick={() => handleSetDefault(t.id)}
                        className="text-gray-400 hover:text-yellow-500"
                        title="Set as default"
                      >
                        <Star size={16} className="inline" />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/c/${tenantSlug}/settings/label-templates/${t.id}`}
                        className="p-1 text-gray-500 hover:text-blue-600 rounded"
                        title="Edit"
                      >
                        <MoreHorizontal size={18} />
                      </Link>
                      <button
                        onClick={() => setDeleteId(t.id)}
                        className="p-1 text-gray-500 hover:text-red-600 rounded"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Label Template"
        message="Are you sure you want to delete this template? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
