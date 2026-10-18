'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Calendar, Clock, Users, Phone, Mail, Plus, X,
  Edit, Ban, ChevronLeft, ChevronRight, Eye, List, CalendarDays,
  Loader2, Check, UserX,
} from 'lucide-react'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination } from '@/components/ui/pagination'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormInput, FormSelect, FormLabel, FormTextarea } from '@/components/ui/form-elements'
import { CancellationReasonModal } from '@/components/modals'
import { toast } from '@/components/ui/toast'

// ==================== Types ====================

type ReservationStatus = 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show'

interface Table {
  id: string
  name: string
  area: string | null
  capacity: number
  status: string
}

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
}

interface Reservation {
  id: string
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  tableId: string | null
  reservationDate: string
  reservationTime: string
  partySize: number
  estimatedDuration: number | null
  status: ReservationStatus
  notes: string | null
  specialRequests: string | null
  source: string | null
  confirmationCode: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string | null
  table: Table | null
  customer: Customer | null
}

interface CreateReservationForm {
  customerName: string
  customerPhone: string
  customerEmail: string
  reservationDate: string
  reservationTime: string
  partySize: number
  tableId: string
  estimatedDuration: number
  source: string
  notes: string
  specialRequests: string
}

// ==================== Constants ====================

const statusColors: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  seated: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  completed: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  no_show: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
}

const statusLabels: Record<ReservationStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  seated: 'Seated',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

const sourceLabels: Record<string, string> = {
  walk_in: 'Walk-in',
  phone: 'Phone',
  online: 'Online',
  app: 'App',
}

const calendarStatusColors: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-200 border-yellow-400 text-yellow-900',
  confirmed: 'bg-blue-200 border-blue-400 text-blue-900',
  seated: 'bg-green-200 border-green-400 text-green-900',
  completed: 'bg-gray-200 border-gray-400 text-gray-700',
  cancelled: 'bg-red-200 border-red-400 text-red-900',
  no_show: 'bg-orange-200 border-orange-400 text-orange-900',
}

const defaultFormState: CreateReservationForm = {
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  reservationDate: '',
  reservationTime: '',
  partySize: 2,
  tableId: '',
  estimatedDuration: 60,
  source: 'walk_in',
  notes: '',
  specialRequests: '',
}

// ==================== Helper functions ====================

function formatTime(timeStr: string): string {
  // timeStr is "HH:mm:ss" or "HH:mm"
  const parts = timeStr.split(':')
  const hour = parseInt(parts[0])
  const minute = parts[1]
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minute} ${ampm}`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function getWeekDays(startDate: Date): Date[] {
  const days: Date[] = []
  const start = new Date(startDate)
  // Set to Monday of the week
  const dayOfWeek = start.getDay()
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  start.setDate(start.getDate() + diff)
  for (let i = 0; i < 7; i++) {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    days.push(day)
  }
  return days
}

function dateToString(date: Date): string {
  return date.toISOString().split('T')[0]
}

function getTodayString(): string {
  return dateToString(new Date())
}

// ==================== Component ====================

export default function ReservationsPage() {
  // View state
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')

  // Create/Edit modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null)
  const [formData, setFormData] = useState<CreateReservationForm>(defaultFormState)
  const [saving, setSaving] = useState(false)

  // Detail modal state
  const [detailReservation, setDetailReservation] = useState<Reservation | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  // Cancellation state
  const [showCancellationModal, setShowCancellationModal] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancellingName, setCancellingName] = useState('')
  const [cancelProcessing, setCancelProcessing] = useState(false)

  // Tables data for dropdown
  const [tables, setTables] = useState<Table[]>([])

  // Calendar state
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => new Date())
  const [calendarReservations, setCalendarReservations] = useState<Reservation[]>([])
  const [loadingCalendar, setLoadingCalendar] = useState(false)

  // Paginated reservations data
  const {
    data: reservations,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Reservation>({
    endpoint: '/api/reservations',
    entityType: 'reservation',
    storageKey: 'reservations-page-size',
    additionalParams: {
      ...(statusFilter && { status: statusFilter }),
      ...(dateFilter && { date: dateFilter }),
    },
  })

  // Fetch tables for dropdown
  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant-tables?all=true')
      if (res.ok) {
        const data = await res.json()
        setTables(data)
      }
    } catch (error) {
      console.error('Error fetching tables:', error)
    }
  }, [])

  useEffect(() => {
    fetchTables()
  }, [fetchTables])

  useRealtimeData(fetchTables, { entityType: 'table' })

  // Fetch calendar data when view mode or week changes
  const weekDays = useMemo(() => getWeekDays(calendarWeekStart), [calendarWeekStart])
  const calendarFromDate = useMemo(() => dateToString(weekDays[0]), [weekDays])
  const calendarToDate = useMemo(() => dateToString(weekDays[6]), [weekDays])

  const fetchCalendarData = useCallback(async () => {
    if (viewMode !== 'calendar') return
    setLoadingCalendar(true)
    try {
      const params = new URLSearchParams({
        all: 'true',
        fromDate: calendarFromDate,
        toDate: calendarToDate,
      })
      if (statusFilter) params.set('status', statusFilter)

      const res = await fetch(`/api/reservations?${params}`)
      if (res.ok) {
        const data = await res.json()
        setCalendarReservations(data)
      }
    } catch (error) {
      console.error('Error fetching calendar reservations:', error)
    } finally {
      setLoadingCalendar(false)
    }
  }, [viewMode, calendarFromDate, calendarToDate, statusFilter])

  useEffect(() => {
    fetchCalendarData()
  }, [fetchCalendarData])

  // Subscribe to realtime updates for calendar too
  useRealtimeData(fetchCalendarData, { entityType: 'reservation', enabled: viewMode === 'calendar' })

  // ==================== Handlers ====================

  function handleOpenCreate() {
    setEditingReservation(null)
    setFormData({
      ...defaultFormState,
      reservationDate: getTodayString(),
    })
    setShowCreateModal(true)
  }

  function handleOpenEdit(reservation: Reservation) {
    setEditingReservation(reservation)
    setFormData({
      customerName: reservation.customerName || '',
      customerPhone: reservation.customerPhone || '',
      customerEmail: reservation.customerEmail || '',
      reservationDate: reservation.reservationDate,
      reservationTime: reservation.reservationTime.substring(0, 5), // HH:mm
      partySize: reservation.partySize,
      tableId: reservation.tableId || '',
      estimatedDuration: reservation.estimatedDuration || 60,
      source: reservation.source || 'walk_in',
      notes: reservation.notes || '',
      specialRequests: reservation.specialRequests || '',
    })
    setShowCreateModal(true)
  }

  function handleOpenDetail(reservation: Reservation) {
    setDetailReservation(reservation)
    setShowDetailModal(true)
  }

  function handleCancelClick(reservation: Reservation) {
    setCancellingId(reservation.id)
    setCancellingName(
      `Reservation for ${reservation.customerName || 'Unknown'} on ${formatDate(reservation.reservationDate)} at ${formatTime(reservation.reservationTime)}`
    )
    setShowCancellationModal(true)
  }

  async function handleCancelConfirm(reason: string) {
    if (!cancellingId) return
    setCancelProcessing(true)
    try {
      const res = await fetch(`/api/reservations/${cancellingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancellationReason: reason,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to cancel reservation')
      }

      toast.success('Reservation cancelled')
      setShowCancellationModal(false)
      setCancellingId(null)
      setCancellingName('')

      // Close detail modal if it was open for this reservation
      if (detailReservation?.id === cancellingId) {
        setShowDetailModal(false)
        setDetailReservation(null)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to cancel reservation')
    } finally {
      setCancelProcessing(false)
    }
  }

  async function handleStatusChange(reservationId: string, newStatus: ReservationStatus) {
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to update status')
      }

      const updated = await res.json()
      toast.success(`Reservation marked as ${statusLabels[newStatus]}`)

      // Update detail modal if open
      if (detailReservation?.id === reservationId) {
        setDetailReservation(updated)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update status')
    } finally {
      setUpdatingStatus(false)
    }
  }

  async function handleSubmit() {
    // Validate required fields
    if (!formData.customerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    if (!formData.reservationDate) {
      toast.error('Reservation date is required')
      return
    }
    if (!formData.reservationTime) {
      toast.error('Reservation time is required')
      return
    }
    if (formData.partySize < 1) {
      toast.error('Party size must be at least 1')
      return
    }

    setSaving(true)
    try {
      const url = editingReservation
        ? `/api/reservations/${editingReservation.id}`
        : '/api/reservations'

      const payload = {
        customerName: formData.customerName.trim(),
        customerPhone: formData.customerPhone.trim() || null,
        customerEmail: formData.customerEmail.trim() || null,
        reservationDate: formData.reservationDate,
        reservationTime: formData.reservationTime,
        partySize: formData.partySize,
        tableId: formData.tableId || null,
        estimatedDuration: formData.estimatedDuration,
        source: formData.source,
        notes: formData.notes.trim() || null,
        specialRequests: formData.specialRequests.trim() || null,
        ...(editingReservation && { expectedUpdatedAt: editingReservation.updatedAt }),
      }

      const res = await fetch(url, {
        method: editingReservation ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const error = await res.json()
        if (res.status === 409) {
          toast.error('This reservation was modified by another user. Please refresh and try again.')
          setShowCreateModal(false)
          return
        }
        throw new Error(error.error || 'Failed to save reservation')
      }

      toast.success(editingReservation ? 'Reservation updated' : 'Reservation created')
      setShowCreateModal(false)
      setEditingReservation(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save reservation')
    } finally {
      setSaving(false)
    }
  }

  // Calendar navigation
  function goToPreviousWeek() {
    const prev = new Date(calendarWeekStart)
    prev.setDate(prev.getDate() - 7)
    setCalendarWeekStart(prev)
  }

  function goToNextWeek() {
    const next = new Date(calendarWeekStart)
    next.setDate(next.getDate() + 7)
    setCalendarWeekStart(next)
  }

  function goToToday() {
    setCalendarWeekStart(new Date())
  }

  // Calendar time slots (10:00 - 22:00)
  const timeSlots = useMemo(() => {
    const slots: string[] = []
    for (let hour = 10; hour <= 22; hour++) {
      slots.push(`${String(hour).padStart(2, '0')}:00`)
    }
    return slots
  }, [])

  // Group calendar reservations by day and time
  const calendarGrid = useMemo(() => {
    const grid: Record<string, Reservation[]> = {}
    for (const day of weekDays) {
      const dayStr = dateToString(day)
      for (const slot of timeSlots) {
        grid[`${dayStr}-${slot}`] = []
      }
    }

    for (const reservation of calendarReservations) {
      const resDate = reservation.reservationDate
      const resTime = reservation.reservationTime.substring(0, 5) // HH:mm
      const resHour = parseInt(resTime.split(':')[0])

      // Place reservation in the closest hour slot
      const slotHour = Math.max(10, Math.min(22, resHour))
      const slotKey = `${resDate}-${String(slotHour).padStart(2, '0')}:00`

      if (grid[slotKey]) {
        grid[slotKey].push(reservation)
      }
    }

    return grid
  }, [calendarReservations, weekDays, timeSlots])

  // ==================== Render ====================

  if (loading && reservations.length === 0 && viewMode === 'list') {
    return <PageLoading text="Loading reservations..." />
  }

  return (
    <>
      <ListPageLayout
        module="Restaurant"
        moduleHref="/restaurant"
        title="Reservations"
        actionContent={
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <List size={14} />
                List
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'calendar'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <CalendarDays size={14} />
                Calendar
              </button>
            </div>

            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              New Reservation
            </button>
          </div>
        }
        search={viewMode === 'list' ? search : undefined}
        setSearch={viewMode === 'list' ? setSearch : undefined}
        onRefresh={viewMode === 'list' ? refresh : fetchCalendarData}
        searchPlaceholder="Search by name, phone, email, or code..."
        filterContent={
          <>
            {viewMode === 'list' && (
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            )}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">All Statuses</option>
              {(Object.entries(statusLabels) as [ReservationStatus, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {(statusFilter || dateFilter) && (
              <button
                onClick={() => { setStatusFilter(''); setDateFilter('') }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5"
              >
                <X size={14} />
              </button>
            )}
          </>
        }
      >
        {viewMode === 'list' ? (
          /* ==================== LIST VIEW ==================== */
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">List of reservations</caption>
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Date & Time</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Customer</th>
                  <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-300">Party</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Table</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Source</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Code</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
                  <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                      {search || statusFilter || dateFilter
                        ? 'No reservations match your filters'
                        : 'No reservations yet. Create your first reservation!'}
                    </td>
                  </tr>
                ) : (
                  reservations.map((reservation) => (
                    <tr
                      key={reservation.id}
                      className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                      onClick={() => handleOpenDetail(reservation)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-gray-400 shrink-0" />
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white text-sm">
                              {formatDate(reservation.reservationDate)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                              <Clock size={12} />
                              {formatTime(reservation.reservationTime)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white text-sm">
                            {reservation.customerName || reservation.customer?.name || 'Unknown'}
                          </p>
                          {(reservation.customerPhone || reservation.customer?.phone) && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                              <Phone size={12} />
                              {reservation.customerPhone || reservation.customer?.phone}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-gray-600 dark:text-gray-300">
                          <Users size={14} />
                          <span className="text-sm">{reservation.partySize}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {reservation.table ? (
                          <span>
                            {reservation.table.name}
                            {reservation.table.area && (
                              <span className="text-gray-400 text-xs ml-1">({reservation.table.area})</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {sourceLabels[reservation.source || ''] || reservation.source || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                          {reservation.confirmationCode || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[reservation.status]}`}>
                          {statusLabels[reservation.status]}
                        </span>
                        {reservation.status === 'cancelled' && reservation.cancellationReason && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1" title={reservation.cancellationReason}>
                            {reservation.cancellationReason.length > 20
                              ? `${reservation.cancellationReason.slice(0, 20)}...`
                              : reservation.cancellationReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleOpenDetail(reservation)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                            title="View details"
                          >
                            <Eye size={16} />
                          </button>
                          {!['completed', 'cancelled', 'no_show'].includes(reservation.status) && (
                            <>
                              <button
                                onClick={() => handleOpenEdit(reservation)}
                                className="p-1.5 text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                title="Edit"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => handleCancelClick(reservation)}
                                className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                title="Cancel"
                              >
                                <Ban size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              className="border-t dark:border-gray-700 px-4"
            />
          </div>
        ) : (
          /* ==================== CALENDAR VIEW ==================== */
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
            {/* Calendar Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
              <div className="flex items-center gap-2">
                <button
                  onClick={goToPreviousWeek}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={goToNextWeek}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={goToToday}
                  className="px-2.5 py-1 text-xs font-medium border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Today
                </button>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {weekDays[0].toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                {weekDays[0].getMonth() !== weekDays[6].getMonth() && (
                  <> - {weekDays[6].toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</>
                )}
              </h3>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {loadingCalendar && <Loader2 size={14} className="animate-spin" />}
                <span>{calendarReservations.length} reservations</span>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                {/* Day Headers */}
                <div className="grid grid-cols-[80px_repeat(7,1fr)] border-b dark:border-gray-700">
                  <div className="px-2 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
                    Time
                  </div>
                  {weekDays.map((day) => {
                    const isToday = dateToString(day) === getTodayString()
                    return (
                      <div
                        key={dateToString(day)}
                        className={`px-2 py-2 text-center border-r dark:border-gray-700 last:border-r-0 ${
                          isToday ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                        }`}
                      >
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {day.toLocaleDateString('en-US', { weekday: 'short' })}
                        </p>
                        <p className={`text-sm font-semibold ${
                          isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'
                        }`}>
                          {day.getDate()}
                        </p>
                      </div>
                    )
                  })}
                </div>

                {/* Time Rows */}
                <div className="max-h-[600px] overflow-y-auto">
                  {timeSlots.map((slot) => (
                    <div key={slot} className="grid grid-cols-[80px_repeat(7,1fr)] border-b dark:border-gray-700 last:border-b-0 min-h-[60px]">
                      <div className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 border-r dark:border-gray-700 flex items-start pt-2">
                        {formatTime(slot)}
                      </div>
                      {weekDays.map((day) => {
                        const dayStr = dateToString(day)
                        const isToday = dayStr === getTodayString()
                        const cellKey = `${dayStr}-${slot}`
                        const cellReservations = calendarGrid[cellKey] || []

                        return (
                          <div
                            key={cellKey}
                            className={`px-1 py-1 border-r dark:border-gray-700 last:border-r-0 ${
                              isToday ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                            }`}
                          >
                            {cellReservations.map((res) => (
                              <button
                                key={res.id}
                                onClick={() => handleOpenDetail(res)}
                                className={`w-full text-left px-1.5 py-1 mb-0.5 rounded text-xs border truncate ${
                                  calendarStatusColors[res.status]
                                } hover:opacity-80 transition-opacity`}
                                title={`${res.customerName || 'Unknown'} - ${res.partySize} guests - ${formatTime(res.reservationTime)}`}
                              >
                                <span className="font-medium">{res.customerName || 'Unknown'}</span>
                                <span className="ml-1 opacity-75">({res.partySize})</span>
                              </button>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Calendar Legend */}
            <div className="flex items-center gap-3 px-4 py-2 border-t dark:border-gray-700 flex-wrap">
              {(Object.entries(statusLabels) as [ReservationStatus, string][]).map(([status, label]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded ${calendarStatusColors[status].split(' ')[0]}`} />
                  <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ListPageLayout>

      {/* ==================== CREATE/EDIT MODAL ==================== */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false)
          setEditingReservation(null)
        }}
        title={editingReservation ? 'Edit Reservation' : 'New Reservation'}
        size="lg"
        footer={
          <ModalFooter>
            <button
              onClick={() => {
                setShowCreateModal(false)
                setEditingReservation(null)
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </span>
              ) : editingReservation ? 'Update Reservation' : 'Create Reservation'}
            </button>
          </ModalFooter>
        }
      >
        <div className="space-y-4">
          {/* Customer Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FormLabel required>Customer Name</FormLabel>
              <FormInput
                type="text"
                value={formData.customerName}
                onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div>
              <FormLabel optional>Phone</FormLabel>
              <FormInput
                type="tel"
                value={formData.customerPhone}
                onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                placeholder="Phone number"
              />
            </div>
          </div>

          <div>
            <FormLabel optional>Email</FormLabel>
            <FormInput
              type="email"
              value={formData.customerEmail}
              onChange={(e) => setFormData({ ...formData, customerEmail: e.target.value })}
              placeholder="Email address"
            />
          </div>

          {/* Date, Time, Party Size */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FormLabel required>Date</FormLabel>
              <FormInput
                type="date"
                value={formData.reservationDate}
                onChange={(e) => setFormData({ ...formData, reservationDate: e.target.value })}
              />
            </div>
            <div>
              <FormLabel required>Time</FormLabel>
              <FormInput
                type="time"
                value={formData.reservationTime}
                onChange={(e) => setFormData({ ...formData, reservationTime: e.target.value })}
              />
            </div>
            <div>
              <FormLabel required>Party Size</FormLabel>
              <FormInput
                type="number"
                min={1}
                max={100}
                value={formData.partySize}
                onChange={(e) => setFormData({ ...formData, partySize: parseInt(e.target.value) || 2 })}
              />
            </div>
          </div>

          {/* Table and Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FormLabel optional>Table</FormLabel>
              <FormSelect
                value={formData.tableId}
                onChange={(e) => setFormData({ ...formData, tableId: e.target.value })}
              >
                <option value="">Auto-assign</option>
                {tables.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.name}{table.area ? ` (${table.area})` : ''} - {table.capacity} seats
                  </option>
                ))}
              </FormSelect>
            </div>
            <div>
              <FormLabel optional>Duration (minutes)</FormLabel>
              <FormInput
                type="number"
                min={15}
                max={480}
                step={15}
                value={formData.estimatedDuration}
                onChange={(e) => setFormData({ ...formData, estimatedDuration: parseInt(e.target.value) || 60 })}
              />
            </div>
            <div>
              <FormLabel optional>Source</FormLabel>
              <FormSelect
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
              >
                <option value="walk_in">Walk-in</option>
                <option value="phone">Phone</option>
                <option value="online">Online</option>
                <option value="app">App</option>
              </FormSelect>
            </div>
          </div>

          {/* Notes */}
          <div>
            <FormLabel optional>Notes</FormLabel>
            <FormTextarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Internal notes..."
              rows={2}
            />
          </div>

          {/* Special Requests */}
          <div>
            <FormLabel optional>Special Requests</FormLabel>
            <FormTextarea
              value={formData.specialRequests}
              onChange={(e) => setFormData({ ...formData, specialRequests: e.target.value })}
              placeholder="Customer special requests (e.g., high chair, dietary needs)..."
              rows={2}
            />
          </div>
        </div>
      </Modal>

      {/* ==================== DETAIL MODAL ==================== */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false)
          setDetailReservation(null)
        }}
        title="Reservation Details"
        size="lg"
      >
        {detailReservation && (
          <div className="space-y-6">
            {/* Status & Confirmation Code */}
            <div className="flex items-center justify-between">
              <span className={`px-3 py-1.5 text-sm font-medium rounded-full ${statusColors[detailReservation.status]}`}>
                {statusLabels[detailReservation.status]}
              </span>
              {detailReservation.confirmationCode && (
                <div className="text-right">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Confirmation Code</p>
                  <p className="font-mono text-lg font-bold text-blue-600 dark:text-blue-400">
                    {detailReservation.confirmationCode}
                  </p>
                </div>
              )}
            </div>

            {/* Customer Info */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Customer Information</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Users size={16} className="text-gray-400" />
                  <span className="text-gray-900 dark:text-white font-medium">
                    {detailReservation.customerName || detailReservation.customer?.name || 'Unknown'}
                  </span>
                </div>
                {(detailReservation.customerPhone || detailReservation.customer?.phone) && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone size={16} className="text-gray-400" />
                    <span className="text-gray-600 dark:text-gray-300">
                      {detailReservation.customerPhone || detailReservation.customer?.phone}
                    </span>
                  </div>
                )}
                {(detailReservation.customerEmail || detailReservation.customer?.email) && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail size={16} className="text-gray-400" />
                    <span className="text-gray-600 dark:text-gray-300">
                      {detailReservation.customerEmail || detailReservation.customer?.email}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Reservation Details */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Date</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                  <Calendar size={14} className="text-gray-400" />
                  {formatDate(detailReservation.reservationDate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Time</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                  <Clock size={14} className="text-gray-400" />
                  {formatTime(detailReservation.reservationTime)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Party Size</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                  <Users size={14} className="text-gray-400" />
                  {detailReservation.partySize} guests
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Duration</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {detailReservation.estimatedDuration || 60} min
                </p>
              </div>
            </div>

            {/* Table & Source */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Table</p>
                <p className="text-sm text-gray-900 dark:text-white">
                  {detailReservation.table
                    ? `${detailReservation.table.name}${detailReservation.table.area ? ` (${detailReservation.table.area})` : ''}`
                    : 'Not assigned'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Source</p>
                <p className="text-sm text-gray-900 dark:text-white">
                  {sourceLabels[detailReservation.source || ''] || detailReservation.source || '-'}
                </p>
              </div>
            </div>

            {/* Notes & Special Requests */}
            {detailReservation.notes && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 rounded p-2">
                  {detailReservation.notes}
                </p>
              </div>
            )}

            {detailReservation.specialRequests && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Special Requests</p>
                <p className="text-sm text-gray-700 dark:text-gray-300 bg-amber-50 dark:bg-amber-900/20 rounded p-2 border border-amber-200 dark:border-amber-800">
                  {detailReservation.specialRequests}
                </p>
              </div>
            )}

            {/* Cancellation info */}
            {detailReservation.status === 'cancelled' && detailReservation.cancellationReason && (
              <div className="bg-red-50 dark:bg-red-900/20 rounded p-3 border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-500 dark:text-red-400 mb-1">Cancellation Reason</p>
                <p className="text-sm text-red-700 dark:text-red-300">{detailReservation.cancellationReason}</p>
                {detailReservation.cancelledAt && (
                  <p className="text-xs text-red-400 mt-1">
                    Cancelled at: {new Date(detailReservation.cancelledAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {/* Status Actions */}
            {!['completed', 'cancelled', 'no_show'].includes(detailReservation.status) && (
              <div className="border-t dark:border-gray-700 pt-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Quick Actions</p>
                <div className="flex flex-wrap gap-2">
                  {detailReservation.status === 'pending' && (
                    <button
                      onClick={() => handleStatusChange(detailReservation.id, 'confirmed')}
                      disabled={updatingStatus}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      <Check size={14} />
                      Confirm
                    </button>
                  )}
                  {(detailReservation.status === 'pending' || detailReservation.status === 'confirmed') && (
                    <button
                      onClick={() => handleStatusChange(detailReservation.id, 'seated')}
                      disabled={updatingStatus}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      <Users size={14} />
                      Seat
                    </button>
                  )}
                  {detailReservation.status === 'seated' && (
                    <button
                      onClick={() => handleStatusChange(detailReservation.id, 'completed')}
                      disabled={updatingStatus}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      <Check size={14} />
                      Complete
                    </button>
                  )}
                  {(detailReservation.status === 'pending' || detailReservation.status === 'confirmed') && (
                    <button
                      onClick={() => handleStatusChange(detailReservation.id, 'no_show')}
                      disabled={updatingStatus}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors disabled:opacity-50"
                    >
                      <UserX size={14} />
                      No Show
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowDetailModal(false)
                      handleOpenEdit(detailReservation)
                    }}
                    disabled={updatingStatus}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  >
                    <Edit size={14} />
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      setShowDetailModal(false)
                      handleCancelClick(detailReservation)
                    }}
                    disabled={updatingStatus}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    <Ban size={14} />
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Created At */}
            <div className="text-xs text-gray-400 dark:text-gray-500 border-t dark:border-gray-700 pt-3">
              Created: {new Date(detailReservation.createdAt).toLocaleString()}
              {detailReservation.updatedAt && (
                <> | Last updated: {new Date(detailReservation.updatedAt).toLocaleString()}</>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ==================== CANCELLATION MODAL ==================== */}
      <CancellationReasonModal
        isOpen={showCancellationModal}
        onClose={() => {
          setShowCancellationModal(false)
          setCancellingId(null)
          setCancellingName('')
        }}
        onConfirm={handleCancelConfirm}
        title="Cancel Reservation"
        itemName={cancellingName}
        processing={cancelProcessing}
        documentType="reservation"
      />
    </>
  )
}
