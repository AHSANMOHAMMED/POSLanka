'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Activity, ChevronLeft, ChevronRight, User, FileText, Wrench, Car, Package, Calendar, ShoppingCart, Download, X, Settings, CreditCard, Truck, Warehouse, ClipboardList, Users, Tag, Gift, BarChart3 } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { useExport } from '@/hooks/useExport'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { PageLoading } from '@/components/ui/loading-spinner'
import { toast } from '@/components/ui/toast'
import { formatDateTime, formatRelativeTime } from '@/lib/utils/date-format'
import { PermissionGuard } from '@/components/auth/PermissionGuard'

interface UserOption {
  id: string
  fullName: string
}

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
  supplier: <Truck size={16} />,
  purchase: <CreditCard size={16} />,
  purchase_order: <ClipboardList size={16} />,
  category: <Tag size={16} />,
  gift_card: <Gift size={16} />,
  employee: <Users size={16} />,
  warehouse: <Warehouse size={16} />,
  stock_transfer: <Warehouse size={16} />,
  stock_take: <ClipboardList size={16} />,
  settings: <Settings size={16} />,
  user: <Users size={16} />,
  saved_report: <BarChart3 size={16} />,
  held_sale: <ShoppingCart size={16} />,
  print_template: <FileText size={16} />,
  letter_head: <FileText size={16} />,
  notification_template: <FileText size={16} />,
  vehicle_make: <Car size={16} />,
  vehicle_model: <Car size={16} />,
  staff_invite: <Users size={16} />,
  custom_role: <Settings size={16} />,
  role_permissions: <Settings size={16} />,
  sms_settings: <Settings size={16} />,
  email_settings: <Settings size={16} />,
  warehouse_stock: <Warehouse size={16} />,
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
  const [filters, setFilters] = useState({
    entityType: '',
    action: '',
    userId: '',
    startDate: '',
    endDate: '',
  })
  const [users, setUsers] = useState<UserOption[]>([])

  // Fetch users for filter dropdown
  useEffect(() => {
    fetch('/api/users?all=true')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        const list = Array.isArray(data) ? data : data.data || []
        setUsers(list.map((u: { id: string; fullName?: string; email?: string }) => ({
          id: u.id,
          fullName: u.fullName || u.email || 'Unknown',
        })))
      })
      .catch(() => {})
  }, [])

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
      if (filters.userId) params.append('userId', filters.userId)
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
      userId: '',
      startDate: '',
      endDate: '',
    })
    setPage(1)
  }

  if (loading && logs.length === 0) {
    return <PageLoading text="Loading activity logs..." />
  }

  const hasFilters = !!(filters.entityType || filters.action || filters.userId || filters.startDate || filters.endDate)

  return (
    <PermissionGuard permission="viewReports">
    <ListPageLayout
      module="Reports"
      moduleHref="/reports"
      title="Activity Log"
      actionContent={
        <button
          onClick={openExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Download size={14} />
          Export
        </button>
      }
      onRefresh={fetchLogs}
      filterContent={
        <>
          <select
            value={filters.entityType}
            onChange={(e) => handleFilterChange('entityType', e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Types</option>
            <option value="work_order">Work Orders</option>
            <option value="estimate">Estimates</option>
            <option value="customer">Customers</option>
            <option value="vehicle">Vehicles</option>
            <option value="item">Items</option>
            <option value="appointment">Appointments</option>
            <option value="sale">Sales</option>
            <option value="supplier">Suppliers</option>
            <option value="purchase">Purchases</option>
            <option value="purchase_order">Purchase Orders</option>
            <option value="category">Categories</option>
            <option value="gift_card">Gift Cards</option>
            <option value="employee">Employees</option>
            <option value="warehouse">Warehouses</option>
            <option value="stock_transfer">Stock Transfers</option>
            <option value="stock_take">Stock Takes</option>
            <option value="held_sale">Held Sales</option>
            <option value="settings">Settings</option>
            <option value="user">Users</option>
            <option value="saved_report">Saved Reports</option>
            <option value="print_template">Print Templates</option>
            <option value="letter_head">Letter Heads</option>
            <option value="notification_template">Notification Templates</option>
            <option value="vehicle_make">Vehicle Makes</option>
            <option value="vehicle_model">Vehicle Models</option>
            <option value="sms_settings">SMS Settings</option>
            <option value="email_settings">Email Settings</option>
          </select>
          <select
            value={filters.action}
            onChange={(e) => handleFilterChange('action', e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
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
          <select
            value={filters.userId}
            onChange={(e) => handleFilterChange('userId', e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Users</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => handleFilterChange('startDate', e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => handleFilterChange('endDate', e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      {/* Activity List */}
      <div className="bg-white rounded border flex-1 overflow-auto">
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
                        {log.action.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        {log.entityType.replace(/_/g, ' ')}
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
    </ListPageLayout>

    <ExportDialog
      isOpen={showExportDialog}
      onClose={closeExport}
      entity="activity-logs"
      currentFilters={{ entityType: filters.entityType || '', action: filters.action || '', userId: filters.userId || '', startDate: filters.startDate || '', endDate: filters.endDate || '' }}
    />
    </PermissionGuard>
  )
}
