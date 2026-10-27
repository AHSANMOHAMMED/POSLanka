// Bell pill with the unread alert count; opens the alerts inbox (/alerts).
// Self-contained: refreshes the unread count from GET /api/notifications when the screen gains
// focus, when the app returns to the foreground, and whenever a push notification arrives;
// a slow poll is only a safety net.
import React, { useCallback, useEffect, useState } from 'react'
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import { router, useFocusEffect } from 'expo-router'
import { apiGet } from '../lib/api'
import { THEME } from '../lib/theme'
import { IconButton } from './ui'

const FALLBACK_POLL_MS = 5 * 60_000

/** `compact`: round bell icon with a red count badge (headers); default: the labelled pill. */
export function AlertsBell({ compact = false }: { compact?: boolean } = {}) {
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    const res = await apiGet<{ unreadCount?: number }>('/api/notifications?pageSize=1')
    if (res.ok && typeof res.data?.unreadCount === 'number') setUnread(res.data.unreadCount)
  }, [])

  useFocusEffect(useCallback(() => { void refresh() }, [refresh]))
  useEffect(() => {
    // App back in the foreground → the inbox may have changed while we were away.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh()
    })
    // A push arrived (foreground) → the server just wrote an inbox row for us.
    let pushSub: { remove: () => void } | null = null
    try {
      pushSub = Notifications.addNotificationReceivedListener(() => { void refresh() })
    } catch {
      // expo-notifications unavailable (e.g. Expo Go / web) — focus + poll still work
    }
    const t = setInterval(() => {
      if (AppState.currentState === 'active') void refresh()
    }, FALLBACK_POLL_MS)
    return () => {
      appState.remove()
      pushSub?.remove()
      clearInterval(t)
    }
  }, [refresh])

  if (compact) {
    return (
      <IconButton
        name={unread > 0 ? 'notifications' : 'notifications-outline'}
        label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
        badge={unread > 0 ? unread : null}
        onPress={() => router.push('/alerts' as any)}
      />
    )
  }

  return (
    <Pressable
      style={[styles.pill, unread > 0 && styles.pillActive]}
      onPress={() => router.push('/alerts' as any)}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
    >
      <Text style={styles.text}>🔔 Alerts</Text>
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceContainerLow,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  pillActive: { borderColor: THEME.colors.error, backgroundColor: THEME.colors.errorLight },
  text: { fontSize: 11, fontWeight: '700', color: THEME.colors.text },
  badge: {
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: THEME.colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
})
