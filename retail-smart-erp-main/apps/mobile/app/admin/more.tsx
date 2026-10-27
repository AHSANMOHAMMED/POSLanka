// Admin app "More" tab: the signed-in platform admin, shortcuts to the full web console,
// text size, device info and sign out.
import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Linking } from 'react-native'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { getApiBase } from '../../src/lib/api'
import { ADMIN_ROLE_LABEL, adminLogout, getAdminUser, type AdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { TEXT_SCALES, useTextScale } from '../../src/lib/textScale'
import { AdminShell, adminStyles } from '../../src/components/admin/AdminShell'
import { Card, ListItem, SectionHeader, type IconName } from '../../src/components/ui'

const WEB_LINKS: Array<{ title: string; subtitle: string; icon: IconName; path: string }> = [
  { title: 'Web console', subtitle: 'Full platform dashboard', icon: 'desktop-outline', path: '/sys-control' },
  { title: 'Subscriptions', subtitle: 'Plans, trials, renewals', icon: 'card-outline', path: '/sys-control/subscriptions' },
  { title: 'Payments', subtitle: 'All payment records', icon: 'cash-outline', path: '/sys-control/payments' },
  { title: 'Sales wall', subtitle: 'Live platform sales', icon: 'trending-up-outline', path: '/sys-control/sales-wall' },
  { title: 'Messages', subtitle: 'Vendor messages', icon: 'chatbubbles-outline', path: '/sys-control/messages' },
  { title: 'Error logs', subtitle: 'Server & client errors', icon: 'bug-outline', path: '/sys-control/error-logs' },
  { title: 'Audit logs', subtitle: 'Who changed what', icon: 'document-text-outline', path: '/sys-control/audit-logs' },
]

export default function AdminMoreScreen() {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  useEffect(() => {
    getAdminUser().then(setAdmin)
  }, [])

  function confirmSignOut() {
    Alert.alert('Sign out', `Sign out of the platform console${admin?.email ? ` (${admin.email})` : ''}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => adminLogout() },
    ])
  }

  return (
    <AdminShell title="More" tab="more">
      <ScrollView style={adminStyles.scroll} contentContainerStyle={[adminStyles.content, { gap: 0 }]}>
        <Card style={styles.profile}>
          <View style={styles.avatar}>
            <Ionicons name="shield-checkmark" size={26} color="#FFF" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>
              {admin?.name || 'Platform admin'}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {admin?.role ? ADMIN_ROLE_LABEL[admin.role] ?? admin.role : ''}
              {admin?.email ? ` · ${admin.email}` : ''}
            </Text>
          </View>
        </Card>

        <SectionHeader title="Web console" />
        <Card style={styles.list}>
          {WEB_LINKS.map((l, i) => (
            <ListItem
              key={l.path}
              icon={l.icon}
              title={l.title}
              subtitle={`${l.subtitle} (opens browser)`}
              onPress={() => Linking.openURL(`${getApiBase()}${l.path}`).catch(() => undefined)}
              last={i === WEB_LINKS.length - 1}
            />
          ))}
        </Card>

        <SectionHeader title="Settings" />
        <TextSizeCard />
        <Card style={[styles.list, { marginTop: 10 }]}>
          <ListItem icon="globe-outline" iconTone="muted" title="Server" subtitle={getApiBase()} />
          <ListItem icon="information-circle-outline" iconTone="muted" title="App version" subtitle={`skyERPOS Admin ${Constants.expoConfig?.version || ''}`} />
          <ListItem icon="log-out-outline" iconTone="error" title="Sign out" titleColor={THEME.colors.error} onPress={confirmSignOut} chevron={false} last />
        </Card>
      </ScrollView>
    </AdminShell>
  )
}

function TextSizeCard() {
  const [scale, setScale] = useTextScale()
  return (
    <Card style={styles.sizeCard}>
      <Ionicons name="text-outline" size={20} color={THEME.colors.primary} />
      <View style={styles.sizeRow}>
        {TEXT_SCALES.map((s, i) => (
          <Pressable
            key={s}
            onPress={() => setScale(s)}
            accessibilityRole="radio"
            accessibilityState={{ checked: scale === s }}
            accessibilityLabel={`${Math.round(s * 100)} percent`}
            style={[styles.sizeBtn, scale === s && styles.sizeBtnActive]}
          >
            <Text allowFontScaling={false} style={[styles.sizeBtnText, { fontSize: (12 + i * 2) / scale }, scale === s && { color: '#FFF' }]}>
              A
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.sub}>{Math.round(scale * 100)}%</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 17, fontWeight: '800', color: THEME.colors.text },
  sub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  list: { padding: 0, overflow: 'hidden' },
  sizeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  sizeRow: { flexDirection: 'row', flex: 1, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, overflow: 'hidden' },
  sizeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, backgroundColor: THEME.colors.card },
  sizeBtnActive: { backgroundColor: THEME.colors.primary },
  sizeBtnText: { fontWeight: '700', color: THEME.colors.text },
})
