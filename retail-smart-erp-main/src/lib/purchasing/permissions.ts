import type { NextResponse } from 'next/server'
import { requirePermission, type Permission } from '@/lib/auth/roles'

/**
 * H3 — read access to purchasing documents. There is no dedicated "view purchases" permission:
 * purchase staff, stock staff (receiving / reorder) and accountants (payables) may read them,
 * POS-only roles (cashier, waiter, pos_user, ...) may not.
 */
export const PURCHASING_VIEW_PERMISSIONS: Permission[] = ['managePurchases', 'manageInventory', 'viewAccounting']

/** Suppliers are also picked on item forms. */
export const SUPPLIER_VIEW_PERMISSIONS: Permission[] = [...PURCHASING_VIEW_PERMISSIONS, 'manageItems']

type SessionArg = Parameters<typeof requirePermission>[0]

/** null when the session has at least one of the permissions, else the first denial (401/403). */
export function requireAnyPermission(session: SessionArg, permissions: Permission[]): NextResponse | null {
  let denied: NextResponse | null = null
  for (const p of permissions) {
    const err = requirePermission(session, p)
    if (!err) return null
    denied ||= err
  }
  return denied
}
