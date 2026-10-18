'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, Search, FolderPlus, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { AlertModal } from '@/components/ui/alert-modal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ServiceTypeFormModal } from '@/components/modals'
import { Modal } from '@/components/ui/modal'

interface ServiceTypeGroup {
  id: string
  name: string
  description: string | null
}

interface ServiceType {
  id: string
  name: string
  description: string | null
  defaultHours: string | null
  defaultRate: string | null
  groupId: string | null
  group: ServiceTypeGroup | null
  isActive: boolean
}

export default function ServiceTypesPage() {
  const [groups, setGroups] = useState<ServiceTypeGroup[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['ungrouped']))

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingServiceType, setEditingServiceType] = useState<ServiceType | null>(null)

  // Group form modal
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ServiceTypeGroup | null>(null)
  const [groupFormData, setGroupFormData] = useState({ name: '', description: '' })
  const [savingGroup, setSavingGroup] = useState(false)

  // Delete confirm modals
  const [deleteServiceConfirm, setDeleteServiceConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; message: string; variant: 'error' | 'warning' | 'info' | 'success' }>({ open: false, title: '', message: '', variant: 'error' })

  // Paginated service types with server-side search
  const {
    data: serviceTypes,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: fetchServiceTypes,
  } = usePaginatedData<ServiceType>({
    endpoint: '/api/service-types',
    entityType: ['service', 'service-type-group'],
    storageKey: 'service-types-page-size',
  })

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/service-type-groups')
      if (res.ok) {
        const data = await res.json()
        setGroups(data)
      }
    } catch (error) {
      console.error('Error fetching groups:', error)
    }
  }, [])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  async function handleGroupSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSavingGroup(true)

    try {
      const url = editingGroup ? `/api/service-type-groups/${editingGroup.id}` : '/api/service-type-groups'
      const method = editingGroup ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groupFormData),
      })

      if (res.ok) {
        const newGroup = await res.json()
        fetchGroups()
        closeGroupModal()
        toast.success(editingGroup ? 'Group updated' : 'Group created')
        // If creating, expand the new group
        if (!editingGroup) {
          setExpandedGroups(prev => new Set([...prev, newGroup.id]))
        }
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save group')
      }
    } catch (error) {
      console.error('Error saving group:', error)
      toast.error('Failed to save group')
    } finally {
      setSavingGroup(false)
    }
  }

  async function handleDeleteService() {
    if (!deleteServiceConfirm.id) return

    try {
      const res = await fetch(`/api/service-types/${deleteServiceConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        fetchServiceTypes()
        toast.success('Service type deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete service type')
      }
    } catch (error) {
      console.error('Error deleting service type:', error)
      toast.error('Failed to delete service type')
    } finally {
      setDeleteServiceConfirm({ open: false, id: null, name: '' })
    }
  }

  function confirmDeleteGroup(id: string, name: string) {
    const groupServices = serviceTypes.filter(s => s.groupId === id)
    if (groupServices.length > 0) {
      setAlertModal({ open: true, title: 'Cannot Delete Group', message: 'Cannot delete group with service types. Move or delete the service types first.', variant: 'warning' })
      return
    }
    setDeleteGroupConfirm({ open: true, id, name })
  }

  async function handleDeleteGroup() {
    if (!deleteGroupConfirm.id) return

    try {
      const res = await fetch(`/api/service-type-groups/${deleteGroupConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        setGroups(groups.filter(g => g.id !== deleteGroupConfirm.id))
        toast.success('Group deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete group')
      }
    } catch (error) {
      console.error('Error deleting group:', error)
      toast.error('Failed to delete group')
    } finally {
      setDeleteGroupConfirm({ open: false, id: null, name: '' })
    }
  }

  function handleEdit(serviceType: ServiceType) {
    setEditingServiceType(serviceType)
    setShowFormModal(true)
  }

  function handleAdd() {
    setEditingServiceType(null)
    setShowFormModal(true)
  }

  function handleEditGroup(group: ServiceTypeGroup) {
    setEditingGroup(group)
    setGroupFormData({
      name: group.name,
      description: group.description || '',
    })
    setShowGroupModal(true)
  }

  function handleAddGroup() {
    setEditingGroup(null)
    setGroupFormData({ name: '', description: '' })
    setShowGroupModal(true)
  }

  function closeGroupModal() {
    setShowGroupModal(false)
    setEditingGroup(null)
    setGroupFormData({ name: '', description: '' })
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupId)) {
        newSet.delete(groupId)
      } else {
        newSet.add(groupId)
      }
      return newSet
    })
  }

  // Group service types - memoized (search is now server-side)
  const groupedServiceTypes = useMemo(() => {
    const grouped: Record<string, ServiceType[]> = { ungrouped: [] }
    groups.forEach(g => { grouped[g.id] = [] })

    serviceTypes.forEach(st => {
      if (st.groupId && grouped[st.groupId]) {
        grouped[st.groupId].push(st)
      } else {
        grouped['ungrouped'].push(st)
      }
    })
    return grouped
  }, [serviceTypes, groups])

  if (loading && serviceTypes.length === 0) {
    return <PageLoading text="Loading service types..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Service Types</h1>
        <div className="flex gap-2">
          <button
            onClick={handleAddGroup}
            className="flex items-center gap-2 px-4 py-2 border border-blue-600 text-blue-600 rounded hover:bg-blue-50"
          >
            <FolderPlus size={20} />
            Add Group
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={20} />
            Add Service Type
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search service types..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Grouped View */}
      <div className="space-y-4 list-container-xl">
        {/* Render each group */}
        {groups.map(group => {
          const groupItems = groupedServiceTypes[group.id] || []
          const isExpanded = expandedGroups.has(group.id)

          return (
            <div key={group.id} className="bg-white rounded border overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
                onClick={() => toggleGroup(group.id)}
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <span className="font-medium">{group.name}</span>
                  <span className="text-sm text-gray-500">({groupItems.length})</span>
                </div>
                {group.name !== 'Group Service Type' && (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleEditGroup(group)}
                      className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => confirmDeleteGroup(group.id, group.name)}
                      className="p-1 text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              {isExpanded && groupItems.length > 0 && (
                <table className="w-full">
                  <caption className="sr-only">Service types in group</caption>
                  <thead className="bg-gray-50 border-t">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600">Name</th>
                      <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600">Description</th>
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Hours</th>
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Rate</th>
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total</th>
                      <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupItems.map((st) => {
                      const hours = st.defaultHours ? parseFloat(st.defaultHours) : 0
                      const rate = st.defaultRate ? parseFloat(st.defaultRate) : 0
                      const total = hours * rate
                      return (
                        <tr key={st.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{st.name}</td>
                          <td className="px-4 py-3 text-gray-600">{st.description || '-'}</td>
                          <td className="px-4 py-3 text-right">
                            {hours > 0 ? hours.toFixed(2) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {rate > 0 ? rate.toFixed(2) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {total > 0 ? total.toFixed(2) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleEdit(st)}
                              aria-label={`Edit ${st.name}`}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            >
                              <Pencil size={18} />
                            </button>
                            <button
                              onClick={() => setDeleteServiceConfirm({ open: true, id: st.id, name: st.name })}
                              aria-label={`Delete ${st.name}`}
                              className="p-1 text-red-600 hover:bg-red-50 rounded ml-2"
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {isExpanded && groupItems.length === 0 && (
                <div className="px-4 py-6 text-center text-gray-500 border-t">
                  No service types in this group
                </div>
              )}
            </div>
          )
        })}

        {/* Ungrouped items */}
        {groupedServiceTypes['ungrouped'].length > 0 && (
          <div className="bg-white rounded border overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
              onClick={() => toggleGroup('ungrouped')}
            >
              <div className="flex items-center gap-2">
                {expandedGroups.has('ungrouped') ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className="font-medium text-gray-600">Ungrouped</span>
                <span className="text-sm text-gray-500">({groupedServiceTypes['ungrouped'].length})</span>
              </div>
            </div>
            {expandedGroups.has('ungrouped') && (
              <table className="w-full">
                <caption className="sr-only">Ungrouped service types</caption>
                <thead className="bg-gray-50 border-t">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600">Name</th>
                    <th scope="col" className="px-4 py-2 text-left text-sm font-medium text-gray-600">Description</th>
                    <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Hours</th>
                    <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Rate</th>
                    <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total</th>
                    <th scope="col" className="px-4 py-2 text-right text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedServiceTypes['ungrouped'].map((st) => {
                    const hours = st.defaultHours ? parseFloat(st.defaultHours) : 0
                    const rate = st.defaultRate ? parseFloat(st.defaultRate) : 0
                    const total = hours * rate
                    return (
                      <tr key={st.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{st.name}</td>
                        <td className="px-4 py-3 text-gray-600">{st.description || '-'}</td>
                        <td className="px-4 py-3 text-right">
                          {hours > 0 ? hours.toFixed(2) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {rate > 0 ? rate.toFixed(2) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {total > 0 ? total.toFixed(2) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleEdit(st)}
                            aria-label={`Edit ${st.name}`}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Pencil size={18} />
                          </button>
                          <button
                            onClick={() => setDeleteServiceConfirm({ open: true, id: st.id, name: st.name })}
                            aria-label={`Delete ${st.name}`}
                            className="p-1 text-red-600 hover:bg-red-50 rounded ml-2"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Empty state */}
        {groups.length === 0 && groupedServiceTypes['ungrouped'].length === 0 && (
          <div className="bg-white rounded border p-8 text-center text-gray-500">
            No service types yet. Add your first service type!
          </div>
        )}

        {/* Pagination */}
        <div className="bg-white rounded border mt-4">
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

      {/* Service Type Form Modal */}
      <ServiceTypeFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false)
          setEditingServiceType(null)
        }}
        onSaved={fetchServiceTypes}
        editServiceType={editingServiceType}
      />

      {/* Group Form Modal */}
      <Modal isOpen={showGroupModal} onClose={closeGroupModal} title={editingGroup ? 'Edit Group' : 'New Group'} size="md">
        <form onSubmit={handleGroupSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Group Name *</label>
            <input
              type="text"
              value={groupFormData.name}
              onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
              placeholder="e.g., Engine Services"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              type="text"
              value={groupFormData.description}
              onChange={(e) => setGroupFormData({ ...groupFormData, description: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
              placeholder="Optional description"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={closeGroupModal}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingGroup}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {savingGroup ? 'Saving...' : editingGroup ? 'Update Group' : 'Create Group'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={deleteServiceConfirm.open}
        onClose={() => setDeleteServiceConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDeleteService}
        title="Delete Service Type"
        message={`Are you sure you want to delete "${deleteServiceConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmModal
        isOpen={deleteGroupConfirm.open}
        onClose={() => setDeleteGroupConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDeleteGroup}
        title="Delete Group"
        message={`Are you sure you want to delete the group "${deleteGroupConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      <AlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal({ ...alertModal, open: false })}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </div>
  )
}
