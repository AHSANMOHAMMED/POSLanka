import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { startAutoSync } from '../src/lib/offlineQueue'
import { startIntakeAutoSync } from '../src/lib/intakeStore'
import { installNotificationHandlers } from '../src/lib/notifications'
import { IS_ADMIN_APP } from '../src/lib/appVariant'
import { installTextScale, TextScaleProvider } from '../src/lib/textScale'

// In-app text size: wraps Text / TextInput once, before the first render
installTextScale()

export default function RootLayout() {
  useEffect(() => {
    // Shop app only: replays queued offline sales and uploads stock intake scans saved offline
    if (!IS_ADMIN_APP) {
      startAutoSync()
      startIntakeAutoSync()
    }
    // Foreground notification toasts + deep links (data.screen).
    return installNotificationHandlers()
  }, [])

  return (
    <TextScaleProvider>
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="shifts" />
        <Stack.Screen name="approvals" />
        <Stack.Screen name="inventory" />
        <Stack.Screen name="summary" />
        <Stack.Screen name="printer" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="staff" />
        <Stack.Screen name="intake" />
        <Stack.Screen name="item-new" />
        <Stack.Screen name="alerts" />
        <Stack.Screen name="labels" />
        <Stack.Screen name="money" />
        <Stack.Screen name="sales" />
        <Stack.Screen name="module/[key]" />
      </Stack>
    </SafeAreaProvider>
    </TextScaleProvider>
  )
}
