// Mirrors the server-side defaults in src/lib/auth/roles.ts (ROLE_PERMISSIONS).
// Used only to hide UI the user cannot use; the server remains the authority.
import type { AuthUser } from './api'

export const ROLE_PERMISSIONS = {
  createSales: ['owner', 'manager', 'cashier', 'waiter', 'sales_manager', 'dealer_sales', 'pos_user'],
  managePOS: ['owner', 'manager', 'pos_user', 'cashier', 'sales_manager'],
  approveRequisitions: ['owner', 'manager', 'purchase_manager'],
  approveAdvances: ['owner', 'manager', 'hr_manager'],
  manageInventory: ['owner', 'manager', 'stock_manager'],
  submitStockIntake: ['owner', 'manager', 'stock_manager', 'cashier', 'pos_user'],
  postStockIntake: ['owner', 'manager', 'stock_manager'],
  viewReports: ['owner', 'manager', 'sales_manager', 'purchase_manager', 'hr_manager', 'stock_manager', 'report_user'],
  manageCustomers: ['owner', 'manager', 'waiter', 'sales_manager', 'dealer_sales'],
  manageUsers: ['owner', 'manager', 'system_manager'],
} as const

export type Permission = keyof typeof ROLE_PERMISSIONS

export function hasPermission(user: AuthUser | null | undefined, permission: Permission): boolean {
  if (!user?.role) return false
  if (user.role === 'owner') return true
  return (ROLE_PERMISSIONS[permission] as readonly string[]).includes(user.role)
}

export function roleLabel(role: string | undefined | null): string {
  if (!role) return ''
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// Mirrors ROLE_HIERARCHY / canModifyUser in src/lib/auth/roles.ts (higher = more privileged).
export const ROLE_HIERARCHY: Record<string, number> = {
  owner: 100,
  manager: 80,
  system_manager: 70,
  accounts_manager: 60,
  sales_manager: 60,
  purchase_manager: 60,
  hr_manager: 60,
  stock_manager: 60,
  cashier: 40,
  technician: 40,
  chef: 40,
  waiter: 40,
  dealer_sales: 40,
  pos_user: 30,
  report_user: 30,
}

export function canModifyUser(actorRole: string, targetCurrentRole: string, targetNewRole?: string): boolean {
  if (actorRole === 'owner') return true
  if (targetCurrentRole === 'owner') return false
  const actor = ROLE_HIERARCHY[actorRole] || 0
  if ((ROLE_HIERARCHY[targetCurrentRole] || 0) > actor) return false
  if (targetNewRole) {
    if (targetNewRole === 'owner') return false
    if ((ROLE_HIERARCHY[targetNewRole] || 0) > actor) return false
  }
  return true
}

const BUSINESS_TYPE_ROLES: Record<string, string[]> = {
  restaurant: ['chef', 'waiter'],
  auto_service: ['technician'],
  dealership: ['technician', 'dealer_sales'],
}

/** Roles the actor may assign to new staff (business-type aware, never owner), highest first. */
export function assignableRoles(actorRole: string, businessType?: string | null): string[] {
  const specific = new Set(Object.values(BUSINESS_TYPE_ROLES).flat())
  const allowed = new Set(BUSINESS_TYPE_ROLES[businessType || ''] || [])
  return Object.keys(ROLE_HIERARCHY)
    .filter((r) => r !== 'owner')
    .filter((r) => !specific.has(r) || allowed.has(r))
    .filter((r) => canModifyUser(actorRole, r, r))
    .sort((a, b) => ROLE_HIERARCHY[b] - ROLE_HIERARCHY[a])
}
