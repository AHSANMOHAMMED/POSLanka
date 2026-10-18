'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { parseAuthEvent, hasSessionFlag, type AuthScope } from '@/lib/auth/events'

interface UseAuthSyncOptions {
  /**
   * Type of page this hook is used on
   * - 'auth': Login, register, home pages (redirect to /account on login)
   * - 'protected': Dashboard, account pages (redirect to /login on logout/expiry)
   */
  pageType: 'auth' | 'protected'

  /**
   * Auth scope to listen for
   */
  scope: AuthScope

  /**
   * Session endpoint URL for checking session validity
   */
  sessionUrl?: string

  /**
   * Whether the hook is enabled (default: true)
   */
  enabled?: boolean
}

/**
 * Hook for cross-tab authentication synchronization
 *
 * On auth pages: Detects login from another tab and redirects to /account
 * On protected pages: Detects logout/session expiry and redirects to /login
 */
export function useAuthSync(options: UseAuthSyncOptions): void {
  const { pageType, scope, sessionUrl = '/api/auth/session', enabled = true } = options
  const router = useRouter()
  const isCheckingRef = useRef(false)

  // Check session validity via API
  const checkSession = useCallback(async (): Promise<boolean> => {
    if (isCheckingRef.current) return false
    isCheckingRef.current = true

    try {
      const res = await fetch(sessionUrl, {
        method: 'GET',
        credentials: 'include',
      })

      if (!res.ok) return false

      const session = await res.json()
      return !!(session?.user)
    } catch {
      return false
    } finally {
      isCheckingRef.current = false
    }
  }, [sessionUrl])

  // Handle redirect based on page type and session status
  const handleAuthChange = useCallback(async (eventType?: 'login' | 'logout') => {
    if (pageType === 'auth') {
      // On auth pages, redirect to /account if logged in
      if (eventType === 'login' || hasSessionFlag(scope)) {
        const hasSession = await checkSession()
        if (hasSession) {
          router.push('/account')
        }
      }
    } else {
      // On protected pages, redirect to /login if logged out
      if (eventType === 'logout' || !hasSessionFlag(scope)) {
        const hasSession = await checkSession()
        if (!hasSession) {
          router.push('/login')
        }
      }
    }
  }, [pageType, scope, router, checkSession])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    // Handle storage events (cross-tab communication)
    const handleStorageEvent = (event: StorageEvent) => {
      const authEvent = parseAuthEvent(event, scope)
      if (!authEvent) return

      handleAuthChange(authEvent.type)
    }

    // Handle visibility change (tab becomes visible)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleAuthChange()
      }
    }

    // Handle window focus
    const handleFocus = () => {
      handleAuthChange()
    }

    // Add event listeners
    window.addEventListener('storage', handleStorageEvent)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    // Initial check for auth pages (in case user is already logged in)
    if (pageType === 'auth') {
      handleAuthChange()
    }

    return () => {
      window.removeEventListener('storage', handleStorageEvent)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [enabled, handleAuthChange, pageType, scope])
}

export default useAuthSync
