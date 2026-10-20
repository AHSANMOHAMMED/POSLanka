// Mirrors the server-side defaults in src/lib/auth/roles.ts (ROLE_PERMISSIONS).
// Used only to hide UI the user cannot use; the server remains the authority.
import type { AuthUser } from './api'

export const ROLE_PERMISSIONS = {
  createSales: ['owner', 'manager', 'cashier', 'waiter', 'sales_manager', 'dealer_sales', 'pos_user'],
  managePOS: ['owner', 'manager', 'pos_user', 'cashier', 'sales_manager'],
  approveRequisitions: ['owner', 'manager', 'purchase_manager'],
  approveAdvances: ['owner', 'manager', 'hr_manager'],
  manageInventory: ['owner', 'manager', 'stock_manager'],
  viewReports: ['owner', 'manager', 'sales_manager', 'purchase_manager', 'hr_manager', 'stock_manager', 'report_user'],
  manageCustomers: ['owner', 'manager', 'waiter', 'sales_manager', 'dealer_sales'],
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
