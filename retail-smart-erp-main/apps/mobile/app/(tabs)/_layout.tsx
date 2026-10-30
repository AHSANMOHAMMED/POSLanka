// Vendor app bottom navigation: Home (dashboard) · Sell (register) · Items · Reports · More.
// Tabs stay mounted, so a half-built cart survives a trip to the dashboard. Every other screen is
// pushed on the root stack above the tabs (full screen, header with back arrow).
import React, { useEffect, useState } from 'react'
import { Redirect, Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { THEME } from '../../src/lib/theme'
import { IS_ADMIN_APP } from '../../src/lib/appVariant'
import { useSessionUser } from '../../src/lib/session'
import { canAny } from '../../src/lib/modules'
import { isBackOffice } from '../../src/lib/roles'
import { subscribe as subscribeQueue } from '../../src/lib/offlineQueue'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

function tabIcon(active: IoniconName, idle: IoniconName) {
  // eslint-disable-next-line react/display-name
  return ({ color, focused, size }: { color: string; focused: boolean; size: number }) => (
    <Ionicons name={focused ? active : idle} color={color} size={Math.min(size, 24)} />
  )
}

const SELL_PERMS = ['createSales'] as const
const ITEMS_PERMS = ['manageItems', 'manageInventory', 'submitStockIntake', 'createSales'] as const
const REPORT_PERMS = ['viewReports', 'managePOS', 'createSales'] as const

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  const { user } = useSessionUser()
  const [pending, setPending] = useState(0)

  useEffect(() => subscribeQueue((s) => setPending(s.pending + s.rejected)), [])

  if (IS_ADMIN_APP) return <Redirect href="/admin/pulse" />
  if (user === null) return <Redirect href="/login" />

  // Owners / managers run the business from Home; the till (Sell) is for cashier accounts
  const canSell = !!user && canAny(user, SELL_PERMS) && !isBackOffice(user)
  const canItems = !!user && canAny(user, ITEMS_PERMS)
  const canReports = !!user && canAny(user, REPORT_PERMS)

  return (
    <Tabs
      backBehavior="firstRoute"
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: THEME.colors.primary,
        tabBarInactiveTintColor: THEME.colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 1 },
        tabBarStyle: {
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 6),
          backgroundColor: THEME.colors.card,
          borderTopColor: THEME.colors.border,
        },
        tabBarItemStyle: { minHeight: 48 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: tabIcon('home', 'home-outline') }} />
      <Tabs.Screen
        name="pos"
        options={{
          title: 'Sell',
          href: canSell ? '/pos' : null,
          tabBarIcon: tabIcon('cart', 'cart-outline'),
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: THEME.colors.secondaryAmber, fontSize: 10 },
        }}
      />
      <Tabs.Screen name="items" options={{ title: 'Items', href: canItems ? '/items' : null, tabBarIcon: tabIcon('cube', 'cube-outline') }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', href: canReports ? '/reports' : null, tabBarIcon: tabIcon('bar-chart', 'bar-chart-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('grid', 'grid-outline') }} />
    </Tabs>
  )
}
