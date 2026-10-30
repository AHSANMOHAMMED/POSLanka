// Catalogue of every feature the vendor app can open (bottom tabs, More grid, Items / Reports hubs).
// Visibility mirrors the permissions the server routes enforce and the web sidebar's business-type
// rules (src/lib/navigation/module-sidebar.ts); the server still refuses anything not allowed.
import { Linking } from 'react-native'
import { getApiBase, type AuthUser } from './api'
import { hasPermission, isBackOffice, ROLE_PERMISSIONS, type Permission } from './roles'
import type { IconName, Tone } from '../components/ui'

/** Permission check that also accepts keys the mobile role table does not list (effective permissions only). */
export function can(user: AuthUser | null | undefined, key: string): boolean {
  if (key in ROLE_PERMISSIONS) return hasPermission(user, key as Permission)
  if (!user?.role) return false
  const eff = user.permissions
  if (eff && typeof eff === 'object' && Object.keys(eff).length > 0) return eff[key] === true
  return user.role === 'owner' || user.role === 'manager'
}

export function canAny(user: AuthUser | null | undefined, keys: readonly string[]): boolean {
  return keys.length === 0 || keys.some((k) => can(user, k))
}

export interface AppFeature {
  key: string
  title: string
  subtitle: string
  icon: IconName
  tone: Tone
  /** Any of these permissions shows the feature; empty = every signed-in user. */
  anyOf: readonly string[]
  /** Native screen. */
  route?: string
  /** Web page under /c/<slug> opened in the browser when there is no native screen. */
  webPath?: string
  /** Only for these business types (web sidebar rule). */
  businessTypes?: readonly string[]
  /** Business feature switch (GET /api/features) that must not be off. */
  flag?: string
  group: 'sell' | 'stock' | 'reports' | 'manage' | 'modules' | 'device'
  /** 'only' = owner / manager accounts only, 'never' = counter staff only (see isBackOffice) */
  backOffice?: 'only' | 'never'
}

export const FEATURES: AppFeature[] = [
  // Selling
  { key: 'till', title: 'Sell at the till', subtitle: 'Cashier screen (needs a shift)', icon: 'cart-outline', tone: 'primary', anyOf: ['createSales'], route: '/pos', group: 'sell', backOffice: 'only' },
  { key: 'shifts', title: 'Shift', subtitle: 'Open / close, cash in & out', icon: 'time-outline', tone: 'primary', anyOf: ['createSales'], route: '/shifts', group: 'sell', backOffice: 'never' },
  { key: 'sales', title: 'Sales history', subtitle: 'Receipts & invoices', icon: 'receipt-outline', tone: 'primary', anyOf: ['createSales', 'manageSales', 'viewReports'], route: '/sales', group: 'sell' },
  { key: 'customers', title: 'Customers', subtitle: 'Balances & contacts', icon: 'people-circle-outline', tone: 'primary', anyOf: ['manageCustomers', 'createSales'], route: '/module/customers', group: 'sell' },
  { key: 'money', title: 'Money out', subtitle: 'Expenses & cheques', icon: 'cash-outline', tone: 'warn', anyOf: ['createSales'], route: '/money', group: 'sell' },

  // Stock
  { key: 'item-new', title: 'Add product', subtitle: 'Name only, rest optional', icon: 'add-circle-outline', tone: 'ok', anyOf: ['manageItems'], route: '/item-new', group: 'stock' },
  { key: 'inventory', title: 'Stock ledger', subtitle: 'Stock movements', icon: 'cube-outline', tone: 'primary', anyOf: ['manageInventory'], route: '/inventory', group: 'stock' },
  { key: 'intake', title: 'Stock intake', subtitle: 'Scan goods received', icon: 'download-outline', tone: 'ok', anyOf: ['submitStockIntake'], route: '/intake', group: 'stock' },
  { key: 'labels', title: 'Labels', subtitle: 'Print barcode labels', icon: 'pricetags-outline', tone: 'warn', anyOf: ['manageItems', 'manageInventory', 'submitStockIntake', 'createSales'], route: '/labels', group: 'stock' },

  // Reports
  { key: 'summary', title: 'Today’s summary', subtitle: 'Store & shift figures', icon: 'stats-chart-outline', tone: 'primary', anyOf: ['viewReports', 'managePOS', 'createSales'], route: '/summary', group: 'reports' },
  { key: 'web-reports', title: 'All reports', subtitle: 'Full reports on the web', icon: 'document-text-outline', tone: 'muted', anyOf: ['viewReports'], webPath: '/reports', group: 'reports' },
  { key: 'web-dashboard', title: 'Web dashboard', subtitle: 'Open the full dashboard', icon: 'desktop-outline', tone: 'muted', anyOf: [], webPath: '/dashboard', group: 'reports' },

  // Management
  { key: 'approvals', title: 'Approvals', subtitle: 'Requisitions & advances', icon: 'checkmark-done-outline', tone: 'ok', anyOf: ['approveRequisitions', 'approveAdvances'], route: '/approvals', group: 'manage' },
  { key: 'staff', title: 'Staff', subtitle: 'Accounts, PINs, roles', icon: 'people-outline', tone: 'primary', anyOf: ['manageUsers'], route: '/staff', group: 'manage' },
  { key: 'attendance', title: 'Attendance', subtitle: 'Fingerprint & shifts', icon: 'finger-print-outline', tone: 'primary', anyOf: ['manageEmployees'], webPath: '/hr/attendance', group: 'manage' },

  // Business modules (read-only lists, details on the web)
  { key: 'quotations', title: 'Quotations', subtitle: 'Quotes to customers', icon: 'document-outline', tone: 'primary', anyOf: ['createSales'], route: '/module/quotations', flag: 'quotation', group: 'modules' },
  { key: 'installments', title: 'Hire purchase', subtitle: 'Installment plans', icon: 'wallet-outline', tone: 'warn', anyOf: ['createSales', 'manageSales', 'viewReports', 'viewAccounting'], route: '/module/installments', businessTypes: ['electronics', 'hardware', 'retail'], group: 'modules' },
  { key: 'deliveries', title: 'Deliveries', subtitle: 'Delivery & installation', icon: 'car-outline', tone: 'primary', anyOf: ['createSales', 'manageSales', 'manageWorkOrders', 'manageInventory', 'viewReports'], route: '/module/deliveries', businessTypes: ['electronics', 'hardware', 'retail', 'supermarket'], group: 'modules' },
  { key: 'warranty-claims', title: 'Warranty claims', subtitle: 'Repairs & replacements', icon: 'shield-checkmark-outline', tone: 'ok', anyOf: ['createSales', 'manageSales', 'manageWorkOrders', 'viewReports'], route: '/module/warranty-claims', businessTypes: ['electronics', 'retail', 'hardware'], group: 'modules' },
  { key: 'print-jobs', title: 'Print jobs', subtitle: 'Studio job tickets', icon: 'print-outline', tone: 'primary', anyOf: ['createSales'], route: '/module/print-jobs', businessTypes: ['print_studio'], group: 'modules' },
  { key: 'recurring-invoices', title: 'Recurring invoices', subtitle: 'Scheduled billing', icon: 'repeat-outline', tone: 'primary', anyOf: ['createSales'], route: '/module/recurring-invoices', group: 'modules' },
  { key: 'payments-received', title: 'Payments received', subtitle: 'Customer receipts', icon: 'card-outline', tone: 'ok', anyOf: ['createSales'], route: '/module/payments-received', group: 'modules' },
  { key: 'projects', title: 'Projects', subtitle: 'Projects & timesheets', icon: 'briefcase-outline', tone: 'primary', anyOf: ['createSales', 'manageSales', 'viewReports'], route: '/module/projects', group: 'modules' },

  // Device
  { key: 'printer', title: 'Printers', subtitle: 'Receipt, label, kitchen', icon: 'print-outline', tone: 'muted', anyOf: [], route: '/printer', group: 'device' },
  { key: 'alerts', title: 'Alerts', subtitle: 'Notifications & settings', icon: 'notifications-outline', tone: 'warn', anyOf: [], route: '/alerts', group: 'device' },
]

export function featureVisible(f: AppFeature, user: AuthUser | null | undefined, hasFlag: (flag: string) => boolean): boolean {
  if (!user) return false
  if (!canAny(user, f.anyOf)) return false
  if (f.businessTypes && !f.businessTypes.includes(user.businessType || 'retail')) return false
  if (f.flag && !hasFlag(f.flag)) return false
  if (f.backOffice === 'only' && !isBackOffice(user)) return false
  if (f.backOffice === 'never' && isBackOffice(user)) return false
  return true
}

export function visibleFeatures(user: AuthUser | null | undefined, hasFlag: (flag: string) => boolean, groups?: AppFeature['group'][]): AppFeature[] {
  return FEATURES.filter((f) => (!groups || groups.includes(f.group)) && featureVisible(f, user, hasFlag))
}

export function featureByKey(key: string): AppFeature | undefined {
  return FEATURES.find((f) => f.key === key)
}

/** Web page of this business (e.g. https://server/c/alisha-shop/quotations). */
export function webUrl(user: AuthUser | null | undefined, path: string): string {
  const slug = user?.tenantSlug ? `/c/${encodeURIComponent(user.tenantSlug)}` : ''
  return `${getApiBase()}${slug}${path.startsWith('/') ? path : `/${path}`}`
}

export function openWeb(user: AuthUser | null | undefined, path: string): void {
  Linking.openURL(webUrl(user, path)).catch(() => undefined)
}

// ----------------------------------------------------------------------------------------------
// Read-only module lists (app/module/[key].tsx): endpoint + how to read a row. Field names follow
// the GET handlers under src/app/api/<module>/route.ts; unknown shapes fall back to common names.
// ----------------------------------------------------------------------------------------------
export interface ModuleListConfig {
  title: string
  endpoint: string
  /** Keys of the list in the JSON body (else data / items / bare array). */
  listKeys: string[]
  webPath: string
  /** Server-side search parameter supported. */
  search?: boolean
  paged?: boolean
  /** The web app has no /<module>/<id> page: rows open the list page. */
  noDetailPage?: boolean
  icon: IconName
}

export const MODULE_LISTS: Record<string, ModuleListConfig> = {
  quotations: { title: 'Quotations', endpoint: '/api/quotations', listKeys: ['quotations'], webPath: '/quotations', icon: 'document-outline' },
  installments: { title: 'Hire purchase', endpoint: '/api/installments', listKeys: ['data'], webPath: '/installments', search: true, paged: true, icon: 'wallet-outline' },
  deliveries: { title: 'Deliveries', endpoint: '/api/deliveries', listKeys: ['data'], webPath: '/deliveries', search: true, paged: true, noDetailPage: true, icon: 'car-outline' },
  'warranty-claims': { title: 'Warranty claims', endpoint: '/api/warranty-claims', listKeys: ['data'], webPath: '/warranty-claims', search: true, paged: true, icon: 'shield-checkmark-outline' },
  'print-jobs': { title: 'Print jobs', endpoint: '/api/print-jobs', listKeys: ['data'], webPath: '/print-jobs', search: true, paged: true, icon: 'print-outline' },
  'recurring-invoices': { title: 'Recurring invoices', endpoint: '/api/recurring-invoices', listKeys: ['data'], webPath: '/recurring-invoices', search: true, paged: true, icon: 'repeat-outline' },
  'payments-received': { title: 'Payments received', endpoint: '/api/payments-received', listKeys: ['data'], webPath: '/payments-received', search: true, paged: true, icon: 'card-outline' },
  projects: { title: 'Projects', endpoint: '/api/projects', listKeys: ['data'], webPath: '/projects', search: true, paged: true, icon: 'briefcase-outline' },
  customers: { title: 'Customers', endpoint: '/api/customers', listKeys: ['data', 'customers'], webPath: '/customers', search: true, paged: true, icon: 'people-circle-outline' },
}

const NUMBER_KEYS = ['quotationNo', 'planNo', 'deliveryNo', 'claimNo', 'jobNo', 'invoiceNo', 'projectNo', 'receiptNo', 'paymentNo', 'entryNumber', 'number', 'code']
const NAME_KEYS = ['customerName', 'name', 'profileName', 'title', 'fullName', 'recipientName', 'itemName']
const AMOUNT_KEYS = ['total', 'grandTotal', 'amount', 'financedAmount', 'budgetAmount', 'fixedAmount', 'balance']
const DATE_KEYS = ['scheduledDate', 'nextDueDate', 'nextRunDate', 'date', 'paymentDate', 'expectedDate', 'startDate', 'createdAt']

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && v.trim()) return v
    if (typeof v === 'number') return String(v)
  }
  return null
}

export interface ModuleRowView {
  id: string
  title: string
  subtitle: string
  amount: number | null
  status: string | null
}

/** Best-effort title / subtitle / amount / status for any module row. */
export function moduleRowView(raw: unknown, index: number): ModuleRowView {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const customer = row.customer && typeof row.customer === 'object' ? (row.customer as Record<string, unknown>) : null
  const number = firstString(row, NUMBER_KEYS)
  const name = firstString(row, NAME_KEYS) || (customer ? firstString(customer, ['name']) : null)
  const title = number && name ? `${number} · ${name}` : number || name || `#${index + 1}`
  let amount: number | null = null
  for (const k of AMOUNT_KEYS) {
    const v = row[k]
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
      amount = Number(v)
      break
    }
  }
  const dateRaw = firstString(row, DATE_KEYS)
  const date = dateRaw ? formatShortDate(dateRaw) : null
  const extra = firstString(row, ['phone', 'email', 'warehouseName', 'assignedName', 'driverName', 'technicianName', 'method', 'paymentMethod'])
  const status = typeof row.status === 'string' ? row.status : null
  return {
    id: String(row.id ?? index),
    title,
    subtitle: [date, extra].filter(Boolean).join(' · '),
    amount,
    status,
  }
}

export function formatShortDate(value: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function statusTone(status: string | null | undefined): Tone {
  const s = (status || '').toLowerCase()
  if (['completed', 'paid', 'active', 'delivered', 'approved', 'accepted', 'closed', 'resolved', 'done'].includes(s)) return 'ok'
  if (['void', 'cancelled', 'rejected', 'overdue', 'defaulted', 'failed', 'expired', 'bounced'].includes(s)) return 'error'
  if (['pending', 'draft', 'partial', 'scheduled', 'sent', 'in_progress', 'open', 'paused'].includes(s)) return 'warn'
  return 'muted'
}

export function humanize(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
