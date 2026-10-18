'use client'

import { useEffect, useRef, useCallback } from 'react'
import { signOut } from 'next-auth/react'
import { broadcastAuthEvent, type AuthScope } from '@/lib/auth/events'

const HEARTBEAT_INTERVAL = 5 * 60 * 1000 // 5 minutes — how often to send heartbeat when active
const INACTIVITY_CHECK_INTERVAL = 60 * 1000 // 1 minute — how often to check local inactivity
const INACTIVITY_LIMIT = 3 * 60 * 60 * 1000 // 3 hours

interface ActivityTrackerProps {
  /** Heartbeat endpoint URL (default: /api/auth/heartbeat) */
  heartbeatUrl?: string
  /** Validate endpoint URL (default: /api/auth/validate) */
  validateUrl?: string
  /** Auth scope for event broadcasting (default: 'company') */
  scope?: AuthScope
  /** Tenant slug for company-scoped logout redirect */
  tenantSlug?: string
}

/**
 * Tracks user activity and sends periodic heartbeats to the server.
 * If the user is inactive for 3+ hours (across all devices), the session is ended.
 */
export function ActivityTracker({
  heartbeatUrl = '/api/auth/heartbeat',
  validateUrl = '/api/auth/validate',
  scope = 'company',
  tenantSlug,
}: ActivityTrackerProps) {
  const lastActivityRef = useRef(0)
  const lastHeartbeatRef = useRef(0)

  // Determine the correct login URL based on scope
  const loginUrl = scope === 'company' && tenantSlug
    ? `/c/${tenantSlug}/login`
    : '/login'

  const sendHeartbeat = useCallback(async () => {
    try {
      const res = await fetch(heartbeatUrl, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.status === 401) {
        broadcastAuthEvent('logout', scope)
        signOut({ callbackUrl: loginUrl, redirect: true })
      }
    } catch {
      // Network error — ignore, will retry next interval
    }
  }, [heartbeatUrl, scope, loginUrl])

  // Record user activity
  const handleActivity = useCallback(() => {
    const now = Date.now()
    lastActivityRef.current = now

    // Send heartbeat if enough time has passed since last one
    if (now - lastHeartbeatRef.current >= HEARTBEAT_INTERVAL) {
      lastHeartbeatRef.current = now
      sendHeartbeat()
    }
  }, [sendHeartbeat])

  useEffect(() => {
    // Initialize refs on mount
    const now = Date.now()
    lastActivityRef.current = now
    lastHeartbeatRef.current = now

    // Send initial heartbeat on mount
    sendHeartbeat()

    // Listen for user activity events
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true })
    })

    // Periodic inactivity check
    const checkInterval = setInterval(async () => {
      const elapsed = Date.now() - lastActivityRef.current
      if (elapsed >= INACTIVITY_LIMIT) {
        try {
          const res = await fetch(validateUrl, {
            credentials: 'include',
          })
          if (res.status === 401) {
            broadcastAuthEvent('logout', scope)
            signOut({ callbackUrl: loginUrl, redirect: true })
          }
        } catch {
          // Network error — keep session, will retry next interval
        }
      }
    }, INACTIVITY_CHECK_INTERVAL)

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity)
      })
      clearInterval(checkInterval)
    }
  }, [handleActivity, sendHeartbeat, validateUrl, scope, loginUrl])

  return null
}
