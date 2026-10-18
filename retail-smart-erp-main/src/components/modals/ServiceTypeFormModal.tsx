'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { toast } from '@/components/ui/toast'
import { isValidPositiveNumber } from '@/lib/utils/validation'

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
  isActive: boolean
}

interface ServiceTypeFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (serviceType: { id: string }) => void
  editServiceType?: ServiceType | null
}

export function ServiceTypeFormModal({ isOpen, onClose, onSaved, editServiceType }: ServiceTypeFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [groups, setGroups] = useState<ServiceTypeGroup[]>([])
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [_pendingGroupName, setPendingGroupName] = useState('')
  const [groupFormData, setGroupFormData] = useState({ name: '', description: '' })
  const [savingGroup, setSavingGroup] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    defaultHours: '',
    defaultRate: '',
    groupId: '',
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
    if (isOpen) {
      fetchGroups()
      if (editServiceType) {
        setFormData({
          name: editServiceType.name,
          description: editServiceType.description || '',
          defaultHours: editServiceType.defaultHours || '',
          defaultRate: editServiceType.defaultRate || '',
          groupId: editServiceType.groupId || '',
        })
      } else {
        resetForm()
      }
    }
  }, [isOpen, editServiceType, fetchGroups])

  function resetForm() {
    setFormData({
      name: '',
      description: '',
      defaultHours: '',
      defaultRate: '',
      groupId: '',
    })
    setError('')
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  async function handleGroupSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSavingGroup(true)

    try {
      const res = await fetch('/api/service-type-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groupFormData),
      })

      if (res.ok) {
        const newGroup = await res.json()
        setGroups([...groups, newGroup])
        setFormData({ ...formData, groupId: newGroup.id })
        setShowGroupModal(false)
        setGroupFormData({ name: '', description: '' })
        setPendingGroupName('')
        toast.success('Group created')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create group')
      }
    } catch (error) {
      console.error('Error creating group:', error)
      toast.error('Failed to create group')
    } finally {
      setSavingGroup(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate numeric fields
    if (formData.defaultHours && !isValidPositiveNumber(formData.defaultHours)) {
      setError('Default hours must be a valid positive number')
      return
    }
    if (formData.defaultRate && !isValidPositiveNumber(formData.defaultRate)) {
      setError('Default rate must be a valid positive number')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editServiceType ? `/api/service-types/${editServiceType.id}` : '/api/service-types'
      const method = editServiceType ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          defaultHours: formData.defaultHours ? parseFloat(formData.defaultHours) : null,
          defaultRate: formData.defaultRate ? parseFloat(formData.defaultRate) : null,
          groupId: formData.groupId || null,
        }),
      })

      if (res.ok) {
        const serviceType = await res.json()
        toast.success(editServiceType ? 'Service type updated' : 'Service type created')
        onSaved(serviceType)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save service type')
      }
    } catch {
      setError('Failed to save service type')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} title={editServiceType ? 'Edit Service Type' : 'New Service Type'} size="xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Group</label>
              <CreatableSelect
                options={groups.map(g => ({ value: g.id, label: g.name }))}
                value={formData.groupId}
                onChange={(value) => setFormData({ ...formData, groupId: value })}
                onCreateNew={(name) => {
                  setPendingGroupName(name)
                  setGroupFormData({ name, description: '' })
                  setShowGroupModal(true)
                }}
                placeholder="Select Group (Optional)"
                createLabel="Create group"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Default Hours</label>
              <input
                type="number"
                step="0.25"
                min="0"
                value={formData.defaultHours}
                onChange={(e) => setFormData({ ...formData, defaultHours: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
                placeholder="e.g., 1.5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Default Rate (per hour)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.defaultRate}
                onChange={(e) => setFormData({ ...formData, defaultRate: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
                placeholder="e.g., 75.00"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editServiceType ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Group Creation Modal */}
      <Modal isOpen={showGroupModal} onClose={() => { setShowGroupModal(false); setPendingGroupName(''); setGroupFormData({ name: '', description: '' }) }} title="New Group" size="md">
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
              onClick={() => { setShowGroupModal(false); setPendingGroupName(''); setGroupFormData({ name: '', description: '' }) }}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingGroup}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {savingGroup ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
