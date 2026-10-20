import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native'
import { router } from 'expo-router'
import { adminGet } from '../../src/lib/adminApi'
import { THEME, formatLKR } from '../../src/lib/theme'
import { LoadingView, ErrorView, InlineNotice } from '../../src/components/StateViews'
import { AdminShell, Card, Kpi, ListRow, Pill, SectionTitle, adminStyles, businessTypeLabel, compactLKR } from '../../src/components/admin/AdminShell'

type Range = 'today' | '7d' | '30d'

interface PlatformStats {
  overview: {
    totalAccounts: number
    totalCompanies: number
    activeSubscriptions: number
    trialSubscriptions: number
    pendingPayments: number
    newSignupsThisWeek: number
    newCompaniesThisWeek: number
    totalRevenue: number
    monthlyRevenue: number
  }
  subscriptionsByStatus: Record<string, number>
  tenantsByType: Record<string, number>
  recentCompanies: Array<{ id: string; name: string; slug: string; businessType: string; createdAt: string }>
  expiringTrials: Array<{ id: string; trialEndsAt: string; tenant?: { name: string; slug: string } | null }>
}

interface SalesAnalytics {
  range: Range
  totals: { netSales: number; grossSales: number; returns: number; receipts: number; avgBasket: number; voids: number }
  byDay: Array<{ date: string; netSales: number; receipts: number }>
  byBusinessType: Array<{ businessType: string; netSales: number; receipts: number }>
  topVendors: Array<{ tenantId: string; name: string; slug: string; netSales: number; receipts: number }>
  topBranches: Array<{ tenantId: string; tenantName: string; warehouseName: string; netSales: number; receipts: number }>
  openShifts: { count: number; byVendor: Array<{ tenantId: string; name: string; count: number }> }
}

const RANGE_LABELS: Record<Range, string> = { today: 'Today', '7d': '7 days', '30d': '30 days' }

export default function AdminPulseScreen() {
  const [range, setRange] = useState<Range>('today')
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [sales, setSales] = useState<SalesAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(null)
      setNotice(null)
      const [statsRes, salesRes] = await Promise.all([
        adminGet<PlatformStats>('/api/sys-control/stats'),
        adminGet<SalesAnalytics>(`/api/sys-control/analytics/sales?range=${range}`),
      ])
      const problems: string[] = []
      if (statsRes.ok) setStats(statsRes.data)
      else problems.push(`Platform stats: ${statsRes.error}`)
      if (salesRes.ok) setSales(salesRes.data)
      else problems.push(`Sales analytics: ${salesRes.error}`)
      if (!statsRes.ok && !salesRes.ok) setError(problems.join('\n'))
      else if (problems.length) setNotice(problems.join('\n'))
      setLoading(false)
      setRefreshing(false)
    },
    [range]
  )

  useEffect(() => {
    load()
  }, [load])

  const typeTotal = sales?.byBusinessType.reduce((s, t) => s + t.netSales, 0) || 0
  const topVendorMax = sales?.topVendors[0]?.netSales || 0

  return (
    <AdminShell title="Platform Pulse" tab="pulse">
      {loading ? (
        <LoadingView text="Loading platform figures…" />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load()} />
      ) : (
        <ScrollView
          style={adminStyles.scroll}
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
        >
          {notice ? <InlineNotice text={notice} tone="warn" /> : null}

          <View style={adminStyles.segment}>
            {(['today', '7d', '30d'] as Range[]).map((r) => (
              <Pressable key={r} style={[adminStyles.segmentBtn, range === r && adminStyles.segmentBtnActive]} onPress={() => setRange(r)}>
                <Text style={[adminStyles.segmentText, range === r && adminStyles.segmentTextActive]}>{RANGE_LABELS[r]}</Text>
              </Pressable>
            ))}
          </View>

          {sales ? (
            <View style={adminStyles.kpiGrid}>
              <Kpi label={`Net sales · ${RANGE_LABELS[range]}`} value={compactLKR(sales.totals.netSales)} hint={`${sales.totals.receipts} receipts`} tone="primary" />
              <Kpi label="Avg basket" value={compactLKR(sales.totals.avgBasket)} hint={`Gross ${compactLKR(sales.totals.grossSales)}`} />
              <Kpi label="Returns" value={compactLKR(sales.totals.returns)} hint={`${sales.totals.voids} voids`} tone={sales.totals.returns > 0 ? 'warn' : undefined} />
              <Kpi label="Open shifts" value={String(sales.openShifts.count)} hint={`${sales.openShifts.byVendor.length} vendors trading`} tone="ok" />
            </View>
          ) : null}

          {stats ? (
            <>
              <SectionTitle>Platform</SectionTitle>
              <View style={adminStyles.kpiGrid}>
                <Kpi label="Companies" value={String(stats.overview.totalCompanies)} hint={`+${stats.overview.newCompaniesThisWeek} this week`} />
                <Kpi label="Accounts" value={String(stats.overview.totalAccounts)} hint={`+${stats.overview.newSignupsThisWeek} signups this week`} />
                <Kpi label="Active subs" value={String(stats.overview.activeSubscriptions)} hint={`${stats.overview.trialSubscriptions} on trial`} tone="ok" />
                <Kpi
                  label="Pending payments"
                  value={String(stats.overview.pendingPayments)}
                  hint="Tap Approvals to review"
                  tone={stats.overview.pendingPayments > 0 ? 'warn' : undefined}
                />
                <Kpi label="Revenue (month)" value={compactLKR(stats.overview.monthlyRevenue)} hint={`Lifetime ${compactLKR(stats.overview.totalRevenue)}`} tone="primary" />
              </View>
            </>
          ) : null}

          {sales ? (
            <>
              <SectionTitle>Sales by business type</SectionTitle>
              <Card>
                {sales.byBusinessType.length === 0 ? (
                  <Text style={adminStyles.empty}>No sales in this range.</Text>
                ) : (
                  sales.byBusinessType.map((t) => {
                    const pct = typeTotal > 0 ? Math.round((t.netSales / typeTotal) * 100) : 0
                    return (
                      <View key={t.businessType} style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.colors.border }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: THEME.colors.text }}>
                            {businessTypeLabel(t.businessType)}
                            {stats?.tenantsByType?.[t.businessType] ? ` · ${stats.tenantsByType[t.businessType]} vendors` : ''}
                          </Text>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: THEME.colors.text, fontFamily: 'monospace' }}>{formatLKR(t.netSales)}</Text>
                        </View>
                        <Text style={adminStyles.muted}>
                          {t.receipts} receipts • {pct}%
                        </Text>
                        <View style={adminStyles.bar}>
                          <View style={[adminStyles.barFill, { width: `${pct}%` }]} />
                        </View>
                      </View>
                    )
                  })
                )}
              </Card>

              <SectionTitle>Top vendors</SectionTitle>
              <Card>
                {sales.topVendors.length === 0 ? (
                  <Text style={adminStyles.empty}>No vendor sales in this range.</Text>
                ) : (
                  sales.topVendors.map((v, idx) => (
                    <Pressable key={v.tenantId} onPress={() => router.push({ pathname: '/admin/vendors/[id]', params: { id: v.tenantId } } as any)}>
                      <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.colors.border }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: THEME.colors.text, flex: 1 }} numberOfLines={1}>
                            {idx + 1}. {v.name}
                          </Text>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: THEME.colors.text, fontFamily: 'monospace' }}>{formatLKR(v.netSales)}</Text>
                        </View>
                        <Text style={adminStyles.muted}>
                          {v.slug} • {v.receipts} receipts
                        </Text>
                        <View style={adminStyles.bar}>
                          <View style={[adminStyles.barFill, { width: `${topVendorMax > 0 ? Math.max(3, Math.round((v.netSales / topVendorMax) * 100)) : 0}%` }]} />
                        </View>
                      </View>
                    </Pressable>
                  ))
                )}
              </Card>

              {sales.topBranches.length > 0 ? (
                <>
                  <SectionTitle>Top branches</SectionTitle>
                  <Card>
                    {sales.topBranches.slice(0, 5).map((b, idx) => (
                      <ListRow key={`${b.tenantId}-${b.warehouseName}-${idx}`} title={`${b.tenantName} · ${b.warehouseName}`} subtitle={`${b.receipts} receipts`} right={formatLKR(b.netSales)} />
                    ))}
                  </Card>
                </>
              ) : null}
            </>
          ) : null}

          {stats && stats.expiringTrials.length > 0 ? (
            <>
              <SectionTitle>Trials expiring this week</SectionTitle>
              <Card>
                {stats.expiringTrials.map((t) => (
                  <ListRow
                    key={t.id}
                    title={t.tenant?.name || 'Unknown company'}
                    subtitle={t.tenant?.slug || ''}
                    right={<Pill text={new Date(t.trialEndsAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} tone="warn" />}
                  />
                ))}
              </Card>
            </>
          ) : null}

          {stats && stats.recentCompanies.length > 0 ? (
            <>
              <SectionTitle>Recently onboarded</SectionTitle>
              <Card>
                {stats.recentCompanies.slice(0, 6).map((c) => (
                  <ListRow
                    key={c.id}
                    title={c.name}
                    subtitle={`${c.slug} • ${businessTypeLabel(c.businessType)}`}
                    right={new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    onPress={() => router.push({ pathname: '/admin/vendors/[id]', params: { id: c.id } } as any)}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
    </AdminShell>
  )
}
