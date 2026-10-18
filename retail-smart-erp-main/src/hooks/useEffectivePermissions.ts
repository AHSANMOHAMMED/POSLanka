'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks'
import type { Permission } from '@/lib/auth/roles'

/**
 * Fetches and caches the current user's effective permissions from the server.
 * Refreshes when role-permissions change via WebSocket.
 */
export function useEffectivePermissions() {
  const { data: session } = useSession()
  const [permissions, setPermissions] = useState<Record<string, boolean> | null>(null)
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef(false)

  const fetchPermissions = useCallback(async () => {
    if (!session?.user?.tenantId) return
    try {
      const res = await fetch('/api/role-permissions/effective')
      if (res.ok) {
        const data = await res.json()
        setPermissions(data.permissions)
      }
    } catch {
      // Keep existing permissions on error
    } finally {
      setLoading(false)
    }
  }, [session?.user?.tenantId])

  // Initial fetch
  useEffect(() => {
    if (session?.user?.tenantId && !fetchedRef.current) {
      fetchedRef.current = true
      fetchPermissions()
    }
  }, [session?.user?.tenantId, fetchPermissions])

  // Real-time updates when role permissions change
  useRealtimeData(fetchPermissions, { entityType: 'settings' })

  const hasPermission = useCallback((permission: Permission): boolean => {
    if (!permissions) return false
    return permissions[permission] ?? false
  }, [permissions])

  return { permissions, loading, hasPermission, refresh: fetchPermissions }
}
