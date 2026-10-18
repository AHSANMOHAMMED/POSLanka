'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import {
  Shield, Save, RotateCcw, Plus, Trash2, Loader2,
  ChevronRight, Check, X, Search, Pencil,
} from 'lucide-react'
import {
  ROLE_PERMISSIONS,
  PERMISSION_LABELS,
  OWNER_ONLY_PERMISSIONS,
  ROLE_HIERARCHY,
  getRolesForBusinessType,
  getCategoriesForBusinessType,
  type Permission,
  type UserRole,
} from '@/lib/auth/roles'

interface CustomRole {
  id: string
  name: string
  slug: string
  baseRole: string
  description: string | null
  color: string | null
  isActive: boolean
  permissions: Record<string, boolean>
}

interface OverrideData {
  builtinOverrides: Record<string, Record<string, boolean>>
  customRoles: CustomRole[]
  systemDefaults: typeof ROLE_PERMISSIONS
}


const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  system_manager: 'System Manager',
  accounts_manager: 'Accounts Manager',
  sales_manager: 'Sales Manager',
  purchase_manager: 'Purchase Manager',
  hr_manager: 'HR Manager',
  stock_manager: 'Stock Manager',
  cashier: 'Cashier',
  technician: 'Technician',
  chef: 'Chef',
  waiter: 'Waiter',
  pos_user: 'POS User',
  report_user: 'Report User',
  dealer_sales: 'Dealer Sales',
}

const HIERARCHY_COLORS: Record<number, string> = {
  100: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  80: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  70: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  60: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  40: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  30: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
}

function getHierarchyBadge(level: number): string {
  return HIERARCHY_COLORS[level] || HIERARCHY_COLORS[30]
}

export default function RolePermissionsPage() {
  const { data: session } = useSession()
  const [data, setData] = useState<OverrideData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedRole, setSelectedRole] = useState<string>('manager')
  const [isCustomRole, setIsCustomRole] = useState(false)
  const [localOverrides, setLocalOverrides] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)

  const tenantSlug = session?.user?.tenantSlug || ''
  const businessType = session?.user?.businessType || 'retail'

  // Filter roles and permission categories by business type
  const builtinRoles = useMemo(() => getRolesForBusinessType(businessType), [businessType])
  const businessCategories = useMemo(() => getCategoriesForBusinessType(businessType), [businessType])

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/role-permissions')
      if (res.ok) {
        const result: OverrideData = await res.json()
        setData(result)
      }
    } catch {
      toast.error('Failed to load role permissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useRealtimeData(fetchData, { entityType: 'settings' })

  // When selected role changes, load its current state into local overrides
  useEffect(() => {
    if (!data) return
    const allPerms = Object.keys(ROLE_PERMISSIONS) as Permission[]

    if (isCustomRole) {
      const customRole = data.customRoles.find(r => r.id === selectedRole)
      if (customRole) {
        const perms: Record<string, boolean> = {}
        for (const p of allPerms) {
          // Custom role: explicit permission or base role system default
          const explicit = customRole.permissions[p]
          if (explicit !== undefined) {
            perms[p] = explicit
          } else {
            const defaults = ROLE_PERMISSIONS[p] as readonly string[]
            perms[p] = defaults.includes(customRole.baseRole)
          }
        }
        setLocalOverrides(perms)
      }
    } else {
      const overrides = data.builtinOverrides[selectedRole] || {}
      const perms: Record<string, boolean> = {}
      for (const p of allPerms) {
        const systemDefault = (ROLE_PERMISSIONS[p] as readonly string[]).includes(selectedRole)
        perms[p] = overrides[p] !== undefined ? overrides[p] : systemDefault
      }
      setLocalOverrides(perms)
    }
    setDirty(false)
  }, [data, selectedRole, isCustomRole])

  const togglePermission = useCallback((permKey: string) => {
    if (selectedRole === 'owner' && !isCustomRole) return // Owner is immutable
    if (OWNER_ONLY_PERMISSIONS.includes(permKey as Permission)) return // Protected permissions
    setLocalOverrides(prev => ({ ...prev, [permKey]: !prev[permKey] }))
    setDirty(true)
  }, [selectedRole, isCustomRole])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      if (isCustomRole) {
        // Save custom role permissions
        const res = await fetch(`/api/custom-roles/${selectedRole}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissions: localOverrides }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to save')
        }
      } else {
        // Save built-in role overrides
        const res = await fetch('/api/role-permissions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: selectedRole, overrides: localOverrides }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to save')
        }
      }
      toast.success('Permissions saved')
      setDirty(false)
      fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }, [isCustomRole, selectedRole, localOverrides, fetchData])

  const handleReset = useCallback(async () => {
    if (isCustomRole) return // Custom roles don't have "system defaults"
    if (!confirm(`Reset ${ROLE_LABELS[selectedRole] || selectedRole} to system defaults? All overrides will be removed.`)) return
    setSaving(true)
    try {
      const res = await fetch('/api/role-permissions/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole }),
      })
      if (!res.ok) throw new Error('Failed to reset')
      toast.success('Reset to system defaults')
      setDirty(false)
      fetchData()
    } catch {
      toast.error('Failed to reset permissions')
    } finally {
      setSaving(false)
    }
  }, [isCustomRole, selectedRole, fetchData])

  const handleDeleteCustomRole = useCallback(async (roleId: string) => {
    if (!confirm('Delete this custom role? This action cannot be undone.')) return
    try {
      const res = await fetch(`/api/custom-roles/${roleId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete')
      }
      toast.success('Custom role deleted')
      setSelectedRole('manager')
      setIsCustomRole(false)
      fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete custom role')
    }
  }, [fetchData])

  // Count overrides for each role
  const overrideCounts = useMemo(() => {
    if (!data) return {}
    const counts: Record<string, number> = {}
    for (const [role, overrides] of Object.entries(data.builtinOverrides)) {
      counts[role] = Object.keys(overrides).length
    }
    return counts
  }, [data])

  // Filter permissions by search + business type
  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase()
    const result: Record<string, Permission[]> = {}
    for (const [category, perms] of Object.entries(businessCategories)) {
      const filtered = perms.filter(p => {
        if (!q) return true
        return PERMISSION_LABELS[p].toLowerCase().includes(q) || p.toLowerCase().includes(q) || category.toLowerCase().includes(q)
      })
      if (filtered.length > 0) result[category] = filtered
    }
    return result
  }, [searchQuery])

  // Check if a permission differs from system default
  const isOverridden = useCallback((permKey: string): boolean => {
    if (isCustomRole) return true // All custom role permissions are "custom"
    const systemDefault = (ROLE_PERMISSIONS[permKey as Permission] as readonly string[]).includes(selectedRole)
    return localOverrides[permKey] !== systemDefault
  }, [isCustomRole, selectedRole, localOverrides])

  const isOwnerSelected = selectedRole === 'owner' && !isCustomRole

  return (
    <PermissionGuard permission="manageTenant">
      <div className="space-y-4">
        <Breadcrumb
          items={[
            { label: 'Settings', href: `/c/${tenantSlug}/settings` },
            { label: 'Role Permissions' },
          ]}
        />

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Shield size={24} />
              Role Permissions
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Customize what each role can access across your business
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="flex gap-4 min-h-[600px]">
            {/* Left Panel - Role List */}
            <div className="w-72 flex-shrink-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Built-in Roles</h3>
              </div>
              <div className="max-h-[380px] overflow-y-auto">
                {builtinRoles.map(role => {
                  const level = ROLE_HIERARCHY[role] || 0
                  const isSelected = selectedRole === role && !isCustomRole
                  const overrideCount = overrideCounts[role] || 0
                  return (
                    <button
                      key={role}
                      onClick={() => { setSelectedRole(role); setIsCustomRole(false); setDirty(false) }}
                      className={`w-full px-3 py-2.5 text-left flex items-center gap-2 transition-colors ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-r-2 border-blue-600'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium truncate ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>
                            {ROLE_LABELS[role]}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getHierarchyBadge(level)}`}>
                            L{level}
                          </span>
                        </div>
                        {overrideCount > 0 && (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400">
                            {overrideCount} override{overrideCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {isSelected && <ChevronRight size={14} className="text-blue-500 flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>

              {/* Custom Roles Section */}
              <div className="border-t border-gray-200 dark:border-gray-700">
                <div className="p-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Custom Roles</h3>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                    title="Create custom role"
                  >
                    <Plus size={16} className="text-gray-500" />
                  </button>
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {data?.customRoles.length === 0 && (
                    <p className="px-3 pb-3 text-xs text-gray-400">No custom roles yet</p>
                  )}
                  {data?.customRoles.map(cr => {
                    const isSelected = selectedRole === cr.id && isCustomRole
                    const baseLevel = ROLE_HIERARCHY[cr.baseRole as UserRole] || 0
                    return (
                      <button
                        key={cr.id}
                        onClick={() => { setSelectedRole(cr.id); setIsCustomRole(true); setDirty(false) }}
                        className={`w-full px-3 py-2.5 text-left flex items-center gap-2 transition-colors ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-r-2 border-blue-600'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {cr.color && (
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cr.color }} />
                            )}
                            <span className={`text-sm font-medium truncate ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>
                              {cr.name}
                            </span>
                          </div>
                          <span className="text-[11px] text-gray-400">
                            Based on {ROLE_LABELS[cr.baseRole] || cr.baseRole} (L{baseLevel})
                          </span>
                        </div>
                        {isSelected && <ChevronRight size={14} className="text-blue-500 flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Right Panel - Permission Grid */}
            <div className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex flex-col">
              {/* Header */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {isCustomRole
                      ? data?.customRoles.find(r => r.id === selectedRole)?.name || 'Custom Role'
                      : ROLE_LABELS[selectedRole] || selectedRole}
                  </h2>
                  {isOwnerSelected && (
                    <span className="text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full">
                      All permissions (immutable)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Search */}
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search permissions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 w-48 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  {/* Reset to defaults */}
                  {!isCustomRole && !isOwnerSelected && (
                    <button
                      onClick={handleReset}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                    >
                      <RotateCcw size={14} />
                      Reset
                    </button>
                  )}
                  {/* Delete custom role */}
                  {isCustomRole && (
                    <button
                      onClick={() => handleDeleteCustomRole(selectedRole)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  )}
                  {/* Save */}
                  <button
                    onClick={handleSave}
                    disabled={saving || !dirty || isOwnerSelected}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save
                  </button>
                </div>
              </div>

              {/* Permission Categories */}
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {Object.entries(filteredCategories).map(([category, perms]) => (
                  <div key={category}>
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      {category}
                    </h3>
                    <div className="space-y-0.5">
                      {perms.map(perm => {
                        const granted = isOwnerSelected ? true : localOverrides[perm] ?? false
                        const isProtected = OWNER_ONLY_PERMISSIONS.includes(perm)
                        const overridden = !isOwnerSelected && isOverridden(perm)
                        const systemDefault = (ROLE_PERMISSIONS[perm] as readonly string[]).includes(
                          isCustomRole
                            ? data?.customRoles.find(r => r.id === selectedRole)?.baseRole || ''
                            : selectedRole
                        )

                        return (
                          <div
                            key={perm}
                            className={`flex items-center justify-between px-3 py-2 rounded transition-colors ${
                              overridden
                                ? 'bg-amber-50 dark:bg-amber-900/10'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-900 dark:text-white">
                                  {PERMISSION_LABELS[perm]}
                                </span>
                                {overridden && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                    {granted !== systemDefault ? (granted ? 'granted' : 'revoked') : 'custom'}
                                  </span>
                                )}
                                {isProtected && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                                    owner only
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">
                                {perm}
                              </span>
                            </div>
                            <button
                              onClick={() => togglePermission(perm)}
                              disabled={isOwnerSelected || isProtected}
                              className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                                isOwnerSelected || isProtected ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                              } ${
                                granted
                                  ? 'bg-green-500 dark:bg-green-600'
                                  : 'bg-gray-300 dark:bg-gray-600'
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                  granted ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                              />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {Object.keys(filteredCategories).length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <Search size={20} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No permissions match your search</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Create Custom Role Modal */}
        {showCreateModal && (
          <CreateCustomRoleModal
            onClose={() => setShowCreateModal(false)}
            onCreated={(roleId) => {
              setShowCreateModal(false)
              setSelectedRole(roleId)
              setIsCustomRole(true)
              fetchData()
            }}
            availableRoles={builtinRoles}
          />
        )}
      </div>
    </PermissionGuard>
  )
}

// =========== Create Custom Role Modal ===========

function CreateCustomRoleModal({
  onClose,
  onCreated,
  availableRoles,
}: {
  onClose: () => void
  onCreated: (roleId: string) => void
  availableRoles: UserRole[]
}) {
  const [name, setName] = useState('')
  const [baseRole, setBaseRole] = useState('cashier')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [saving, setSaving] = useState(false)

  const baseRoleOptions = availableRoles.filter(r => r !== 'owner')

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/custom-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), baseRole, description: description.trim() || undefined, color }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create')
      }
      const created = await res.json()
      toast.success(`Custom role "${name}" created`)
      onCreated(created.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create custom role')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create Custom Role</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Custom roles inherit permissions from a base role.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Role Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Senior Cashier"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Base Role *
            </label>
            <select
              value={baseRole}
              onChange={(e) => setBaseRole(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              {baseRoleOptions.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]} (Level {ROLE_HIERARCHY[r]})</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Determines hierarchy level and default permissions</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this role is for..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-8 rounded border border-gray-200 dark:border-gray-600 cursor-pointer"
              />
              <span className="text-sm text-gray-500">{color}</span>
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded transition-colors flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create Role
          </button>
        </div>
      </div>
    </div>
  )
}
