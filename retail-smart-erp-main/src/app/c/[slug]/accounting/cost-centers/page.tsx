'use client'

import { useState, useCallback } from 'react'
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  Folder,
  FileText,
  Loader2,
  Network,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { StatusBadge } from '@/components/ui'
import { ConfirmModal } from '@/components/ui/confirm-modal'

interface CostCenter {
  id: string
  name: string
  parentId: string | null
  isGroup: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  children?: CostCenter[]
}

const emptyForm = {
  name: '',
  parentId: '',
  isGroup: false,
  isActive: true,
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

function CostCenterTreeNode({
  costCenter,
  depth,
  expandedIds,
  toggleExpand,
  onEdit,
  onDelete,
  search,
}: {
  costCenter: CostCenter
  depth: number
  expandedIds: Set<string>
  toggleExpand: (id: string) => void
  onEdit: (cc: CostCenter) => void
  onDelete: (cc: CostCenter) => void
  search: string
}) {
  const isExpanded = expandedIds.has(costCenter.id)
  const hasChildren = costCenter.children && costCenter.children.length > 0
  const searchLower = search.toLowerCase()

  const matchesSelf =
    !search || costCenter.name.toLowerCase().includes(searchLower)

  const hasMatchingDescendant = (cc: CostCenter): boolean => {
    if (!cc.children) return false
    return cc.children.some(
      (child) =>
        child.name.toLowerCase().includes(searchLower) ||
        hasMatchingDescendant(child)
    )
  }

  const shouldShow = matchesSelf || hasMatchingDescendant(costCenter)
  if (!shouldShow) return null

  return (
    <>
      <tr className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
        <td className="px-4 py-2.5">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => toggleExpand(costCenter.id)}
                className="p-0.5 mr-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <span className="w-[22px] mr-1.5 inline-block" />
            )}
            {costCenter.isGroup ? (
              <Folder size={16} className="mr-2 text-amber-500 dark:text-amber-400 flex-shrink-0" />
            ) : (
              <FileText size={16} className="mr-2 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            )}
            <span className="font-medium text-gray-900 dark:text-white text-sm">
              {costCenter.name}
            </span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-center">
          <StatusBadge status={costCenter.isActive ? 'active' : 'inactive'} size="sm" />
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onEdit(costCenter)}
              aria-label={`Edit ${costCenter.name}`}
              className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => onDelete(costCenter)}
              aria-label={`Delete ${costCenter.name}`}
              className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded &&
        hasChildren &&
        costCenter.children!.map((child) => (
          <CostCenterTreeNode
            key={child.id}
            costCenter={child}
            depth={depth + 1}
            expandedIds={expandedIds}
            toggleExpand={toggleExpand}
            onEdit={onEdit}
            onDelete={onDelete}
            search={search}
          />
        ))}
    </>
  )
}

export default function CostCentersPage() {
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [flatCostCenters, setFlatCostCenters] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [editingCostCenter, setEditingCostCenter] = useState<CostCenter | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteCostCenter, setDeleteCostCenter] = useState<CostCenter | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchCostCenters = useCallback(async () => {
    try {
      const [treeRes, flatRes] = await Promise.all([
        fetch('/api/accounting/cost-centers?tree=true'),
        fetch('/api/accounting/cost-centers?all=true'),
      ])
      if (treeRes.ok) {
        const data = await treeRes.json()
        const tree = Array.isArray(data) ? data : data.data || []
        setCostCenters(tree)
        // Auto-expand root level
        const rootIds = tree.map((cc: CostCenter) => cc.id)
        setExpandedIds((prev) => {
          const next = new Set(prev)
          rootIds.forEach((id: string) => next.add(id))
          return next
        })
      }
      if (flatRes.ok) {
        const data = await flatRes.json()
        setFlatCostCenters(Array.isArray(data) ? data : data.data || [])
      }
    } catch {
      toast.error('Failed to load cost centers')
    } finally {
      setLoading(false)
    }
  }, [])

  const { refresh } = useRealtimeData(fetchCostCenters, { entityType: 'cost-center' })

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleAdd() {
    setEditingCostCenter(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function handleEdit(costCenter: CostCenter) {
    setEditingCostCenter(costCenter)
    setForm({
      name: costCenter.name,
      parentId: costCenter.parentId || '',
      isGroup: costCenter.isGroup,
      isActive: costCenter.isActive,
    })
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingCostCenter(null)
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
        parentId: form.parentId || null,
        isGroup: form.isGroup,
        isActive: form.isActive,
      }

      const url = editingCostCenter
        ? `/api/accounting/cost-centers/${editingCostCenter.id}`
        : '/api/accounting/cost-centers'
      const method = editingCostCenter ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(editingCostCenter ? 'Cost center updated' : 'Cost center created')
        handleCloseModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save cost center')
      }
    } catch {
      toast.error('Error saving cost center')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteCostCenter) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/accounting/cost-centers/${deleteCostCenter.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Cost center deleted')
        setDeleteCostCenter(null)
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete cost center')
      }
    } catch {
      toast.error('Error deleting cost center')
    } finally {
      setDeleting(false)
    }
  }

  // Filter parent options: only groups, exclude self when editing
  const parentOptions = flatCostCenters.filter(
    (cc) => cc.isGroup && cc.id !== editingCostCenter?.id
  )

  if (loading && costCenters.length === 0) {
    return <PageLoading text="Loading cost centers..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Cost Centers"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search cost centers..."
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Cost Center
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Cost Centers</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {costCenters.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <Network size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No cost centers found. Add your first cost center to get started.</p>
                  </div>
                </td>
              </tr>
            ) : (
              costCenters.map((cc) => (
                <CostCenterTreeNode
                  key={cc.id}
                  costCenter={cc}
                  depth={0}
                  expandedIds={expandedIds}
                  toggleExpand={toggleExpand}
                  onEdit={handleEdit}
                  onDelete={setDeleteCostCenter}
                  search={search}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingCostCenter ? 'Edit Cost Center' : 'Add Cost Center'}
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
                  placeholder="e.g. Marketing Department"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Parent Cost Center
                </label>
                <select
                  value={form.parentId}
                  onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                  className={selectClass}
                >
                  <option value="">None (Root Level)</option>
                  {parentOptions.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isGroup"
                  checked={form.isGroup}
                  onChange={(e) => setForm({ ...form, isGroup: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isGroup" className="text-sm text-gray-700 dark:text-gray-300">
                  Is Group (container for child cost centers)
                </label>
              </div>

              {editingCostCenter && (
                <div className="flex items-center gap-2">
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
              )}

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
                  {editingCostCenter ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmModal
        isOpen={!!deleteCostCenter}
        onClose={() => setDeleteCostCenter(null)}
        onConfirm={handleDelete}
        title="Delete Cost Center"
        message={`Are you sure you want to delete "${deleteCostCenter?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />
    </ListPageLayout>
  )
}
