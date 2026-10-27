// Home tab: the business dashboard — greeting, shift status, today's KPIs, 7-day sales chart,
// quick actions and recent sales. Pull to refresh; skeletons while loading; offline aware.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Image, useWindowDimensions } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { formatBusinessId } from '../../src/lib/api'
import { displayRole, hasPermission } from '../../src/lib/roles'
import { THEME, formatLKR, compactLKR } from '../../src/lib/theme'
import { useHeaderPad } from '../../src/lib/safeArea'
import { useSessionUser } from '../../src/lib/session'
import { loadDashboard, saleCustomer, timeOf, type DashboardData, type DayPoint } from '../../src/lib/dashboard'
import { shiftCounterName, shiftWarehouseName, paymentMethodLabel } from '../../src/lib/shift'
import { subscribe as subscribeQueue, type QueueState } from '../../src/lib/offlineQueue'
import { AlertsBell } from '../../src/components/AlertsBell'
import { Banner, Card, EmptyState, IconBubble, KpiCard, ListItem, SectionHeader, Skeleton, uiStyles, type IconName, type Tone } from '../../src/components/ui'
import { canAny } from '../../src/lib/modules'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

interface QuickAction {
  key: string
  label: string
  icon: IconName
  tone: Tone
  anyOf: string[]
  go: () => void
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'sale', label: 'New sale', icon: 'cart', tone: 'primary', anyOf: ['createSales'], go: () => router.navigate('/pos') },
  { key: 'scan', label: 'Scan item', icon: 'barcode', tone: 'ok', anyOf: ['manageItems', 'manageInventory', 'submitStockIntake', 'createSales'], go: () => router.navigate({ pathname: '/items', params: { scan: String(Date.now()) } }) },
  { key: 'intake', label: 'Stock intake', icon: 'download', tone: 'warn', anyOf: ['submitStockIntake'], go: () => router.push('/intake') },
  { key: 'labels', label: 'Print labels', icon: 'pricetags', tone: 'primary', anyOf: ['manageItems', 'manageInventory', 'submitStockIntake', 'createSales'], go: () => router.push('/labels') },
]

export default function HomeScreen() {
  const headerPad = useHeaderPad(6)
  const { width } = useWindowDimensions()
  const { user, reload } = useSessionUser()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [queue, setQueue] = useState<QueueState | null>(null)
  const loadedAt = useRef(0)

  useEffect(() => subscribeQueue(setQueue), [])

  const load = useCallback(async (u = user) => {
    if (!u) return
    loadedAt.current = Date.now()
    const d = await loadDashboard(u).catch(() => null)
    if (d) setData(d)
    setLoading(false)
  }, [user])

  // Reload when the tab is shown (at most every 20 s) so figures follow the day.
  useFocusEffect(
    useCallback(() => {
      if (user && Date.now() - loadedAt.current > 20_000) load(user)
    }, [user, load])
  )

  async function onRefresh() {
    setRefreshing(true)
    const u = await reload(true)
    await load(u || user)
    setRefreshing(false)
  }

  const sells = hasPermission(user, 'createSales')
  const reports = hasPermission(user, 'viewReports')
  const actions = QUICK_ACTIONS.filter((a) => canAny(user, a.anyOf))
  const kpiWidth = Math.floor((Math.min(width, 900) - 32 - 10) / 2)
  const offline = !!data?.offline || queue?.online === false

  return (
    <View style={uiStyles.screen}>
      {/* Greeting header */}
      <View style={[styles.header, headerPad]}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} accessibilityLabel="skyERPOS" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.hello} numberOfLines={1}>
            {greeting()}
            {user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </Text>
          <Text style={styles.business} numberOfLines={1}>
            {user?.tenantName || 'skyERPOS'}
            {data?.shift ? ` · ${shiftWarehouseName(data.shift)}` : user?.businessId ? ` · ${user.tenantSlug || formatBusinessId(user.businessId)}` : ''}
          </Text>
        </View>
        <AlertsBell compact />
      </View>

      {offline ? <Banner text={`Offline — showing what this device knows${queue?.pending ? ` · ${queue.pending} sale(s) waiting to sync` : ''}`} /> : null}
      {!offline && queue && queue.pending + queue.rejected > 0 ? (
        <Banner
          tone={queue.rejected > 0 ? 'error' : 'warn'}
          icon="sync-outline"
          text={`${queue.pending} offline sale(s) syncing${queue.rejected ? ` · ${queue.rejected} need attention` : ''}`}
          onPress={() => router.navigate('/pos')}
        />
      ) : null}

      <ScrollView contentContainerStyle={[uiStyles.content, { paddingBottom: 28 }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[THEME.colors.primary]} />}>
        {/* Role line */}
        <View style={styles.roleRow}>
          <Ionicons name="person-circle-outline" size={16} color={THEME.colors.textMuted} />
          <Text style={styles.roleText} numberOfLines={1}>
            {displayRole(user)}
            {data?.scope === 'shift' ? ' · figures for your shift' : data?.scope === 'store' ? ' · store-wide figures' : ''}
          </Text>
        </View>

        {/* Shift status */}
        {sells ? <ShiftCard data={data} loading={loading} /> : null}

        {/* KPIs */}
        {loading && !data ? (
          <View style={styles.kpiGrid}>
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} style={[styles.kpiSkeleton, { width: kpiWidth }]}>
                <Skeleton width="60%" height={12} />
                <Skeleton width="80%" height={22} style={{ marginTop: 14 }} />
                <Skeleton width="40%" height={10} style={{ marginTop: 8 }} />
              </Card>
            ))}
          </View>
        ) : data?.today ? (
          <View style={styles.kpiGrid}>
            <KpiCard style={{ width: kpiWidth }} label="Sales today" value={compactLKR(data.today.sales)} hint={data.today.returns > 0 ? `Returns ${compactLKR(data.today.returns)}` : data.scope === 'shift' ? 'This shift' : 'Net of returns'} icon="trending-up" tone="primary" onPress={() => router.push('/summary')} />
            <KpiCard style={{ width: kpiWidth }} label="Transactions" value={String(data.today.count)} hint="Receipts today" icon="receipt-outline" tone="ok" onPress={() => router.push('/sales')} />
            <KpiCard style={{ width: kpiWidth }} label="Average sale" value={compactLKR(data.today.average)} hint="Per receipt" icon="calculator-outline" tone="primary" />
            {data.cashInDrawer !== null ? (
              <KpiCard style={{ width: kpiWidth }} label="Cash in drawer" value={compactLKR(data.cashInDrawer)} hint="Expected (est.)" icon="cash-outline" tone="warn" onPress={() => router.push('/shifts')} />
            ) : data.week ? (
              <KpiCard style={{ width: kpiWidth }} label="This week" value={compactLKR(data.week.sales)} hint={`${data.week.count} receipts`} icon="calendar-outline" tone="warn" />
            ) : null}
            {data.lowStock !== null ? (
              <KpiCard style={{ width: kpiWidth }} label="Low stock" value={String(data.lowStock)} hint={data.lowStock > 0 ? 'Items to reorder' : 'All good'} icon="alert-circle-outline" tone={data.lowStock > 0 ? 'error' : 'ok'} onPress={() => router.navigate('/items')} />
            ) : null}
            {data.pendingApprovals !== null ? (
              <KpiCard style={{ width: kpiWidth }} label="Approvals" value={String(data.pendingApprovals)} hint={data.pendingApprovals > 0 ? 'Waiting for you' : 'Nothing pending'} icon="checkmark-done-outline" tone={data.pendingApprovals > 0 ? 'warn' : 'ok'} onPress={() => router.push('/approvals')} />
            ) : null}
          </View>
        ) : data ? (
          <View style={styles.kpiGrid}>
            {data.lowStock !== null ? <KpiCard style={{ width: kpiWidth }} label="Low stock" value={String(data.lowStock)} hint="Items to reorder" icon="alert-circle-outline" tone={data.lowStock > 0 ? 'error' : 'ok'} onPress={() => router.navigate('/items')} /> : null}
            {data.pendingApprovals !== null ? <KpiCard style={{ width: kpiWidth }} label="Approvals" value={String(data.pendingApprovals)} hint="Pending" icon="checkmark-done-outline" tone="warn" onPress={() => router.push('/approvals')} /> : null}
          </View>
        ) : null}

        {/* 7-day chart */}
        {reports ? (
          <>
            <SectionHeader title="Last 7 days" actionLabel="Reports" onAction={() => router.navigate('/reports')} />
            <Card>{data?.days ? <WeekChart days={data.days} /> : loading ? <Skeleton height={140} /> : <Text style={styles.muted}>Chart unavailable {offline ? 'offline' : 'right now'}.</Text>}</Card>
          </>
        ) : null}

        {/* Quick actions */}
        {actions.length > 0 ? (
          <>
            <SectionHeader title="Quick actions" />
            <View style={styles.actions}>
              {actions.map((a) => (
                <Pressable key={a.key} onPress={a.go} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={a.label}>
                  <IconBubble name={a.icon} tone={a.tone} size={48} />
                  <Text style={styles.actionLabel} numberOfLines={2}>
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {/* Payment mix */}
        {data && data.paymentBreakdown.length > 0 ? (
          <>
            <SectionHeader title="Payments today" />
            <Card style={uiStyles.listCard}>
              {data.paymentBreakdown.map((p, i) => (
                <ListItem key={p.method} icon={p.method === 'cash' ? 'cash-outline' : p.method === 'card' ? 'card-outline' : 'swap-horizontal-outline'} title={paymentMethodLabel(p.method)} subtitle={`${p.count} receipts`} right={formatLKR(p.total)} last={i === data.paymentBreakdown.length - 1} />
              ))}
            </Card>
          </>
        ) : null}

        {/* Recent sales */}
        <SectionHeader title="Recent sales" actionLabel="See all" onAction={() => router.push('/sales')} />
        <Card style={uiStyles.listCard}>
          {loading && !data ? (
            <View style={{ padding: 14, gap: 14 }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={34} />
              ))}
            </View>
          ) : !data || data.recent.length === 0 ? (
            <EmptyState icon={offline ? 'cloud-offline-outline' : 'receipt-outline'} title={offline ? 'Offline' : 'No sales yet'} subtitle={offline ? 'Recent sales show when the device is back online.' : 'Sales made today appear here.'} actionLabel={sells && !offline ? 'Start selling' : undefined} onAction={() => router.navigate('/pos')} />
          ) : (
            data.recent.map((s, i) => (
              <ListItem
                key={s.id}
                icon={s.isReturn ? 'return-down-back-outline' : 'receipt-outline'}
                iconTone={s.isReturn ? 'error' : s.status === 'void' ? 'muted' : 'ok'}
                title={s.invoiceNo}
                subtitle={`${saleCustomer(s)} · ${timeOf(s.createdAt)}${s.status === 'void' ? ' · void' : ''}`}
                right={<Text style={[styles.amount, s.isReturn && { color: THEME.colors.error }]}>{formatLKR(s.total)}</Text>}
                onPress={() => router.push({ pathname: '/sales', params: { q: s.invoiceNo } })}
                last={i === data.recent.length - 1}
              />
            ))
          )}
        </Card>

        {data && data.problems.length > 0 ? <Text style={[styles.muted, { marginTop: 12 }]}>{data.problems.join('\n')}</Text> : null}
      </ScrollView>
    </View>
  )
}

function ShiftCard({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  if (loading && !data) {
    return (
      <Card style={{ marginBottom: 12 }}>
        <Skeleton width="50%" height={14} />
        <Skeleton width="70%" height={10} style={{ marginTop: 10 }} />
      </Card>
    )
  }
  const shift = data?.shift
  if (!shift) {
    return (
      <Card style={[styles.shiftCard, { borderColor: THEME.colors.secondaryContainer }]} onPress={() => router.push('/shifts')}>
        <IconBubble name="lock-closed-outline" tone="warn" size={44} />
        <View style={{ flex: 1 }}>
          <Text style={styles.shiftTitle}>No open shift</Text>
          <Text style={styles.muted}>Open a shift to start selling</Text>
        </View>
        <View style={styles.shiftBtn}>
          <Text style={styles.shiftBtnText}>Open</Text>
        </View>
      </Card>
    )
  }
  const since = new Date(shift.openingTime)
  return (
    <Card style={styles.shiftCard} onPress={() => router.navigate('/pos')}>
      <IconBubble name="storefront-outline" tone="ok" size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.shiftTitle} numberOfLines={1}>
          Shift open · {shiftCounterName(shift) || 'Counter'}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {shiftWarehouseName(shift)}
          {isNaN(since.getTime()) ? '' : ` · since ${since.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
          {data?.shiftOffline ? ' · offline' : ''}
        </Text>
      </View>
      <View style={[styles.shiftBtn, { backgroundColor: THEME.colors.primary }]}>
        <Text style={[styles.shiftBtnText, { color: THEME.colors.onPrimary }]}>Sell</Text>
      </View>
    </Card>
  )
}

/** Plain-View bar chart of the last 7 days (no chart library). */
function WeekChart({ days }: { days: DayPoint[] }) {
  const max = Math.max(1, ...days.map((d) => d.total))
  const total = days.reduce((s, d) => s + d.total, 0)
  const todayKey = days[days.length - 1]?.date
  return (
    <View>
      <View style={styles.chartHead}>
        <Text style={styles.chartTotal}>{formatLKR(total)}</Text>
        <Text style={styles.muted}>{days.reduce((s, d) => s + d.count, 0)} receipts</Text>
      </View>
      <View style={styles.chart} accessibilityLabel={`Sales for the last 7 days, total ${formatLKR(total)}`}>
        {days.map((d) => {
          const h = Math.max(3, Math.round((d.total / max) * 110))
          const isToday = d.date === todayKey
          const label = new Date(`${d.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
          return (
            <View key={d.date} style={styles.barCol}>
              <Text style={styles.barValue} numberOfLines={1}>
                {d.total > 0 ? compactLKR(d.total).replace('LKR ', '') : ''}
              </Text>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { height: h, backgroundColor: isToday ? THEME.colors.secondaryAmber : THEME.colors.primary }]} />
              </View>
              <Text style={[styles.barLabel, isToday && { color: THEME.colors.text, fontWeight: '800' }]}>{isToday ? 'Today' : label}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: THEME.colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.colors.borderStrong },
  logo: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: THEME.colors.border },
  hello: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  business: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 1 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  roleText: { fontSize: 12, color: THEME.colors.textMuted, flex: 1 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiSkeleton: { minHeight: 96 },
  shiftCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  shiftTitle: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  shiftBtn: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: THEME.colors.secondaryLight, alignItems: 'center', justifyContent: 'center' },
  shiftBtnText: { fontSize: 14, fontWeight: '800', color: THEME.colors.onSecondaryContainer },
  muted: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  action: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 14, backgroundColor: THEME.colors.card, borderWidth: 1, borderColor: THEME.colors.border, minHeight: 96 },
  actionLabel: { fontSize: 12, fontWeight: '700', color: THEME.colors.text, textAlign: 'center' },
  amount: { fontSize: 14, fontWeight: '800', color: THEME.colors.text, fontVariant: ['tabular-nums'] },
  chartHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  chartTotal: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 150 },
  barCol: { flex: 1, alignItems: 'center' },
  barValue: { fontSize: 9, color: THEME.colors.textMuted, marginBottom: 3 },
  barTrack: { height: 110, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  bar: { width: '58%', borderRadius: 6, minHeight: 3 },
  barLabel: { fontSize: 10, color: THEME.colors.textMuted, marginTop: 5 },
})
