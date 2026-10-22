'use client'

import { createContext, useContext } from 'react'
import { adminCan, ADMIN_ROLE_LABELS, type AdminPermission, type AdminRole } from '@/lib/admin/roles'

/**
 * Platform role of the signed-in admin, provided by the console layout. Used only to hide or
 * disable controls: every /api/sys-control route enforces the same permission server-side.
 */
const AdminRoleContext = createContext<AdminRole>('viewer')

export function AdminRoleProvider({ role, children }: { role: AdminRole; children: React.ReactNode }) {
  return <AdminRoleContext.Provider value={role}>{children}</AdminRoleContext.Provider>
}

export function useAdminRole(): AdminRole {
  return useContext(AdminRoleContext)
}

/** true when the signed-in admin's role grants `permission`. */
export function useAdminCan(permission: AdminPermission): boolean {
  return adminCan(useContext(AdminRoleContext), permission)
}

/** Tooltip text for a control the role cannot use. */
export function useDeniedTitle(permission: AdminPermission): string | undefined {
  const role = useContext(AdminRoleContext)
  return adminCan(role, permission) ? undefined : `Not available to the ${ADMIN_ROLE_LABELS[role]} role`
}
