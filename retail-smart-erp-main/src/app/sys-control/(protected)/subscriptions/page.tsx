'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, Building2, CheckCircle, Clock, AlertCircle, XCircle,
  Database, HardDrive, Settings, Save, X, Lock, Unlock, CalendarClock,
} from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface Subscription {
  id: string
  tenantId: string
  status: 'trial' | 'active' | 'past_due' | 'cancelled' | 'locked'
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  billingCycle: string | null
  overrideDatabaseBytes: number | null
  overrideFileStorageBytes: number | null
  subscribedPriceMonthly: string | null
  subscribedPriceYearly: string | null
  priceLockedAt: string | null
  createdAt: string
  tenant: {
    id: string
    name: string
    slug: string
    businessType: string
    lockedReason: string | null
    deletionScheduledAt: string | null
  } | null
  tier: {
    id: string
    name: string
    displayName: string
    priceMonthly: string
    maxDatabaseBytes: number | null
    maxFileStorageBytes: number | null
  } | null
  billingAccount: {
    id: string
    email: string
    fullName: string
  } | null
  usage?: {
    storageBytes: number
    fileStorageBytes: number
  } | null
}


function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function bytesToGB(bytes: number): string {
  if (!bytes) return ''
  return (bytes / (1024 * 1024 * 1024)).toFixed(2).replace(/\.?0+$/, '')
}

function gbToBytes(gb: string): number | null {
  if (!gb) return null
  return Math.round(parseFloat(gb) * 1024 * 1024 * 1024)
}

function StorageMiniBar({ used, limit, className = '' }: { used: number; limit: number | null; className?: string }) {
  if (!limit) return <span className="text-xs text-gray-400">No limit</span>
  const percent = Math.min((used / limit) * 100, 100)
  const isWarning = percent >= 80
  const isCritical = percent >= 95

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden min-w-[60px]">
        <div
          className={`h-full rounded-full ${
            isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-blue-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={`text-xs font-medium whitespace-nowrap ${
        isCritical ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-gray-500 dark:text-gray-400'
      }`}>
        {percent.toFixed(0)}%
      </span>
    </div>
  )
}

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'trial' | 'active' | 'past_due' | 'cancelled' | 'locked'>('all')
  const [locking, setLocking] = useState<string | null>(null)
  const [overrideModal, setOverrideModal] = useState<Subscription | null>(null)
  const [periodModal, setPeriodModal] = useState<Subscription | null>(null)
  const [periodMode, setPeriodMode] = useState<'adjust' | 'exact'>('adjust')
  const [periodMonths, setPeriodMonths] = useState(1)
  const [periodDate, setPeriodDate] = useState('')
  const [periodReason, setPeriodReason] = useState('')
  const [savingPeriod, setSavingPeriod] = useState(false)
  const [overrideData, setOverrideData] = useState({ dbGB: '', fileGB: '' })
  const [savingOverride, setSavingOverride] = useState(false)

  const fetchSubscriptions = useCallback(async () => {
    try {
      const res = await fetch(`/api/sys-control/subscriptions?status=${filter}&includeUsage=true`)
      if (res.ok) {
        const data = await res.json()
        setSubscriptions(data)
      }
    } catch (error) {
      console.error('Failed to fetch subscriptions:', error)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchSubscriptions()
  }, [fetchSubscriptions])

  const openPeriodModal = (sub: Subscription) => {
    setPeriodModal(sub)
    setPeriodMode('adjust')
    setPeriodMonths(1)
    setPeriodReason('')
    // Default the date picker to current end date
    const endDate = sub.status === 'trial' && sub.trialEndsAt
      ? sub.trialEndsAt
      : sub.currentPeriodEnd
    setPeriodDate(endDate ? new Date(endDate).toISOString().split('T')[0] : '')
  }

  const getPreviewDate = () => {
    if (!periodModal) return null
    if (periodMode === 'exact') {
      return periodDate ? new Date(periodDate) : null
    }
    const currentEnd = periodModal.currentPeriodEnd
      ? new Date(periodModal.currentPeriodEnd)
      : new Date()
    const base = new Date(Math.max(currentEnd.getTime(), Date.now()))
    base.setMonth(base.getMonth() + periodMonths)
    return base
  }

  const savePeriod = async () => {
    if (!periodModal) return
    setSavingPeriod(true)
    try {
      const payload: Record<string, unknown> = {}
      if (periodMode === 'exact') {
        payload.setEndDate = periodDate
      } else {
        payload.adjustMonths = periodMonths
      }
      if (periodReason) payload.reason = periodReason

      const res = await fetch(`/api/sys-control/subscriptions/${periodModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setPeriodModal(null)
        fetchSubscriptions()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to update period')
      }
    } catch (error) {
      console.error('Failed to update period:', error)
      alert('Failed to update period')
    } finally {
      setSavingPeriod(false)
    }
  }

  const openOverrideModal = (sub: Subscription) => {
    setOverrideModal(sub)
    setOverrideData({
      dbGB: sub.overrideDatabaseBytes ? bytesToGB(sub.overrideDatabaseBytes) : '',
      fileGB: sub.overrideFileStorageBytes ? bytesToGB(sub.overrideFileStorageBytes) : '',
    })
  }

  const saveOverride = async () => {
    if (!overrideModal) return
    setSavingOverride(true)
    try {
      const res = await fetch(`/api/sys-control/subscriptions/${overrideModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overrideDatabaseBytes: gbToBytes(overrideData.dbGB),
          overrideFileStorageBytes: gbToBytes(overrideData.fileGB),
        }),
      })

      if (res.ok) {
        setOverrideModal(null)
        fetchSubscriptions()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to save override')
      }
    } catch (error) {
      console.error('Failed to save override:', error)
      alert('Failed to save override')
    } finally {
      setSavingOverride(false)
    }
  }

  const toggleLock = async (subscriptionId: string, tenantId: string, isLocked: boolean) => {
    if (!confirm(isLocked
      ? 'Unlock this company? It will be reactivated and the deletion timer will be cleared.'
      : 'Lock this company? Users will be unable to access it.'
    )) return

    setLocking(subscriptionId)
    try {
      const res = await fetch(`/api/sys-control/subscriptions/${subscriptionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLocked
          ? { unlock: true }
          : { lock: true, lockReason: 'admin_action' }
        ),
      })

      if (res.ok) {
        fetchSubscriptions()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to update subscription')
      }
    } catch (error) {
      console.error('Failed to toggle lock:', error)
      alert('Failed to update subscription')
    } finally {
      setLocking(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
            <CheckCircle className="w-3 h-3" />
            Active
          </span>
        )
      case 'trial':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
            <Clock className="w-3 h-3" />
            Free
          </span>
        )
      case 'past_due':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">
            <AlertCircle className="w-3 h-3" />
            Past Due
          </span>
        )
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
            <XCircle className="w-3 h-3" />
            Cancelled
          </span>
        )
      case 'locked':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
            <Lock className="w-3 h-3" />
            Locked
          </span>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Subscriptions</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage company subscriptions and storage overrides</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(['all', 'trial', 'active', 'past_due', 'locked', 'cancelled'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-gray-900 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
            }`}
          >
            {status === 'past_due' ? 'Past Due' : status === 'locked' ? 'Locked' : status === 'trial' ? 'Free' : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Subscriptions Table */}
      <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No subscriptions found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Company
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Owner
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Plan
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  DB Storage
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  File Storage
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Expires
                </th>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {subscriptions.map((sub) => {
                const dbLimit = sub.overrideDatabaseBytes || sub.tier?.maxDatabaseBytes || null
                const fileLimit = sub.overrideFileStorageBytes || sub.tier?.maxFileStorageBytes || null
                const dbUsed = sub.usage?.storageBytes || 0
                const fileUsed = sub.usage?.fileStorageBytes || 0
                const dbPercent = dbLimit ? (dbUsed / dbLimit) * 100 : 0
                const filePercent = fileLimit ? (fileUsed / fileLimit) * 100 : 0
                const isNearLimit = dbPercent >= 80 || filePercent >= 80

                return (
                  <tr key={sub.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${isNearLimit ? 'bg-amber-50/50 dark:bg-amber-900/20' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded flex items-center justify-center ${
                          isNearLimit ? 'bg-amber-100' : 'bg-gray-100 dark:bg-gray-700'
                        }`}>
                          <Building2 className={`w-5 h-5 ${isNearLimit ? 'text-amber-600' : 'text-gray-500 dark:text-gray-400'}`} />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{sub.tenant?.name || 'Unknown'}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{sub.tenant?.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-gray-900 dark:text-white">{sub.billingAccount?.fullName}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{sub.billingAccount?.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-900 dark:text-white">{sub.tier?.displayName || sub.tier?.name || 'N/A'}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {sub.subscribedPriceMonthly
                          ? `${formatCurrencyWithSymbol(Number(sub.subscribedPriceMonthly), 'LKR')}/mo`
                          : sub.tier?.priceMonthly ? `${formatCurrencyWithSymbol(Number(sub.tier.priceMonthly), 'LKR')}/mo` : ''}
                      </p>
                      {sub.subscribedPriceMonthly && sub.tier?.priceMonthly && Number(sub.subscribedPriceMonthly) !== Number(sub.tier.priceMonthly) && (
                        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 mt-1">
                          Grandfathered
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="min-w-[120px]">
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
                          <Database className="w-3 h-3" />
                          {formatBytes(dbUsed)} / {dbLimit ? formatBytes(dbLimit) : '∞'}
                        </div>
                        <StorageMiniBar used={dbUsed} limit={dbLimit} />
                        {sub.overrideDatabaseBytes && (
                          <p className="text-[10px] text-purple-600 mt-0.5">Override active</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="min-w-[120px]">
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
                          <HardDrive className="w-3 h-3" />
                          {formatBytes(fileUsed)} / {fileLimit ? formatBytes(fileLimit) : '∞'}
                        </div>
                        <StorageMiniBar used={fileUsed} limit={fileLimit} />
                        {sub.overrideFileStorageBytes && (
                          <p className="text-[10px] text-purple-600 mt-0.5">Override active</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(sub.status)}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-600 dark:text-gray-400">
                        {sub.status === 'trial' && sub.trialEndsAt
                          ? new Date(sub.trialEndsAt).toLocaleDateString()
                          : sub.currentPeriodEnd
                          ? new Date(sub.currentPeriodEnd).toLocaleDateString()
                          : '-'}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openOverrideModal(sub)}
                          className="p-2 text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded"
                          title="Storage Override"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleLock(sub.id, sub.tenantId, sub.status === 'locked')}
                          disabled={locking === sub.id}
                          className={`p-2 rounded ${
                            sub.status === 'locked'
                              ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                              : 'text-red-600 hover:text-red-700 hover:bg-red-50'
                          }`}
                          title={sub.status === 'locked' ? 'Unlock Company' : 'Lock Company'}
                        >
                          {locking === sub.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : sub.status === 'locked' ? (
                            <Unlock className="w-4 h-4" />
                          ) : (
                            <Lock className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => openPeriodModal(sub)}
                          className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                          title="Manage Period"
                        >
                          <CalendarClock className="w-4 h-4" />
                        </button>
                      </div>
                      {sub.status === 'locked' && sub.tenant?.lockedReason && (
                        <p className="text-xs text-red-500 mt-1">
                          Reason: {sub.tenant.lockedReason.replace(/_/g, ' ')}
                          {sub.tenant.deletionScheduledAt && (
                            <> — Deletion: {new Date(sub.tenant.deletionScheduledAt).toLocaleDateString()}</>
                          )}
                        </p>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Storage Override Modal */}
      {overrideModal && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50"
          onClick={() => setOverrideModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Storage Override</h3>
              <button
                onClick={() => setOverrideModal(null)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6">
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Override storage limits for <strong>{overrideModal.tenant?.name}</strong>.
                Leave blank to use the plan defaults.
              </p>
              {overrideModal.tier && (
                <p className="text-gray-500 dark:text-gray-400 text-xs mt-2">
                  Plan defaults: DB {overrideModal.tier.maxDatabaseBytes ? formatBytes(overrideModal.tier.maxDatabaseBytes) : 'Unlimited'} / Files {overrideModal.tier.maxFileStorageBytes ? formatBytes(overrideModal.tier.maxFileStorageBytes) : 'Unlimited'}
                </p>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <Database className="w-4 h-4 inline mr-1" />
                  Database Storage Override (GB)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={overrideData.dbGB}
                  onChange={(e) => setOverrideData({ ...overrideData, dbGB: e.target.value })}
                  placeholder="Leave blank for plan default"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <HardDrive className="w-4 h-4 inline mr-1" />
                  File Storage Override (GB)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={overrideData.fileGB}
                  onChange={(e) => setOverrideData({ ...overrideData, fileGB: e.target.value })}
                  placeholder="Leave blank for plan default"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={saveOverride}
                disabled={savingOverride}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50 font-medium"
              >
                {savingOverride ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Override
              </button>
              <button
                onClick={() => setOverrideModal(null)}
                className="px-4 py-2.5 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Period Modal */}
      {periodModal && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50"
          onClick={() => setPeriodModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Manage Period</h3>
              <button
                onClick={() => setPeriodModal(null)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Adjust subscription period for <strong>{periodModal.tenant?.name}</strong>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Current end: {periodModal.currentPeriodEnd
                  ? new Date(periodModal.currentPeriodEnd).toLocaleDateString()
                  : 'Not set'}
              </p>
            </div>

            {/* Mode Tabs */}
            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded mb-4">
              <button
                onClick={() => setPeriodMode('adjust')}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  periodMode === 'adjust'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Add/Remove Months
              </button>
              <button
                onClick={() => setPeriodMode('exact')}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  periodMode === 'exact'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Set Exact Date
              </button>
            </div>

            <div className="space-y-4">
              {periodMode === 'adjust' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Months to add/remove
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPeriodMonths(prev => prev - 1)}
                      disabled={periodMonths <= -12}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-300"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={periodMonths}
                      onChange={(e) => setPeriodMonths(parseInt(e.target.value) || 0)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-center dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={() => setPeriodMonths(prev => prev + 1)}
                      disabled={periodMonths >= 36}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-300"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {[1, 3, 6, 12].map(m => (
                      <button
                        key={m}
                        onClick={() => setPeriodMonths(m)}
                        className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
                          periodMonths === m
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                            : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        +{m}mo
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    New end date
                  </label>
                  <input
                    type="date"
                    value={periodDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setPeriodDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={periodReason}
                  onChange={(e) => setPeriodReason(e.target.value)}
                  placeholder="e.g. Customer requested extension"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>

            {/* Preview */}
            {(() => {
              const previewDate = getPreviewDate()
              return previewDate ? (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded">
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    New end date: <strong>{previewDate.toLocaleDateString()}</strong>
                  </p>
                </div>
              ) : null
            })()}

            <div className="flex gap-3 mt-6">
              <button
                onClick={savePeriod}
                disabled={savingPeriod || (periodMode === 'adjust' && periodMonths === 0) || (periodMode === 'exact' && !periodDate)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50 font-medium"
              >
                {savingPeriod ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                Update Period
              </button>
              <button
                onClick={() => setPeriodModal(null)}
                className="px-4 py-2.5 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
