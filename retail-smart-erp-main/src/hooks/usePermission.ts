'use client'

import { useSession } from 'next-auth/react'
import { hasPermission, ROLE_PERMISSIONS, type Permission } from '@/lib/auth/roles'
import { useEffectivePermissions } from './useEffectivePermissions'

/**
 * Hook to check if the current user has a specific permission.
 * Uses server-fetched effective permissions (includes tenant overrides).
 * Falls back to system defaults while loading.
 */
export function usePermission(permission: Permission): boolean {
  const { data: session } = useSession()
  const { permissions: effectivePerms } = useEffectivePermissions()
  const role = session?.user?.role
  if (!role) return false

  // Use server-resolved permissions if available
  if (effectivePerms) {
    return effectivePerms[permission] ?? false
  }

  // Fallback to system defaults while loading
  return hasPermission(role, permission)
}

/**
 * Hook to get the current user's role.
 */
export function useUserRole(): string | undefined {
  const { data: session } = useSession()
  return session?.user?.role
}

/**
 * Hook to get the current user's custom role name (if any).
 */
export function useCustomRoleName(): string | null {
  const { data: session } = useSession()
  return (session?.user as Record<string, unknown> | undefined)?.customRoleName as string | null ?? null
}

/**
 * Hook to get all effective permissions for the current user.
 * Useful for the role permissions settings page.
 */
export function useAllPermissions(): {
  permissions: Record<string, boolean> | null
  loading: boolean
  systemDefaults: typeof ROLE_PERMISSIONS
} {
  const { permissions, loading } = useEffectivePermissions()
  return { permissions, loading, systemDefaults: ROLE_PERMISSIONS }
}
