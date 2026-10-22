/**
 * H4: read-side permission helpers for list / detail GET handlers.
 *
 * Cashiers legitimately look up items and customers at the POS, so those lists stay readable;
 * what is gated is data a POS role should not see (cost prices, other staff's documents, full
 * gift-card registers). Everything goes through hasPermission(), so tenant role overrides and
 * custom roles apply.
 */
import { hasPermission, type Permission } from './roles'

type PermSession = { user: { role: string; tenantId?: string; customRoleId?: string | null } }

export function hasAnyPermission(session: PermSession, permissions: readonly Permission[]): boolean {
  const { role, tenantId, customRoleId } = session.user
  return permissions.some((p) => hasPermission(role, p, tenantId, customRoleId))
}

/** Who may see purchase cost / valuation of items. */
export const COST_VIEW_PERMISSIONS: readonly Permission[] = [
  'manageItems', 'manageInventory', 'managePurchases', 'viewReports', 'viewAccounting',
]

export function canViewCostPrices(session: PermSession): boolean {
  return hasAnyPermission(session, COST_VIEW_PERMISSIONS)
}

/** Remove cost fields from an item (and its nested supplier price info) for POS-only roles. */
export function redactItemCost<T extends Record<string, unknown>>(item: T): T {
  const out: Record<string, unknown> = { ...item }
  if ('costPrice' in out) out.costPrice = null
  if ('valuationRate' in out) out.valuationRate = null
  if ('lastPurchasePrice' in out) out.lastPurchasePrice = null
  return out as T
}

/**
 * Customer lookup: POS sellers, customer managers, service / restaurant staff who attach a
 * customer to a job, and reporting / accounting roles. Excludes e.g. hr_manager, stock_manager,
 * purchase_manager and system_manager unless granted one of these.
 */
export const CUSTOMER_LOOKUP_PERMISSIONS: readonly Permission[] = [
  'createSales', 'manageCustomers', 'manageSales', 'manageCustomerCredit', 'manageWorkOrders',
  'manageAppointments', 'manageRestaurantOrders', 'manageDealers', 'viewReports', 'viewAccounting',
]

/** Layaways are taken and paid at the POS. */
export const LAYAWAY_VIEW_PERMISSIONS: readonly Permission[] = ['createSales', 'manageSales', 'viewReports', 'viewAccounting']

/** The full gift-card register (POS uses /api/gift-cards/lookup by card number instead). */
export const GIFT_CARD_LIST_PERMISSIONS: readonly Permission[] = ['manageSales', 'viewReports', 'viewAccounting']
