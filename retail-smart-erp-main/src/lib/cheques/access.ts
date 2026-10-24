import { hasPermission } from '@/lib/auth/roles'

interface SessionLike { user: { role: string; tenantId: string; customRoleId?: string | null } }

/** Full cheques register: accounts, sales or purchasing managers. Others see the cheques they recorded. */
export function canViewAllCheques(session: SessionLike): boolean {
  const { role, tenantId, customRoleId } = session.user
  return hasPermission(role, 'viewAccounting', tenantId, customRoleId)
    || hasPermission(role, 'manageSales', tenantId, customRoleId)
    || hasPermission(role, 'managePurchases', tenantId, customRoleId)
}
