'use client'

import { useSession, signOut } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { useAuthSync } from '@/hooks'
import { broadcastAuthEvent, type AuthScope } from '@/lib/auth/events'

interface SessionValidatorProps {
  children: React.ReactNode
  /** Endpoint URL for session validation (default: /api/auth/validate) */
  validateUrl?: string
  /** Auth scope for cross-tab sync (default: 'company') */
  scope?: AuthScope
  /** Tenant slug for company-scoped logout redirect */
  tenantSlug?: string
}

/**
 * Client-side session validator that redirects to login if session is invalid.
 * Makes an API call (in the background) to verify the session is still valid in the database.
 * Also handles cross-tab logout detection via useAuthSync.
 */
export function SessionValidator({
  children,
  validateUrl = '/api/auth/validate',
  scope = 'company',
  tenantSlug,
}: SessionValidatorProps) {
  const { data: session, status } = useSession()
  const [isValid, setIsValid] = useState(true)
  const userId = session?.user?.id

  // Cross-tab auth sync - redirect to /login if logged out from another tab
  useAuthSync({
    pageType: 'protected',
    scope,
    sessionUrl: scope === 'account' ? '/api/account-auth/session' : '/api/auth/session',
  })

  useEffect(() => {
    async function validateSession() {
      if (status === 'loading') return

      if (status === 'unauthenticated') return

      // Determine the correct login URL based on scope
      const loginUrl = scope === 'company' && tenantSlug
        ? `/c/${tenantSlug}/login`
        : '/login'

      // If session loaded but user ID is empty, the session is invalid
      if (status === 'authenticated' && session?.user && !userId) {
        setIsValid(false)
        broadcastAuthEvent('logout', scope)
        signOut({ callbackUrl: loginUrl, redirect: true })
        return
      }

      // Make API call to verify session is valid in database
      try {
        const res = await fetch(validateUrl, {
          method: 'GET',
          credentials: 'include',
        })

        if (res.status === 401) {
          // Session is invalid - sign out
          setIsValid(false)
          broadcastAuthEvent('logout', scope)
          signOut({ callbackUrl: loginUrl, redirect: true })
          return
        }

        setIsValid(true)
      } catch {
        // Network error - assume valid for now
        setIsValid(true)
      }
    }

    validateSession()
    // Keyed on the user id, not the session object: next-auth hands out a new object on every
    // session refresh / tab focus, which re-ran this check (and its request) each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, status, validateUrl, scope, tenantSlug])

  // The server layout already authenticated this request, so render immediately (server HTML
  // included) and only blank the page once the background check finds the session invalid.
  // Rendering nothing until the check returned left every page empty for a round trip.
  if (!isValid) {
    return null
  }

  return <>{children}</>
}
