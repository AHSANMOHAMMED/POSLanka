/**
 * Vendor alert catalogue (client-safe: no server imports).
 * Shared by notify(), the preferences API and the web / mobile settings screens.
 */

export const ALERT_TYPES = [
  'low_stock',
  'out_of_stock',
  'expiring_stock',
  'stock_digest',
  'large_refund',
  'sale_void',
  'manual_return',
  'shift_variance',
  'offline_sale_rejected',
  'offline_price_difference',
  'intake_sync_errors',
  'intake_awaiting_approval',
  'requisition_submitted',
  'advance_requested',
  'subscription_expiring',
  'import_finished',
] as const

export type AlertType = typeof ALERT_TYPES[number]

export function isAlertType(v: unknown): v is AlertType {
  return typeof v === 'string' && (ALERT_TYPES as readonly string[]).includes(v)
}

export type AlertGroup = 'Stock' | 'Sales' | 'Approvals' | 'System'

export const ALERT_TYPE_INFO: Record<AlertType, { label: string; description: string; group: AlertGroup }> = {
  low_stock: { label: 'Low stock', description: 'An item drops to or below its minimum stock', group: 'Stock' },
  out_of_stock: { label: 'Out of stock', description: 'An item runs out in a branch', group: 'Stock' },
  expiring_stock: { label: 'Expiring stock', description: 'Items or batches close to their expiry date (daily)', group: 'Stock' },
  stock_digest: { label: 'Daily stock digest', description: 'Morning summary of items below minimum', group: 'Stock' },
  large_refund: { label: 'Large refund', description: 'A refund above the configured amount', group: 'Sales' },
  sale_void: { label: 'Sale voided', description: 'A completed sale is voided', group: 'Sales' },
  manual_return: { label: 'Return without receipt', description: 'A return processed without the original invoice', group: 'Sales' },
  shift_variance: { label: 'Shift cash variance', description: 'A shift closes with a cash shortage or excess', group: 'Sales' },
  offline_sale_rejected: { label: 'Offline sale rejected', description: 'An offline sale could not be synced', group: 'Sales' },
  offline_price_difference: { label: 'Offline price difference', description: 'An offline sale used an outdated price', group: 'Sales' },
  intake_sync_errors: { label: 'Stock intake errors', description: 'A stock intake sync finished with errors', group: 'Stock' },
  intake_awaiting_approval: { label: 'Stock intake to post', description: 'A stock intake batch was submitted for posting', group: 'Approvals' },
  requisition_submitted: { label: 'Purchase requisition', description: 'A requisition awaits approval', group: 'Approvals' },
  advance_requested: { label: 'Salary advance request', description: 'An employee advance awaits approval', group: 'Approvals' },
  subscription_expiring: { label: 'Subscription reminder', description: 'Your plan or trial ends soon', group: 'System' },
  import_finished: { label: 'Import finished', description: 'A bulk import you started has finished', group: 'System' },
}

/**
 * De-dupe window per type in seconds (used only when the caller passes a dedupeKey).
 * 0 = no de-duplication.
 */
export const DEDUPE_WINDOW_SECONDS: Record<AlertType, number> = {
  low_stock: 24 * 3600,
  out_of_stock: 12 * 3600,
  expiring_stock: 24 * 3600,
  stock_digest: 20 * 3600,
  large_refund: 0,
  sale_void: 0,
  manual_return: 0,
  shift_variance: 0,
  offline_sale_rejected: 0,
  offline_price_difference: 0,
  intake_sync_errors: 0,
  intake_awaiting_approval: 3600,
  requisition_submitted: 0,
  advance_requested: 0,
  subscription_expiring: 3 * 24 * 3600,
  import_finished: 0,
}

/** Types that ignore quiet hours for push (kept empty on purpose: everything respects quiet hours). */
export const CRITICAL_ALERT_TYPES: readonly AlertType[] = []

export interface TenantAlertSettings {
  /** Used when a branch has no minimum stock configured for an item (0 / unset = off). */
  defaultMinStock: number | null
  expiryWarningDays: number
  /** Refunds at or above this amount alert managers (null = off). */
  largeRefundAmount: number | null
  /** Shift closings with |variance| at or above this amount alert managers. */
  varianceThreshold: number
  digestEnabled: boolean
}

export const DEFAULT_ALERT_SETTINGS: TenantAlertSettings = {
  defaultMinStock: null,
  expiryWarningDays: 7,
  largeRefundAmount: null,
  varianceThreshold: 1,
  digestEnabled: true,
}

export interface AlertPreferences {
  enabledTypes: AlertType[] | null
  mutedTypes: AlertType[]
  /** 'HH:MM' local time or null */
  quietStart: string | null
  quietEnd: string | null
  timezone: string | null
  /** 0-23, null = no daily digest */
  digestHour: number | null
  pushEnabled: boolean
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  enabledTypes: null,
  mutedTypes: [],
  quietStart: null,
  quietEnd: null,
  timezone: null,
  digestHour: 8,
  pushEnabled: true,
}
