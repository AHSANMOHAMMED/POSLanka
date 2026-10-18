'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { toast } from '@/components/ui/toast'
import { Edit2, Eye, EyeOff, Loader2, X, Warehouse, Check, Clock, Mail, RefreshCw, Trash2 } from 'lucide-react'
import { hasPermission, canModifyUser, type UserRole } from '@/lib/auth/roles'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface User {
  id: string
  email: string
  fullName: string
  role: UserRole
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

interface PendingInvite {
  id: string
  email: string
  role: string
  expiresAt: string
  createdAt: string
  status: 'pending' | 'expired'
}

interface WarehouseOption {
  id: string
  name: string
  code: string
  isDefault: boolean
}

interface UserWarehouseAssignment {
  id: string
  warehouseId: string
  isActive: boolean
  warehouse: WarehouseOption
}

const roleColors: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  cashier: 'bg-green-100 text-green-700',
  technician: 'bg-orange-100 text-orange-700',
  chef: 'bg-red-100 text-red-700',
  waiter: 'bg-teal-100 text-teal-700',
  system_manager: 'bg-slate-100 text-slate-700',
  accounts_manager: 'bg-indigo-100 text-indigo-700',
  sales_manager: 'bg-emerald-100 text-emerald-700',
  purchase_manager: 'bg-amber-100 text-amber-700',
  hr_manager: 'bg-pink-100 text-pink-700',
  stock_manager: 'bg-cyan-100 text-cyan-700',
  pos_user: 'bg-lime-100 text-lime-700',
  report_user: 'bg-violet-100 text-violet-700',
  dealer_sales: 'bg-yellow-100 text-yellow-700',
}

export default function StaffPage() {
  const { data: session } = useSession()
  const [users, setUsers] = useState<User[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'cashier' as UserRole,
  })
  const [submitting, setSubmitting] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [resending, setResending] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  // Warehouse assignment state
  const [showWarehouseModal, setShowWarehouseModal] = useState(false)
  const [warehouseModalUser, setWarehouseModalUser] = useState<User | null>(null)
  const [allWarehouses, setAllWarehouses] = useState<WarehouseOption[]>([])
  const [, setUserAssignments] = useState<UserWarehouseAssignment[]>([])
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState<Set<string>>(new Set())
  const [loadingWarehouses, setLoadingWarehouses] = useState(false)
  const [savingWarehouses, setSavingWarehouses] = useState(false)

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
      } else {
        toast.error('Failed to load staff members')
      }
    } catch (err) {
      console.error('Error fetching users:', err)
      toast.error('Failed to load staff members')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchInvites = useCallback(async () => {
    try {
      const res = await fetch('/api/users/invites')
      if (res.ok) {
        const data = await res.json()
        setPendingInvites(data.filter((i: PendingInvite) => i.status === 'pending'))
      }
    } catch (err) {
      console.error('Error fetching invites:', err)
    }
  }, [])

  // Real-time updates via WebSocket
  useRealtimeData(fetchUsers, { entityType: 'user', refreshOnMount: false })

  useEffect(() => {
    fetchUsers()
    fetchInvites()
  }, [fetchUsers, fetchInvites])

  // Check permission
  if (session && !hasPermission(session.user.role, 'manageUsers')) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500">You do not have permission to access this page.</p>
      </div>
    )
  }

  const filteredUsers = showInactive ? users : users.filter(u => u.isActive)

  function openCreateModal() {
    setEditingUser(null)
    setFormData({ fullName: '', email: '', password: '', role: 'cashier' })
    setShowModal(true)
  }

  function openEditModal(user: User) {
    setEditingUser(user)
    setFormData({
      fullName: user.fullName,
      email: user.email,
      password: '',
      role: user.role,
    })
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingUser(null)
    setFormData({ fullName: '', email: '', password: '', role: 'cashier' })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (editingUser) {
      // Edit mode — existing validation
      if (!formData.fullName.trim()) {
        toast.error('Full name is required')
        return
      }
      if (!formData.email.trim()) {
        toast.error('Email is required')
        return
      }
      if (formData.password && formData.password.length < 8) {
        toast.error('Password must be at least 8 characters')
        return
      }
    } else {
      // Create mode — only email + role required
      if (!formData.email.trim()) {
        toast.error('Email is required')
        return
      }
    }

    setSubmitting(true)

    try {
      if (editingUser) {
        // Update existing user
        const updateData: Record<string, unknown> = {
          fullName: formData.fullName,
          email: formData.email,
          role: formData.role,
          expectedUpdatedAt: editingUser.updatedAt,
        }
        if (formData.password) {
          updateData.password = formData.password
        }

        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        })

        if (res.status === 409) {
          toast.error('User was modified by another user. Please refresh.')
          return
        }

        if (res.ok) {
          toast.success('Staff member updated')
          closeModal()
          fetchUsers()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Failed to update')
        }
      } else {
        // Add or invite new user
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            role: formData.role,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          if (data.mode === 'added') {
            toast.success('Staff member added successfully')
            fetchUsers()
          } else if (data.mode === 'invited') {
            toast.success(`Invitation sent to ${formData.email}`)
            fetchInvites()
          }
          closeModal()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Failed to add staff member')
        }
      }
    } catch {
      toast.error('Error saving staff member')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleUserStatus(user: User) {
    if (user.id === session?.user?.id) {
      toast.error('You cannot change your own status')
      return
    }

    setToggling(user.id)
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: !user.isActive,
          expectedUpdatedAt: user.updatedAt,
        }),
      })

      if (res.status === 409) {
        toast.error('User was modified by another user. Please refresh.')
        return
      }

      if (res.ok) {
        toast.success(user.isActive ? 'Staff member deactivated' : 'Staff member activated')
        fetchUsers()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update status')
      }
    } catch {
      toast.error('Error updating status')
    } finally {
      setToggling(null)
    }
  }

  async function handleResendInvite(invite: PendingInvite) {
    setResending(invite.id)
    try {
      const res = await fetch(`/api/users/invites/${invite.id}/resend`, {
        method: 'POST',
      })

      if (res.ok) {
        toast.success(`Invitation resent to ${invite.email}`)
        fetchInvites()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to resend invite')
      }
    } catch {
      toast.error('Error resending invite')
    } finally {
      setResending(null)
    }
  }

  async function handleCancelInvite(invite: PendingInvite) {
    setCancelling(invite.id)
    try {
      const res = await fetch(`/api/users/invites?id=${invite.id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        toast.success('Invitation cancelled')
        fetchInvites()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel invite')
      }
    } catch {
      toast.error('Error cancelling invite')
    } finally {
      setCancelling(null)
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function formatDateTime(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Warehouse assignment functions
  async function openWarehouseModal(user: User) {
    setWarehouseModalUser(user)
    setShowWarehouseModal(true)
    setLoadingWarehouses(true)

    try {
      // Fetch all warehouses and user's current assignments in parallel
      const [warehousesRes, assignmentsRes] = await Promise.all([
        fetch('/api/warehouses?all=true'),
        fetch(`/api/users/${user.id}/warehouses`),
      ])

      if (warehousesRes.ok) {
        const warehouses = await warehousesRes.json()
        setAllWarehouses(Array.isArray(warehouses) ? warehouses : warehouses.data || [])
      }

      if (assignmentsRes.ok) {
        const data = await assignmentsRes.json()
        const assignments = data.assignments || []
        setUserAssignments(assignments)
        setSelectedWarehouseIds(new Set(assignments.map((a: UserWarehouseAssignment) => a.warehouseId)))
      }
    } catch (err) {
      console.error('Error fetching warehouse data:', err)
      toast.error('Failed to load warehouse data')
    } finally {
      setLoadingWarehouses(false)
    }
  }

  function closeWarehouseModal() {
    setShowWarehouseModal(false)
    setWarehouseModalUser(null)
    setAllWarehouses([])
    setUserAssignments([])
    setSelectedWarehouseIds(new Set())
  }

  function toggleWarehouseSelection(warehouseId: string) {
    const newSelected = new Set(selectedWarehouseIds)
    if (newSelected.has(warehouseId)) {
      newSelected.delete(warehouseId)
    } else {
      newSelected.add(warehouseId)
    }
    setSelectedWarehouseIds(newSelected)
  }

  async function saveWarehouseAssignments() {
    if (!warehouseModalUser) return

    setSavingWarehouses(true)
    try {
      const res = await fetch(`/api/users/${warehouseModalUser.id}/warehouses`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseIds: Array.from(selectedWarehouseIds),
        }),
      })

      if (res.ok) {
        toast.success('Warehouse assignments updated')
        closeWarehouseModal()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update warehouse assignments')
      }
    } catch {
      toast.error('Error saving warehouse assignments')
    } finally {
      setSavingWarehouses(false)
    }
  }

  function handleRefresh() {
    fetchUsers()
    fetchInvites()
  }

  return (
    <PermissionGuard permission="manageUsers">
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="Staff"
      actionButton={{ label: 'Add Staff Member', onClick: openCreateModal }}
      onRefresh={handleRefresh}
      filterContent={
        <>
          <select
            value={showInactive ? 'all' : 'active'}
            onChange={(e) => setShowInactive(e.target.value === 'all')}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="active">Active Only</option>
            <option value="all">Show Inactive</option>
          </select>
        </>
      }
    >
      {/* Pending Invitations */}
      {pendingInvites.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-md overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-amber-200 flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-100 rounded flex items-center justify-center">
              <Clock size={16} className="text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-amber-900 text-sm">Pending Invitations</h3>
              <p className="text-xs text-amber-700">{pendingInvites.length} invitation{pendingInvites.length > 1 ? 's' : ''} awaiting response</p>
            </div>
          </div>
          <div className="divide-y divide-amber-200">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-amber-100 rounded flex items-center justify-center">
                    <Mail size={14} className="text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{invite.email}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${roleColors[invite.role] || 'bg-gray-100 text-gray-700'}`}>
                        {invite.role}
                      </span>
                      <span className="text-xs text-amber-700">
                        Expires {formatDate(invite.expiresAt)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleResendInvite(invite)}
                    disabled={resending === invite.id}
                    className="p-1.5 text-amber-700 hover:bg-amber-100 rounded transition-colors disabled:opacity-50"
                    title="Resend invitation"
                  >
                    {resending === invite.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                  <button
                    onClick={() => handleCancelInvite(invite)}
                    disabled={cancelling === invite.id}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                    title="Cancel invitation"
                  >
                    {cancelling === invite.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-md border shadow-sm overflow-hidden flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {showInactive ? 'No staff members found' : 'No active staff members'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b table-sticky-header">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Role</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Last Login</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Warehouses</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.map((user) => (
                <tr key={user.id} className={!user.isActive ? 'bg-gray-50' : ''}>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {user.fullName}
                      {user.id === session?.user?.id && (
                        <span className="ml-2 text-xs text-gray-400">(You)</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      Joined {formatDate(user.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${roleColors[user.role]}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDateTime(user.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openWarehouseModal(user)}
                      className="flex items-center gap-1.5 px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      <Warehouse size={14} />
                      Manage
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {user.id !== session?.user?.id && canModifyUser(session?.user?.role || '', user.role) && (
                        <button
                          onClick={() => toggleUserStatus(user)}
                          disabled={toggling === user.id}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                          title={user.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {toggling === user.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : user.isActive ? (
                            <EyeOff size={16} />
                          ) : (
                            <Eye size={16} />
                          )}
                        </button>
                      )}
                      {canModifyUser(session?.user?.role || '', user.role) && (
                        <button
                          onClick={() => openEditModal(user)}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ListPageLayout>

    {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-md w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">
                {editingUser ? 'Edit Staff Member' : 'Add Staff Member'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {editingUser ? (
                <>
                  {/* Edit mode — full form */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password (leave blank to keep current)
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      minLength={8}
                      placeholder="Leave blank to keep current"
                    />
                    <p className="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
                  </div>
                </>
              ) : (
                <>
                  {/* Add mode — email + role only */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="colleague@example.com"
                      required
                    />
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                    <p className="text-sm text-blue-800">
                      If this person already has an account, they&apos;ll be added immediately. Otherwise, an invitation email will be sent.
                    </p>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role *
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as typeof formData.role })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={editingUser?.id === session?.user?.id || editingUser?.role === 'owner'}
                >
                  {/* Owner role cannot be created/changed via POS - only through account dashboard */}
                  {editingUser?.role === 'owner' && <option value="owner">Owner</option>}
                  {/* Only show roles the current user is allowed to assign */}
                  {canModifyUser(session?.user?.role || '', 'manager', 'manager') && (
                    <option value="manager">Manager</option>
                  )}
                  <option value="cashier">Cashier</option>
                  <option value="technician">Technician</option>
                  <option value="chef">Chef</option>
                  <option value="waiter">Waiter</option>
                  {canModifyUser(session?.user?.role || '', 'system_manager', 'system_manager') && (
                    <option value="system_manager">System Manager</option>
                  )}
                  {canModifyUser(session?.user?.role || '', 'accounts_manager', 'accounts_manager') && (
                    <option value="accounts_manager">Accounts Manager</option>
                  )}
                  {canModifyUser(session?.user?.role || '', 'sales_manager', 'sales_manager') && (
                    <option value="sales_manager">Sales Manager</option>
                  )}
                  {canModifyUser(session?.user?.role || '', 'purchase_manager', 'purchase_manager') && (
                    <option value="purchase_manager">Purchase Manager</option>
                  )}
                  {canModifyUser(session?.user?.role || '', 'hr_manager', 'hr_manager') && (
                    <option value="hr_manager">HR Manager</option>
                  )}
                  {canModifyUser(session?.user?.role || '', 'stock_manager', 'stock_manager') && (
                    <option value="stock_manager">Stock Manager</option>
                  )}
                  <option value="pos_user">POS User</option>
                  <option value="report_user">Report User</option>
                  <option value="dealer_sales">Dealer Sales</option>
                </select>
                {editingUser?.id === session?.user?.id && (
                  <p className="text-xs text-amber-600 mt-1">You cannot change your own role</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  {editingUser ? 'Update' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Warehouse Assignment Modal */}
      {showWarehouseModal && warehouseModalUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-md w-full max-w-md mx-4 shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <div>
                <h2 className="text-lg font-semibold dark:text-white">Warehouse Access</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {warehouseModalUser.fullName}
                </p>
              </div>
              <button
                onClick={closeWarehouseModal}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X size={20} className="dark:text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingWarehouses ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              ) : warehouseModalUser.role === 'owner' ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Warehouse size={28} className="text-purple-600" />
                  </div>
                  <p className="font-medium text-gray-900 dark:text-white">Full Access</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Owners automatically have access to all warehouses.
                  </p>
                  <div className="mt-4 space-y-1">
                    {allWarehouses.map((warehouse) => (
                      <div key={warehouse.id} className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Check size={14} className="text-green-500" />
                        <span>{warehouse.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : allWarehouses.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Warehouse size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No warehouses found.</p>
                  <p className="text-sm">Create warehouses in Settings first.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    Select warehouses this user can access:
                  </p>
                  {allWarehouses.map((warehouse) => {
                    const isSelected = selectedWarehouseIds.has(warehouse.id)
                    return (
                      <button
                        key={warehouse.id}
                        onClick={() => toggleWarehouseSelection(warehouse.id)}
                        className={`w-full p-3 rounded border text-left flex items-center gap-3 transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {isSelected && <Check size={14} className="text-white" />}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium dark:text-white">{warehouse.name}</div>
                          <div className="text-sm text-gray-500">{warehouse.code}</div>
                        </div>
                        {warehouse.isDefault && (
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
                            Default
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t dark:border-gray-700 flex justify-between items-center">
              {warehouseModalUser.role === 'owner' ? (
                <div className="text-sm text-purple-600 dark:text-purple-400">
                  Owner has automatic access
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {selectedWarehouseIds.size} warehouse{selectedWarehouseIds.size !== 1 ? 's' : ''} selected
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={closeWarehouseModal}
                  className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white"
                >
                  {warehouseModalUser.role === 'owner' ? 'Close' : 'Cancel'}
                </button>
                {warehouseModalUser.role !== 'owner' && (
                  <button
                    onClick={saveWarehouseAssignments}
                    disabled={savingWarehouses}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {savingWarehouses && <Loader2 size={16} className="animate-spin" />}
                    Save
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
    )}
    </PermissionGuard>
  )
}
