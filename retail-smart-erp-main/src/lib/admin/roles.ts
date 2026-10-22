/**
 * Platform-admin (super_admins.role) roles and what each may do in the console.
 * Pure module: imported by the server session layer and by client components (sidebar, buttons).
 *
 *   owner    everything, including managing other platform admins
 *   support  read everything; open vendors as owner (impersonate); messages, notifications/emails,
 *            error-log triage. No billing changes, no settings, no admin management.
 *   billing  read everything; subscriptions, payments (approve slips, refunds), plans/pricing,
 *            coupons and vendor plan changes / extensions
 *   viewer   read-only everywhere
 *
 * Every /api/sys-control handler names the permission it needs when it calls
 * validateAdminSession(...) (the argument is required, so a route cannot forget).
 */

export const ADMIN_ROLES = ['owner', 'support', 'billing', 'viewer'] as const
export type AdminRole = typeof ADMIN_ROLES[number]

export const ADMIN_PERMISSIONS = [
  /** any GET: dashboards, lists, details, exports */
  'read',
  /** own account: password, 2FA, sign-out, push device */
  'self',
  /** vendor lifecycle (create, suspend, archive, status, feature flags, owner password resets) */
  'vendors.manage',
  /** open a vendor as its owner */
  'vendors.impersonate',
  /** reply to / start vendor conversations */
  'messages',
  /** broadcast notifications and emails */
  'notifications',
  /** resolve / reopen error-log entries */
  'error_logs',
  /** subscriptions, payments, refunds, pricing tiers, coupons, plan changes / extensions */
  'billing',
  /** platform settings and maintenance (storage cleanup) */
  'settings',
  /** add / deactivate platform admins and change their roles */
  'admins',
] as const
export type AdminPermission = typeof ADMIN_PERMISSIONS[number]

const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  owner: new Set(ADMIN_PERMISSIONS),
  support: new Set<AdminPermission>(['read', 'self', 'vendors.impersonate', 'messages', 'notifications', 'error_logs']),
  billing: new Set<AdminPermission>(['read', 'self', 'billing']),
  viewer: new Set<AdminPermission>(['read', 'self']),
}

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  owner: 'Owner',
  support: 'Support',
  billing: 'Billing',
  viewer: 'Viewer',
}

export const ADMIN_ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  owner: 'Full access, including platform admins and settings.',
  support: 'Vendors (read), open as owner, messages, notifications and error log.',
  billing: 'Subscriptions, payments, refunds, pricing, coupons and plan changes.',
  viewer: 'Read-only access to every page.',
}

export function isAdminRole(v: unknown): v is AdminRole {
  return typeof v === 'string' && (ADMIN_ROLES as readonly string[]).includes(v)
}

/** Unknown / missing roles get the least privilege. */
export function normalizeAdminRole(v: unknown): AdminRole {
  return isAdminRole(v) ? v : 'viewer'
}

export function adminCan(role: AdminRole | string | null | undefined, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[normalizeAdminRole(role)].has(permission)
}

export function adminPermissionsOf(role: AdminRole | string | null | undefined): AdminPermission[] {
  return [...ROLE_PERMISSIONS[normalizeAdminRole(role)]]
}

/** Short reason shown when a role lacks a permission. */
export function adminDeniedMessage(role: AdminRole | string | null | undefined): string {
  const r = normalizeAdminRole(role)
  return `Your platform role (${ADMIN_ROLE_LABELS[r]}) does not allow this action.`
}
