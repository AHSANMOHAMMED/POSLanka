// Signed-in user for screens + the tab bar. Reads the stored user instantly and refreshes the
// server-effective permissions on focus (at most every 30 s) so an owner's role change shows quickly,
// and again whenever the app comes back to the foreground (a super admin may have changed the business
// type / mall segments meanwhile).
import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { getUser, refreshPermissions, type AuthUser } from './api'

let lastRefresh = 0
const listeners = new Set<(u: AuthUser | null) => void>()

function publish(u: AuthUser | null) {
  for (const l of Array.from(listeners)) l(u)
}

/** Refresh permissions from the server (throttled unless forced) and notify every hook. */
export async function reloadSessionUser(force = false): Promise<AuthUser | null> {
  if (!force && Date.now() - lastRefresh < 30_000) return getUser()
  lastRefresh = Date.now()
  const fresh = await refreshPermissions().catch(() => null)
  const u = fresh || (await getUser())
  publish(u)
  return u
}

// One app-wide listener (not one per mounted hook): back in the foreground → refresh at once
let foregroundWatched = false
function watchForeground() {
  if (foregroundWatched) return
  foregroundWatched = true
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && listeners.size > 0 && Date.now() - lastRefresh > 5_000) {
      reloadSessionUser(true).catch(() => undefined)
    }
  })
}

/** undefined while loading, null when signed out. */
export function useSessionUser(): { user: AuthUser | null | undefined; reload: (force?: boolean) => Promise<AuthUser | null> } {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    getUser().then((u) => {
      if (alive) setUser(u)
    })
    const l = (u: AuthUser | null) => {
      if (alive) setUser(u)
    }
    listeners.add(l)
    watchForeground()
    return () => {
      alive = false
      listeners.delete(l)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      reloadSessionUser(false).catch(() => undefined)
    }, [])
  )

  return { user, reload: reloadSessionUser }
}
