import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { getToken, loadSavedSettings } from '../src/lib/api'
import { getAdminToken } from '../src/lib/adminApi'
import { registerPushToken } from '../src/lib/notifications'
import { fetchCurrentShift } from '../src/lib/shift'

export default function Index() {
  const [target, setTarget] = useState<'/login' | '/pos' | '/shifts' | '/admin/pulse' | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await loadSavedSettings()
      const token = await getToken()
      if (!token) {
        // A platform-admin session (separate token) goes straight to the admin console.
        const adminToken = await getAdminToken()
        if (!cancelled) setTarget(adminToken ? '/admin/pulse' : '/login')
        return
      }
      // Re-register the push token on every cold start (tokens rotate); ignores 404 / Expo Go.
      registerPushToken().catch(() => undefined)
      const res = await fetchCurrentShift()
      if (cancelled) return
      if (res.status === 401) {
        setTarget('/login')
      } else if (res.ok) {
        setTarget(res.data.hasOpenShift ? '/pos' : '/shifts')
      } else {
        // Offline or server error: the POS screen shows the shift gate itself.
        setTarget('/pos')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!target) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return <Redirect href={target} />
}
