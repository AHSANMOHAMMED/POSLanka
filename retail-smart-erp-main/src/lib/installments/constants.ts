/** Client-safe labels / colours for hire purchase, deliveries and warranty claims (drizzle/0181). */

export const PLAN_STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  defaulted: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  repossessed: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
}

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  installed: 'Installed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export const DELIVERY_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  out_for_delivery: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  installed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
}

export const DELIVERY_TIME_SLOTS = ['8 AM – 12 PM', '12 PM – 4 PM', '4 PM – 8 PM', 'Any time']

export const WARRANTY_STATUS_LABELS: Record<string, string> = {
  received: 'Received',
  diagnosing: 'Diagnosing',
  sent_to_supplier: 'Sent to supplier',
  repairing: 'Repairing',
  ready: 'Ready for pickup',
  delivered: 'Delivered',
  rejected: 'Rejected',
}

export const WARRANTY_STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  diagnosing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  sent_to_supplier: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
  repairing: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  ready: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  delivered: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
}

export const WARRANTY_RESOLUTIONS: Array<[string, string]> = [
  ['repaired', 'Repaired'],
  ['replaced', 'Replaced (new unit)'],
  ['refunded', 'Refunded'],
  ['no_fault', 'No fault found'],
  ['rejected', 'Rejected (not covered)'],
]
