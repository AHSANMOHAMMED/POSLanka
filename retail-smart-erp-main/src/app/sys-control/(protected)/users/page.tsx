'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Loader2, Building2, UserX, UserCheck } from 'lucide-react'

interface Account {
  id: string
  email: string
  fullName: string
  phone: string | null
  emailVerified: boolean
  isActive: boolean
  deactivatedAt: string | null
  deactivationReason: string | null
  lastLoginAt: string | null
  createdAt: string
  _count: {
    companies: number
  }
}

export default function UsersPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [togglingActive, setTogglingActive] = useState<string | null>(null)
  const [showDeactivateModal, setShowDeactivateModal] = useState(false)
  const [deactivatingAccount, setDeactivatingAccount] = useState<Account | null>(null)
  const [deactivationReason, setDeactivationReason] = useState('')

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/sys-control/users?search=${encodeURIComponent(search)}`)
      if (res.ok) {
        const data = await res.json()
        setAccounts(data)
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAccounts()
    }, 300)
    return () => clearTimeout(timer)
  }, [fetchAccounts])

  const handleDeactivateClick = (account: Account) => {
    setDeactivatingAccount(account)
    setDeactivationReason('')
    setShowDeactivateModal(true)
  }

  const toggleAccountActive = async (accountId: string, activate: boolean, reason?: string) => {
    setTogglingActive(accountId)
    try {
      const res = await fetch(`/api/sys-control/users/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: activate,
          deactivationReason: !activate ? reason : null,
        }),
      })

      if (res.ok) {
        setShowDeactivateModal(false)
        setDeactivatingAccount(null)
        fetchAccounts()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to update user')
      }
    } catch (error) {
      console.error('Failed to update user:', error)
      alert('Failed to update user')
    } finally {
      setTogglingActive(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage user accounts</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
        />
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No users found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  User
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Phone
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Companies
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Last Login
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Registered
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {accounts.map((account) => (
                <tr key={account.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${account.isActive === false ? 'opacity-60' : ''}`}>
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{account.fullName}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{account.email}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-600 dark:text-gray-400">{account.phone || '-'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                      <Building2 className="w-4 h-4" />
                      {account._count?.companies || 0}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-600 dark:text-gray-400">
                      {account.lastLoginAt
                        ? new Date(account.lastLoginAt).toLocaleDateString()
                        : 'Never'}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-600 dark:text-gray-400">
                      {new Date(account.createdAt).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                        account.isActive !== false
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {account.isActive !== false ? 'Active' : 'Deactivated'}
                      </span>
                      {account.isActive === false && account.deactivationReason && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-[150px] truncate" title={account.deactivationReason}>
                          {account.deactivationReason}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {account.isActive !== false ? (
                      <button
                        onClick={() => handleDeactivateClick(account)}
                        disabled={togglingActive === account.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 rounded hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        {togglingActive === account.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <UserX className="w-4 h-4" />
                            Deactivate
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleAccountActive(account.id, true)}
                        disabled={togglingActive === account.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 rounded hover:bg-green-100 transition-colors disabled:opacity-50"
                      >
                        {togglingActive === account.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <UserCheck className="w-4 h-4" />
                            Activate
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Deactivation Modal */}
      {showDeactivateModal && deactivatingAccount && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-md shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Deactivate User Account
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Are you sure you want to deactivate <strong>{deactivatingAccount.fullName}</strong>&apos;s account ({deactivatingAccount.email})?
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              This user will no longer be able to log in. Their data will be preserved.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Reason for deactivation (optional)
              </label>
              <textarea
                value={deactivationReason}
                onChange={(e) => setDeactivationReason(e.target.value)}
                rows={3}
                placeholder="e.g., Unpaid subscription, violation of terms..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDeactivateModal(false)
                  setDeactivatingAccount(null)
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => toggleAccountActive(deactivatingAccount.id, false, deactivationReason)}
                disabled={togglingActive === deactivatingAccount.id}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {togglingActive === deactivatingAccount.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserX className="w-4 h-4" />
                )}
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
