/**
 * Check if a menu item is currently available based on time windows.
 * Items with availableFrom/availableTo fields are only available during those hours.
 */
export function isItemAvailable(item: { availableFrom?: string | null; availableTo?: string | null }): boolean {
  if (!item.availableFrom && !item.availableTo) return true

  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  if (item.availableFrom) {
    const [h, m] = item.availableFrom.split(':').map(Number)
    const fromMinutes = h * 60 + m
    if (currentMinutes < fromMinutes) return false
  }

  if (item.availableTo) {
    const [h, m] = item.availableTo.split(':').map(Number)
    const toMinutes = h * 60 + m
    if (currentMinutes > toMinutes) return false
  }

  return true
}

/**
 * Format availability window for display.
 * Returns null if no availability window is set.
 */
export function formatAvailabilityWindow(item: { availableFrom?: string | null; availableTo?: string | null }): string | null {
  if (!item.availableFrom && !item.availableTo) return null

  const formatTime = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const hour12 = h % 12 || 12
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`
  }

  if (item.availableFrom && item.availableTo) {
    return `${formatTime(item.availableFrom)} - ${formatTime(item.availableTo)}`
  }
  if (item.availableFrom) {
    return `From ${formatTime(item.availableFrom)}`
  }
  if (item.availableTo) {
    return `Until ${formatTime(item.availableTo)}`
  }
  return null
}
