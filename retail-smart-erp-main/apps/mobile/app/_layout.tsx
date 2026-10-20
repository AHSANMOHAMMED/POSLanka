import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { startAutoSync } from '../src/lib/offlineQueue'
import { installNotificationHandlers } from '../src/lib/notifications'

export default function RootLayout() {
  useEffect(() => {
    // Replays queued offline sales whenever connectivity returns.
    startAutoSync()
    // Foreground notification toasts + deep links (data.screen).
    return installNotificationHandlers()
  }, [])

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="pos" />
        <Stack.Screen name="shifts" />
        <Stack.Screen name="approvals" />
        <Stack.Screen name="inventory" />
        <Stack.Screen name="summary" />
        <Stack.Screen name="printer" />
        <Stack.Screen name="admin" />
      </Stack>
    </>
  )
}
