// Admin app "More" tab: native console hubs + optional open-on-web (sslip public base).
import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Linking } from 'react-native'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { getApiBase, getPublicWebBase } from '../../src/lib/api'
import { ADMIN_ROLE_LABEL, adminLogout, getAdminUser, useAdminUser, type AdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { TEXT_SCALES, useTextScale } from '../../src/lib/textScale'
import { AdminShell, adminStyles } from '../../src/components/admin/AdminShell'
import { Card, ListItem, SectionHeader, type IconName } from '../../src/components/ui'

const NATIVE: Array<{ title: string; subtitle: string; icon: IconName; href: string; permission?: string }> = [
  { title: 'Create vendor', subtitle: 'New tenant onboarding', icon: 'add-circle-outline', href: '/admin/vendors/create', permission: 'vendors.manage' },
  { title: 'Subscriptions', subtitle: 'Plans, extend, lock', icon: 'card-outline', href: '/admin/subscriptions', permission: 'billing' },
  { title: 'Pricing', subtitle: 'Monthly / yearly / lifetime', icon: 'pricetags-outline', href: '/admin/pricing', permission: 'billing' },
  { title: 'Payments', subtitle: 'Bank slips & PayHere', icon: 'cash-outline', href: '/admin/payments', permission: 'billing' },
  { title: 'Messages', subtitle: 'Vendor support inbox', icon: 'chatbubbles-outline', href: '/admin/messages', permission: 'messages' },
  { title: 'Notifications', subtitle: 'Broadcasts', icon: 'notifications-outline', href: '/admin/notifications', permission: 'notifications' },
  { title: 'Send email', subtitle: 'Platform email', icon: 'mail-outline', href: '/admin/send-email', permission: 'notifications' },
  { title: 'Messaging providers', subtitle: 'SMS / WhatsApp config', icon: 'cloud-outline', href: '/admin/messaging', permission: 'settings' },
  { title: 'Audit logs', subtitle: 'Who changed what', icon: 'document-text-outline', href: '/admin/audit-logs' },
  { title: 'Error logs', subtitle: 'Server & client errors', icon: 'bug-outline', href: '/admin/error-logs', permission: 'error_logs' },
  { title: 'Users', subtitle: 'Owners & platform admins', icon: 'people-outline', href: '/admin/users' },
  { title: 'Settings', subtitle: 'Platform settings', icon: 'settings-outline', href: '/admin/settings', permission: 'settings' },
  { title: 'Account', subtitle: 'Password & 2FA', icon: 'shield-checkmark-outline', href: '/admin/account', permission: 'self' },
]

const WEB_LINKS: Array<{ title: string; path: string }> = [
  { title: 'Full web console', path: '/sys-control' },
  { title: 'Sales wall (web)', path: '/sys-control/sales-wall' },
]

export default function AdminMoreScreen() {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const { can } = useAdminUser()
  useEffect(() => {
    getAdminUser().then(setAdmin)
  }, [])

  function confirmSignOut() {
    Alert.alert('Sign out', `Sign out of the platform console${admin?.email ? ` (${admin.email})` : ''}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => adminLogout() },
    ])
  }

  const visible = NATIVE.filter((l) => !l.permission || can(l.permission) || l.permission === 'self' || can('read'))

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

        <SectionHeader title="Console" />
        <Card style={styles.list}>
          {visible.map((l, i) => (
            <ListItem
              key={l.href}
              icon={l.icon}
              title={l.title}
              subtitle={l.subtitle}
              onPress={() => router.push(l.href as any)}
              last={i === visible.length - 1}
            />
          ))}
        </Card>

        <SectionHeader title="Open on web" />
        <Card style={styles.list}>
          {WEB_LINKS.map((l, i) => (
            <ListItem
              key={l.path}
              icon="open-outline"
              title={l.title}
              subtitle={getPublicWebBase()}
              onPress={() => Linking.openURL(`${getPublicWebBase()}${l.path}`).catch(() => undefined)}
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
