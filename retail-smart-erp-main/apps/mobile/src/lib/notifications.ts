// Push notifications (expo-notifications).
//
// - registerPushToken(): asks permission, fetches the Expo push token and
//   registers the device with POST /api/account/devices. Skipped gracefully when
//   there is no EAS projectId (Expo Go / local builds) or permission is denied.
// - unregisterPushToken(): DELETE /api/account/devices on logout.
// - installNotificationHandlers(): foreground toast/alert + deep-link by
//   `data.screen` ('approvals' | 'pos' | 'shifts' | 'inventory' | 'intake' | 'alerts').
import { Platform, Alert } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { api, getToken, onBeforeLogout } from './api'

const PUSH_TOKEN_KEY = 'poslanka_push_token'
const ANDROID_CHANNEL_ID = 'poslanka-default'

export type NotificationScreen = 'approvals' | 'pos' | 'shifts' | 'inventory' | 'intake' | 'alerts'

const SCREEN_ROUTES: Record<NotificationScreen, string> = {
  approvals: '/approvals',
  pos: '/pos',
  shifts: '/shifts',
  inventory: '/inventory',
  intake: '/intake',
  alerts: '/alerts',
}

type ToastFn = (title: string, body: string, onPress?: () => void) => void
let toastHandler: ToastFn | null = null

/** Screens may install an in-app toast; otherwise a native Alert is used. */
export function setNotificationToastHandler(fn: ToastFn | null) {
  toastHandler = fn
}

function projectId(): string | null {
  const fromExtra = (Constants.expoConfig as any)?.extra?.eas?.projectId
  const fromEas = (Constants as any).easConfig?.projectId
  const id = fromExtra || fromEas
  return typeof id === 'string' && id.length > 0 ? id : null
}

function deviceName(): string {
  return Device.deviceName || [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || `${Platform.OS} device`
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'POSLanka alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0F766E',
    })
  } catch {
    // Expo Go without notification support: ignore.
  }
}

/** Result codes let the caller decide whether to show anything. */
export type RegisterResult = 'registered' | 'no-project-id' | 'denied' | 'unsupported' | 'not-logged-in' | 'failed'

export async function registerPushToken(): Promise<RegisterResult> {
  if (!(await getToken())) return 'not-logged-in'
  if (!Device.isDevice) return 'unsupported'
  const id = projectId()
  if (!id) return 'no-project-id'

  try {
    await ensureAndroidChannel()
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status
    }
    if (status !== 'granted') return 'denied'

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data
    if (!token) return 'failed'

    const res = await api('/api/account/devices', {
      method: 'POST',
      body: JSON.stringify({ pushToken: token, platform: Platform.OS === 'ios' ? 'ios' : 'android', deviceName: deviceName() }),
    })
    // 404: the endpoint is not deployed yet; keep the token so logout can still try to remove it.
    if (res.ok || res.status === 404) {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token)
      return 'registered'
    }
    return 'failed'
  } catch {
    // getExpoPushTokenAsync throws in Expo Go (SDK 52 removed remote push there) — not fatal.
    return 'unsupported'
  }
}

export async function unregisterPushToken(): Promise<void> {
  let token: string | null = null
  try {
    token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY)
  } catch {
    token = null
  }
  if (!token) return
  try {
    await api('/api/account/devices', { method: 'DELETE', body: JSON.stringify({ pushToken: token }) }, { skipUnauthorizedHandler: true })
  } catch {
    // ignore: the server will prune stale tokens on delivery failure
  }
  await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => undefined)
}

function screenFromData(data: unknown): NotificationScreen | null {
  const screen = (data as any)?.screen
  if (typeof screen === 'string' && screen in SCREEN_ROUTES) return screen as NotificationScreen
  // any server alert (data.type) without a known screen opens the alerts inbox
  return typeof (data as any)?.type === 'string' ? 'alerts' : null
}

/** Navigate for an alert's `data` (same rules as a push tap). Returns false when there is no target. */
export function openNotificationTarget(data: unknown): boolean {
  const screen = screenFromData(data)
  if (!screen || screen === 'alerts') return false
  navigateTo(screen)
  return true
}

function navigateTo(screen: NotificationScreen) {
  try {
    router.push(SCREEN_ROUTES[screen] as any)
  } catch {
    // Router not mounted yet; the cold-start path handles it.
  }
}

let handlersInstalled = false
let subscriptions: Array<{ remove: () => void }> = []

/** Call once from the root layout. Safe in Expo Go (everything is try/caught). */
export function installNotificationHandlers(): () => void {
  if (handlersInstalled) return () => undefined
  handlersInstalled = true

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    })
  } catch {
    // ignore
  }

  try {
    // Foreground: show a toast / alert with a "View" action that deep-links.
    subscriptions.push(
      Notifications.addNotificationReceivedListener((notification) => {
        const content = notification.request.content
        const title = content.title || 'POSLanka'
        const body = content.body || ''
        const screen = screenFromData(content.data)
        const onPress = screen ? () => navigateTo(screen) : undefined
        if (toastHandler) {
          toastHandler(title, body, onPress)
        } else {
          Alert.alert(title, body, onPress ? [{ text: 'Dismiss', style: 'cancel' }, { text: 'View', onPress }] : [{ text: 'OK' }])
        }
      })
    )
    // Tapped from the tray (app in background): deep-link straight away.
    subscriptions.push(
      Notifications.addNotificationResponseReceivedListener((response) => {
        const screen = screenFromData(response.notification.request.content.data)
        if (screen) navigateTo(screen)
      })
    )
    // Cold start from a notification tap.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const screen = response ? screenFromData(response.notification.request.content.data) : null
        if (screen) setTimeout(() => navigateTo(screen), 300)
      })
      .catch(() => undefined)
  } catch {
    // ignore
  }

  // Remove the device registration whenever the user signs out.
  onBeforeLogout(unregisterPushToken)

  return () => {
    subscriptions.forEach((s) => s.remove())
    subscriptions = []
    handlersInstalled = false
  }
}
