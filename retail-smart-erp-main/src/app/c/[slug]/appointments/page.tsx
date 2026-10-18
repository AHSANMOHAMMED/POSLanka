'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Plus, Pencil, Trash2, Calendar, Clock, Car, Wrench, X, List, CalendarDays, Download } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { useExport } from '@/hooks/useExport'
import { CancellationReasonModal } from '@/components/modals'
import { AppointmentCalendar } from '@/components/appointments'
import { usePaginatedData } from '@/hooks'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { Pagination } from '@/components/ui/pagination'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  customerId: string | null
}

interface ServiceType {
  id: string
  name: string
}

interface WorkOrder {
  id: string
  orderNo: string
}

interface Appointment {
  id: string
  scheduledDate: string
  scheduledTime: string
  durationMinutes: number
  status: 'scheduled' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show'
  notes: string | null
  customerId: string | null
  vehicleId: string | null
  serviceTypeId: string | null
  workOrderId: string | null
  cancellationReason: string | null
  recurrencePattern: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | null
  recurrenceEndDate: string | null
  parentAppointmentId: string | null
  customer: Customer | null
  vehicle: Vehicle | null
  serviceType: ServiceType | null
  workOrder: WorkOrder | null
}

const statusColors: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  confirmed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  arrived: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  completed: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  no_show: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
}

const statusLabels: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

// Valid MANUAL status transitions
const validStatusTransitions: Record<string, string[]> = {
  scheduled: ['confirmed'],
  confirmed: [],
  arrived: [],
  completed: [],
  cancelled: [],
  no_show: [],
}

const statusButtonColors: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-800',
  arrived: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900 dark:text-yellow-300 dark:hover:bg-yellow-800',
  completed: 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-300 dark:hover:bg-purple-800',
  no_show: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (mins === 0) {
    return `${hours}h`
  }
  return `${hours}h ${mins}m`
}

export default function AppointmentsPage() {
  const router = useRouter()
  const params = useParams()
  const slug = params.slug as string
  const { showExportDialog, openExport, closeExport } = useExport()
  const [calendarAppointments, setCalendarAppointments] = useState<Appointment[]>([])
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')

  // Modal states
  const [showCancellationModal, setShowCancellationModal] = useState(false)
  const [cancellingAppointmentId, setCancellingAppointmentId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  const [createWOConfirm, setCreateWOConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  const [processingAction, setProcessingAction] = useState(false)

  // 8L: Tenant timezone for display
  const [timezoneAbbr, setTimezoneAbbr] = useState('IST')

  useEffect(() => {
    fetch('/api/tenant')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.timezone) {
          try {
            const abbr = new Intl.DateTimeFormat('en-US', { timeZone: data.timezone, timeZoneName: 'short' })
              .formatToParts(new Date())
              .find(p => p.type === 'timeZoneName')?.value || 'IST'
            setTimezoneAbbr(abbr)
          } catch { /* use default */ }
        }
      })
      .catch(() => { /* use default */ })
  }, [])

  // Build additionalParams for list view pagination
  const listViewParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (dateFilter) {
      params.startDate = dateFilter
      params.endDate = dateFilter
    }
    if (statusFilter) params.status = statusFilter
    return params
  }, [dateFilter, statusFilter])

  // Paginated appointments for list view
  const {
    data: listAppointments,
    pagination,
    loading: listLoading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: refreshList,
  } = usePaginatedData<Appointment>({
    endpoint: '/api/appointments',
    entityType: 'appointment',
    storageKey: 'appointments-page-size',
    additionalParams: listViewParams,
    realtimeEnabled: viewMode === 'list',
  })

  // Fetch all appointments for calendar view
  const fetchCalendarAppointments = useCallback(async () => {
    try {
      const res = await fetch('/api/appointments?all=true')
      if (res.ok) {
        const data = await res.json()
        setCalendarAppointments(data)
      } else {
        toast.error('Failed to load appointments')
      }
    } catch (error) {
      console.error('Error fetching appointments:', error)
      toast.error('Failed to load appointments')
    } finally {
      setCalendarLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCalendarAppointments()
  }, [fetchCalendarAppointments])

  // Real-time updates for calendar view
  useRealtimeData(fetchCalendarAppointments, { entityType: 'appointment', refreshOnMount: false, enabled: viewMode === 'calendar' })

  // Unified refresh function for both views
  const fetchAppointments = useCallback(() => {
    if (viewMode === 'calendar') {
      fetchCalendarAppointments()
    } else {
      refreshList()
    }
  }, [viewMode, fetchCalendarAppointments, refreshList])

  // Use appropriate appointments based on view mode
  const appointments = viewMode === 'calendar' ? calendarAppointments : listAppointments
  const loading = viewMode === 'calendar' ? calendarLoading : listLoading

  async function handleDelete() {
    if (!deleteConfirm.id || processingAction) return

    setProcessingAction(true)
    try {
      const res = await fetch(`/api/appointments/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        fetchAppointments()
        toast.success('Appointment deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete appointment')
      }
    } catch (error) {
      console.error('Error deleting appointment:', error)
      toast.error('Failed to delete appointment')
    } finally {
      setProcessingAction(false)
      setDeleteConfirm({ open: false, id: null })
    }
  }

  async function handleCreateWorkOrder() {
    if (!createWOConfirm.id || processingAction) return

    setProcessingAction(true)
    try {
      const res = await fetch(`/api/appointments/${createWOConfirm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createWorkOrder: true }),
      })

      if (res.ok) {
        const data = await res.json()
        fetchAppointments()
        toast.success('Work order created')
        if (data.workOrder) {
          window.location.href = `/c/${slug}/work-orders/${data.workOrder.id}`
        }
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create work order')
      }
    } catch (error) {
      console.error('Error creating work order:', error)
      toast.error('Failed to create work order')
    } finally {
      setProcessingAction(false)
      setCreateWOConfirm({ open: false, id: null })
    }
  }

  async function handleStatusChange(id: string, newStatus: string, cancellationReason?: string) {
    if (processingAction) return

    setProcessingAction(true)
    try {
      const body: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'cancelled' && cancellationReason) {
        body.cancellationReason = cancellationReason
      }
      const res = await fetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        fetchAppointments()
        setShowCancellationModal(false)
        setCancellingAppointmentId(null)
        toast.success('Status updated')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update status')
      }
    } catch (error) {
      console.error('Error updating status:', error)
      toast.error('Failed to update status')
    } finally {
      setProcessingAction(false)
    }
  }

  function handleCancelClick(id: string) {
    setCancellingAppointmentId(id)
    setShowCancellationModal(true)
  }

  function handleEdit(appointment: Appointment) {
    router.push(`/c/${slug}/appointments/${appointment.id}`)
  }

  // Group by date for list view
  const groupedAppointments = useMemo(() => {
    return listAppointments.reduce((groups, apt) => {
      const date = apt.scheduledDate
      if (!groups[date]) {
        groups[date] = []
      }
      groups[date].push(apt)
      return groups
    }, {} as Record<string, Appointment[]>)
  }, [listAppointments])

  // Sort dates
  const sortedDates = useMemo(() => {
    return Object.keys(groupedAppointments).sort((a, b) => b.localeCompare(a))
  }, [groupedAppointments])

  if (loading && appointments.length === 0) {
    return <PageLoading text="Loading appointments..." />
  }

  const hasFilters = !!(dateFilter || statusFilter)

  return (
    <>
    <ListPageLayout
      module="Auto Service"
      moduleHref="/auto-service"
      title="Appointment"
      actionContent={
        <div className="flex items-center gap-3">
          {/* Export */}
          <button
            onClick={openExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download size={14} />
            Export
          </button>
          {/* View toggle */}
          <div className="flex items-center border dark:border-gray-600 rounded overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm ${
                viewMode === 'list'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
              aria-label="List view"
            >
              <List size={16} />
              List
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm ${
                viewMode === 'calendar'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
              aria-label="Calendar view"
            >
              <CalendarDays size={16} />
              Calendar
            </button>
          </div>
          <button
            onClick={() => router.push(`/c/${slug}/appointments/new`)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
            aria-label="Create new appointment"
          >
            <Plus size={16} aria-hidden="true" />
            New Appointment
          </button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={fetchAppointments}
      searchPlaceholder="Customer, vehicle, service..."
      filterContent={viewMode === 'list' ? (
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
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
          {hasFilters && (
            <button onClick={() => { setDateFilter(''); setStatusFilter(''); }} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      ) : undefined}
    >
      {/* Calendar View */}
      {viewMode === 'calendar' ? (
        <div className="flex-1 overflow-auto p-4">
          <AppointmentCalendar
            appointments={calendarAppointments}
            selectedDate={dateFilter}
            onSelectDate={(date) => {
              setDateFilter(date === dateFilter ? '' : date)
            }}
            onSelectAppointment={(apt) => handleEdit(apt)}
          />
        </div>
      ) : (
        <>
          {sortedDates.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
              {search || dateFilter || statusFilter ? 'No appointments match your filters.' : 'No appointments found. Create your first appointment!'}
            </div>
          ) : (
            <div className="space-y-6 list-container-xl">
              {sortedDates.map(date => (
                <div key={date} className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
                  <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center gap-2">
                    <Calendar size={18} className="text-gray-400" />
                    <span className="font-medium dark:text-white">
                      {new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({groupedAppointments[date].length} appointment{groupedAppointments[date].length !== 1 ? 's' : ''})
                    </span>
                  </div>
                  <div className="divide-y dark:divide-gray-700">
                    {groupedAppointments[date]
                      .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
                      .map(apt => (
                        <div key={apt.id} className={`p-4 ${
                          apt.status === 'cancelled' ? 'bg-red-50/50 dark:bg-red-900/10 opacity-75' :
                          apt.status === 'no_show' ? 'bg-orange-50/50 dark:bg-orange-900/10 opacity-75' :
                          apt.status === 'completed' ? 'bg-green-50/50 dark:bg-green-900/10' :
                          'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}>
                          <div className="flex justify-between items-start">
                            <div className="flex gap-4">
                              <div className="text-center min-w-[80px]">
                                <div className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                                  <Clock size={14} />
                                  <span className="font-medium">{apt.scheduledTime.slice(0, 5)}</span>
                                  <span className="text-xs text-gray-400">{timezoneAbbr}</span>
                                </div>
                                <div className="text-xs text-gray-400">{formatDuration(apt.durationMinutes)}</div>
                              </div>
                              <div>
                                <div className="font-medium dark:text-white">
                                  {apt.customer?.name || 'No customer'}
                                </div>
                                {apt.vehicle && (
                                  <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                                    <Car size={14} />
                                    {apt.vehicle.licensePlate && <span className="font-medium">[{apt.vehicle.licensePlate}]</span>}
                                    {apt.vehicle.year ? `${apt.vehicle.year} ` : ''}
                                    {apt.vehicle.make} {apt.vehicle.model}
                                  </div>
                                )}
                                {apt.serviceType && (
                                  <div className="text-sm text-gray-600 dark:text-gray-400">{apt.serviceType.name}</div>
                                )}
                                {apt.notes && (
                                  <div className="text-sm text-gray-500 dark:text-gray-500 mt-1">{apt.notes}</div>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              {/* Status transition buttons */}
                              <div className="flex items-center gap-1">
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[apt.status]}`}>
                                  {statusLabels[apt.status]}
                                </span>
                                {validStatusTransitions[apt.status]?.map(nextStatus => (
                                  <button
                                    key={nextStatus}
                                    onClick={() => handleStatusChange(apt.id, nextStatus)}
                                    disabled={processingAction}
                                    className={`px-2 py-1 text-xs font-medium rounded-full transition-colors disabled:opacity-50 ${statusButtonColors[nextStatus]}`}
                                    title={`Mark as ${statusLabels[nextStatus]}`}
                                  >
                                    → {statusLabels[nextStatus]}
                                  </button>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                              {apt.workOrder ? (
                                <Link
                                  href={`/work-orders/${apt.workOrder.id}`}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors"
                                  aria-label={`View work order ${apt.workOrder.orderNo}`}
                                >
                                  <Wrench size={12} />
                                  {apt.workOrder.orderNo}
                                </Link>
                              ) : apt.status !== 'cancelled' && apt.status !== 'no_show' && apt.status !== 'completed' && (
                                <button
                                  onClick={() => setCreateWOConfirm({ open: true, id: apt.id })}
                                  disabled={processingAction}
                                  className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/50 rounded disabled:opacity-50"
                                  title="Create Work Order"
                                  aria-label="Create work order from this appointment"
                                >
                                  <Wrench size={16} aria-hidden="true" />
                                </button>
                              )}
                              <button
                                onClick={() => handleEdit(apt)}
                                disabled={processingAction || ['completed', 'cancelled', 'no_show'].includes(apt.status)}
                                className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                title={['completed', 'cancelled', 'no_show'].includes(apt.status) ? 'Cannot edit terminal appointment' : 'Edit'}
                                aria-label="Edit appointment"
                              >
                                <Pencil size={16} aria-hidden="true" />
                              </button>
                              {apt.status !== 'cancelled' && apt.status !== 'completed' && apt.status !== 'no_show' && apt.status !== 'arrived' && (
                                <>
                                  <button
                                    onClick={() => handleStatusChange(apt.id, 'no_show')}
                                    disabled={processingAction}
                                    className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 disabled:opacity-50"
                                    title="Mark as No Show"
                                    aria-label="Mark as no show"
                                  >
                                    No Show
                                  </button>
                                  <button
                                    onClick={() => handleCancelClick(apt.id)}
                                    disabled={processingAction}
                                    className="p-1 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/50 rounded disabled:opacity-50"
                                    title="Cancel Appointment"
                                    aria-label="Cancel this appointment"
                                  >
                                    <X size={16} aria-hidden="true" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => setDeleteConfirm({ open: true, id: apt.id })}
                                disabled={processingAction || apt.status === 'completed'}
                                className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                title={apt.status === 'completed' ? 'Cannot delete completed appointment' : 'Delete'}
                                aria-label="Delete appointment"
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                              </div>
                              {apt.status === 'cancelled' && apt.cancellationReason && (
                                <p className="text-xs text-red-600 dark:text-red-400" title={apt.cancellationReason}>
                                  Reason: {apt.cancellationReason.length > 40 ? `${apt.cancellationReason.slice(0, 40)}...` : apt.cancellationReason}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination.total > 0 && (
            <div className="mt-4 bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <Pagination
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                className="px-4"
              />
            </div>
          )}
        </>
      )}
    </ListPageLayout>

    <CancellationReasonModal
      isOpen={showCancellationModal}
      onClose={() => {
        setShowCancellationModal(false)
        setCancellingAppointmentId(null)
      }}
      onConfirm={(reason) => {
        if (cancellingAppointmentId) {
          handleStatusChange(cancellingAppointmentId, 'cancelled', reason)
        }
      }}
      title="Cancel Appointment"
      itemName={cancellingAppointmentId ? `Appointment on ${appointments.find(a => a.id === cancellingAppointmentId)?.scheduledDate || ''}` : undefined}
      processing={processingAction}
      documentType="work_order"
    />

    <ConfirmModal
      isOpen={deleteConfirm.open}
      onClose={() => setDeleteConfirm({ open: false, id: null })}
      onConfirm={handleDelete}
      title="Delete Appointment"
      message="Are you sure you want to delete this appointment? This action cannot be undone."
      confirmText="Delete"
      variant="danger"
    />

    <ConfirmModal
      isOpen={createWOConfirm.open}
      onClose={() => setCreateWOConfirm({ open: false, id: null })}
      onConfirm={handleCreateWorkOrder}
      title="Create Work Order"
      message="Create a work order from this appointment? You will be redirected to the work order page."
      confirmText="Create"
      variant="info"
    />

    <ExportDialog
      isOpen={showExportDialog}
      onClose={closeExport}
      entity="appointments"
      currentFilters={{ search, status: statusFilter, startDate: dateFilter || '', endDate: dateFilter || '' }}
    />
    </>
  )
}
