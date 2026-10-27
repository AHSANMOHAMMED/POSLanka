// More tab: every feature the role / business type allows as an icon grid (native screens, or
// the web page in the browser where the app has none), plus text size, device info and sign out.
import React from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, useWindowDimensions } from 'react-native'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { formatBusinessId, getApiBase, logout } from '../../src/lib/api'
import { displayRole } from '../../src/lib/roles'
import { THEME } from '../../src/lib/theme'
import { useSessionUser } from '../../src/lib/session'
import { useFeatureFlags } from '../../src/lib/features'
import { openWeb, visibleFeatures, type AppFeature } from '../../src/lib/modules'
import { TEXT_SCALES, useTextScale } from '../../src/lib/textScale'
import { Card, IconBubble, ListItem, ScreenHeader, SectionHeader, uiStyles } from '../../src/components/ui'

const GROUPS: Array<{ title: string; groups: AppFeature['group'][] }> = [
  { title: 'Selling', groups: ['sell'] },
  { title: 'Stock', groups: ['stock'] },
  { title: 'Manage', groups: ['manage', 'reports'] },
  { title: 'Business modules', groups: ['modules'] },
  { title: 'This device', groups: ['device'] },
]

export default function MoreTab() {
  const { user } = useSessionUser()
  const features = useFeatureFlags()
  const { width } = useWindowDimensions()
  const cols = width >= 720 ? 6 : width >= 520 ? 4 : 3
  const tileW = Math.floor((Math.min(width, 900) - 32 - (cols - 1) * 10) / cols)

  function open(f: AppFeature) {
    if (f.route) router.push(f.route as any)
    else if (f.webPath) openWeb(user, f.webPath)
  }

  function confirmLogout() {
    Alert.alert('Sign out', 'Sign out of this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => logout() },
    ])
  }

  const initials = (user?.name || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <View style={uiStyles.screen}>
      <ScreenHeader title="More" back={false} />
      <ScrollView contentContainerStyle={[uiStyles.content, { paddingBottom: 32 }]}>
        <Card style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>
              {user?.name || '—'}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {displayRole(user)}
              {user?.customRoleName ? ' (custom role)' : ''}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {user?.tenantName}
              {user?.businessId ? ` · ${user.tenantSlug || formatBusinessId(user.businessId)}` : ''}
            </Text>
          </View>
        </Card>

        {GROUPS.map((g) => {
          const list = visibleFeatures(user, features.has, g.groups)
          if (list.length === 0) return null
          return (
            <View key={g.title}>
              <SectionHeader title={g.title} />
              <View style={styles.grid}>
                {list.map((f) => (
                  <Pressable
                    key={f.key}
                    onPress={() => open(f)}
                    style={({ pressed }) => [styles.tile, { width: tileW }, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={f.title}
                  >
                    <IconBubble name={f.icon} tone={f.tone} size={46} />
                    <Text style={styles.tileTitle} numberOfLines={2}>
                      {f.title}
                    </Text>
                    {!f.route && f.webPath ? <Ionicons name="open-outline" size={12} color={THEME.colors.textSubtle} style={styles.webMark} /> : null}
                  </Pressable>
                ))}
              </View>
            </View>
          )
        })}

        <SectionHeader title="Settings" />
        <TextSizeRow />
        <Card style={[uiStyles.listCard, { marginTop: 10 }]}>
          <ListItem icon="globe-outline" iconTone="muted" title="Server" subtitle={getApiBase()} />
          <ListItem icon="information-circle-outline" iconTone="muted" title="App version" subtitle={`skyERPOS ${Constants.expoConfig?.version || ''}`} />
          <ListItem icon="log-out-outline" iconTone="error" title="Sign out" titleColor={THEME.colors.error} onPress={confirmLogout} chevron={false} last />
        </Card>
      </ScrollView>
    </View>
  )
}

/** In-app text size (90% .. 140%); applies to every screen at once. */
function TextSizeRow() {
  const [scale, setScale] = useTextScale()
  return (
    <Card style={styles.sizeCard}>
      <Ionicons name="text-outline" size={20} color={THEME.colors.primary} />
      <View style={styles.sizeRow} accessibilityRole="radiogroup">
        {TEXT_SCALES.map((s, i) => (
          <Pressable
            key={s}
            onPress={() => setScale(s)}
            accessibilityRole="radio"
            accessibilityState={{ checked: scale === s }}
            accessibilityLabel={`${Math.round(s * 100)} percent`}
            style={[styles.sizeBtn, scale === s && styles.sizeBtnActive]}
          >
            {/* allowFontScaling off + fixed sizes: the picker itself stays put while the app rescales */}
            <Text allowFontScaling={false} style={[styles.sizeBtnText, { fontSize: (12 + i * 2) / scale }, scale === s && styles.sizeBtnTextActive]}>
              A
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.sizePct}>{Math.round(scale * 100)}%</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: THEME.colors.onPrimary, fontSize: 19, fontWeight: '800' },
  name: { fontSize: 17, fontWeight: '800', color: THEME.colors.text },
  sub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { minHeight: 104, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, backgroundColor: THEME.colors.card, borderWidth: 1, borderColor: THEME.colors.border, alignItems: 'center', gap: 8 },
  tileTitle: { fontSize: 12, fontWeight: '700', color: THEME.colors.text, textAlign: 'center' },
  webMark: { position: 'absolute', top: 8, right: 8 },
  sizeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  sizeRow: { flexDirection: 'row', flex: 1, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, overflow: 'hidden' },
  sizeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, backgroundColor: THEME.colors.card },
  sizeBtnActive: { backgroundColor: THEME.colors.primary },
  sizeBtnText: { fontWeight: '700', color: THEME.colors.text },
  sizeBtnTextActive: { color: THEME.colors.onPrimary },
  sizePct: { fontSize: 12, color: THEME.colors.textMuted, minWidth: 36, textAlign: 'right' },
})
