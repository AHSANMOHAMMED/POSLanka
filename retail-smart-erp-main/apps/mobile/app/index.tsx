import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { getToken, getUser, loadSavedSettings, refreshPermissions } from '../src/lib/api'
import { hasPermission } from '../src/lib/roles'
import { getAdminToken } from '../src/lib/adminApi'
import { registerPushToken } from '../src/lib/notifications'
import { fetchCurrentShift } from '../src/lib/shift'
import { IS_ADMIN_APP } from '../src/lib/appVariant'

export default function Index() {
  const [target, setTarget] = useState<'/login' | '/pos' | '/shifts' | '/home' | '/admin/pulse' | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await loadSavedSettings()
      // skyERPOS Admin app: platform console only
      if (IS_ADMIN_APP) {
        const adminToken = await getAdminToken()
        if (!cancelled) setTarget(adminToken ? '/admin/pulse' : '/login')
        return
      }
      const token = await getToken()
      if (!token) {
        if (!cancelled) setTarget('/login')
        return
      }
      // Re-register the push token on every cold start (tokens rotate); ignores 404 / Expo Go.
      registerPushToken().catch(() => undefined)
      // Pick up role / permission changes the owner made since the last launch. Bounded so a
      // slow network never blocks start-up (the stored permissions are used meanwhile).
      const user = await Promise.race([
        refreshPermissions().catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]) || (await getUser())
      if (cancelled) return
      if (!hasPermission(user, 'createSales')) {
        setTarget('/home')
        return
      }
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
