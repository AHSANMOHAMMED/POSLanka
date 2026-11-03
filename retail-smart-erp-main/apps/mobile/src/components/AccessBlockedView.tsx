import React from 'react'
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { THEME } from '../lib/theme'
import { resolveLockMessage, type LockMessage } from '../lib/lockMessage'

export interface AccessBlockedProps {
  status?: string | null
  lockedReason?: string | null
  title?: string | null
  description?: string | null
  error?: string | null
  tenantName?: string | null
  onBackToLogin: () => void
}

/**
 * Full-screen gate for suspended / locked / archived companies.
 * Never a blank screen — always a clear reason + back to sign-in.
 */
export function AccessBlockedView(props: AccessBlockedProps) {
  const insets = useSafeAreaInsets()
  const msg: LockMessage = resolveLockMessage(props)
  const danger = msg.tone === 'danger'

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.badge, danger ? styles.badgeDanger : styles.badgeWarn]}>
          <Text style={[styles.badgeText, danger ? styles.badgeTextDanger : styles.badgeTextWarn]}>
            {msg.statusLabel}
          </Text>
        </View>

        <View style={[styles.iconWell, danger ? styles.iconWellDanger : styles.iconWellWarn]}>
          <Text style={styles.iconGlyph} accessibilityLabel="Locked">
            {danger ? '🔒' : '⏸️'}
          </Text>
        </View>

        <Text style={styles.title}>{msg.title}</Text>
        <Text style={styles.body}>{msg.description}</Text>

        {props.tenantName ? (
          <Text style={styles.tenant}>{props.tenantName}</Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What you can do</Text>
          <Text style={styles.cardLine}>• Ask your owner to renew or settle payment</Text>
          <Text style={styles.cardLine}>• Contact skyERPOS support to reactivate</Text>
          <Text style={styles.cardLine}>• Your sales and stock data stay on the server</Text>
        </View>


        <Pressable
          style={styles.btn}
          onPress={props.onBackToLogin}
          accessibilityRole="button"
          accessibilityLabel="Back to sign in"
        >
          <Text style={styles.btnText}>Back to sign-in</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
  },
  badge: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 20,
  },
  badgeDanger: { backgroundColor: THEME.colors.errorLight },
  badgeWarn: { backgroundColor: THEME.colors.secondaryLight },
  badgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  badgeTextDanger: { color: THEME.colors.error },
  badgeTextWarn: { color: THEME.colors.secondary },
  iconWell: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  iconWellDanger: { backgroundColor: THEME.colors.errorLight },
  iconWellWarn: { backgroundColor: THEME.colors.secondaryLight },
  iconGlyph: { fontSize: 32 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: THEME.colors.text,
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: THEME.colors.textMuted,
    textAlign: 'center',
    marginBottom: 12,
  },
  tenant: {
    fontSize: 13,
    color: THEME.colors.textSubtle,
    marginBottom: 24,
    textAlign: 'center',
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: THEME.colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 16,
    marginBottom: 28,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: 8,
  },
  cardLine: {
    fontSize: 14,
    lineHeight: 22,
    color: THEME.colors.textMuted,
  },
  btn: {
    alignSelf: 'stretch',
    backgroundColor: THEME.colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: {
    color: THEME.colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
})
