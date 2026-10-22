'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks'
import type { Permission } from '@/lib/auth/roles'
import { sharedJson } from '@/lib/client/shared-fetch'

/**
 * Fetches and caches the current user's effective permissions from the server.
 * Refreshes when role-permissions change via WebSocket.
 */
export function useEffectivePermissions() {
  const { data: session } = useSession()
  const [permissions, setPermissions] = useState<Record<string, boolean> | null>(null)
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef(false)

  // Several components (guards, navbar, sidebar, tabs) use this hook on every page: they share
  // one request; a refresh (realtime role change, explicit refresh) bypasses the 30 s reuse.
  const loadPermissions = useCallback(async (force: boolean) => {
    if (!session?.user?.tenantId) return
    try {
      const data = await sharedJson<{ permissions: Record<string, boolean> }>('/api/role-permissions/effective', { maxAgeMs: 30_000, force })
      setPermissions(data.permissions)
    } catch {
      // Keep existing permissions on error
    } finally {
      setLoading(false)
    }
  }, [session?.user?.tenantId])
  const fetchPermissions = useCallback(() => loadPermissions(true), [loadPermissions])

  // Initial fetch
  useEffect(() => {
    if (session?.user?.tenantId && !fetchedRef.current) {
      fetchedRef.current = true
      loadPermissions(false)
    }
  }, [session?.user?.tenantId, loadPermissions])

  // Real-time updates when role permissions change (the initial load happens above)
  useRealtimeData(fetchPermissions, { entityType: 'settings', refreshOnMount: false })

  const hasPermission = useCallback((permission: Permission): boolean => {
    if (!permissions) return false
    return permissions[permission] ?? false
  }, [permissions])

  return { permissions, loading, hasPermission, refresh: fetchPermissions }
}
