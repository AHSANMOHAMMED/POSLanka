// Client-safe display config for stock intake batch statuses (web pages).
export const INTAKE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-700 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-700' },
  submitted: { label: 'Submitted', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  syncing: { label: 'Syncing', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  posted: { label: 'Posted', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  partially_posted: { label: 'Partially Posted', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700' },
}
