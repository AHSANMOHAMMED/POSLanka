// X3: Consistent date/time formatting utilities

/**
 * Format options for different use cases
 */
export const DATE_FORMATS = {
  // Short date: "Jan 28, 2026"
  short: { month: 'short', day: 'numeric', year: 'numeric' } as const,

  // Long date: "January 28, 2026"
  long: { month: 'long', day: 'numeric', year: 'numeric' } as const,

  // Full date with weekday: "Tuesday, January 28, 2026"
  full: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } as const,

  // Numeric: "01/28/2026"
  numeric: { month: '2-digit', day: '2-digit', year: 'numeric' } as const,

  // ISO date: "2026-01-28"
  iso: { year: 'numeric', month: '2-digit', day: '2-digit' } as const,
}

export const TIME_FORMATS = {
  // Short time: "2:30 PM"
  short: { hour: 'numeric', minute: '2-digit', hour12: true } as const,

  // With seconds: "2:30:45 PM"
  long: { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true } as const,

  // 24-hour: "14:30"
  military: { hour: '2-digit', minute: '2-digit', hour12: false } as const,
}

/**
 * Format a date string or Date object to a readable date
 * @param date - Date string, Date object, or null/undefined
 * @param format - Format preset (default: 'short')
 * @returns Formatted date string or '-' if invalid
 */
export function formatDate(
  date: string | Date | null | undefined,
  format: keyof typeof DATE_FORMATS = 'short'
): string {
  if (!date) return '-'

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    if (isNaN(dateObj.getTime())) return '-'

    return dateObj.toLocaleDateString('en-US', DATE_FORMATS[format])
  } catch {
    return '-'
  }
}

/**
 * Format a date string or Date object to a readable time
 * @param date - Date string, Date object, or null/undefined
 * @param format - Format preset (default: 'short')
 * @returns Formatted time string or '-' if invalid
 */
export function formatTime(
  date: string | Date | null | undefined,
  format: keyof typeof TIME_FORMATS = 'short'
): string {
  if (!date) return '-'

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    if (isNaN(dateObj.getTime())) return '-'

    return dateObj.toLocaleTimeString('en-US', TIME_FORMATS[format])
  } catch {
    return '-'
  }
}

/**
 * Format a date string or Date object to date and time
 * @param date - Date string, Date object, or null/undefined
 * @param dateFormat - Date format preset (default: 'short')
 * @param timeFormat - Time format preset (default: 'short')
 * @returns Formatted date and time string or '-' if invalid
 */
export function formatDateTime(
  date: string | Date | null | undefined,
  dateFormat: keyof typeof DATE_FORMATS = 'short',
  timeFormat: keyof typeof TIME_FORMATS = 'short'
): string {
  if (!date) return '-'

  const formattedDate = formatDate(date, dateFormat)
  const formattedTime = formatTime(date, timeFormat)

  if (formattedDate === '-' || formattedTime === '-') return '-'

  return `${formattedDate} ${formattedTime}`
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "in 3 days")
 * @param date - Date string, Date object, or null/undefined
 * @returns Relative time string or '-' if invalid
 */
export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return '-'

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    if (isNaN(dateObj.getTime())) return '-'

    const now = new Date()
    const diffMs = dateObj.getTime() - now.getTime()
    const diffSec = Math.round(diffMs / 1000)
    const diffMin = Math.round(diffSec / 60)
    const diffHour = Math.round(diffMin / 60)
    const diffDay = Math.round(diffHour / 24)

    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

    if (Math.abs(diffSec) < 60) {
      return rtf.format(diffSec, 'second')
    } else if (Math.abs(diffMin) < 60) {
      return rtf.format(diffMin, 'minute')
    } else if (Math.abs(diffHour) < 24) {
      return rtf.format(diffHour, 'hour')
    } else if (Math.abs(diffDay) < 30) {
      return rtf.format(diffDay, 'day')
    } else {
      return formatDate(dateObj, 'short')
    }
  } catch {
    return '-'
  }
}

/**
 * Check if a date is today
 */
export function isToday(date: string | Date | null | undefined): boolean {
  if (!date) return false

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    const today = new Date()

    return dateObj.toDateString() === today.toDateString()
  } catch {
    return false
  }
}

/**
 * Check if a date is in the past
 */
export function isPast(date: string | Date | null | undefined): boolean {
  if (!date) return false

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.getTime() < Date.now()
  } catch {
    return false
  }
}

/**
 * Check if a date is in the future
 */
export function isFuture(date: string | Date | null | undefined): boolean {
  if (!date) return false

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.getTime() > Date.now()
  } catch {
    return false
  }
}

/**
 * Get the start of day for a date
 */
export function startOfDay(date: string | Date): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Get the end of day for a date
 */
export function endOfDay(date: string | Date): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

/**
 * Format a date using a tenant date format string like 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'
 * @param date - Date string, Date object, or null/undefined
 * @param dateFormatStr - Format string from tenant settings (default: 'DD/MM/YYYY')
 * @returns Formatted date string or '-' if invalid
 */
export function formatTenantDate(
  date: string | Date | null | undefined,
  dateFormatStr: string = 'DD/MM/YYYY'
): string {
  if (!date) return '-'

  try {
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return '-'

    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = String(d.getFullYear())

    switch (dateFormatStr) {
      case 'MM/DD/YYYY':
        return `${month}/${day}/${year}`
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`
      case 'DD.MM.YYYY':
        return `${day}.${month}.${year}`
      case 'YYYY/MM/DD':
        return `${year}/${month}/${day}`
      case 'DD/MM/YYYY':
      default:
        return `${day}/${month}/${year}`
    }
  } catch {
    return '-'
  }
}

/**
 * Format a date and time using tenant settings
 * @param date - Date string, Date object, or null/undefined
 * @param dateFormatStr - Format string from tenant settings
 * @param timeFormatStr - '12h' or '24h' (default: '12h')
 * @returns Formatted date-time string or '-' if invalid
 */
export function formatTenantDateTime(
  date: string | Date | null | undefined,
  dateFormatStr: string = 'DD/MM/YYYY',
  timeFormatStr: string = '12h'
): string {
  if (!date) return '-'

  const datePart = formatTenantDate(date, dateFormatStr)
  if (datePart === '-') return '-'

  try {
    const d = typeof date === 'string' ? new Date(date) : date
    const timePart = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: timeFormatStr === '12h',
    })
    return `${datePart} ${timePart}`
  } catch {
    return datePart
  }
}

/**
 * Format duration in minutes to human readable string
 * @param minutes - Duration in minutes
 * @returns Formatted duration (e.g., "1h 30m", "45m")
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '-'

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}
