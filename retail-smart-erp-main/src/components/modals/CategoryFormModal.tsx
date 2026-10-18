'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Folder, FolderTree, AlertTriangle } from 'lucide-react'
import { useTerminology } from '@/hooks'

interface Category {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
  parent?: { id: string; name: string } | null
}

interface CategoryFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (category: Category) => void
  editCategory?: Category | null
  initialName?: string
  initialParentId?: string
}

export function CategoryFormModal({
  isOpen,
  onClose,
  onSaved,
  editCategory = null,
  initialName = '',
  initialParentId = '',
}: CategoryFormModalProps) {
  const t = useTerminology()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [formData, setFormData] = useState({
    name: '',
    parentId: '',
    isActive: true,
  })

  // Fetch categories for parent selection
  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories?all=true')
      if (res.ok) {
        const data = await res.json()
        setCategories(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error('Error fetching categories:', error)
    }
  }, [])

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchCategories()
      if (editCategory) {
        setFormData({
          name: editCategory.name,
          parentId: editCategory.parentId || '',
          isActive: editCategory.isActive,
        })
      } else {
        setFormData({
          name: initialName,
          parentId: initialParentId,
          isActive: true,
        })
      }
      setError('')
    }
  }, [isOpen, editCategory, initialName, initialParentId, fetchCategories])

  // Filter out current category and its children from parent options (to prevent circular references)
  const availableParentCategories = useMemo(() => {
    if (!editCategory) return categories

    // Get all descendant IDs to exclude
    const getDescendantIds = (parentId: string): string[] => {
      const children = categories.filter(c => c.parentId === parentId)
      return [parentId, ...children.flatMap(c => getDescendantIds(c.id))]
    }

    const excludeIds = getDescendantIds(editCategory.id)
    return categories.filter(c => !excludeIds.includes(c.id))
  }, [categories, editCategory])

  // Build hierarchical category tree for display
  const categoryTree = useMemo(() => {
    const rootCategories = availableParentCategories.filter(c => !c.parentId)
    const childrenMap = new Map<string, Category[]>()

    availableParentCategories.forEach(c => {
      if (c.parentId) {
        const children = childrenMap.get(c.parentId) || []
        children.push(c)
        childrenMap.set(c.parentId, children)
      }
    })

    const buildTree = (parent: Category, level: number): { category: Category; level: number }[] => {
      const result: { category: Category; level: number }[] = [{ category: parent, level }]
      const children = childrenMap.get(parent.id) || []
      children.forEach(child => {
        result.push(...buildTree(child, level + 1))
      })
      return result
    }

    const tree: { category: Category; level: number }[] = []
    rootCategories.forEach(root => {
      tree.push(...buildTree(root, 0))
    })
    return tree
  }, [availableParentCategories])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.name.trim()) {
      setError(`${t.category} name is required`)
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editCategory ? `/api/categories/${editCategory.id}` : '/api/categories'
      const method = editCategory ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          parentId: formData.parentId || null,
          isActive: formData.isActive,
        }),
      })

      if (res.ok) {
        const category = await res.json()
        toast.success(editCategory ? `${t.category} updated successfully` : `${t.category} created successfully`)
        onSaved(category)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || `Failed to ${editCategory ? 'update' : 'create'} ${t.category.toLowerCase()}`)
      }
    } catch (err) {
      console.error('Error saving category:', err)
      setError(`Failed to ${editCategory ? 'update' : 'create'} ${t.category.toLowerCase()}`)
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({
      name: '',
      parentId: '',
      isActive: true,
    })
    setError('')
    onClose()
  }

  // Get parent category name for display
  const selectedParent = categories.find(c => c.id === formData.parentId)

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editCategory ? `Edit ${t.category}` : `New ${t.category}`}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {/* Category Name */}
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-200">
            <Folder size={14} className="inline mr-1" />
            {t.category} Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            placeholder="e.g., Engine Parts, Brake Parts, Accessories"
            autoFocus
          />
        </div>

        {/* Parent Category */}
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-200">
            <FolderTree size={14} className="inline mr-1" />
            Parent {t.category}
          </label>
          <select
            value={formData.parentId}
            onChange={(e) => setFormData(prev => ({ ...prev, parentId: e.target.value }))}
            className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">-- No Parent (Top Level) --</option>
            {categoryTree.map(({ category, level }) => (
              <option key={category.id} value={category.id}>
                {'—'.repeat(level)} {category.name}
              </option>
            ))}
          </select>
          {selectedParent && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              This will be a sub-category of &quot;{selectedParent.name}&quot;
            </p>
          )}
        </div>

        {/* Status (in edit mode or for advanced creation) */}
        {editCategory && (
          <div className="flex items-center justify-between p-4 border dark:border-gray-700 rounded">
            <div>
              <label className="block text-sm font-medium dark:text-gray-200">{t.category} Status</label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Inactive {t.categories.toLowerCase()} will not appear in dropdowns
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              <span className="ml-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                {formData.isActive ? 'Active' : 'Inactive'}
              </span>
            </label>
          </div>
        )}

        {/* Hierarchy Preview */}
        {formData.parentId && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
            <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">{t.category} Hierarchy</p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
              {selectedParent?.name} → {formData.name || '(new category)'}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : editCategory ? `Update ${t.category}` : `Create ${t.category}`}
          </button>
        </div>
      </form>
    </Modal>
  )
}
