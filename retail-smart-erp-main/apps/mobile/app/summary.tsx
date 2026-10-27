import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native'
import { router } from 'expo-router'
import { apiGet, asList, getUser, qs, type AuthUser } from '../src/lib/api'
import { hasPermission, hasAnyPermission, displayRole } from '../src/lib/roles'
import { fetchCurrentShift, paymentMethodLabel, shiftCounterName, shiftWarehouseName, type Shift } from '../src/lib/shift'
import { THEME, formatLKR } from '../src/lib/theme'
import { LoadingView, ErrorView, InlineNotice, EmptyView } from '../src/components/StateViews'
import { useHeaderPad } from '../src/lib/safeArea'
import { goBack } from '../src/lib/nav'
import { ScreenHeader, IconButton, Badge } from '../src/components/ui'

interface DashboardStats {
  today: { totalSales: number; totalReturns: number; netSales: number; transactionCount: number; returnCount: number; pendingCount: number }
  week: { totalSales: number; netSales: number; transactionCount: number }
  month: { totalSales: number; netSales: number; transactionCount: number }
  paymentBreakdown: Array<{ method: string | null; count: number; total: string | number }>
}

interface DailySummary {
  date: string
  totalShifts: number
  summary: { totalSales: number; totalReturns: number; netSales: number; totalTransactions: number; totalVariance: number }
  paymentMethodBreakdown: Array<{ paymentMethod: string; openingAmount: number; expectedAmount: number; actualAmount: number; variance: number }>
  shifts: Array<{ id: string; entryNumber?: string; posProfile?: { name: string } | null; user?: { name: string } | null; netSales: number; totalTransactions: number; closingTime?: string }>
}

interface SaleRow {
  id: string
  invoiceNo: string
  total: string | number
  /** GET /api/sales rows carry the sales table columns: taxAmount / discountAmount */
  taxAmount?: string | number
  discountAmount?: string | number
  tax?: string | number
  discount?: string | number
  paymentMethod?: string | null
  status: string
  isReturn?: boolean
  posOpeningEntryId?: string | null
  createdAt: string
  payments?: Array<{ method: string; amount: string | number }>
}

interface ShiftStats {
  gross: number
  returns: number
  net: number
  count: number
  tax: number
  discounts: number
  byMethod: Array<{ method: string; amount: number; count: number }>
  truncated: boolean
}

function todayISO() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function aggregateShiftSales(rows: SaleRow[], shiftId: string, truncated: boolean): ShiftStats {
  const mine = rows.filter((s) => s.posOpeningEntryId === shiftId && s.status !== 'void')
  let gross = 0
  let returns = 0
  let tax = 0
  let discounts = 0
  let count = 0
  const byMethod = new Map<string, { amount: number; count: number }>()
  for (const s of mine) {
    const total = Number(s.total) || 0
    if (s.isReturn) {
      returns += Math.abs(total)
      continue
    }
    gross += total
    tax += Number(s.taxAmount ?? s.tax) || 0
    discounts += Number(s.discountAmount ?? s.discount) || 0
    count += 1
    const splits = s.payments && s.payments.length ? s.payments : [{ method: s.paymentMethod || 'cash', amount: total }]
    for (const p of splits) {
      const key = p.method || 'cash'
      const cur = byMethod.get(key) || { amount: 0, count: 0 }
      cur.amount += Number(p.amount) || 0
      cur.count += 1
      byMethod.set(key, cur)
    }
  }
  return {
    gross,
    returns,
    net: gross - returns,
    count,
    tax,
    discounts,
    byMethod: Array.from(byMethod.entries()).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount),
    truncated,
  }
}

export default function ManagerDailySummaryScreen() {
  const headerPad = useHeaderPad()
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [shift, setShift] = useState<Shift | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [daily, setDaily] = useState<DailySummary | null>(null)
  const [shiftStats, setShiftStats] = useState<ShiftStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    const u = await getUser()
    setUser(u)
    if (!silent) setLoading(true)
    setError(null)
    setNotice(null)

    // Only call what the role may use (server enforces the same permissions):
    // dashboard-stats → viewReports, pos-daily-summary → managePOS, own shift → createSales.
    const wantsReports = hasPermission(u, 'viewReports')
    const wantsDaily = hasPermission(u, 'managePOS')
    const wantsShift = hasPermission(u, 'createSales')
    if (!wantsReports && !wantsDaily && !wantsShift) {
      setLoading(false)
      setRefreshing(false)
      return
    }
    const [shiftRes, statsRes, dailyRes] = await Promise.all([
      wantsShift ? fetchCurrentShift() : Promise.resolve(null),
      wantsReports ? apiGet<DashboardStats>('/api/sales/dashboard-stats') : Promise.resolve(null),
      wantsDaily ? apiGet<DailySummary>(`/api/pos-daily-summary${qs({ date: todayISO() })}`) : Promise.resolve(null),
    ])

    const currentShift = shiftRes && shiftRes.ok ? shiftRes.data.shift : null
    setShift(currentShift)

    let anyOk = false
    const problems: string[] = []

    if (statsRes) {
      if (statsRes.ok) {
        setStats(statsRes.data)
        anyOk = true
      } else {
        setStats(null)
        if (statsRes.status !== 403) problems.push(`Store totals: ${statsRes.error}`)
      }
    } else {
      setStats(null)
    }

    if (dailyRes && dailyRes.ok) {
      setDaily(dailyRes.data)
      anyOk = true
    } else {
      setDaily(null)
      if (dailyRes && dailyRes.status !== 403) problems.push(`Daily summary: ${dailyRes.error}`)
    }

    // Cashiers (no viewReports) see their own open shift's figures from /api/sales.
    if (currentShift) {
      const salesRes = await apiGet<any>(`/api/sales${qs({ page: 1, pageSize: 100 })}`)
      if (salesRes.ok) {
        const rows = asList<SaleRow>(salesRes.data)
        const totalPages = salesRes.data?.pagination?.totalPages || 1
        setShiftStats(aggregateShiftSales(rows, currentShift.id, totalPages > 1))
        anyOk = true
      } else {
        setShiftStats(null)
        problems.push(`Shift sales: ${salesRes.error}`)
      }
    } else {
      setShiftStats(null)
      if (!shiftRes || shiftRes.ok) anyOk = true
      else problems.push(`Shift: ${shiftRes.error}`)
    }

    if (!anyOk && problems.length) setError(problems.join('\n'))
    else if (problems.length) setNotice(problems.join('\n'))

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const avgBasket = stats && stats.today.transactionCount > 0 ? stats.today.totalSales / stats.today.transactionCount : 0
  const shiftAvg = shiftStats && shiftStats.count > 0 ? shiftStats.gross / shiftStats.count : 0

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title={stats ? 'Daily summary' : 'My shift summary'}
        subtitle={`${user?.tenantName || ''} • ${todayISO()}`}
        right={user ? <Badge text={displayRole(user)} tone="primary" /> : undefined}
      />

      {user && !hasAnyPermission(user, ['viewReports', 'managePOS', 'createSales']) ? (
        <EmptyView icon="🔒" title="Not available for your role" subtitle="Sales figures are only for selling, POS or report roles." />
      ) : loading ? (
        <LoadingView text="Loading today's figures…" />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load()} />
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentInner}
          showsVerticalScrollIndicator={false}
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

          {stats ? (
            <>
              <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>Today's Gross Sales (store)</Text>
                <Text style={styles.heroValue}>{formatLKR(stats.today.totalSales)}</Text>
                <View style={styles.heroSubRow}>
                  <View style={styles.heroSubItem}>
                    <Text style={styles.heroSubLabel}>Transactions</Text>
                    <Text style={styles.heroSubValue}>{stats.today.transactionCount} bills</Text>
                  </View>
                  <View style={styles.heroSubItem}>
                    <Text style={styles.heroSubLabel}>Avg Basket</Text>
                    <Text style={styles.heroSubValue}>{formatLKR(avgBasket)}</Text>
                  </View>
                  <View style={styles.heroSubItem}>
                    <Text style={styles.heroSubLabel}>Returns</Text>
                    <Text style={styles.heroSubValue}>{formatLKR(stats.today.totalReturns)}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Tender Breakdown (today)</Text>
                <View style={styles.listContainer}>
                  {stats.paymentBreakdown.length === 0 ? (
                    <Text style={styles.emptyRow}>No sales recorded today yet.</Text>
                  ) : (
                    stats.paymentBreakdown.map((p, idx) => {
                      const amt = Number(p.total) || 0
                      const pct = stats.today.totalSales > 0 ? Math.round((amt / stats.today.totalSales) * 100) : 0
                      return (
                        <View key={`${p.method}-${idx}`} style={styles.listItem}>
                          <View>
                            <Text style={styles.itemTitle}>{paymentMethodLabel(p.method || 'cash')}</Text>
                            <Text style={styles.itemSubtitle}>
                              {p.count} bills • {pct}% of volume
                            </Text>
                          </View>
                          <Text style={styles.itemAmount}>{formatLKR(amt)}</Text>
                        </View>
                      )
                    })
                  )}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Period Performance</Text>
                <View style={styles.listContainer}>
                  <View style={styles.listItem}>
                    <View>
                      <Text style={styles.itemTitle}>This week</Text>
                      <Text style={styles.itemSubtitle}>{stats.week.transactionCount} bills</Text>
                    </View>
                    <Text style={styles.itemAmount}>{formatLKR(stats.week.netSales)}</Text>
                  </View>
                  <View style={styles.listItem}>
                    <View>
                      <Text style={styles.itemTitle}>This month</Text>
                      <Text style={styles.itemSubtitle}>{stats.month.transactionCount} bills</Text>
                    </View>
                    <Text style={styles.itemAmount}>{formatLKR(stats.month.netSales)}</Text>
                  </View>
                </View>
              </View>
            </>
          ) : null}

          {shift && shiftStats ? (
            <>
              <View style={[styles.heroCard, stats && { backgroundColor: THEME.colors.primaryDark }]}>
                <Text style={styles.heroLabel}>
                  My open shift • {shiftCounterName(shift) || 'Counter'} • {shiftWarehouseName(shift)}
                </Text>
                <Text style={styles.heroValue}>{formatLKR(shiftStats.gross)}</Text>
                <View style={styles.heroSubRow}>
                  <View style={styles.heroSubItem}>
                    <Text style={styles.heroSubLabel}>Bills</Text>
                    <Text style={styles.heroSubValue}>{shiftStats.count}</Text>
                  </View>
                  <View style={styles.heroSubItem}>
                    <Text style={styles.heroSubLabel}>Avg Basket</Text>
                    <Text style={styles.heroSubValue}>{formatLKR(shiftAvg)}</Text>
                  </View>
                  <View style={styles.heroSubItem}>
                    <Text style={styles.heroSubLabel}>Tax</Text>
                    <Text style={styles.heroSubValue}>{formatLKR(shiftStats.tax)}</Text>
                  </View>
                </View>
                {shiftStats.truncated ? <Text style={styles.heroNote}>Based on the latest 100 sales; older shift sales not included.</Text> : null}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>My Shift Tenders</Text>
                <View style={styles.listContainer}>
                  {(shift.balances || []).length > 0 && (
                    <View style={styles.listItem}>
                      <View>
                        <Text style={styles.itemTitle}>Opening float</Text>
                        <Text style={styles.itemSubtitle}>
                          Opened {new Date(shift.openingTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                      <Text style={styles.itemAmount}>
                        {formatLKR((shift.balances || []).reduce((s, b) => s + (Number(b.openingAmount) || 0), 0))}
                      </Text>
                    </View>
                  )}
                  {shiftStats.byMethod.length === 0 ? (
                    <Text style={styles.emptyRow}>No sales on this shift yet.</Text>
                  ) : (
                    shiftStats.byMethod.map((m) => (
                      <View key={m.method} style={styles.listItem}>
                        <View>
                          <Text style={styles.itemTitle}>{paymentMethodLabel(m.method)}</Text>
                          <Text style={styles.itemSubtitle}>{m.count} payments</Text>
                        </View>
                        <Text style={styles.itemAmount}>{formatLKR(m.amount)}</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
            </>
          ) : !stats ? (
            <View style={styles.closingBanner}>
              <Text style={{ fontSize: 24 }}>🕒</Text>
              <View style={styles.closingBannerText}>
                <Text style={styles.closingTitle}>No open shift</Text>
                <Text style={styles.closingSubtitle}>Open a shift to see your live sales figures here.</Text>
              </View>
            </View>
          ) : null}

          {daily ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Closed Shifts Today ({daily.totalShifts})</Text>
              <View style={styles.listContainer}>
                <View style={styles.listItem}>
                  <View>
                    <Text style={styles.itemTitle}>Net sales (closed shifts)</Text>
                    <Text style={styles.itemSubtitle}>{daily.summary.totalTransactions} bills • returns {formatLKR(daily.summary.totalReturns)}</Text>
                  </View>
                  <Text style={styles.itemAmount}>{formatLKR(daily.summary.netSales)}</Text>
                </View>
                <View style={styles.listItem}>
                  <View>
                    <Text style={styles.itemTitle}>Total cash variance</Text>
                    <Text style={styles.itemSubtitle}>across reconciled drawers</Text>
                  </View>
                  <Text
                    style={[
                      styles.itemAmount,
                      { color: Math.abs(daily.summary.totalVariance) < 0.005 ? THEME.colors.tertiary : THEME.colors.error },
                    ]}
                  >
                    {daily.summary.totalVariance > 0 ? '+' : ''}
                    {formatLKR(daily.summary.totalVariance)}
                  </Text>
                </View>
                {daily.shifts.map((s) => (
                  <View key={s.id} style={styles.listItem}>
                    <View>
                      <Text style={styles.itemTitle}>
                        {s.posProfile?.name || 'Counter'} • {s.user?.name || ''}
                      </Text>
                      <Text style={styles.itemSubtitle}>
                        {s.totalTransactions} bills{s.closingTime ? ` • closed ${new Date(s.closingTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.itemAmount}>{formatLKR(s.netSales)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.colors.surface },
  header: {
    paddingTop: 44,
    height: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: THEME.spacing.lg,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  backButton: { width: 36, height: 36, borderRadius: THEME.radius.md, alignItems: 'center', justifyContent: 'center' },
  backButtonText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  headerSub: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textMuted },
  syncBadge: { backgroundColor: THEME.colors.tertiaryLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: THEME.radius.sm, maxWidth: 120 },
  syncBadgeText: { fontSize: 10, fontFamily: 'monospace', fontWeight: '700', color: THEME.colors.tertiary },
  content: { flex: 1 },
  contentInner: { padding: THEME.spacing.lg, paddingBottom: 40, gap: 16 },
  heroCard: { backgroundColor: THEME.colors.primary, borderRadius: THEME.radius.xl, padding: 20 },
  heroLabel: { fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', fontWeight: '700' },
  heroValue: { fontSize: 28, fontWeight: '900', fontFamily: 'monospace', color: THEME.colors.onPrimary, marginTop: 4, marginBottom: 16 },
  heroSubRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', paddingTop: 12 },
  heroSubItem: { flex: 1 },
  heroSubLabel: { fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' },
  heroSubValue: { fontSize: 12, fontWeight: '700', fontFamily: 'monospace', color: THEME.colors.onPrimary, marginTop: 2 },
  heroNote: { marginTop: 10, fontSize: 10, color: 'rgba(255,255,255,0.75)' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.text, fontFamily: 'monospace', textTransform: 'uppercase' },
  listContainer: { backgroundColor: THEME.colors.card, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border, overflow: 'hidden' },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  emptyRow: { padding: 14, fontSize: 12, color: THEME.colors.textMuted },
  itemTitle: { fontSize: 13, fontWeight: '600', color: THEME.colors.text },
  itemSubtitle: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 1 },
  itemAmount: { fontSize: 13, fontFamily: 'monospace', fontWeight: '700', color: THEME.colors.text },
  closingBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: THEME.colors.primaryLight, padding: 16, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: 'rgba(15, 118, 110, 0.2)' },
  closingBannerText: { flex: 1 },
  closingTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.primary },
  closingSubtitle: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
})
