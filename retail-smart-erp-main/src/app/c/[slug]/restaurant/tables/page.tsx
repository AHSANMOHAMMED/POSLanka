'use client'

import { useState, useEffect, useCallback } from 'react'
import { Edit, Users, Loader2, Link2, Unlink, UserCheck, Check, X, ChevronDown } from 'lucide-react'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination } from '@/components/ui/pagination'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormInput, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'

interface Table {
  id: string
  name: string
  area: string | null
  capacity: number
  status: string
  isActive: boolean
  serverId: string | null
  tableGroupId: string | null
}

interface TableGroupMember {
  id: string
  tableId: string
  table: Table
}

interface ServerInfo {
  id: string
  fullName: string
  role: string
}

interface TableGroup {
  id: string
  name: string
  combinedCapacity: number
  status: string
  serverId: string | null
  notes: string | null
  createdAt: string
  server: ServerInfo | null
  members: TableGroupMember[]
}

const statusColors: Record<string, string> = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  occupied: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  reserved: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  unavailable: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
}

const statusLabels: Record<string, string> = {
  available: 'Available',
  occupied: 'Occupied',
  reserved: 'Reserved',
  unavailable: 'Unavailable',
}

export default function RestaurantTablesPage() {
  const [statusFilter, setStatusFilter] = useState('')
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingTable, setEditingTable] = useState<Table | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    area: '',
    capacity: 4,
  })
  const [saving, setSaving] = useState(false)

  // Merge mode state
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([])
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [mergeFormData, setMergeFormData] = useState({
    name: '',
    serverId: '',
    notes: '',
  })
  const [merging, setMerging] = useState(false)

  // Table groups state
  const [tableGroups, setTableGroups] = useState<TableGroup[]>([])
  const [splitting, setSplitting] = useState<string | null>(null)

  // Server assignment state
  const [servers, setServers] = useState<ServerInfo[]>([])
  const [assigningServer, setAssigningServer] = useState<string | null>(null)
  const [serverDropdownOpen, setServerDropdownOpen] = useState<string | null>(null)

  // Paginated tables data
  const {
    data: tables,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Table>({
    endpoint: '/api/restaurant-tables',
    entityType: 'table',
    storageKey: 'restaurant-tables-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : {},
  })

  // Fetch table groups
  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant-tables/groups')
      if (res.ok) {
        const data = await res.json()
        setTableGroups(data)
      }
    } catch {
      // silently fail
    }
  }, [])

  // Fetch eligible servers
  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant-tables/server-assignments')
      if (res.ok) {
        const data = await res.json()
        setServers(data.servers || [])
      }
    } catch {
      // silently fail
    }
  }, [])

  // Real-time updates for table groups
  useRealtimeData(fetchGroups, { entityType: 'table-group' })

  // Initial data load
  useEffect(() => {
    fetchGroups()
    fetchServers()
  }, [fetchGroups, fetchServers])

  // Reset form when modal opens/closes
  useEffect(() => {
    if (showFormModal) {
      if (editingTable) {
        setFormData({
          name: editingTable.name,
          area: editingTable.area || '',
          capacity: editingTable.capacity,
        })
      } else {
        setFormData({
          name: '',
          area: '',
          capacity: 4,
        })
      }
    }
  }, [showFormModal, editingTable])

  // Handle form submit
  async function handleSubmit() {
    if (!formData.name.trim()) {
      toast.error('Table name is required')
      return
    }

    setSaving(true)
    try {
      const url = editingTable
        ? `/api/restaurant-tables/${editingTable.id}`
        : '/api/restaurant-tables'

      const res = await fetch(url, {
        method: editingTable ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          area: formData.area.trim() || null,
          capacity: formData.capacity,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to save table')
      }

      toast.success(editingTable ? 'Table updated' : 'Table created')
      setShowFormModal(false)
      setEditingTable(null)
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save table')
    } finally {
      setSaving(false)
    }
  }

  // Handle edit click
  function handleEditClick(table: Table, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingTable(table)
    setShowFormModal(true)
  }

  // Toggle table selection for merge
  function toggleTableSelection(tableId: string) {
    setSelectedTableIds((prev) =>
      prev.includes(tableId)
        ? prev.filter((id) => id !== tableId)
        : [...prev, tableId]
    )
  }

  // Handle merge confirmation
  async function handleMerge() {
    if (selectedTableIds.length < 2) {
      toast.error('Select at least 2 tables to merge')
      return
    }

    setMerging(true)
    try {
      const res = await fetch('/api/restaurant-tables/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableIds: selectedTableIds,
          name: mergeFormData.name.trim() || undefined,
          serverId: mergeFormData.serverId || undefined,
          notes: mergeFormData.notes.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to merge tables')
      }

      toast.success('Tables merged successfully')
      setShowMergeModal(false)
      setMergeMode(false)
      setSelectedTableIds([])
      setMergeFormData({ name: '', serverId: '', notes: '' })
      refresh()
      fetchGroups()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to merge tables')
    } finally {
      setMerging(false)
    }
  }

  // Handle split (disband group)
  async function handleSplit(groupId: string) {
    setSplitting(groupId)
    try {
      const res = await fetch(`/api/restaurant-tables/merge/${groupId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to split tables')
      }

      toast.success('Table group disbanded')
      refresh()
      fetchGroups()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to split tables')
    } finally {
      setSplitting(null)
    }
  }

  // Handle server assignment
  async function handleAssignServer(tableId: string, serverId: string | null) {
    setAssigningServer(tableId)
    try {
      const res = await fetch(`/api/restaurant-tables/${tableId}/assign-server`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to assign server')
      }

      toast.success(serverId ? 'Server assigned' : 'Server unassigned')
      refresh()
      setServerDropdownOpen(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to assign server')
    } finally {
      setAssigningServer(null)
    }
  }

  // Get table group info for a table
  function getTableGroup(tableGroupId: string | null): TableGroup | undefined {
    if (!tableGroupId) return undefined
    return tableGroups.find((g) => g.id === tableGroupId)
  }

  // Get group mate names for a table
  function getGroupMateNames(table: Table): string[] {
    const group = getTableGroup(table.tableGroupId)
    if (!group) return []
    return group.members
      .filter((m) => m.tableId !== table.id)
      .map((m) => m.table.name)
  }

  // Get server name for a table
  function getServerName(serverId: string | null): string | null {
    if (!serverId) return null
    const server = servers.find((s) => s.id === serverId)
    return server?.fullName || null
  }

  // Check if a table can be selected for merge (not already in a group and not unavailable)
  function canSelectForMerge(table: Table): boolean {
    return !table.tableGroupId && table.status !== 'unavailable'
  }

  if (loading && tables.length === 0) {
    return <PageLoading text="Loading tables..." />
  }

  return (
    <>
      <ListPageLayout
        module="Restaurant"
        moduleHref="/restaurant"
        title="Tables"
        actionContent={
          <div className="flex items-center gap-2">
            {mergeMode ? (
              <>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {selectedTableIds.length} selected
                </span>
                <button
                  onClick={() => {
                    if (selectedTableIds.length < 2) {
                      toast.error('Select at least 2 tables to merge')
                      return
                    }
                    setShowMergeModal(true)
                  }}
                  disabled={selectedTableIds.length < 2}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Link2 size={16} />
                  Merge ({selectedTableIds.length})
                </button>
                <button
                  onClick={() => {
                    setMergeMode(false)
                    setSelectedTableIds([])
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                >
                  <X size={16} />
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setMergeMode(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 rounded transition-colors"
                >
                  <Link2 size={16} />
                  Merge Tables
                </button>
                <button
                  onClick={() => {
                    setEditingTable(null)
                    setShowFormModal(true)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  New Table
                </button>
              </>
            )}
          </div>
        }
        search={search}
        setSearch={setSearch}
        onRefresh={() => {
          refresh()
          fetchGroups()
          fetchServers()
        }}
        searchPlaceholder="Search tables..."
        filterContent={
          <>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">All Statuses</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {statusFilter && (
              <button onClick={() => setStatusFilter('')} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
                <X size={14} />
              </button>
            )}
          </>
        }
      >
        {/* Active Table Groups Banner */}
        {tableGroups.length > 0 && !mergeMode && (
          <div className="px-4 pt-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
                <Link2 size={14} className="text-purple-500" />
                Merged Table Groups
              </h3>
              <div className="space-y-2">
                {tableGroups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-purple-900 dark:text-purple-200 truncate">
                          {group.name}
                        </span>
                        <span className="text-xs text-purple-600 dark:text-purple-400">
                          ({group.combinedCapacity} seats)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-purple-500 dark:text-purple-400">
                          Tables: {group.members.map((m) => m.table.name).join(', ')}
                        </span>
                        {group.server && (
                          <span className="text-xs text-purple-600 dark:text-purple-300 flex items-center gap-1">
                            <UserCheck size={12} />
                            {group.server.fullName}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleSplit(group.id)}
                      disabled={splitting === group.id}
                      className="ml-2 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-md transition-colors disabled:opacity-50"
                    >
                      {splitting === group.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Unlink size={12} />
                      )}
                      Split
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Merge mode instructions */}
        {mergeMode && (
          <div className="mx-4 mt-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded px-3 py-2">
            <p className="text-sm text-purple-800 dark:text-purple-200">
              Select 2 or more tables to merge into a group. Tables already in a group or marked as unavailable cannot be selected.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
          {tables.length === 0 ? (
            <div className="col-span-full text-center py-8 text-gray-500 dark:text-gray-400">
              {search || statusFilter
                ? 'No tables match your filters'
                : 'No tables yet. Create your first table!'}
            </div>
          ) : (
            tables.map((table) => {
              const isSelected = selectedTableIds.includes(table.id)
              const canSelect = canSelectForMerge(table)
              const groupMateNames = getGroupMateNames(table)
              const serverName = getServerName(table.serverId)

              return (
                <div
                  key={table.id}
                  onClick={() => {
                    if (mergeMode && canSelect) {
                      toggleTableSelection(table.id)
                    }
                  }}
                  className={`
                    bg-white dark:bg-gray-800 rounded border p-4 transition-all relative
                    ${mergeMode && canSelect ? 'cursor-pointer hover:shadow-md' : 'hover:shadow-md'}
                    ${mergeMode && !canSelect ? 'opacity-50 cursor-not-allowed' : ''}
                    ${isSelected ? 'ring-2 ring-purple-500 border-purple-400 dark:border-purple-600' : 'dark:border-gray-700'}
                    ${table.tableGroupId ? 'border-l-4 border-l-purple-500' : ''}
                  `}
                >
                  {/* Selection checkbox in merge mode */}
                  {mergeMode && canSelect && (
                    <div className="absolute top-2 right-2">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-purple-500 border-purple-500 text-white'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                      >
                        {isSelected && <Check size={12} />}
                      </div>
                    </div>
                  )}

                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate">{table.name}</h3>
                      {table.area && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{table.area}</p>
                      )}
                    </div>
                    {!mergeMode && (
                      <button
                        onClick={(e) => handleEditClick(table, e)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      >
                        <Edit size={16} />
                      </button>
                    )}
                  </div>

                  {/* Merged badge */}
                  {groupMateNames.length > 0 && (
                    <div className="mb-2 flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 rounded px-2 py-1">
                      <Link2 size={12} />
                      <span className="truncate">Merged with: {groupMateNames.join(', ')}</span>
                    </div>
                  )}

                  {/* Server assignment */}
                  {!mergeMode && (
                    <div className="mb-2 relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setServerDropdownOpen(
                            serverDropdownOpen === table.id ? null : table.id
                          )
                        }}
                        disabled={assigningServer === table.id}
                        className={`
                          w-full text-left flex items-center gap-1.5 px-2 py-1 text-xs rounded border transition-colors
                          ${serverName
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                            : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-700'
                          }
                        `}
                      >
                        {assigningServer === table.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <UserCheck size={12} />
                        )}
                        <span className="flex-1 truncate">
                          {serverName || 'Assign server...'}
                        </span>
                        <ChevronDown size={12} />
                      </button>

                      {/* Server dropdown */}
                      {serverDropdownOpen === table.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={(e) => {
                              e.stopPropagation()
                              setServerDropdownOpen(null)
                            }}
                          />
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded shadow-lg z-20 max-h-48 overflow-y-auto">
                            {table.serverId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleAssignServer(table.id, null)
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border-b dark:border-gray-700"
                              >
                                Unassign server
                              </button>
                            )}
                            {servers.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                                No eligible servers found
                              </div>
                            ) : (
                              servers.map((server) => (
                                <button
                                  key={server.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleAssignServer(table.id, server.id)
                                  }}
                                  className={`
                                    w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between
                                    ${table.serverId === server.id ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}
                                  `}
                                >
                                  <span>{server.fullName}</span>
                                  <span className="text-gray-400 dark:text-gray-500 capitalize">{server.role}</span>
                                </button>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
                      <Users size={16} />
                      <span className="text-sm">{table.capacity} seats</span>
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[table.status]}`}>
                      {statusLabels[table.status]}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t dark:border-gray-700 px-4 bg-white dark:bg-gray-800"
        />
      </ListPageLayout>

      {/* Form Modal (Create/Edit Table) */}
      <Modal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false)
          setEditingTable(null)
        }}
        title={editingTable ? 'Edit Table' : 'New Table'}
        size="md"
        footer={
          <ModalFooter>
            <button
              onClick={() => {
                setShowFormModal(false)
                setEditingTable(null)
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </span>
              ) : editingTable ? 'Update Table' : 'Create Table'}
            </button>
          </ModalFooter>
        }
      >
        <div className="space-y-4">
          <div>
            <FormLabel required>Table Name</FormLabel>
            <FormInput
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Table 1, Booth A"
            />
          </div>

          <div>
            <FormLabel optional>Area / Section</FormLabel>
            <FormInput
              type="text"
              value={formData.area}
              onChange={(e) => setFormData({ ...formData, area: e.target.value })}
              placeholder="e.g., Main Hall, Patio, VIP"
            />
          </div>

          <div>
            <FormLabel>Seating Capacity</FormLabel>
            <FormInput
              type="number"
              min={1}
              max={50}
              value={formData.capacity}
              onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 4 })}
            />
          </div>
        </div>
      </Modal>

      {/* Merge Modal */}
      <Modal
        isOpen={showMergeModal}
        onClose={() => {
          setShowMergeModal(false)
          setMergeFormData({ name: '', serverId: '', notes: '' })
        }}
        title="Merge Tables"
        size="md"
        footer={
          <ModalFooter>
            <button
              onClick={() => {
                setShowMergeModal(false)
                setMergeFormData({ name: '', serverId: '', notes: '' })
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleMerge}
              disabled={merging}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded transition-colors disabled:opacity-50"
            >
              {merging ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Merging...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Link2 size={16} />
                  Merge Tables
                </span>
              )}
            </button>
          </ModalFooter>
        }
      >
        <div className="space-y-4">
          {/* Selected tables summary */}
          <div>
            <FormLabel>Selected Tables</FormLabel>
            <div className="flex flex-wrap gap-2 mt-1">
              {selectedTableIds.map((id) => {
                const table = tables.find((t) => t.id === id)
                return table ? (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 rounded-md"
                  >
                    {table.name}
                    <span className="text-purple-500 text-xs">({table.capacity} seats)</span>
                  </span>
                ) : null
              })}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Combined capacity:{' '}
              {tables
                .filter((t) => selectedTableIds.includes(t.id))
                .reduce((sum, t) => sum + t.capacity, 0)}{' '}
              seats
            </p>
          </div>

          <div>
            <FormLabel optional>Group Name</FormLabel>
            <FormInput
              type="text"
              value={mergeFormData.name}
              onChange={(e) =>
                setMergeFormData({ ...mergeFormData, name: e.target.value })
              }
              placeholder="Auto-generated if empty"
            />
          </div>

          <div>
            <FormLabel optional>Assign Server</FormLabel>
            <select
              value={mergeFormData.serverId}
              onChange={(e) =>
                setMergeFormData({ ...mergeFormData, serverId: e.target.value })
              }
              className="w-full h-9 px-2.5 py-1.5 text-sm rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">No server assigned</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.fullName} ({server.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <FormLabel optional>Notes</FormLabel>
            <textarea
              value={mergeFormData.notes}
              onChange={(e) =>
                setMergeFormData({ ...mergeFormData, notes: e.target.value })
              }
              placeholder="e.g., Large party, VIP event"
              rows={2}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </Modal>
    </>
  )
}
