import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Redirect, Stack } from 'expo-router'
import { getAdminToken } from '../../src/lib/adminApi'
import { IS_ADMIN_APP } from '../../src/lib/appVariant'

/** Gate: every /admin/* screen needs a platform-admin token. */
export default function AdminLayout() {
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking')

  useEffect(() => {
    // The vendor POS app has no platform console (that is the skyERPOS Admin app)
    if (!IS_ADMIN_APP) { setState('denied'); return }
    getAdminToken().then((t) => setState(t ? 'ok' : 'denied'))
  }, [])

  if (state === 'checking') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }
  if (state === 'denied') return <Redirect href="/login" />

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="pulse" />
      <Stack.Screen name="live" />
      <Stack.Screen name="vendors" />
      <Stack.Screen name="vendors/[id]" />
      <Stack.Screen name="vendor-data" />
      <Stack.Screen name="approvals" />
    </Stack>
  )
}
