// Shared chrome for the super-admin companion screens: header with the admin's identity and a
// bottom tab bar with icons (Pulse / Live / Vendors / Approvals / More). Detail screens (`back`)
// get a back arrow and no tab bar, like pushed screens in the vendor app.
import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Image, BackHandler } from 'react-native'
import { router, usePathname, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { THEME } from '../../lib/theme'
import { ADMIN_ROLE_LABEL, getAdminUser, type AdminUser } from '../../lib/adminApi'
import { useHeaderPad, useBottomPad } from '../../lib/safeArea'

export type AdminTab = 'pulse' | 'live' | 'vendors' | 'approvals' | 'more'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

const TABS: Array<{ id: AdminTab; label: string; icon: IoniconName; iconIdle: IoniconName; href: string }> = [
  { id: 'pulse', label: 'Pulse', icon: 'pulse', iconIdle: 'pulse-outline', href: '/admin/pulse' },
  { id: 'live', label: 'Live', icon: 'radio', iconIdle: 'radio-outline', href: '/admin/live' },
  { id: 'vendors', label: 'Vendors', icon: 'storefront', iconIdle: 'storefront-outline', href: '/admin/vendors' },
  { id: 'approvals', label: 'Approvals', icon: 'checkmark-done-circle', iconIdle: 'checkmark-done-circle-outline', href: '/admin/approvals' },
  { id: 'more', label: 'More', icon: 'grid', iconIdle: 'grid-outline', href: '/admin/more' },
]

interface AdminShellProps {
  title: string
  subtitle?: string
  tab: AdminTab
  /** Show a back arrow instead of the brand badge (detail screens). */
  back?: boolean
  right?: React.ReactNode
  children: React.ReactNode
}

export function AdminShell({ title, subtitle, tab, back, right, children }: AdminShellProps) {
  const headerPad = useHeaderPad()
  const bottomPad = useBottomPad(8)
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    getAdminUser().then(setAdmin)
  }, [])

  // Android back on a tab other than Pulse goes to Pulse first (like a tab navigator), then exits.
  useFocusEffect(
    React.useCallback(() => {
      if (back || tab === 'pulse') return
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.replace('/admin/pulse')
        return true
      })
      return () => sub.remove()
    }, [back, tab])
  )

  return (
    <View style={styles.container}>
      <View style={[styles.header, headerPad]}>
        {back ? (
          <Pressable style={styles.backBtn} hitSlop={8} accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin/vendors'))}>
            <Ionicons name="arrow-back" size={24} color={THEME.colors.text} />
          </Pressable>
        ) : (
          <Image source={require('../../../assets/icon.png')} style={styles.badge} accessibilityLabel="skyERPOS" />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle || (admin ? `${admin.name}${admin.role ? ` • ${ADMIN_ROLE_LABEL[admin.role] ?? admin.role}` : ''} • ${admin.email}` : 'Platform console')}
          </Text>
        </View>
        {right}
      </View>

      <View style={{ flex: 1 }}>{children}</View>

      {back ? null : (
        <View style={[styles.tabBar, { paddingBottom: bottomPad }]} accessibilityRole="tablist">
          {TABS.map((t) => {
            const active = t.id === tab || pathname === t.href
            return (
              <Pressable
                key={t.id}
                style={styles.tabBtn}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.label}
                onPress={() => (active ? undefined : router.replace(t.href as any))}
              >
                {active ? <View style={styles.tabIndicator} /> : null}
                <Ionicons name={active ? t.icon : t.iconIdle} size={23} color={active ? THEME.colors.primary : THEME.colors.textMuted} />
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
              </Pressable>
            )
          })}
        </View>
      )}
    </View>
  )
}

/** Small reusable bits for the admin screens. */
export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'primary' | 'warn' | 'error' | 'ok' }) {
  const color =
    tone === 'warn' ? THEME.colors.secondary : tone === 'error' ? THEME.colors.error : tone === 'ok' ? THEME.colors.tertiary : THEME.colors.text
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? <Text style={styles.kpiHint}>{hint}</Text> : null}
    </View>
  )
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  )
}

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function ListRow({ title, subtitle, right, onPress, tone }: { title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; tone?: 'error' | 'ok' }) {
  const Comp: any = onPress ? Pressable : View
  return (
    <Comp style={styles.listRow} onPress={onPress}>
      <View style={{ flex: 1, marginRight: 10 }}>
        <Text style={[styles.rowTitle, tone === 'error' && { color: THEME.colors.error }, tone === 'ok' && { color: THEME.colors.tertiary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {typeof right === 'string' ? <Text style={styles.rowRight}>{right}</Text> : right}
    </Comp>
  )
}

export function Pill({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'ok' | 'warn' | 'error' | 'primary' }) {
  const bg =
    tone === 'ok' ? THEME.colors.tertiaryLight : tone === 'warn' ? THEME.colors.secondaryLight : tone === 'error' ? THEME.colors.errorLight : tone === 'primary' ? THEME.colors.primaryLight : THEME.colors.surfaceContainerHigh
  const fg =
    tone === 'ok' ? THEME.colors.tertiary : tone === 'warn' ? THEME.colors.onSecondaryContainer : tone === 'error' ? THEME.colors.error : tone === 'primary' ? THEME.colors.primary : THEME.colors.textMuted
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  )
}

export function statusTone(status: string | null | undefined): 'ok' | 'warn' | 'error' | 'muted' {
  switch (status) {
    case 'active':
      return 'ok'
    case 'trial':
      return 'warn'
    case 'locked':
    case 'suspended':
    case 'cancelled':
    case 'expired':
      return 'error'
    default:
      return 'muted'
  }
}

export function compactLKR(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '0'))
  if (isNaN(v)) return 'LKR 0'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}LKR ${(abs / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${sign}LKR ${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 10_000) return `${sign}LKR ${(abs / 1_000).toFixed(1)}K`
  return `${sign}LKR ${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function businessTypeLabel(t: string | null | undefined): string {
  switch (t) {
    case 'retail':
      return 'Retail'
    case 'restaurant':
      return 'Restaurant'
    case 'supermarket':
      return 'Supermarket'
    case 'auto_service':
      return 'Auto service'
    case 'dealership':
      return 'Dealership'
    case 'pharmacy':
      return 'Pharmacy'
    case 'electronics':
      return 'Electronics & appliances'
    case 'hardware':
      return 'Hardware'
    case 'print_studio':
      return 'Printing & photo studio'
    case 'office':
      return 'Office & services'
    default:
      return t ? t.replace(/_/g, ' ') : 'Unknown'
  }
}

export function timeAgo(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  const diff = Math.max(0, Date.now() - d.getTime())
  const s = Math.floor(diff / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export const adminStyles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border },
  segmentBtnActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  segmentText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  segmentTextActive: { color: '#FFF' },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: THEME.colors.text,
  },
  primaryBtn: { height: 46, borderRadius: 12, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  dangerBtn: { height: 46, borderRadius: 12, backgroundColor: THEME.colors.error, alignItems: 'center', justifyContent: 'center' },
  dangerBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  ghostBtn: { height: 46, borderRadius: 12, backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { color: THEME.colors.text, fontWeight: '800', fontSize: 14 },
  muted: { fontSize: 12, color: THEME.colors.textMuted },
  empty: { padding: 16, fontSize: 12, color: THEME.colors.textMuted, textAlign: 'center' },
  bar: { height: 6, borderRadius: 3, backgroundColor: THEME.colors.surfaceContainerHigh, overflow: 'hidden', marginTop: 6 },
  barFill: { height: 6, borderRadius: 3, backgroundColor: THEME.colors.primary },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  badge: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: THEME.colors.border },
  backBtn: { width: 44, height: 44, marginLeft: -8, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: THEME.colors.text },
  headerSub: { fontSize: 11, color: THEME.colors.textMuted },
  signOutBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: THEME.colors.border },
  signOutText: { fontSize: 11, fontWeight: '700', color: THEME.colors.error },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    paddingBottom: 18,
    paddingTop: 6,
  },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 54, paddingVertical: 6, position: 'relative' },
  tabEmoji: { fontSize: 18 },
  tabLabel: { fontSize: 11, fontWeight: '700', color: THEME.colors.textMuted, marginTop: 2 },
  tabLabelActive: { color: THEME.colors.primary },
  tabIndicator: { position: 'absolute', top: 0, width: 28, height: 3, borderRadius: 2, backgroundColor: THEME.colors.primary },
  kpi: { width: '48%', flexGrow: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: THEME.colors.border },
  kpiLabel: { fontSize: 10, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 20, fontWeight: '900', marginTop: 4, fontFamily: 'monospace' },
  kpiHint: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: THEME.colors.border, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  rowTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  rowSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
  rowRight: { fontSize: 13, fontWeight: '800', color: THEME.colors.text, fontFamily: 'monospace' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
})
