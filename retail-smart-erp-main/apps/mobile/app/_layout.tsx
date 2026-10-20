import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

export default function RootLayout() {
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
      </Stack>
    </>
  )
}
