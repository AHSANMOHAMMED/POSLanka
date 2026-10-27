/** Shared class names / tiny helpers for the recurring invoice, payments received and project pages */
export const input = 'w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500'
export const label = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1'
export const card = 'bg-white dark:bg-gray-800 rounded border dark:border-gray-700'
export const btnPrimary = 'inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50'
export const btnSecondary = 'inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 text-sm rounded text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50'
export const th = 'px-3 py-2 font-medium text-left'
export const chip = (active: boolean) => `px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${active
  ? 'bg-blue-600 border-blue-600 text-white'
  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-500'}`

export const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  stopped: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  on_hold: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  cancelled: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  generated: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  draft: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  skipped: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

export const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export async function readJson(res: Response): Promise<Record<string, unknown> & { error?: string }> {
  try { return await res.json() } catch { return {} }
}

/** Today as YYYY-MM-DD in Sri Lanka time */
export function colomboToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export const METHOD_LABELS: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', credit: 'Store credit', gift_card: 'Gift card' }
