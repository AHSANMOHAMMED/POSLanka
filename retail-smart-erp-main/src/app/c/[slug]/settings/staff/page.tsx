'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { toast } from '@/components/ui/toast'
import { Edit2, Eye, EyeOff, Loader2, X, Warehouse, Check, Clock, Mail, RefreshCw, Trash2 } from 'lucide-react'
import { hasPermission, canModifyUser, getRolesForBusinessType, ROLE_HIERARCHY, type UserRole } from '@/lib/auth/roles'
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
  warehouses?: Array<{ warehouseId: string; warehouse: { id: string; name: string; code: string } }>
  posProfiles?: Array<{ posProfileId: string; name: string; warehouseId: string | null; isDefault: boolean }>
}

interface CounterOption {
  id: string
  name: string
  code: string | null
  warehouseId: string | null
  status?: string
}

type CreateMode = 'create' | 'invite'

const PASSWORD_RULE = 'At least 8 characters with an uppercase letter, a lowercase letter and a number'

function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters'
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter'
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter'
  if (!/[0-9]/.test(pw)) return 'Password must contain a number'
  return null
}

function roleLabel(role: string): string {
  if (role === 'pos_user') return 'POS User'
  if (role === 'hr_manager') return 'HR Manager'
  return role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
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
    pin: '',
    role: 'cashier' as UserRole,
  })
  const [createMode, setCreateMode] = useState<CreateMode>('create')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formWarehouseIds, setFormWarehouseIds] = useState<Set<string>>(new Set())
  const [formCounterIds, setFormCounterIds] = useState<Set<string>>(new Set())
  const [branchOptions, setBranchOptions] = useState<WarehouseOption[]>([])
  const [counterOptions, setCounterOptions] = useState<CounterOption[]>([])
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
      const res = await fetch('/api/users?includeWarehouses=true')
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

  // Branches + counters for the create/edit forms
  const fetchOptions = useCallback(async () => {
    try {
      const [whRes, ppRes] = await Promise.all([
        fetch('/api/warehouses?all=true&activeOnly=true'),
        fetch('/api/pos-profiles?all=true'),
      ])
      if (whRes.ok) {
        const data = await whRes.json()
        setBranchOptions(Array.isArray(data) ? data : data.data || [])
      }
      if (ppRes.ok) {
        const data = await ppRes.json()
        const list: CounterOption[] = Array.isArray(data) ? data : data.profiles || []
        setCounterOptions(list.filter(c => !c.status || c.status === 'active'))
      }
    } catch (err) {
      console.error('Error fetching branches/counters:', err)
    }
  }, [])

  // Real-time updates via WebSocket
  useRealtimeData(fetchUsers, { entityType: 'user', refreshOnMount: false })

  useEffect(() => {
    fetchUsers()
    fetchInvites()
    fetchOptions()
  }, [fetchUsers, fetchInvites, fetchOptions])

  const actorRole = session?.user?.role || ''
  const businessType = (session?.user as { businessType?: string } | undefined)?.businessType || ''

  // Roles the current user may assign: relevant to the business type, never owner,
  // and not above the actor's own level (ROLE_HIERARCHY via canModifyUser)
  const assignableRoles = useMemo(() => {
    return getRolesForBusinessType(businessType)
      .filter(r => r !== 'owner' && canModifyUser(actorRole, r, r))
      .sort((a, b) => ROLE_HIERARCHY[b] - ROLE_HIERARCHY[a])
  }, [actorRole, businessType])

  // Counters available for the selected branches (all counters if no branch picked)
  const visibleCounters = useMemo(() => {
    if (formWarehouseIds.size === 0) return counterOptions
    return counterOptions.filter(c => !c.warehouseId || formWarehouseIds.has(c.warehouseId))
  }, [counterOptions, formWarehouseIds])

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
    const defaultRole: UserRole = assignableRoles.includes('cashier') ? 'cashier' : (assignableRoles[0] || 'cashier')
    setFormData({ fullName: '', email: '', password: '', pin: '', role: defaultRole })
    setCreateMode('create')
    setConfirmPassword('')
    setFormWarehouseIds(new Set(branchOptions.length === 1 ? [branchOptions[0].id] : []))
    setFormCounterIds(new Set())
    setShowModal(true)
  }

  function openEditModal(user: User) {
    setEditingUser(user)
    setFormData({
      fullName: user.fullName,
      email: user.email,
      password: '',
      pin: '',
      role: user.role,
    })
    setConfirmPassword('')
    setFormWarehouseIds(new Set((user.warehouses || []).map(w => w.warehouseId)))
    setFormCounterIds(new Set((user.posProfiles || []).map(p => p.posProfileId)))
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingUser(null)
    setFormData({ fullName: '', email: '', password: '', pin: '', role: 'cashier' })
    setConfirmPassword('')
    setFormWarehouseIds(new Set())
    setFormCounterIds(new Set())
  }

  function toggleInSet(set: Set<string>, id: string): Set<string> {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  function toggleFormBranch(id: string) {
    const next = toggleInSet(formWarehouseIds, id)
    setFormWarehouseIds(next)
    // Drop counters that no longer belong to a selected branch
    if (next.size > 0) {
      setFormCounterIds(prev => new Set(Array.from(prev).filter(cid => {
        const c = counterOptions.find(o => o.id === cid)
        return !c || !c.warehouseId || next.has(c.warehouseId)
      })))
    }
  }

  async function saveCounters(user: User): Promise<boolean> {
    const before = new Set((user.posProfiles || []).map(p => p.posProfileId))
    const same = before.size === formCounterIds.size && Array.from(formCounterIds).every(id => before.has(id))
    if (same) return true
    const res = await fetch(`/api/users/${user.id}/pos-profiles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posProfileIds: Array.from(formCounterIds) }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Failed to update counters')
      return false
    }
    return true
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
      if (formData.password) {
        const problem = passwordProblem(formData.password)
        if (problem) {
          toast.error(problem)
          return
        }
      }
      if (formData.pin && !/^\d{4,6}$/.test(formData.pin)) {
        toast.error('POS PIN must be 4-6 digits')
        return
      }
    } else {
      if (!formData.email.trim()) {
        toast.error('Email is required')
        return
      }
      if (createMode === 'create') {
        if (!formData.fullName.trim()) {
          toast.error('Full name is required')
          return
        }
        const problem = passwordProblem(formData.password)
        if (problem) {
          toast.error(problem)
          return
        }
        if (formData.password !== confirmPassword) {
          toast.error('Passwords do not match')
          return
        }
        if (formData.pin && !/^\d{4,6}$/.test(formData.pin)) {
          toast.error('POS PIN must be 4-6 digits')
          return
        }
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
        if (formData.pin) {
          updateData.pin = formData.pin
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
          const countersOk = await saveCounters(editingUser)
          if (countersOk) {
            toast.success('Staff member updated')
            closeModal()
          }
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
          body: JSON.stringify(createMode === 'create'
            ? {
                mode: 'create',
                email: formData.email,
                fullName: formData.fullName,
                role: formData.role,
                password: formData.password,
                pin: formData.pin || undefined,
                warehouseIds: Array.from(formWarehouseIds),
                posProfileIds: Array.from(formCounterIds),
              }
            : {
                mode: 'invite',
                email: formData.email,
                role: formData.role,
                fullName: formData.fullName || undefined,
                warehouseIds: Array.from(formWarehouseIds),
                posProfileIds: Array.from(formCounterIds),
              }),
        })

        if (res.ok) {
          const data = await res.json()
          if (data.mode === 'created') {
            toast.success(`${data.user?.fullName || 'Staff member'} can now sign in`)
            fetchUsers()
          } else if (data.mode === 'added') {
            toast.success('Staff member added successfully')
            fetchUsers()
          } else if (data.mode === 'invited') {
            toast.success(`Invitation sent to ${formData.email}`)
            fetchInvites()
          }
          closeModal()
        } else {
          const data = await res.json().catch(() => ({}))
          toast.error(data.details?.[0]?.message || data.error || 'Failed to add staff member')
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
        fetchUsers()
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
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Branches &amp; Counters</th>
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
                    <div className="flex flex-wrap gap-1 mb-1 max-w-xs">
                      {user.role === 'owner' ? (
                        <span className="text-xs text-purple-600">All branches</span>
                      ) : (user.warehouses || []).length === 0 ? (
                        <span className="text-xs text-gray-400">No branch</span>
                      ) : (
                        (user.warehouses || []).map(w => (
                          <span key={w.warehouseId} className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                            {w.warehouse.name}
                          </span>
                        ))
                      )}
                      {(user.posProfiles || []).map(p => (
                        <span key={p.posProfileId} className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700" title="POS counter">
                          {p.name}{p.isDefault && (user.posProfiles || []).length > 1 ? ' ★' : ''}
                        </span>
                      ))}
                    </div>
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
          <div className="bg-white rounded-md w-full max-w-lg mx-4 shadow-xl max-h-[90vh] flex flex-col">
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
            <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
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
                    <p className="text-xs text-gray-500 mt-1">{PASSWORD_RULE}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      POS PIN (4-6 digits, leave blank to keep current)
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={formData.pin}
                      onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Used to unlock the terminal and approve overrides"
                    />
                    <p className="text-xs text-gray-500 mt-1">Cashiers unlock their terminal with it; managers approve discounts and price overrides with it.</p>
                  </div>
                </>
              ) : (
                <>
                  {/* Add mode — create with password (default) or send an email invite */}
                  <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded">
                    {(['create', 'invite'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setCreateMode(m)}
                        className={`px-3 py-1.5 text-sm rounded ${createMode === m ? 'bg-white shadow font-medium text-gray-900' : 'text-gray-600'}`}
                      >
                        {m === 'create' ? 'Create with password' : 'Send email invite'}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name {createMode === 'create' ? '*' : ''}
                    </label>
                    <input
                      type="text"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required={createMode === 'create'}
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
                      placeholder="colleague@example.com"
                      required
                    />
                  </div>
                  {createMode === 'create' ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm *</label>
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            required
                          />
                        </div>
                      </div>
                      <p className={`text-xs -mt-2 ${formData.password && passwordProblem(formData.password) ? 'text-amber-600' : 'text-gray-500'}`}>
                        {PASSWORD_RULE}
                        {confirmPassword && confirmPassword !== formData.password ? ' — passwords do not match' : ''}
                      </p>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">POS PIN (optional, 4-6 digits)</label>
                        <input
                          type="password"
                          inputMode="numeric"
                          value={formData.pin}
                          onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                          className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Used to unlock the POS terminal"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                      <p className="text-sm text-blue-800">
                        If this person already has an account, they&apos;ll be added immediately. Otherwise, an invitation email will be sent and the branches/counters below are applied when they accept.
                      </p>
                    </div>
                  )}
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
                  {/* Only roles for this business type at/below the current user's level */}
                  {editingUser && editingUser.role !== 'owner' && !assignableRoles.includes(editingUser.role) && (
                    <option value={editingUser.role}>{roleLabel(editingUser.role)}</option>
                  )}
                  {assignableRoles.map(r => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </select>
                {editingUser?.id === session?.user?.id && (
                  <p className="text-xs text-amber-600 mt-1">You cannot change your own role</p>
                )}
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Branches</label>
                  {branchOptions.length === 0 ? (
                    <p className="text-xs text-gray-500">No branches found.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {branchOptions.map(b => {
                        const on = formWarehouseIds.has(b.id)
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => toggleFormBranch(b.id)}
                            className={`px-2.5 py-1 text-sm rounded border flex items-center gap-1 ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}
                          >
                            {on && <Check size={12} />}
                            {b.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">If none is chosen and there is only one branch, it is assigned automatically.</p>
                </div>
              )}
              {editingUser?.role !== 'owner' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">POS Counters</label>
                  {visibleCounters.length === 0 ? (
                    <p className="text-xs text-gray-500">No counters for the selected branches.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {visibleCounters.map(c => {
                        const on = formCounterIds.has(c.id)
                        const branch = branchOptions.find(b => b.id === c.warehouseId)
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setFormCounterIds(toggleInSet(formCounterIds, c.id))}
                            className={`px-2.5 py-1 text-sm rounded border flex items-center gap-1 ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}
                          >
                            {on && <Check size={12} />}
                            {c.name}
                            {branch && formWarehouseIds.size !== 1 && <span className="text-xs text-gray-400">· {branch.name}</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {editingUser ? 'A counter\'s branch is added to the user automatically.' : 'Cashiers get the branch\'s only counter automatically if none is chosen.'}
                  </p>
                </div>
              )}
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
                  {editingUser ? 'Update' : createMode === 'create' ? 'Create' : 'Send Invite'}
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
