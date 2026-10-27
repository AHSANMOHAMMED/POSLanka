// Reports tab: sales by period (today / week / month), this month's profit + stock value for
// owners / managers, top items, and the report screens (summary, sales history, money out, web).
//   GET /api/sales/dashboard-stats   viewReports
//   GET /api/dashboard/owner         viewReports (profit, stock value, cheques, expiring batches)
import React, { useCallback, useRef, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, useWindowDimensions } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { apiGet, isNetworkError } from '../../src/lib/api'
import { hasPermission } from '../../src/lib/roles'
import { THEME, formatLKR, compactLKR } from '../../src/lib/theme'
import { useSessionUser } from '../../src/lib/session'
import { useFeatureFlags } from '../../src/lib/features'
import { openWeb, visibleFeatures } from '../../src/lib/modules'
import { paymentMethodLabel } from '../../src/lib/shift'
import { Banner, Card, KpiCard, ListItem, ScreenHeader, SectionHeader, Skeleton, uiStyles } from '../../src/components/ui'

type Period = 'today' | 'week' | 'month'
const PERIOD_LABEL: Record<Period, string> = { today: 'Today', week: 'This week', month: 'This month' }

interface Stats {
  today: { totalSales: number; netSales: number; totalReturns: number; transactionCount: number; returnCount: number }
  week: { totalSales: number; netSales: number; transactionCount: number }
  month: { totalSales: number; netSales: number; transactionCount: number }
  paymentBreakdown: Array<{ method: string | null; count: number; total: string | number }>
}

interface Owner {
  period?: { fromDate: string; toDate: string }
  stock?: { atCost: number; atSellingPrice: number; potentialMargin: number }
  profit?: { revenue: number; costOfGoods: number; grossProfit: number; marginPercent: number | null; topItems: Array<{ itemId: string; name: string; quantity: number; revenue: number; profit: number }> }
  cheques?: { next7Days: { received: { count: number; amount: number }; issued: { count: number; amount: number } }; overdue: { count: number; amount: number }; bounced: { count: number; amount: number } }
  expiring?: { next30Days: { count: number; valueAtCost: number }; expired: { count: number } }
}

export default function ReportsTab() {
  const { user } = useSessionUser()
  const features = useFeatureFlags()
  const { width } = useWindowDimensions()
  const [period, setPeriod] = useState<Period>('today')
  const [stats, setStats] = useState<Stats | null>(null)
  const [owner, setOwner] = useState<Owner | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offline, setOffline] = useState(false)
  const loadedAt = useRef(0)
  const reports = hasPermission(user, 'viewReports')

  const load = useCallback(async () => {
    if (!reports) {
      setLoading(false)
      return
    }
    loadedAt.current = Date.now()
    const [s, o] = await Promise.all([apiGet<Stats>('/api/sales/dashboard-stats'), apiGet<Owner>('/api/dashboard/owner?topItems=5')])
    if (s.ok) setStats(s.data)
    if (o.ok) setOwner(o.data)
    setOffline(isNetworkError(s))
    setLoading(false)
  }, [reports])

  useFocusEffect(
    useCallback(() => {
      if (user !== undefined && Date.now() - loadedAt.current > 30_000) load()
    }, [user, load])
  )

  const links = visibleFeatures(user, features.has, ['reports']).concat(visibleFeatures(user, features.has, ['sell']).filter((f) => f.key === 'sales' || f.key === 'money'))
  const half = Math.floor((Math.min(width, 900) - 32 - 10) / 2)
  const p = stats ? (period === 'today' ? stats.today : stats[period]) : null
  const count = p?.transactionCount || 0

  return (
    <View style={uiStyles.screen}>
      <ScreenHeader title="Reports" subtitle={user?.tenantName} back={false} />
      {offline ? <Banner text="Offline — figures could not be refreshed" /> : null}
      <ScrollView
        contentContainerStyle={[uiStyles.content, { paddingBottom: 28 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            colors={[THEME.colors.primary]}
            onRefresh={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
          />
        }
      >
        {reports ? (
          <>
            <View style={styles.segment} accessibilityRole="tablist">
              {(['today', 'week', 'month'] as Period[]).map((k) => (
                <Pressable key={k} onPress={() => setPeriod(k)} style={[styles.segBtn, period === k && styles.segBtnActive]} accessibilityRole="tab" accessibilityState={{ selected: period === k }}>
                  <Text style={[styles.segText, period === k && styles.segTextActive]}>{PERIOD_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>

            {loading && !stats ? (
              <View style={styles.grid}>
                {[0, 1, 2, 3].map((i) => (
                  <Card key={i} style={{ width: half, minHeight: 96 }}>
                    <Skeleton width="50%" height={12} />
                    <Skeleton width="80%" height={22} style={{ marginTop: 14 }} />
                  </Card>
                ))}
              </View>
            ) : p ? (
              <View style={styles.grid}>
                <KpiCard style={{ width: half }} label="Net sales" value={compactLKR(p.netSales)} hint={`Gross ${compactLKR(p.totalSales)}`} icon="trending-up" />
                <KpiCard style={{ width: half }} label="Receipts" value={String(count)} hint={PERIOD_LABEL[period]} icon="receipt-outline" tone="ok" />
                <KpiCard style={{ width: half }} label="Average sale" value={compactLKR(count ? p.totalSales / count : 0)} hint="Per receipt" icon="calculator-outline" />
                {period === 'today' && stats ? (
                  <KpiCard style={{ width: half }} label="Returns" value={compactLKR(stats.today.totalReturns)} hint={`${stats.today.returnCount} returns`} icon="return-down-back-outline" tone={stats.today.totalReturns > 0 ? 'error' : 'muted'} />
                ) : owner?.profit && period === 'month' ? (
                  <KpiCard style={{ width: half }} label="Gross profit" value={compactLKR(owner.profit.grossProfit)} hint={owner.profit.marginPercent != null ? `${owner.profit.marginPercent}% margin` : 'This month'} icon="pie-chart-outline" tone="ok" />
                ) : (
                  <KpiCard style={{ width: half }} label="Month to date" value={compactLKR(stats?.month.netSales)} hint={`${stats?.month.transactionCount ?? 0} receipts`} icon="calendar-outline" tone="warn" />
                )}
              </View>
            ) : null}

            {period === 'today' && stats && stats.paymentBreakdown.length > 0 ? (
              <>
                <SectionHeader title="Payments today" />
                <Card>
                  {(() => {
                    const total = stats.paymentBreakdown.reduce((s, x) => s + Number(x.total || 0), 0) || 1
                    return stats.paymentBreakdown.map((x) => {
                      const pct = Math.round((Number(x.total || 0) / total) * 100)
                      return (
                        <View key={x.method || 'cash'} style={{ marginBottom: 10 }}>
                          <View style={styles.barHead}>
                            <Text style={styles.barName}>{paymentMethodLabel(x.method || 'cash')}</Text>
                            <Text style={styles.barAmt}>
                              {formatLKR(x.total)} · {pct}%
                            </Text>
                          </View>
                          <View style={styles.track}>
                            <View style={[styles.fill, { width: `${Math.max(2, pct)}%` }]} />
                          </View>
                        </View>
                      )
                    })
                  })()}
                </Card>
              </>
            ) : null}

            {owner ? (
              <>
                <SectionHeader title="This month" />
                <Card style={uiStyles.listCard}>
                  {owner.profit ? <ListItem icon="pie-chart-outline" iconTone="ok" title="Gross profit" subtitle={`Revenue ${formatLKR(owner.profit.revenue)} · cost ${formatLKR(owner.profit.costOfGoods)}`} right={formatLKR(owner.profit.grossProfit)} /> : null}
                  {owner.stock ? <ListItem icon="cube-outline" title="Stock value (cost)" subtitle={`At selling price ${formatLKR(owner.stock.atSellingPrice)}`} right={formatLKR(owner.stock.atCost)} /> : null}
                  {owner.cheques ? (
                    <ListItem
                      icon="document-text-outline"
                      iconTone={owner.cheques.overdue.count + owner.cheques.bounced.count > 0 ? 'error' : 'warn'}
                      title="Cheques due in 7 days"
                      subtitle={`${owner.cheques.overdue.count} overdue · ${owner.cheques.bounced.count} bounced`}
                      right={String(owner.cheques.next7Days.received.count + owner.cheques.next7Days.issued.count)}
                      onPress={() => router.push('/money')}
                    />
                  ) : null}
                  {owner.expiring ? <ListItem icon="hourglass-outline" iconTone={owner.expiring.expired.count > 0 ? 'error' : 'warn'} title="Batches expiring in 30 days" subtitle={`${owner.expiring.expired.count} already expired`} right={String(owner.expiring.next30Days.count)} last /> : null}
                </Card>

                {owner.profit && owner.profit.topItems.length > 0 ? (
                  <>
                    <SectionHeader title="Top items this month" />
                    <Card style={uiStyles.listCard}>
                      {owner.profit.topItems.map((t, i) => (
                        <ListItem key={t.itemId} icon="star-outline" iconTone="warn" title={`${i + 1}. ${t.name}`} subtitle={`${t.quantity} sold · profit ${formatLKR(t.profit)}`} right={compactLKR(t.revenue)} last={i === owner.profit!.topItems.length - 1} />
                      ))}
                    </Card>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        <SectionHeader title="Reports & records" />
        <Card style={uiStyles.listCard}>
          {links.map((f, i) => (
            <ListItem
              key={f.key}
              icon={f.icon}
              iconTone={f.tone}
              title={f.title}
              subtitle={f.webPath && !f.route ? `${f.subtitle} (opens browser)` : f.subtitle}
              onPress={() => (f.route ? router.push(f.route as any) : f.webPath ? openWeb(user, f.webPath) : undefined)}
              last={i === links.length - 1}
            />
          ))}
        </Card>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: THEME.colors.surfaceContainer, borderRadius: 12, padding: 4, marginBottom: 12 },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segBtnActive: { backgroundColor: THEME.colors.card, ...THEME.shadow },
  segText: { fontSize: 13, fontWeight: '700', color: THEME.colors.textMuted },
  segTextActive: { color: THEME.colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barName: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  barAmt: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted },
  track: { height: 8, borderRadius: 4, backgroundColor: THEME.colors.surfaceContainer, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: THEME.colors.primary },
})
