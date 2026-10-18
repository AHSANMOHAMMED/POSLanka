'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity,
  Building2,
  CreditCard,
  Wallet,
  LogIn,
  LogOut,
  Settings,
  Shield,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { PageSkeleton } from '@/components/ui/skeleton'

interface ActivityItem {
  id: string
  type: string
  action: string
  description: string
  companyName: string | null
  createdAt: string
  metadata?: Record<string, unknown>
}

const activityIcons: Record<string, typeof Activity> = {
  login: LogIn,
  logout: LogOut,
  site_created: Building2,
  site_updated: Settings,
  payment: CreditCard,
  wallet: Wallet,
  security: Shield,
}

const activityColors: Record<string, { bg: string; icon: string }> = {
  login: { bg: 'bg-blue-100 dark:bg-blue-900/30', icon: 'text-blue-600 dark:text-blue-400' },
  logout: { bg: 'bg-gray-100 dark:bg-gray-700', icon: 'text-gray-600 dark:text-gray-400' },
  site_created: { bg: 'bg-green-100 dark:bg-green-900/30', icon: 'text-green-600 dark:text-green-400' },
  site_updated: { bg: 'bg-amber-100 dark:bg-amber-900/30', icon: 'text-amber-600 dark:text-amber-400' },
  payment: { bg: 'bg-purple-100 dark:bg-purple-900/30', icon: 'text-purple-600 dark:text-purple-400' },
  wallet: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', icon: 'text-emerald-600 dark:text-emerald-400' },
  security: { bg: 'bg-red-100 dark:bg-red-900/30', icon: 'text-red-600 dark:text-red-400' },
}

const filters = [
  { id: 'all', label: 'All Activity' },
  { id: 'login', label: 'Logins' },
  { id: 'site_created', label: 'Sites' },
  { id: 'payment', label: 'Payments' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'security', label: 'Security' },
  { id: 'site_updated', label: 'Settings' },
]

const PAGE_SIZE = 20

function formatDate(date: string): string {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()

  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

export default function ActivityPage() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)

  const fetchActivity = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      })
      if (filter !== 'all') {
        params.set('type', filter)
      }
      const res = await fetch(`/api/account/activity?${params}`)
      if (res.ok) {
        const data = await res.json()
        setActivities(data.activities || [])
        setTotal(data.total || 0)
      }
    } catch (error) {
      console.error('Failed to fetch activity:', error)
    } finally {
      setLoading(false)
    }
  }, [page, filter])

  useEffect(() => {
    fetchActivity()
  }, [fetchActivity])

  // Reset to first page when filter changes
  useEffect(() => {
    setPage(0)
  }, [filter])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  if (loading && activities.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Activity Log</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Track all account activity and changes</p>
        </div>
        <PageSkeleton layout="list" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Activity Log</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Track all account activity and changes</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Activity filters">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              filter === f.id
                ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow-lg'
                : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Activity List */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-md flex items-center justify-center">
              <Activity className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Activity</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {total} event{total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        {activities.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Activity className="w-8 h-8 text-gray-300 dark:text-gray-500" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">No activity found</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              {filter !== 'all'
                ? 'Try a different filter to see more activity'
                : 'Activity will appear here as you use the platform'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {activities.map((activity) => {
              const Icon = activityIcons[activity.type] || Activity
              const colors = activityColors[activity.type] || {
                bg: 'bg-gray-100 dark:bg-gray-700',
                icon: 'text-gray-600 dark:text-gray-400',
              }

              return (
                <div
                  key={activity.id}
                  className="px-4 sm:px-6 py-4 sm:py-5 flex items-start gap-3 sm:gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div
                    className={`w-10 h-10 sm:w-12 sm:h-12 rounded-md flex items-center justify-center flex-shrink-0 ${colors.bg}`}
                  >
                    <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${colors.icon}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{activity.action}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {activity.description}
                        </p>
                        {activity.companyName && (
                          <span className="inline-flex items-center gap-1.5 mt-3 text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded">
                            <Building2 className="w-3.5 h-3.5" />
                            {activity.companyName}
                          </span>
                        )}
                      </div>
                      <div className="sm:text-right flex-shrink-0">
                        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                          <Calendar className="w-4 h-4" />
                          {formatDate(activity.createdAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Page {page + 1} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Previous page"
                className="p-2 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                aria-label="Next page"
                className="p-2 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
