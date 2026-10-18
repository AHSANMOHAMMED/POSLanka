'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { toast } from '@/components/ui/toast'
import { Users, Plus, Edit2, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/page-header'
import { hasPermission, type UserRole } from '@/lib/auth/roles'
import { StaffFormModal } from '@/components/modals'

interface WarehouseData {
  id: string
  name: string
  code: string
  isDefault: boolean
}

interface User {
  id: string
  email: string
  fullName: string
  role: UserRole
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  warehouses?: { warehouseId: string; warehouse: WarehouseData }[]
}

const roleColors: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  manager: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  cashier: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  technician: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  chef: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  waiter: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  system_manager: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
  accounts_manager: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  sales_manager: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  purchase_manager: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  hr_manager: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
  stock_manager: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  pos_user: 'bg-lime-100 text-lime-700 dark:bg-lime-900 dark:text-lime-300',
  report_user: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  dealer_sales: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
}

export default function StaffPage() {
  const { data: session } = useSession()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

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

  // Real-time updates via WebSocket
  useRealtimeData(fetchUsers, { entityType: 'user', refreshOnMount: false })

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // Check permission
  if (session && !hasPermission(session.user.role, 'manageUsers')) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400">You do not have permission to access this page.</p>
      </div>
    )
  }

  const filteredUsers = showInactive ? users : users.filter(u => u.isActive)

  function handleEdit(user: User) {
    setEditingUser(user)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingUser(null)
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

  return (
    <div>
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Settings', href: '/settings' },
          { label: 'Staff' }
        ]}
        className="mb-4"
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 dark:text-white">
            <Users size={24} />
            Staff Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage users and their roles
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            Show inactive
          </label>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={18} />
            Add Staff Member
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-md border dark:border-gray-700 shadow-sm overflow-hidden list-container-xl">
        {loading ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            {showInactive ? 'No staff members found' : 'No active staff members'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 table-sticky-header">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Email</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Role</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Warehouses</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Last Login</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {filteredUsers.map((user) => (
                <tr key={user.id} className={!user.isActive ? 'bg-gray-50 dark:bg-gray-900/50' : ''}>
                  <td className="px-4 py-3">
                    <div className="font-medium dark:text-white">
                      {user.fullName}
                      {user.id === session?.user?.id && (
                        <span className="ml-2 text-xs text-gray-400">(You)</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Joined {formatDate(user.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${roleColors[user.role]}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.warehouses && user.warehouses.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.warehouses.slice(0, 2).map((uw) => (
                          <span
                            key={uw.warehouseId}
                            className="px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300"
                            title={uw.warehouse.name}
                          >
                            {uw.warehouse.code}
                          </span>
                        ))}
                        {user.warehouses.length > 2 && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400">
                            +{user.warehouses.length - 2}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {formatDateTime(user.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {user.id !== session?.user?.id && (
                        <button
                          onClick={() => toggleUserStatus(user)}
                          disabled={toggling === user.id}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
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
                      <button
                        onClick={() => handleEdit(user)}
                        className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Staff Form Modal */}
      <StaffFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          fetchUsers()
          handleCloseModal()
        }}
        editUser={editingUser}
        currentUserId={session?.user?.id}
      />
    </div>
  )
}
