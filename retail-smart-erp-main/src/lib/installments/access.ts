/**
 * Who may use hire purchase, deliveries and warranty claims (drizzle/0181). Server-only.
 * Counter staff (createSales) take plans and payments; managers (manageSales) change a plan's
 * status; drivers / technicians work on deliveries and claims.
 */
import { NextResponse } from 'next/server'
import type { Permission } from '@/lib/auth/roles'
import { hasAnyPermission } from '@/lib/auth/field-access'

type PermSession = Parameters<typeof hasAnyPermission>[0]

export const INSTALLMENT_VIEW: readonly Permission[] = ['createSales', 'manageSales', 'viewReports', 'viewAccounting']
export const INSTALLMENT_TAKE: readonly Permission[] = ['createSales', 'manageSales']
export const INSTALLMENT_MANAGE: readonly Permission[] = ['manageSales']
/** void a receipt / mark its cheque bounced (sales managers, accounts — as the cheques register) */
export const INSTALLMENT_REVERSE: readonly Permission[] = ['manageSales', 'manageAccounting']
export const DELIVERY_VIEW: readonly Permission[] = ['createSales', 'manageSales', 'manageWorkOrders', 'manageInventory', 'viewReports']
export const DELIVERY_EDIT: readonly Permission[] = ['createSales', 'manageSales', 'manageWorkOrders', 'manageInventory']
export const WARRANTY_VIEW: readonly Permission[] = ['createSales', 'manageSales', 'manageWorkOrders', 'viewReports']
export const WARRANTY_EDIT: readonly Permission[] = ['createSales', 'manageSales', 'manageWorkOrders']

/** 403 unless the user holds one of the permissions */
export function requireAny(session: PermSession, permissions: readonly Permission[]): NextResponse | null {
  return hasAnyPermission(session, permissions)
    ? null
    : NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
}
