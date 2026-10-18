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
 * Makes an API call to verify the session is still valid in the database.
 * Also handles cross-tab logout detection via useAuthSync.
 */
export function SessionValidator({
  children,
  validateUrl = '/api/auth/validate',
  scope = 'company',
  tenantSlug,
}: SessionValidatorProps) {
  const { data: session, status } = useSession()
  const [isValidating, setIsValidating] = useState(true)
  const [isValid, setIsValid] = useState(true)

  // Cross-tab auth sync - redirect to /login if logged out from another tab
  useAuthSync({
    pageType: 'protected',
    scope,
    sessionUrl: scope === 'account' ? '/api/account-auth/session' : '/api/auth/session',
  })

  useEffect(() => {
    async function validateSession() {
      if (status === 'loading') return

      if (status === 'unauthenticated') {
        setIsValidating(false)
        return
      }

      // Determine the correct login URL based on scope
      const loginUrl = scope === 'company' && tenantSlug
        ? `/c/${tenantSlug}/login`
        : '/login'

      // If session loaded but user ID is empty, the session is invalid
      if (status === 'authenticated' && session?.user && !session.user.id) {
        setIsValid(false)
        setIsValidating(false)
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
      } finally {
        setIsValidating(false)
      }
    }

    validateSession()
  }, [session, status, validateUrl, scope, tenantSlug])

  // Show nothing while validating
  if (isValidating || !isValid) {
    return null
  }

  return <>{children}</>
}
