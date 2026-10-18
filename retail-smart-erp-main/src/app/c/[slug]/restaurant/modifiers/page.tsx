'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Edit, Trash2, Check, X,
  ChevronDown, ChevronUp, Settings, Tag, Package,
} from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { Pagination } from '@/components/ui/pagination'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormInput, FormLabel, FormTextarea } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { EmptyState, Button } from '@/components/ui'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatCurrency } from '@/lib/utils/currency'

// ============================================
// TYPES
// ============================================

interface ModifierGroupListItem {
  id: string
  name: string
  description: string | null
  minSelections: number | null
  maxSelections: number | null
  isRequired: boolean
  isActive: boolean
  sortOrder: number | null
  modifierCount: number
  itemCount: number
  createdAt: string
  updatedAt: string | null
}

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

interface GroupFormData {
  name: string
  description: string
  minSelections: string
  maxSelections: string
  isRequired: boolean
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

const INITIAL_GROUP_FORM: GroupFormData = {
  name: '',
  description: '',
  minSelections: '0',
  maxSelections: '',
  isRequired: false,
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

export default function ModifierGroupsPage() {
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()

  // State for expanded groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [groupModifiers, setGroupModifiers] = useState<Record<string, Modifier[]>>({})
  const [loadingModifiers, setLoadingModifiers] = useState<Set<string>>(new Set())

  // Group modal state
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ModifierGroupListItem | null>(null)
  const [groupFormData, setGroupFormData] = useState<GroupFormData>(INITIAL_GROUP_FORM)
  const [savingGroup, setSavingGroup] = useState(false)

  // Modifier modal state
  const [showModifierModal, setShowModifierModal] = useState(false)
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null)
  const [modifierGroupId, setModifierGroupId] = useState<string | null>(null)
  const [modifierFormData, setModifierFormData] = useState<ModifierFormData>(INITIAL_MODIFIER_FORM)
  const [savingModifier, setSavingModifier] = useState(false)

  // Delete state
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })
  const [deleteModifierConfirm, setDeleteModifierConfirm] = useState<{ open: boolean; id: string | null; groupId: string | null; name: string }>({ open: false, id: null, groupId: null, name: '' })

  // Active filter
  const [activeFilter, setActiveFilter] = useState<string>('')

  // Paginated data
  const {
    data: groups,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<ModifierGroupListItem>({
    endpoint: '/api/modifier-groups',
    entityType: 'modifier-group',
    storageKey: 'modifier-groups-page-size',
    additionalParams: activeFilter ? { isActive: activeFilter } : undefined,
  })

  // ============================================
  // EXPAND/COLLAPSE GROUP
  // ============================================

  async function toggleExpand(groupId: string) {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId)
    } else {
      newExpanded.add(groupId)
      // Load modifiers if not already loaded
      if (!groupModifiers[groupId]) {
        await fetchModifiers(groupId)
      }
    }
    setExpandedGroups(newExpanded)
  }

  async function fetchModifiers(groupId: string) {
    setLoadingModifiers((prev) => new Set([...prev, groupId]))
    try {
      const res = await fetch(`/api/modifier-groups/${groupId}/modifiers`)
      if (res.ok) {
        const data = await res.json()
        setGroupModifiers((prev) => ({ ...prev, [groupId]: data }))
      } else {
        toast.error('Failed to load modifiers')
      }
    } catch {
      toast.error('Failed to load modifiers')
    } finally {
      setLoadingModifiers((prev) => {
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
    }
  }

  // ============================================
  // GROUP HANDLERS
  // ============================================

  function handleOpenCreateGroup() {
    setEditingGroup(null)
    setGroupFormData(INITIAL_GROUP_FORM)
    setShowGroupModal(true)
  }

  function handleEditGroup(group: ModifierGroupListItem) {
    setEditingGroup(group)
    setGroupFormData({
      name: group.name,
      description: group.description || '',
      minSelections: String(group.minSelections ?? 0),
      maxSelections: group.maxSelections !== null ? String(group.maxSelections) : '',
      isRequired: group.isRequired,
    })
    setShowGroupModal(true)
  }

  function handleCloseGroupModal() {
    setShowGroupModal(false)
    setEditingGroup(null)
    setGroupFormData(INITIAL_GROUP_FORM)
  }

  async function handleSaveGroup(e: React.FormEvent) {
    e.preventDefault()

    if (!groupFormData.name.trim()) {
      toast.error('Group name is required')
      return
    }

    setSavingGroup(true)
    try {
      const url = editingGroup
        ? `/api/modifier-groups/${editingGroup.id}`
        : '/api/modifier-groups'
      const method = editingGroup ? 'PUT' : 'POST'

      const payload = {
        name: groupFormData.name.trim(),
        description: groupFormData.description.trim() || null,
        minSelections: parseInt(groupFormData.minSelections) || 0,
        maxSelections: groupFormData.maxSelections ? parseInt(groupFormData.maxSelections) : null,
        isRequired: groupFormData.isRequired,
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        toast.success(editingGroup ? 'Modifier group updated' : 'Modifier group created')
        handleCloseGroupModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save modifier group')
      }
    } catch {
      toast.error('Failed to save modifier group')
    } finally {
      setSavingGroup(false)
    }
  }

  async function handleDeleteGroup() {
    if (!deleteGroupConfirm.id) return

    try {
      const res = await fetch(`/api/modifier-groups/${deleteGroupConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Modifier group deleted')
        refresh()
        // Clean up local state
        setExpandedGroups((prev) => {
          const next = new Set(prev)
          next.delete(deleteGroupConfirm.id!)
          return next
        })
        setGroupModifiers((prev) => {
          const next = { ...prev }
          delete next[deleteGroupConfirm.id!]
          return next
        })
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete modifier group')
      }
    } catch {
      toast.error('Failed to delete modifier group')
    } finally {
      setDeleteGroupConfirm({ open: false, id: null, name: '' })
    }
  }

  async function handleToggleGroupActive(group: ModifierGroupListItem) {
    try {
      const res = await fetch(`/api/modifier-groups/${group.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...group,
          isActive: !group.isActive,
        }),
      })

      if (res.ok) {
        toast.success(group.isActive ? 'Modifier group deactivated' : 'Modifier group activated')
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update modifier group')
      }
    } catch {
      toast.error('Failed to update modifier group')
    }
  }

  // ============================================
  // MODIFIER HANDLERS
  // ============================================

  function handleOpenCreateModifier(groupId: string) {
    setEditingModifier(null)
    setModifierGroupId(groupId)
    setModifierFormData(INITIAL_MODIFIER_FORM)
    setShowModifierModal(true)
  }

  function handleEditModifier(modifier: Modifier) {
    setEditingModifier(modifier)
    setModifierGroupId(modifier.groupId)
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
    setModifierGroupId(null)
    setModifierFormData(INITIAL_MODIFIER_FORM)
  }

  async function handleSaveModifier(e: React.FormEvent) {
    e.preventDefault()

    if (!modifierFormData.name.trim()) {
      toast.error('Modifier name is required')
      return
    }

    if (!modifierGroupId) return

    setSavingModifier(true)
    try {
      const url = editingModifier
        ? `/api/modifier-groups/${modifierGroupId}/modifiers/${editingModifier.id}`
        : `/api/modifier-groups/${modifierGroupId}/modifiers`
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
        // Refresh modifiers for this group
        await fetchModifiers(modifierGroupId)
        refresh()
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
    if (!deleteModifierConfirm.id || !deleteModifierConfirm.groupId) return

    const groupId = deleteModifierConfirm.groupId
    try {
      const res = await fetch(`/api/modifier-groups/${groupId}/modifiers/${deleteModifierConfirm.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Modifier deleted')
        await fetchModifiers(groupId)
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete modifier')
      }
    } catch {
      toast.error('Failed to delete modifier')
    } finally {
      setDeleteModifierConfirm({ open: false, id: null, groupId: null, name: '' })
    }
  }

  async function handleMoveModifier(groupId: string, modifierId: string, direction: 'up' | 'down') {
    const mods = groupModifiers[groupId]
    if (!mods) return

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
    setGroupModifiers((prev) => ({ ...prev, [groupId]: newMods }))

    // Update sort orders on server
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
      // Revert on error
      await fetchModifiers(groupId)
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
  // RENDER
  // ============================================

  if (loading && groups.length === 0) {
    return <PageLoading text="Loading modifier groups..." />
  }

  return (
    <ListPageLayout
      module="Restaurant"
      moduleHref="/restaurant"
      title="Modifier Groups"
      actionButton={{ label: 'New Modifier Group', onClick: handleOpenCreateGroup }}
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search modifier groups..."
      filterContent={
        <>
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All</option>
            <option value="true">Active Only</option>
            <option value="false">Inactive Only</option>
          </select>
          {activeFilter && (
            <button onClick={() => setActiveFilter('')} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="flex-1 overflow-auto p-4">
        {groups.length === 0 ? (
          <EmptyState
            icon={<Settings size={24} />}
            title={search ? 'No modifier groups found' : 'No modifier groups yet'}
            description={
              search
                ? 'Try adjusting your search terms'
                : 'Create modifier groups to let customers customize menu items (e.g., toppings, sizes, extras)'
            }
            action={
              !search && (
                <Button onClick={handleOpenCreateGroup} size="sm">
                  <Plus size={16} className="mr-1" />
                  New Modifier Group
                </Button>
              )
            }
          />
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div
                key={group.id}
                className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                {/* Group Header */}
                <div
                  className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  onClick={() => toggleExpand(group.id)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                      <Settings className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-white truncate">
                          {group.name}
                        </span>
                        {group.isRequired && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            Required
                          </span>
                        )}
                        {!group.isActive && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {group.description && (
                          <span className="truncate max-w-xs">{group.description}</span>
                        )}
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <Tag size={12} />
                          {group.modifierCount} modifier{group.modifierCount !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <Package size={12} />
                          {group.itemCount} item{group.itemCount !== 1 ? 's' : ''}
                        </span>
                        {(group.minSelections !== null && group.minSelections !== undefined) && (
                          <span className="flex-shrink-0">
                            Select: {group.minSelections}{group.maxSelections !== null ? `\u2013${group.maxSelections}` : '+'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditGroup(group) }}
                      className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                      title="Edit group"
                    >
                      <Edit size={15} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleGroupActive(group) }}
                      className={`p-1.5 rounded transition-colors ${
                        group.isActive
                          ? 'text-green-600 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                          : 'text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                      }`}
                      title={group.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {group.isActive ? <Check size={15} /> : <X size={15} />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteGroupConfirm({ open: true, id: group.id, name: group.name })
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Delete group"
                    >
                      <Trash2 size={15} />
                    </button>
                    {expandedGroups.has(group.id) ? (
                      <ChevronUp size={18} className="text-gray-400 ml-1" />
                    ) : (
                      <ChevronDown size={18} className="text-gray-400 ml-1" />
                    )}
                  </div>
                </div>

                {/* Expanded Modifiers */}
                {expandedGroups.has(group.id) && (
                  <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                    <div className="px-4 py-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Modifiers
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => router.push(`/c/${tenantSlug}/restaurant/modifiers/${group.id}`)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Full Details
                        </button>
                        <button
                          onClick={() => handleOpenCreateModifier(group.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                        >
                          <Plus size={14} />
                          Add Modifier
                        </button>
                      </div>
                    </div>

                    {loadingModifiers.has(group.id) ? (
                      <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                        Loading modifiers...
                      </div>
                    ) : !groupModifiers[group.id] || groupModifiers[group.id].length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                        No modifiers yet. Click &quot;Add Modifier&quot; to create one.
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {groupModifiers[group.id].map((modifier, idx) => (
                          <div
                            key={modifier.id}
                            className="px-4 py-2.5 flex items-center justify-between hover:bg-white dark:hover:bg-gray-800 transition-colors"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              {/* Sort arrows */}
                              <div className="flex flex-col gap-0.5 flex-shrink-0">
                                <button
                                  onClick={() => handleMoveModifier(group.id, modifier.id, 'up')}
                                  disabled={idx === 0}
                                  className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <ChevronUp size={12} />
                                </button>
                                <button
                                  onClick={() => handleMoveModifier(group.id, modifier.id, 'down')}
                                  disabled={idx === groupModifiers[group.id].length - 1}
                                  className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <ChevronDown size={12} />
                                </button>
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">
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
                                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                  {parseFloat(modifier.price) > 0 && (
                                    <span className="font-medium text-green-600 dark:text-green-400">
                                      +{formatCurrency(modifier.price, currency)}
                                    </span>
                                  )}
                                  {modifier.allergens && modifier.allergens.length > 0 && (
                                    <span className="text-orange-600 dark:text-orange-400">
                                      {modifier.allergens.join(', ')}
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
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() =>
                                  setDeleteModifierConfirm({
                                    open: true,
                                    id: modifier.id,
                                    groupId: group.id,
                                    name: modifier.name,
                                  })
                                }
                                className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                title="Delete modifier"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Pagination */}
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <Pagination
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                className="px-4"
              />
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Group Modal */}
      <Modal
        isOpen={showGroupModal}
        onClose={handleCloseGroupModal}
        title={editingGroup ? 'Edit Modifier Group' : 'New Modifier Group'}
        size="lg"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={handleCloseGroupModal}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveGroup}
              disabled={savingGroup || !groupFormData.name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingGroup ? 'Saving...' : editingGroup ? 'Update Group' : 'Create Group'}
            </button>
          </ModalFooter>
        }
      >
        <form onSubmit={handleSaveGroup} className="space-y-4">
          <div>
            <FormLabel required>Group Name</FormLabel>
            <FormInput
              value={groupFormData.name}
              onChange={(e) => setGroupFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Pizza Toppings, Drink Size, Extra Sauces"
              autoFocus
            />
          </div>

          <div>
            <FormLabel optional>Description</FormLabel>
            <FormTextarea
              value={groupFormData.description}
              onChange={(e) => setGroupFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Brief description of this modifier group..."
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
                placeholder="0"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Minimum options the customer must select
              </p>
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
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Maximum options allowed (blank = no limit)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isRequired"
              checked={groupFormData.isRequired}
              onChange={(e) => setGroupFormData((prev) => ({ ...prev, isRequired: e.target.checked }))}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="isRequired" className="text-sm text-gray-700 dark:text-gray-300">
              Required - customer must make a selection from this group
            </label>
          </div>
        </form>
      </Modal>

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
                  id="isDefault"
                  checked={modifierFormData.isDefault}
                  onChange={(e) => setModifierFormData((prev) => ({ ...prev, isDefault: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700 dark:text-gray-300">
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

      {/* Delete Group Confirm */}
      <ConfirmModal
        isOpen={deleteGroupConfirm.open}
        onClose={() => setDeleteGroupConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDeleteGroup}
        title="Delete Modifier Group"
        message={`Are you sure you want to delete "${deleteGroupConfirm.name}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Delete"
      />

      {/* Delete Modifier Confirm */}
      <ConfirmModal
        isOpen={deleteModifierConfirm.open}
        onClose={() => setDeleteModifierConfirm({ open: false, id: null, groupId: null, name: '' })}
        onConfirm={handleDeleteModifier}
        title="Delete Modifier"
        message={`Are you sure you want to delete "${deleteModifierConfirm.name}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Delete"
      />
    </ListPageLayout>
  )
}
