import React from 'react'
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import { THEME } from '../lib/theme'

export function LoadingView({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={THEME.colors.primary} />
      <Text style={styles.muted}>{text}</Text>
    </View>
  )
}

export function EmptyView({ icon = '📭', title, subtitle }: { icon?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
    </View>
  )
}

export function ErrorView({
  message,
  onRetry,
  title = 'Something went wrong',
}: {
  message: string
  onRetry?: () => void
  title?: string
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={[styles.muted, { color: THEME.colors.error }]}>{message}</Text>
      {onRetry ? (
        <Pressable style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryText}>↻ Retry</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** Small inline banner (e.g. a non-blocking error above a list). */
export function InlineNotice({ text, tone = 'warn' }: { text: string; tone?: 'warn' | 'error' | 'info' }) {
  const bg = tone === 'error' ? THEME.colors.errorLight : tone === 'info' ? THEME.colors.primaryLight : THEME.colors.secondaryLight
  const fg = tone === 'error' ? THEME.colors.error : tone === 'info' ? THEME.colors.primary : THEME.colors.onSecondaryContainer
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={[styles.noticeText, { color: fg }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 28 },
  icon: { fontSize: 40, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '800', color: THEME.colors.text, textAlign: 'center' },
  muted: { marginTop: 6, fontSize: 13, color: THEME.colors.textMuted, textAlign: 'center' },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: THEME.colors.primary,
  },
  retryText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  notice: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginHorizontal: 16, marginVertical: 6 },
  noticeText: { fontSize: 12, fontWeight: '600' },
})
