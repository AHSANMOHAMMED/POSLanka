// Business types console: every business type with its vendors, 30-day activity and sales, and
// whether the features new vendors start with were changed. Tap a type for its features × vendors.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { adminGet } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { EmptyView, ErrorView, LoadingView } from '../../src/components/StateViews'
import { Kpi, Pill, adminStyles, compactLKR, statusTone } from '../../src/components/admin/AdminShell'
import { MoreShell } from '../../src/components/admin/AdminForm'

interface TypeSummary {
  type: string
  label: string
  tenantCount: number
  statusCounts: Record<string, number>
  activeTenants30d: number
  netSales30d: number
  receipts30d: number
  enabledCounts: Record<string, number>
  preset: Record<string, boolean>
  presetOverridden: string[]
}

interface OverviewResponse {
  types: TypeSummary[]
  totals: { tenants: number; activeTenants30d: number; netSales30d: number }
  features: Array<{ key: string; label: string; group: string; businessTypes: string[] | null }>
  groups: string[]
  usageDays: number
}

export default function AdminBusinessTypesScreen() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    const res = await adminGet<OverviewResponse>('/api/sys-control/business-types')
    if (res.ok) setData(res.data)
    else setError(res.error)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Types with vendors first (most vendors on top); empty types stay listed so their presets can be set
  const types = useMemo(
    () => [...(data?.types || [])].sort((a, b) => b.tenantCount - a.tenantCount || b.netSales30d - a.netSales30d || a.label.localeCompare(b.label)),
    [data]
  )
  const days = data?.usageDays ?? 30

  return (
    <MoreShell title="Business types" subtitle={data ? `${types.length} types • ${data.totals.tenants} vendors` : 'Features & usage by type'}>
      {loading ? (
        <LoadingView text="Loading business types…" />
      ) : error && !data ? (
        <ErrorView message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={types}
          keyExtractor={(t) => t.type}
          contentContainerStyle={adminStyles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                load(true)
              }}
            />
          }
          ListHeaderComponent={
            data ? (
              <View style={[adminStyles.kpiGrid, { marginBottom: 4 }]}>
                <Kpi label="Vendors" value={String(data.totals.tenants)} tone="primary" />
                <Kpi label={`Active (${days} d)`} value={String(data.totals.activeTenants30d)} hint={data.totals.tenants > 0 ? `${Math.round((data.totals.activeTenants30d / data.totals.tenants) * 100)}% made a sale` : undefined} tone="ok" />
                <Kpi label={`Net sales (${days} d)`} value={compactLKR(data.totals.netSales30d)} />
                <Kpi label="Features" value={String(data.features.length)} hint={`${data.groups.length} groups`} />
              </View>
            ) : null
          }
          ListEmptyComponent={<EmptyView icon="🏷️" title="No business types" subtitle="The server returned no business types." />}
          renderItem={({ item }) => <TypeCard item={item} days={days} />}
        />
      )}
    </MoreShell>
  )
}

function TypeCard({ item, days }: { item: TypeSummary; days: number }) {
  const statuses = Object.entries(item.statusCounts || {}).sort((a, b) => b[1] - a[1])
  const featuresOnInPreset = Object.values(item.preset || {}).filter(Boolean).length
  const changed = item.presetOverridden?.length || 0
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      onPress={() => router.push({ pathname: '/admin/business-types/[type]', params: { type: item.type } } as any)}
      accessibilityRole="button"
      accessibilityLabel={`${item.label}, ${item.tenantCount} vendors`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.title} numberOfLines={1}>
            {item.label}
          </Text>
          <Text style={adminStyles.muted} numberOfLines={1}>
            {item.tenantCount} {item.tenantCount === 1 ? 'vendor' : 'vendors'} • {item.activeTenants30d} active ({days} d) • {item.receipts30d.toLocaleString()} receipts
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.sales}>{compactLKR(item.netSales30d)}</Text>
          <Text style={adminStyles.muted}>net {days} d</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
      {item.tenantCount > 0 ? (
        <View style={adminStyles.bar}>
          <View style={[adminStyles.barFill, { width: `${Math.round((item.activeTenants30d / item.tenantCount) * 100)}%`, backgroundColor: THEME.colors.tertiary }]} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {statuses.length === 0 ? <Pill text="no vendors" /> : statuses.map(([s, n]) => <Pill key={s} text={`${s} ${n}`} tone={statusTone(s)} />)}
        <Pill text={`${featuresOnInPreset} on for new`} tone="primary" />
      </View>
      {changed > 0 ? (
        <Text style={styles.changed}>
          {changed} {changed === 1 ? 'feature' : 'features'} changed for new vendors
        </Text>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: THEME.colors.border, padding: 14 },
  title: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  sales: { fontSize: 14, fontWeight: '900', color: THEME.colors.text, fontFamily: 'monospace' },
  chevron: { fontSize: 22, color: THEME.colors.textSubtle, fontWeight: '700', marginLeft: 8 },
  changed: { marginTop: 8, fontSize: 12, fontWeight: '700', color: THEME.colors.onSecondaryContainer },
})
