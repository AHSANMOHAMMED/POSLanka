'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home, ChevronRight, ArrowLeft, Plus, Edit, Trash2,
  ChevronDown, ChevronUp, Check, X, Tag, Package, Save,
} from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormInput, FormLabel, FormTextarea } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'
import { formatCurrency } from '@/lib/utils/currency'
import { useCompany } from '@/components/providers/CompanyContextProvider'

// ============================================
// TYPES
// ============================================

interface Modifier {
  id: string
  groupId: string
  name: string
  description: string | null
  price: string
  sku: string | null
  isDefault: boolean
  isActive: boolean
  allergens: string[] | null
  calories: number | null
  sortOrder: number | null
  createdAt: string
  updatedAt: string | null
}

interface ModifierGroup {
  id: string
  name: string
  description: string | null
  minSelections: number | null
  maxSelections: number | null
  isRequired: boolean
  isActive: boolean
  sortOrder: number | null
  modifiers: Modifier[]
  itemCount: number
  createdAt: string
  updatedAt: string | null
}

interface AssociatedItem {
  associationId: string
  itemId: string
  name: string
  sku: string | null
  sellingPrice: string
  isActive: boolean
  imageUrl: string | null
  createdAt: string
}

interface GroupFormData {
  name: string
  description: string
  minSelections: string
  maxSelections: string
  isRequired: boolean
  isActive: boolean
}

interface ModifierFormData {
  name: string
  description: string
  price: string
  sku: string
  isDefault: boolean
  allergens: string[]
  calories: string
}

const INITIAL_MODIFIER_FORM: ModifierFormData = {
  name: '',
  description: '',
  price: '0.00',
  sku: '',
  isDefault: false,
  allergens: [],
  calories: '',
}

const COMMON_ALLERGENS = [
  'Dairy', 'Eggs', 'Fish', 'Shellfish', 'Tree Nuts',
  'Peanuts', 'Wheat', 'Soy', 'Sesame',
]

// ============================================
// MAIN COMPONENT
// ============================================

export default function ModifierGroupDetailPage({
  params,
}: {
  params: Promise<{ slug: string; groupId: string }>
}) {
  const { groupId } = use(params)
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()

  // Group data
  const [group, setGroup] = useState<ModifierGroup | null>(null)
  const [associatedItems, setAssociatedItems] = useState<AssociatedItem[]>([])
  const [loadingGroup, setLoadingGroup] = useState(true)
  const [loadingItems, setLoadingItems] = useState(true)

  // Group editing
  const [editingGroupInfo, setEditingGroupInfo] = useState(false)
  const [groupFormData, setGroupFormData] = useState<GroupFormData>({
    name: '',
    description: '',
    minSelections: '0',
    maxSelections: '',
    isRequired: false,
    isActive: true,
  })
  const [savingGroup, setSavingGroup] = useState(false)

  // Modifier modal
  const [showModifierModal, setShowModifierModal] = useState(false)
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null)
  const [modifierFormData, setModifierFormData] = useState<ModifierFormData>(INITIAL_MODIFIER_FORM)
  const [savingModifier, setSavingModifier] = useState(false)

  // Delete state
  const [deleteModifierConfirm, setDeleteModifierConfirm] = useState<{ open: boolean; id: string | null; name: string }>({
    open: false, id: null, name: '',
  })

  // Item association
  const [addingItem, setAddingItem] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState('')

  // ============================================
  // FETCH DATA
  // ============================================

  const fetchGroup = useCallback(async () => {
    try {
      const res = await fetch(`/api/modifier-groups/${groupId}`)
      if (res.ok) {
        const data = await res.json()
        setGroup(data)
        setGroupFormData({
          name: data.name,
          description: data.description || '',
          minSelections: String(data.minSelections ?? 0),
          maxSelections: data.maxSelections !== null ? String(data.maxSelections) : '',
          isRequired: data.isRequired,
          isActive: data.isActive,
        })
      } else if (res.status === 404) {
        toast.error('Modifier group not found')
        router.push(`/c/${tenantSlug}/restaurant/modifiers`)
      }
    } catch {
      toast.error('Failed to load modifier group')
    } finally {
      setLoadingGroup(false)
    }
  }, [groupId, tenantSlug, router])

  const fetchAssociatedItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/modifier-groups/${groupId}/items`)
      if (res.ok) {
        const data = await res.json()
        setAssociatedItems(data)
      }
    } catch {
      console.error('Failed to load associated items')
    } finally {
      setLoadingItems(false)
    }
  }, [groupId])

  useEffect(() => {
    fetchGroup()
    fetchAssociatedItems()
  }, [fetchGroup, fetchAssociatedItems])

  // Real-time updates
  useRealtimeData(fetchGroup, { entityType: 'modifier-group' })

  // ============================================
  // GROUP HANDLERS
  // ============================================

  function handleStartEditGroup() {
    if (!group) return
    setGroupFormData({
      name: group.name,
      description: group.description || '',
      minSelections: String(group.minSelections ?? 0),
      maxSelections: group.maxSelections !== null ? String(group.maxSelections) : '',
      isRequired: group.isRequired,
      isActive: group.isActive,
    })
    setEditingGroupInfo(true)
  }

  function handleCancelEditGroup() {
    setEditingGroupInfo(false)
    if (group) {
      setGroupFormData({
        name: group.name,
        description: group.description || '',
        minSelections: String(group.minSelections ?? 0),
        maxSelections: group.maxSelections !== null ? String(group.maxSelections) : '',
        isRequired: group.isRequired,
        isActive: group.isActive,
      })
    }
  }

  async function handleSaveGroup() {
    if (!groupFormData.name.trim()) {
      toast.error('Group name is required')
      return
    }

    setSavingGroup(true)
    try {
      const res = await fetch(`/api/modifier-groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupFormData.name.trim(),
          description: groupFormData.description.trim() || null,
          minSelections: parseInt(groupFormData.minSelections) || 0,
          maxSelections: groupFormData.maxSelections ? parseInt(groupFormData.maxSelections) : null,
          isRequired: groupFormData.isRequired,
          isActive: groupFormData.isActive,
        }),
      })

      if (res.ok) {
        toast.success('Modifier group updated')
        setEditingGroupInfo(false)
        fetchGroup()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update modifier group')
      }
    } catch {
      toast.error('Failed to update modifier group')
    } finally {
      setSavingGroup(false)
    }
  }

  // ============================================
  // MODIFIER HANDLERS
  // ============================================

  function handleOpenCreateModifier() {
    setEditingModifier(null)
    setModifierFormData(INITIAL_MODIFIER_FORM)
    setShowModifierModal(true)
  }

  function handleEditModifier(modifier: Modifier) {
    setEditingModifier(modifier)
    setModifierFormData({
      name: modifier.name,
      description: modifier.description || '',
      price: parseFloat(modifier.price).toFixed(2),
      sku: modifier.sku || '',
      isDefault: modifier.isDefault,
      allergens: modifier.allergens || [],
      calories: modifier.calories !== null ? String(modifier.calories) : '',
    })
    setShowModifierModal(true)
  }

  function handleCloseModifierModal() {
    setShowModifierModal(false)
    setEditingModifier(null)
    setModifierFormData(INITIAL_MODIFIER_FORM)
  }

  async function handleSaveModifier(e: React.FormEvent) {
    e.preventDefault()

    if (!modifierFormData.name.trim()) {
      toast.error('Modifier name is required')
      return
    }

    setSavingModifier(true)
    try {
      const url = editingModifier
        ? `/api/modifier-groups/${groupId}/modifiers/${editingModifier.id}`
        : `/api/modifier-groups/${groupId}/modifiers`
      const method = editingModifier ? 'PUT' : 'POST'

      const payload = {
        name: modifierFormData.name.trim(),
        description: modifierFormData.description.trim() || null,
        price: parseFloat(modifierFormData.price) || 0,
        sku: modifierFormData.sku.trim() || null,
        isDefault: modifierFormData.isDefault,
        allergens: modifierFormData.allergens.length > 0 ? modifierFormData.allergens : null,
        calories: modifierFormData.calories ? parseInt(modifierFormData.calories) : null,
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        toast.success(editingModifier ? 'Modifier updated' : 'Modifier added')
        handleCloseModifierModal()
        fetchGroup()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save modifier')
      }
    } catch {
      toast.error('Failed to save modifier')
    } finally {
      setSavingModifier(false)
    }
  }

  async function handleDeleteModifier() {
    if (!deleteModifierConfirm.id) return

    try {
      const res = await fetch(`/api/modifier-groups/${groupId}/modifiers/${deleteModifierConfirm.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Modifier deleted')
        fetchGroup()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete modifier')
      }
    } catch {
      toast.error('Failed to delete modifier')
    } finally {
      setDeleteModifierConfirm({ open: false, id: null, name: '' })
    }
  }

  async function handleMoveModifier(modifierId: string, direction: 'up' | 'down') {
    if (!group) return
    const mods = group.modifiers
    const index = mods.findIndex((m) => m.id === modifierId)
    if (index === -1) return
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === mods.length - 1) return

    const swapIndex = direction === 'up' ? index - 1 : index + 1
    const currentMod = mods[index]
    const swapMod = mods[swapIndex]

    // Optimistically update UI
    const newMods = [...mods]
    newMods[index] = swapMod
    newMods[swapIndex] = currentMod
    setGroup((prev) => prev ? { ...prev, modifiers: newMods } : null)

    try {
      await Promise.all([
        fetch(`/api/modifier-groups/${groupId}/modifiers/${currentMod.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...currentMod, sortOrder: swapMod.sortOrder ?? swapIndex }),
        }),
        fetch(`/api/modifier-groups/${groupId}/modifiers/${swapMod.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...swapMod, sortOrder: currentMod.sortOrder ?? index }),
        }),
      ])
    } catch {
      fetchGroup()
      toast.error('Failed to reorder modifiers')
    }
  }

  function toggleAllergen(allergen: string) {
    setModifierFormData((prev) => {
      const current = prev.allergens
      if (current.includes(allergen)) {
        return { ...prev, allergens: current.filter((a) => a !== allergen) }
      }
      return { ...prev, allergens: [...current, allergen] }
    })
  }

  // ============================================
  // ITEM ASSOCIATION HANDLERS
  // ============================================

  async function searchItems(searchText: string) {
    const params = new URLSearchParams({ pageSize: '15' })
    if (searchText) params.set('search', searchText)
    const res = await fetch(`/api/items?${params}`)
    const result = await res.json()
    const data = result.data || result
    return data.map((item: { id: string; name: string; sellingPrice: string }) => ({
      value: item.id,
      label: item.name,
      data: { sellingPrice: item.sellingPrice },
    }))
  }

  async function handleAddItem() {
    if (!selectedItemId) {
      toast.error('Please select an item')
      return
    }

    // Check if already associated
    if (associatedItems.some((a) => a.itemId === selectedItemId)) {
      toast.error('This item is already associated with this group')
      return
    }

    setAddingItem(true)
    try {
      const currentItemIds = associatedItems.map((a) => a.itemId)
      const newItemIds = [...currentItemIds, selectedItemId]

      const res = await fetch(`/api/modifier-groups/${groupId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: newItemIds }),
      })

      if (res.ok) {
        toast.success('Item associated')
        setSelectedItemId('')
        fetchAssociatedItems()
        fetchGroup()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to add item')
      }
    } catch {
      toast.error('Failed to add item')
    } finally {
      setAddingItem(false)
    }
  }

  async function handleRemoveItem(itemId: string) {
    try {
      const currentItemIds = associatedItems.map((a) => a.itemId).filter((id) => id !== itemId)

      const res = await fetch(`/api/modifier-groups/${groupId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: currentItemIds }),
      })

      if (res.ok) {
        toast.success('Item removed')
        fetchAssociatedItems()
        fetchGroup()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to remove item')
      }
    } catch {
      toast.error('Failed to remove item')
    }
  }

  // ============================================
  // RENDER
  // ============================================

  if (loadingGroup) {
    return <PageLoading text="Loading modifier group..." />
  }

  if (!group) {
    return (
      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
        Modifier group not found.
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col -m-5">
      {/* Breadcrumb */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
            <Home size={14} />
          </Link>
          <ChevronRight size={14} />
          <Link href={`/c/${tenantSlug}/restaurant`} className="hover:text-blue-600 dark:hover:text-blue-400">
            Restaurant
          </Link>
          <ChevronRight size={14} />
          <Link href={`/c/${tenantSlug}/restaurant/modifiers`} className="hover:text-blue-600 dark:hover:text-blue-400">
            Modifier Groups
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium truncate">{group.name}</span>
        </div>
      </div>

      {/* Header */}
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/c/${tenantSlug}/restaurant/modifiers`)}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{group.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {group.isRequired && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    Required
                  </span>
                )}
                {group.isActive ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                    Inactive
                  </span>
                )}
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Select: {group.minSelections ?? 0}{group.maxSelections !== null ? `\u2013${group.maxSelections}` : '+'}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleStartEditGroup}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            <Edit size={16} />
            Edit Group
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Group Info (editable) */}
          {editingGroupInfo && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Edit Group Info</h2>
              <div className="space-y-4">
                <div>
                  <FormLabel required>Group Name</FormLabel>
                  <FormInput
                    value={groupFormData.name}
                    onChange={(e) => setGroupFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Group name"
                    autoFocus
                  />
                </div>
                <div>
                  <FormLabel optional>Description</FormLabel>
                  <FormTextarea
                    value={groupFormData.description}
                    onChange={(e) => setGroupFormData((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Description..."
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FormLabel optional>Min Selections</FormLabel>
                    <FormInput
                      type="number"
                      min="0"
                      step="1"
                      value={groupFormData.minSelections}
                      onChange={(e) => setGroupFormData((prev) => ({ ...prev, minSelections: e.target.value }))}
                    />
                  </div>
                  <div>
                    <FormLabel optional>Max Selections</FormLabel>
                    <FormInput
                      type="number"
                      min="0"
                      step="1"
                      value={groupFormData.maxSelections}
                      onChange={(e) => setGroupFormData((prev) => ({ ...prev, maxSelections: e.target.value }))}
                      placeholder="No limit"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="editIsRequired"
                      checked={groupFormData.isRequired}
                      onChange={(e) => setGroupFormData((prev) => ({ ...prev, isRequired: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="editIsRequired" className="text-sm text-gray-700 dark:text-gray-300">
                      Required
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="editIsActive"
                      checked={groupFormData.isActive}
                      onChange={(e) => setGroupFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="editIsActive" className="text-sm text-gray-700 dark:text-gray-300">
                      Active
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={handleSaveGroup}
                    disabled={savingGroup || !groupFormData.name.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Save size={16} />
                    {savingGroup ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={handleCancelEditGroup}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Group Description (read-only when not editing) */}
          {!editingGroupInfo && group.description && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">{group.description}</p>
            </div>
          )}

          {/* Modifiers Section */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag size={16} className="text-purple-600 dark:text-purple-400" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Modifiers ({group.modifiers.length})
                </h2>
              </div>
              <button
                onClick={handleOpenCreateModifier}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
              >
                <Plus size={16} />
                Add Modifier
              </button>
            </div>

            {group.modifiers.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                No modifiers yet. Click &quot;Add Modifier&quot; to create one.
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {group.modifiers.map((modifier, idx) => (
                  <div
                    key={modifier.id}
                    className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {/* Sort arrows */}
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => handleMoveModifier(modifier.id, 'up')}
                          disabled={idx === 0}
                          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move up"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => handleMoveModifier(modifier.id, 'down')}
                          disabled={idx === group.modifiers.length - 1}
                          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move down"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 dark:text-white">
                            {modifier.name}
                          </span>
                          {modifier.isDefault && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                              Default
                            </span>
                          )}
                          {!modifier.isActive && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                          <span className={`font-medium ${parseFloat(modifier.price) > 0 ? 'text-green-600 dark:text-green-400' : ''}`}>
                            {parseFloat(modifier.price) > 0 ? `+${formatCurrency(modifier.price, currency)}` : 'No extra charge'}
                          </span>
                          {modifier.description && (
                            <span className="truncate max-w-xs">{modifier.description}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {modifier.allergens && modifier.allergens.length > 0 && (
                            <span className="text-orange-600 dark:text-orange-400">
                              Allergens: {modifier.allergens.join(', ')}
                            </span>
                          )}
                          {modifier.calories !== null && (
                            <span>{modifier.calories} cal</span>
                          )}
                          {modifier.sku && (
                            <span>SKU: {modifier.sku}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleEditModifier(modifier)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                        title="Edit modifier"
                      >
                        <Edit size={15} />
                      </button>
                      <button
                        onClick={() =>
                          setDeleteModifierConfirm({ open: true, id: modifier.id, name: modifier.name })
                        }
                        className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        title="Delete modifier"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Associated Menu Items Section */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package size={16} className="text-blue-600 dark:text-blue-400" />
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Associated Menu Items ({associatedItems.length})
                  </h2>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Menu items that use this modifier group. Customers can select modifiers from this group when ordering these items.
              </p>
            </div>

            {/* Add Item */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <AsyncCreatableSelect
                    fetchOptions={searchItems}
                    value={selectedItemId}
                    onChange={(value) => setSelectedItemId(value)}
                    placeholder="Search menu items to associate..."
                  />
                </div>
                <button
                  onClick={handleAddItem}
                  disabled={!selectedItemId || addingItem}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={16} />
                  {addingItem ? 'Adding...' : 'Add'}
                </button>
              </div>
            </div>

            {loadingItems ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                Loading associated items...
              </div>
            ) : associatedItems.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                No menu items associated yet. Use the search above to add items.
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {associatedItems.map((item) => (
                  <div
                    key={item.itemId}
                    className="px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded flex items-center justify-center flex-shrink-0">
                        <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {item.name}
                          </span>
                          {!item.isActive && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                          {item.sku && <span>SKU: {item.sku}</span>}
                          <span>{formatCurrency(item.sellingPrice, currency)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveItem(item.itemId)}
                      className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Remove association"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modifier Modal */}
      <Modal
        isOpen={showModifierModal}
        onClose={handleCloseModifierModal}
        title={editingModifier ? 'Edit Modifier' : 'Add Modifier'}
        size="lg"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={handleCloseModifierModal}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveModifier}
              disabled={savingModifier || !modifierFormData.name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingModifier ? 'Saving...' : editingModifier ? 'Update Modifier' : 'Add Modifier'}
            </button>
          </ModalFooter>
        }
      >
        <form onSubmit={handleSaveModifier} className="space-y-4">
          <div>
            <FormLabel required>Modifier Name</FormLabel>
            <FormInput
              value={modifierFormData.name}
              onChange={(e) => setModifierFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Extra Cheese, Large Size, No Onions"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel optional>Price</FormLabel>
              <FormInput
                type="number"
                min="0"
                step="0.01"
                value={modifierFormData.price}
                onChange={(e) => setModifierFormData((prev) => ({ ...prev, price: e.target.value }))}
                placeholder="0.00"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Additional cost for this modifier
              </p>
            </div>
            <div>
              <FormLabel optional>SKU</FormLabel>
              <FormInput
                value={modifierFormData.sku}
                onChange={(e) => setModifierFormData((prev) => ({ ...prev, sku: e.target.value }))}
                placeholder="e.g., MOD-001"
              />
            </div>
          </div>

          <div>
            <FormLabel optional>Description</FormLabel>
            <FormTextarea
              value={modifierFormData.description}
              onChange={(e) => setModifierFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Optional description..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel optional>Calories</FormLabel>
              <FormInput
                type="number"
                min="0"
                step="1"
                value={modifierFormData.calories}
                onChange={(e) => setModifierFormData((prev) => ({ ...prev, calories: e.target.value }))}
                placeholder="e.g., 150"
              />
            </div>
            <div className="flex items-end pb-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="detailIsDefault"
                  checked={modifierFormData.isDefault}
                  onChange={(e) => setModifierFormData((prev) => ({ ...prev, isDefault: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="detailIsDefault" className="text-sm text-gray-700 dark:text-gray-300">
                  Pre-selected by default
                </label>
              </div>
            </div>
          </div>

          <div>
            <FormLabel optional>Allergens</FormLabel>
            <div className="flex flex-wrap gap-2 mt-1">
              {COMMON_ALLERGENS.map((allergen) => (
                <button
                  key={allergen}
                  type="button"
                  onClick={() => toggleAllergen(allergen)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    modifierFormData.allergens.includes(allergen)
                      ? 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-600'
                  }`}
                >
                  {modifierFormData.allergens.includes(allergen) && (
                    <Check size={12} className="inline mr-1" />
                  )}
                  {allergen}
                </button>
              ))}
            </div>
          </div>
        </form>
      </Modal>

      {/* Delete Modifier Confirm */}
      <ConfirmModal
        isOpen={deleteModifierConfirm.open}
        onClose={() => setDeleteModifierConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDeleteModifier}
        title="Delete Modifier"
        message={`Are you sure you want to delete "${deleteModifierConfirm.name}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Delete"
      />
    </div>
  )
}
