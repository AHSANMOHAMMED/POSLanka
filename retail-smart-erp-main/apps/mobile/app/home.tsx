import React, { useCallback, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Alert, useWindowDimensions } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { formatBusinessId, getUser, logout, refreshPermissions, type AuthUser } from '../src/lib/api'
import { displayRole, hasAnyPermission, hasPermission, type Permission } from '../src/lib/roles'
import { THEME } from '../src/lib/theme'
import { useBottomPad, useHeaderPad } from '../src/lib/safeArea'
import { LoadingView, EmptyView } from '../src/components/StateViews'
import { AlertsBell } from '../src/components/AlertsBell'

interface Tile {
  key: string
  icon: string
  title: string
  subtitle: string
  href: '/pos' | '/shifts' | '/summary' | '/inventory' | '/intake' | '/approvals' | '/staff' | '/labels' | '/printer' | '/alerts' | '/money'
  /** Any of these permissions shows the tile; empty = every signed-in user. */
  anyOf: Permission[]
}

// Each tile mirrors the permission the screen's server routes enforce; the server still refuses.
const TILES: Tile[] = [
  { key: 'pos', icon: '🛒', title: 'Register', subtitle: 'Sell, returns, held bills', href: '/pos', anyOf: ['createSales'] },
  { key: 'shifts', icon: '🕒', title: 'Shift', subtitle: 'Open / close, cash in & out', href: '/shifts', anyOf: ['createSales'] },
  { key: 'money', icon: '💸', title: 'Money out', subtitle: 'Expenses & cheques received', href: '/money', anyOf: ['createSales'] },
  { key: 'summary', icon: '📊', title: 'Summary', subtitle: 'Today’s sales figures', href: '/summary', anyOf: ['viewReports', 'managePOS', 'createSales'] },
  { key: 'inventory', icon: '📦', title: 'Stock', subtitle: 'Stock movements ledger', href: '/inventory', anyOf: ['manageInventory'] },
  { key: 'intake', icon: '📥', title: 'Stock intake', subtitle: 'Scan goods received', href: '/intake', anyOf: ['submitStockIntake'] },
  { key: 'approvals', icon: '✓', title: 'Approvals', subtitle: 'Requisitions & advances', href: '/approvals', anyOf: ['approveRequisitions', 'approveAdvances'] },
  { key: 'staff', icon: '👥', title: 'Staff', subtitle: 'Accounts, PINs, roles', href: '/staff', anyOf: ['manageUsers'] },
  { key: 'labels', icon: '🏷️', title: 'Labels', subtitle: 'Print barcode labels', href: '/labels', anyOf: ['manageItems', 'manageInventory', 'submitStockIntake', 'createSales'] },
  { key: 'printer', icon: '🖨️', title: 'Printers', subtitle: 'Receipt, label, kitchen', href: '/printer', anyOf: [] },
  { key: 'alerts', icon: '🔔', title: 'Alerts', subtitle: 'Notifications & preferences', href: '/alerts', anyOf: [] },
]

function visibleTiles(user: AuthUser | null | undefined): Tile[] {
  return TILES.filter((t) => t.anyOf.length === 0 || hasAnyPermission(user, t.anyOf))
}

export default function HomeScreen() {
  const headerPad = useHeaderPad()
  const bottomPad = useBottomPad(16)
  const { width } = useWindowDimensions()
  const [user, setUserState] = useState<AuthUser | null | undefined>(undefined)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (fromServer: boolean) => {
    const cached = await getUser()
    if (!cached) {
      router.replace('/login')
      return
    }
    setUserState(cached)
    if (fromServer) {
      const fresh = await refreshPermissions().catch(() => null)
      if (fresh) setUserState(fresh)
    }
  }, [])

  // Re-check permissions every time the hub is shown, so an owner's change applies quickly.
  useFocusEffect(
    useCallback(() => {
      load(true)
    }, [load])
  )

  const tiles = visibleTiles(user)
  // 2 columns on phones, 3 on large phones / small tablets, 4 on tablets.
  const contentWidth = Math.min(width, 900) - 32
  const cols = contentWidth >= 720 ? 4 : contentWidth >= 520 ? 3 : 2
  const tileWidth = Math.floor((contentWidth - (cols - 1) * 12) / cols)

  function confirmLogout() {
    Alert.alert('Sign out', 'Sign out of this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => logout() },
    ])
  }

  return (
    <View style={styles.safe}>
      <View style={[styles.header, headerPad]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.company} numberOfLines={1}>{user?.tenantName || 'skyERPOS'}</Text>
          {user?.businessId ? (
            <Text style={styles.businessId} numberOfLines={1}>Business ID {formatBusinessId(user.businessId)}</Text>
          ) : null}
        </View>
        <AlertsBell />
        <Pressable onPress={confirmLogout} style={styles.signOut} hitSlop={6}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      {user === undefined ? (
        <LoadingView />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 16 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true)
                await load(true)
                setRefreshing(false)
              }}
            />
          }
        >
          <View style={styles.whoCard}>
            <Text style={styles.whoName} numberOfLines={1}>{user?.name}</Text>
            <Text style={styles.whoRole} numberOfLines={2}>
              {displayRole(user)}
              {user?.customRoleName ? ' (custom role)' : ''}
            </Text>
            {!hasPermission(user, 'createSales') ? (
              <Text style={styles.whoNote}>Your role does not use the register. Pick a task below.</Text>
            ) : null}
          </View>

          {tiles.length === 0 ? (
            <EmptyView icon="🔒" title="Nothing assigned yet" subtitle="Your role has no mobile features enabled. Ask the owner to grant access." />
          ) : (
            <View style={styles.grid}>
              {tiles.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => router.push(t.href)}
                  style={({ pressed }) => [styles.tile, { width: tileWidth }, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.tileIcon}>{t.icon}</Text>
                  <Text style={styles.tileTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.tileSub} numberOfLines={2}>{t.subtitle}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  company: { fontSize: 17, fontWeight: '800', color: THEME.colors.primary },
  businessId: { fontSize: 11, fontFamily: 'monospace', color: THEME.colors.textMuted, marginTop: 2 },
  signOut: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: THEME.colors.border },
  signOutText: { fontSize: 12, fontWeight: '700', color: THEME.colors.error },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  whoCard: {
    backgroundColor: THEME.colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    marginBottom: 16,
  },
  whoName: { fontSize: 16, fontWeight: '800', color: THEME.colors.text },
  whoRole: { fontSize: 13, color: THEME.colors.textMuted, marginTop: 2 },
  whoNote: { fontSize: 12, color: THEME.colors.textSubtle, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    backgroundColor: THEME.colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    minHeight: 112,
  },
  tileIcon: { fontSize: 26, marginBottom: 8 },
  tileTitle: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  tileSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
})
