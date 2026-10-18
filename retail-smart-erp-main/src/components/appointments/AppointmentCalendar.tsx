'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Clock, User } from 'lucide-react'

// Base appointment interface for calendar display
interface BaseAppointment {
  id: string
  scheduledDate: string
  scheduledTime: string
  durationMinutes: number
  status: 'scheduled' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show'
  customer: { name: string } | null
  vehicle: { make: string; model: string; licensePlate: string | null } | null
  serviceType: { name: string } | null
}

// Generic props to accept any appointment type that extends the base
interface Props<T extends BaseAppointment> {
  appointments: T[]
  onSelectDate?: (date: string) => void
  onSelectAppointment?: (appointment: T) => void
  selectedDate?: string
}

const statusColors: Record<string, string> = {
  scheduled: 'bg-blue-500',
  confirmed: 'bg-green-500',
  arrived: 'bg-yellow-500',
  completed: 'bg-purple-500',
  cancelled: 'bg-red-500',
  no_show: 'bg-gray-500',
}

const statusLabels: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

export function AppointmentCalendar<T extends BaseAppointment>({ appointments, onSelectDate, onSelectAppointment, selectedDate }: Props<T>) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)

  // Get appointments grouped by date
  const appointmentsByDate = useMemo(() => {
    return appointments.reduce((acc, apt) => {
      if (!acc[apt.scheduledDate]) {
        acc[apt.scheduledDate] = []
      }
      acc[apt.scheduledDate].push(apt)
      return acc
    }, {} as Record<string, T[]>)
  }, [appointments])

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()

    // First day of the month
    const firstDay = new Date(year, month, 1)
    // Last day of the month
    const lastDay = new Date(year, month + 1, 0)

    // Start from Sunday of the week containing the first day
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - startDate.getDay())

    // End on Saturday of the week containing the last day
    const endDate = new Date(lastDay)
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay()))

    const days: { date: Date; isCurrentMonth: boolean }[] = []
    const current = new Date(startDate)

    while (current <= endDate) {
      days.push({
        date: new Date(current),
        isCurrentMonth: current.getMonth() === month
      })
      current.setDate(current.getDate() + 1)
    }

    return days
  }, [currentMonth])

  function formatDateKey(date: Date): string {
    return date.toISOString().split('T')[0]
  }

  function goToPreviousMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  function goToNextMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  function goToToday() {
    const now = new Date()
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  const todayStr = formatDateKey(new Date())

  return (
    <div className="bg-white rounded border">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousMonth}
            className="p-2 hover:bg-gray-100 rounded"
            aria-label="Previous month"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={goToNextMonth}
            className="p-2 hover:bg-gray-100 rounded"
            aria-label="Next month"
          >
            <ChevronRight size={20} />
          </button>
          <h2 className="text-lg font-semibold ml-2">
            {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h2>
        </div>
        <button
          onClick={goToToday}
          className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
        >
          Today
        </button>
      </div>

      {/* Days of week header */}
      <div className="grid grid-cols-7 border-b">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="py-2 text-center text-sm font-medium text-gray-500">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day, idx) => {
          const dateKey = formatDateKey(day.date)
          const dayAppointments = appointmentsByDate[dateKey] || []
          const isToday = dateKey === todayStr
          const isSelected = dateKey === selectedDate
          const isHovered = dateKey === hoveredDate

          return (
            <div
              key={idx}
              className={`min-h-[100px] border-b border-r p-1 cursor-pointer transition-colors ${
                !day.isCurrentMonth ? 'bg-gray-50' : ''
              } ${isSelected ? 'bg-blue-50' : isHovered ? 'bg-gray-50' : ''}`}
              onClick={() => onSelectDate?.(dateKey)}
              onMouseEnter={() => setHoveredDate(dateKey)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              <div className={`text-sm font-medium mb-1 ${
                isToday
                  ? 'w-7 h-7 flex items-center justify-center bg-blue-600 text-white rounded-full mx-auto'
                  : day.isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
              }`}>
                {day.date.getDate()}
              </div>
              <div className="space-y-1">
                {dayAppointments.slice(0, 3).map(apt => (
                  <div
                    key={apt.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectAppointment?.(apt)
                    }}
                    className={`text-xs px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80 ${statusColors[apt.status]} text-white`}
                    title={`${apt.scheduledTime.slice(0, 5)} - ${apt.customer?.name || 'No customer'} - ${apt.serviceType?.name || 'No service'}`}
                  >
                    {apt.scheduledTime.slice(0, 5)} {apt.customer?.name?.split(' ')[0] || ''}
                  </div>
                ))}
                {dayAppointments.length > 3 && (
                  <div className="text-xs text-gray-500 pl-1">
                    +{dayAppointments.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="p-3 border-t flex flex-wrap gap-3">
        {Object.entries(statusLabels).map(([status, label]) => (
          <div key={status} className="flex items-center gap-1 text-xs">
            <div className={`w-3 h-3 rounded ${statusColors[status]}`} />
            <span className="text-gray-600">{label}</span>
          </div>
        ))}
      </div>

      {/* Selected date appointments detail */}
      {selectedDate && appointmentsByDate[selectedDate]?.length > 0 && (
        <div className="border-t p-4">
          <h3 className="font-medium mb-3">
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric'
            })}
          </h3>
          <div className="space-y-2">
            {appointmentsByDate[selectedDate]
              .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
              .map(apt => (
                <div
                  key={apt.id}
                  onClick={() => onSelectAppointment?.(apt)}
                  className="flex items-center gap-3 p-2 rounded border hover:bg-gray-50 cursor-pointer"
                >
                  <div className={`w-1 h-10 rounded ${statusColors[apt.status]}`} />
                  <div className="flex items-center gap-1 text-sm font-medium min-w-[60px]">
                    <Clock size={14} className="text-gray-400" />
                    {apt.scheduledTime.slice(0, 5)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-gray-400" />
                      <span className="font-medium">{apt.customer?.name || 'No customer'}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      {apt.serviceType?.name || 'No service'}
                      {apt.vehicle && ` • ${apt.vehicle.licensePlate || ''} ${apt.vehicle.make} ${apt.vehicle.model}`}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[apt.status]} text-white`}>
                    {statusLabels[apt.status]}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
