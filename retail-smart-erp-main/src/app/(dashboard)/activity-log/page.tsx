'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Activity, Filter, ChevronLeft, ChevronRight, User, FileText, Wrench, Car, Package, Calendar, ShoppingCart, Download } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { useExport } from '@/hooks/useExport'
import { PageLoading } from '@/components/ui/loading-spinner'
import { toast } from '@/components/ui/toast'
import { formatDateTime, formatRelativeTime } from '@/lib/utils/date-format'

interface ActivityLog {
  id: string
  action: string
  entityType: string
  entityId: string | null
  entityName: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  user: {
    id: string
    fullName: string
    email: string
  } | null
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

const actionColors: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  status_change: 'bg-yellow-100 text-yellow-700',
  submit: 'bg-purple-100 text-purple-700',
  approve: 'bg-green-100 text-green-700',
  reject: 'bg-red-100 text-red-700',
  cancel: 'bg-orange-100 text-orange-700',
  convert: 'bg-teal-100 text-teal-700',
  login: 'bg-gray-100 text-gray-700',
  logout: 'bg-gray-100 text-gray-700',
  print: 'bg-indigo-100 text-indigo-700',
  export: 'bg-indigo-100 text-indigo-700',
}

const entityIcons: Record<string, React.ReactNode> = {
  work_order: <Wrench size={16} />,
  estimate: <FileText size={16} />,
  customer: <User size={16} />,
  vehicle: <Car size={16} />,
  item: <Package size={16} />,
  appointment: <Calendar size={16} />,
  sale: <ShoppingCart size={16} />,
}

export default function ActivityLogPage() {
  const { showExportDialog, openExport, closeExport } = useExport()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [page, setPage] = useState(1)
  const [serverPagination, setServerPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    entityType: '',
    action: '',
    startDate: '',
    endDate: '',
  })

  // Track current request to ignore stale responses
  const requestCounterRef = useRef(0)
  const currentRequestRef = useRef(0)
  const limit = 50

  const fetchLogs = useCallback(async () => {
    const thisRequest = ++requestCounterRef.current
    currentRequestRef.current = thisRequest

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      })

      if (filters.entityType) params.append('entityType', filters.entityType)
      if (filters.action) params.append('action', filters.action)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)

      const res = await fetch(`/api/activity-logs?${params}`)

      // Ignore stale responses
      if (currentRequestRef.current !== thisRequest) return

      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs)
        setServerPagination(data.pagination)
      } else if (res.status === 403) {
        toast.error('Access denied. Only managers and owners can view activity logs.')
      } else {
        toast.error('Failed to load activity logs')
      }
    } catch (error) {
      if (currentRequestRef.current === thisRequest) {
        console.error('Error fetching activity logs:', error)
        toast.error('Failed to load activity logs')
      }
    } finally {
      if (currentRequestRef.current === thisRequest) {
        setLoading(false)
      }
    }
  }, [page, filters])

  useEffect(() => {
    setLoading(true)
    fetchLogs()
  }, [fetchLogs])

  // Real-time updates via WebSocket (listens to all entity types)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useRealtimeData(fetchLogs, { entityType: '*' as any, refreshOnMount: false })

  function handlePageChange(newPage: number) {
    setPage(newPage)
  }

  function handleFilterChange(key: string, value: string) {
    setFilters({ ...filters, [key]: value })
    setPage(1) // Reset to first page
  }

  function clearFilters() {
    setFilters({
      entityType: '',
      action: '',
      startDate: '',
      endDate: '',
    })
    setPage(1)
  }

  if (loading && logs.length === 0) {
    return <PageLoading text="Loading activity logs..." />
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Activity size={28} className="text-blue-600" />
          <h1 className="text-2xl font-bold">Activity Log</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openExport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 border rounded hover:bg-gray-50 ${
              showFilters ? 'bg-gray-100' : ''
            }`}
          >
            <Filter size={18} />
            Filters
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white rounded border p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Entity Type</label>
              <select
                value={filters.entityType}
                onChange={(e) => handleFilterChange('entityType', e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Types</option>
                <option value="work_order">Work Orders</option>
                <option value="estimate">Estimates</option>
                <option value="customer">Customers</option>
                <option value="vehicle">Vehicles</option>
                <option value="item">Items</option>
                <option value="appointment">Appointments</option>
                <option value="sale">Sales</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
              <select
                value={filters.action}
                onChange={(e) => handleFilterChange('action', e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Actions</option>
                <option value="create">Create</option>
                <option value="update">Update</option>
                <option value="delete">Delete</option>
                <option value="status_change">Status Change</option>
                <option value="submit">Submit</option>
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
                <option value="cancel">Cancel</option>
                <option value="convert">Convert</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          {(filters.entityType || filters.action || filters.startDate || filters.endDate) && (
            <button
              onClick={clearFilters}
              className="mt-3 text-sm text-gray-600 hover:text-gray-900"
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Activity List */}
      <div className="bg-white rounded border">
        {logs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No activity logs found
          </div>
        ) : (
          <div className="divide-y">
            {logs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
                    {entityIcons[log.entityType] || <Activity size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${actionColors[log.action] || 'bg-gray-100 text-gray-700'}`}>
                        {log.action.replace('_', ' ')}
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        {log.entityType.replace('_', ' ')}
                      </span>
                      {log.entityName && (
                        <span className="text-sm text-gray-600">
                          - {log.entityName}
                        </span>
                      )}
                    </div>
                    {log.description && (
                      <p className="mt-1 text-sm text-gray-600">{log.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                      {log.user && (
                        <span className="flex items-center gap-1">
                          <User size={12} />
                          {log.user.fullName}
                        </span>
                      )}
                      <span title={formatDateTime(log.createdAt)}>
                        {formatRelativeTime(log.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {serverPagination.totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Showing {((serverPagination.page - 1) * serverPagination.limit) + 1} to{' '}
              {Math.min(serverPagination.page * serverPagination.limit, serverPagination.total)} of{' '}
              {serverPagination.total} entries
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(serverPagination.page - 1)}
                disabled={serverPagination.page <= 1}
                className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm">
                Page {serverPagination.page} of {serverPagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(serverPagination.page + 1)}
                disabled={serverPagination.page >= serverPagination.totalPages}
                className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="activity-logs"
        currentFilters={{ entityType: filters.entityType || '', action: filters.action || '', startDate: filters.startDate || '', endDate: filters.endDate || '' }}
      />
    </div>
  )
}
