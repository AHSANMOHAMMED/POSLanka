'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { toast } from '@/components/ui/toast'
import { ClipboardList, Copy, Eye, EyeOff, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface ChecklistItem {
  id: string
  itemName: string
  itemType: 'checkbox' | 'select' | 'text' | 'number'
  options: string | null
  isRequired: boolean
  sortOrder: number
}

interface Category {
  id: string
  name: string
  sortOrder: number
  items: ChecklistItem[]
}

interface VehicleType {
  id: string
  name: string
  bodyType: string
}

interface InspectionTemplate {
  id: string
  tenantId: string | null
  name: string
  description: string | null
  inspectionType: 'check_in' | 'check_out'
  isDefault: boolean
  isActive: boolean
  vehicleType: VehicleType | null
  categories: Category[]
}

export default function InspectionTemplatesPage() {
  const [templates, setTemplates] = useState<InspectionTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null)
  const [showCloneModal, setShowCloneModal] = useState(false)
  const [cloningTemplate, setCloningTemplate] = useState<InspectionTemplate | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchTemplates = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (showInactive) params.set('includeInactive', 'true')
      const res = await fetch(`/api/inspection-templates?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTemplates(data)
      } else {
        toast.error('Failed to load inspection templates')
      }
    } catch (error) {
      console.error('Error fetching templates:', error)
      toast.error('Failed to load inspection templates')
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  // Real-time updates via WebSocket
  useRealtimeData(fetchTemplates, { entityType: 'inspection-template', refreshOnMount: false })

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  async function handleClone() {
    if (!cloningTemplate) return
    if (!cloneName.trim()) {
      toast.error('Name is required')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/inspection-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloneFromId: cloningTemplate.id,
          name: cloneName,
        }),
      })

      if (res.ok) {
        toast.success('Template cloned successfully')
        setShowCloneModal(false)
        setCloningTemplate(null)
        setCloneName('')
        fetchTemplates()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to clone template')
      }
    } catch {
      toast.error('Error cloning template')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleActive(template: InspectionTemplate) {
    try {
      const res = await fetch(`/api/inspection-templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !template.isActive }),
      })

      if (res.ok) {
        toast.success(template.isActive ? 'Template deactivated' : 'Template activated')
        fetchTemplates()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update')
      }
    } catch {
      toast.error('Error updating template')
    }
  }

  function openCloneModal(template: InspectionTemplate) {
    setCloningTemplate(template)
    setCloneName(`${template.name} (Copy)`)
    setShowCloneModal(true)
  }

  const systemTemplates = templates.filter(t => !t.tenantId)
  const customTemplates = templates.filter(t => t.tenantId)

  return (
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="Inspection Template"
      actionContent={
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
      }
      onRefresh={fetchTemplates}
    >
      <div className="p-4 overflow-y-auto flex-1">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* System Templates */}
          {systemTemplates.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4">System Default Templates</h2>
              <p className="text-sm text-gray-500 mb-4">
                Clone these templates to customize for your business
              </p>
              <div className="space-y-3">
                {systemTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isExpanded={expandedTemplate === template.id}
                    onToggleExpand={() => setExpandedTemplate(
                      expandedTemplate === template.id ? null : template.id
                    )}
                    onClone={() => openCloneModal(template)}
                    onToggleActive={() => handleToggleActive(template)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom Templates */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Custom Templates</h2>
            {customTemplates.length === 0 ? (
              <div className="bg-gray-50 border border-dashed rounded-md p-8 text-center">
                <ClipboardList size={32} className="mx-auto mb-3 text-gray-400" />
                <p className="text-gray-500">No custom templates yet</p>
                <p className="text-sm text-gray-400 mt-1">
                  Clone a system template to customize it
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {customTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isExpanded={expandedTemplate === template.id}
                    onToggleExpand={() => setExpandedTemplate(
                      expandedTemplate === template.id ? null : template.id
                    )}
                    onClone={() => openCloneModal(template)}
                    onToggleActive={() => handleToggleActive(template)}
                    isCustom
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Clone Modal */}
      {showCloneModal && cloningTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-md shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-xl font-bold mb-2">Clone Template</h2>
            <p className="text-sm text-gray-500 mb-4">
              Create a copy of &ldquo;{cloningTemplate.name}&rdquo; that you can customize
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Template Name
                </label>
                <input
                  type="text"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter template name"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCloneModal(false)
                  setCloningTemplate(null)
                }}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClone}
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cloning...
                  </span>
                ) : (
                  'Clone Template'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </ListPageLayout>
  )
}

function TemplateCard({
  template,
  isExpanded,
  onToggleExpand,
  onClone,
  onToggleActive,
  isCustom = false,
}: {
  template: InspectionTemplate
  isExpanded: boolean
  onToggleExpand: () => void
  onClone: () => void
  onToggleActive: () => void
  isCustom?: boolean
}) {
  const totalItems = template.categories.reduce((sum, cat) => sum + cat.items.length, 0)

  return (
    <div className={`bg-white border rounded-md overflow-hidden ${!template.isActive ? 'opacity-50' : ''}`}>
      <div className="p-4 flex items-center gap-4">
        <button onClick={onToggleExpand} className="p-1 hover:bg-gray-100 rounded">
          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="w-10 h-10 bg-purple-50 rounded flex items-center justify-center">
          <ClipboardList size={20} className="text-purple-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{template.name}</span>
            {template.vehicleType && (
              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                {template.vehicleType.name}
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded ${
              template.inspectionType === 'check_in'
                ? 'bg-green-100 text-green-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {template.inspectionType === 'check_in' ? 'Check-in' : 'Check-out'}
            </span>
            {isCustom && (
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                Custom
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">
            {template.categories.length} categories, {totalItems} items
          </p>
        </div>
        <button
          onClick={onClone}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded"
          title="Clone template"
        >
          <Copy size={18} />
        </button>
        <button
          onClick={onToggleActive}
          className={`p-2 rounded ${
            template.isActive
              ? 'text-gray-500 hover:bg-gray-100'
              : 'text-green-600 hover:bg-green-50'
          }`}
          title={template.isActive ? 'Deactivate' : 'Activate'}
        >
          {template.isActive ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {isExpanded && (
        <div className="border-t bg-gray-50 p-4">
          {template.description && (
            <p className="text-sm text-gray-600 mb-4">{template.description}</p>
          )}
          <div className="space-y-4">
            {template.categories.map((category) => (
              <div key={category.id} className="bg-white border rounded p-3">
                <h4 className="font-medium text-sm mb-2">{category.name}</h4>
                <div className="grid grid-cols-2 gap-1">
                  {category.items.map((item) => (
                    <div key={item.id} className="text-xs text-gray-600 flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        item.isRequired ? 'bg-red-500' : 'bg-gray-300'
                      }`} />
                      <span className="truncate">{item.itemName}</span>
                      {item.itemType !== 'checkbox' && (
                        <span className="text-gray-400">({item.itemType})</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
