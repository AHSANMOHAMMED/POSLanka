import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { startAutoSync } from '../src/lib/offlineQueue'
import { startIntakeAutoSync } from '../src/lib/intakeStore'
import { installNotificationHandlers } from '../src/lib/notifications'
import { installTextScale, TextScaleProvider } from '../src/lib/textScale'

// In-app text size: wraps Text / TextInput once, before the first render
installTextScale()

export default function RootLayout() {
  useEffect(() => {
    // Replays queued offline sales whenever connectivity returns.
    startAutoSync()
    // Uploads stock intake scans saved while offline.
    startIntakeAutoSync()
    // Foreground notification toasts + deep links (data.screen).
    return installNotificationHandlers()
  }, [])

  return (
    <TextScaleProvider>
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="home" />
        <Stack.Screen name="login" />
        <Stack.Screen name="pos" />
        <Stack.Screen name="shifts" />
        <Stack.Screen name="approvals" />
        <Stack.Screen name="inventory" />
        <Stack.Screen name="summary" />
        <Stack.Screen name="printer" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="staff" />
        <Stack.Screen name="intake" />
        <Stack.Screen name="alerts" />
        <Stack.Screen name="labels" />
      </Stack>
    </SafeAreaProvider>
    </TextScaleProvider>
  )
}
