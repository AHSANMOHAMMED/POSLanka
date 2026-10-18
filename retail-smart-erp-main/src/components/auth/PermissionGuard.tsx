'use client'

import { useSession } from 'next-auth/react'
import { hasPermission, type Permission } from '@/lib/auth/roles'
import { ShieldX } from 'lucide-react'

interface PermissionGuardProps {
  permission: Permission
  children: React.ReactNode
  fallback?: React.ReactNode
}

const defaultFallback = (
  <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
    <ShieldX size={48} className="text-gray-400" />
    <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Access Denied</h2>
    <p className="text-gray-500 dark:text-gray-400 text-center max-w-md">
      You don&apos;t have permission to access this page. Contact your administrator if you believe this is an error.
    </p>
  </div>
)

/**
 * Wraps children with a permission check.
 * Shows "Access Denied" fallback when user lacks the required permission.
 */
export function PermissionGuard({ permission, children, fallback }: PermissionGuardProps) {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return null
  }

  const role = session?.user?.role
  if (!role || !hasPermission(role, permission)) {
    return <>{fallback || defaultFallback}</>
  }

  return <>{children}</>
}
