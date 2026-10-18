// Cross-tab authentication event utilities
// Uses localStorage events for instant cross-tab communication

export type AuthScope = 'account' | 'company'
export type AuthEventType = 'login' | 'logout'

interface AuthEvent {
  type: AuthEventType
  scope: AuthScope
  timestamp: number
}

function getEventKey(scope: AuthScope): string {
  return `auth_sync_event_${scope}`
}

function getSessionFlagKey(scope: AuthScope): string {
  return `auth_logged_in_${scope}`
}

/**
 * Broadcast an auth event to all other tabs for a specific scope
 */
export function broadcastAuthEvent(type: AuthEventType, scope: AuthScope): void {
  if (typeof window === 'undefined') return

  const event: AuthEvent = {
    type,
    scope,
    timestamp: Date.now(),
  }

  // Set to trigger storage event in other tabs
  localStorage.setItem(getEventKey(scope), JSON.stringify(event))

  // Set a persistent flag for focus-based detection
  if (type === 'login') {
    localStorage.setItem(getSessionFlagKey(scope), 'true')
  } else {
    localStorage.removeItem(getSessionFlagKey(scope))
  }
}

/**
 * Parse auth event from storage event for a specific scope
 */
export function parseAuthEvent(event: StorageEvent, scope: AuthScope): AuthEvent | null {
  if (event.key !== getEventKey(scope) || !event.newValue) return null

  try {
    return JSON.parse(event.newValue) as AuthEvent
  } catch {
    return null
  }
}

/**
 * Check if there's an active session flag for a specific scope
 */
export function hasSessionFlag(scope: AuthScope): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(getSessionFlagKey(scope)) === 'true'
}

/**
 * Clear the session flag for a specific scope
 */
export function clearSessionFlag(scope: AuthScope): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(getSessionFlagKey(scope))
}
