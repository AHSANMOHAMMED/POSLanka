import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { adminGet } from '../../src/lib/adminApi'
import { THEME, formatLKR } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { AdminShell, Kpi, Pill, adminStyles, businessTypeLabel, compactLKR, timeAgo } from '../../src/components/admin/AdminShell'

const POLL_MS = 5000
const MAX_ROWS = 200

interface LiveReceipt {
  id: string
  invoiceNo: string
  tenantId: string
  tenantName: string
  tenantSlug: string
  businessType: string
  warehouseName: string | null
  cashierName: string | null
  total: number
  isReturn: boolean
  paymentMethod: string | null
  createdAt: string
}

interface LiveResponse {
  since: string
  serverTime: string
  receipts: LiveReceipt[]
  hourly: Array<{ hour: string; netSales: number; receipts: number }>
}

export default function AdminLiveScreen() {
  const [rows, setRows] = useState<LiveReceipt[]>([])
  const [hourly, setHourly] = useState<LiveResponse['hourly']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [lastTick, setLastTick] = useState<Date | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const sinceRef = useRef<string | null>(null)
  const inFlight = useRef(false)

  const poll = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const q = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : ''
    const res = await adminGet<LiveResponse>(`/api/sys-control/analytics/live${q}`)
    inFlight.current = false
    if (!res.ok) {
      // Keep the current ticker on transient failures; only block on the first load.
      if (rows.length === 0) setError(res.error)
      setLoading(false)
      return
    }
    setError(null)
    const incoming = res.data.receipts || []
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id))
      const fresh = incoming.filter((r) => !seen.has(r.id))
      if (fresh.length) {
        setFreshIds(new Set(fresh.map((r) => r.id)))
        setTimeout(() => setFreshIds(new Set()), 2500)
      }
      const merged = [...fresh, ...prev].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return merged.slice(0, MAX_ROWS)
    })
    if (res.data.hourly) setHourly(res.data.hourly)
    // Subsequent polls only ask for receipts since the server's clock, minus a small overlap.
    const serverTime = new Date(res.data.serverTime)
    sinceRef.current = isNaN(serverTime.getTime()) ? null : new Date(serverTime.getTime() - 15_000).toISOString()
    setLastTick(new Date())
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    poll()
    if (paused) return
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [poll, paused])

  const lastHour = rows.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 60 * 60 * 1000)
  const lastHourNet = lastHour.reduce((s, r) => s + r.total, 0)
  const vendorsActive = new Set(lastHour.map((r) => r.tenantId)).size
  const todayNet = hourly.reduce((s, h) => s + h.netSales, 0)
  const todayReceipts = hourly.reduce((s, h) => s + h.receipts, 0)
  const hourlyMax = Math.max(1, ...hourly.map((h) => h.netSales))

  return (
    <AdminShell
      title="Live Receipts"
      subtitle={lastTick ? `Updated ${timeAgo(lastTick)} • every ${POLL_MS / 1000}s` : 'Connecting…'}
      tab="live"
      right={
        <Pressable style={[styles.pauseBtn, paused && styles.pauseBtnOn]} onPress={() => setPaused((p) => !p)}>
          <Text style={[styles.pauseText, paused && { color: '#FFF' }]}>{paused ? '▶ Resume' : '⏸ Pause'}</Text>
        </Pressable>
      }
    >
      {loading ? (
        <LoadingView text="Opening the live feed…" />
      ) : error && rows.length === 0 ? (
        <ErrorView message={error} onRetry={poll} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={adminStyles.content}
          ListHeaderComponent={
            <View style={{ gap: 12, marginBottom: 4 }}>
              <View style={adminStyles.kpiGrid}>
                <Kpi label="Last 60 min" value={compactLKR(lastHourNet)} hint={`${lastHour.length} receipts • ${vendorsActive} vendors`} tone="primary" />
                <Kpi label="Last 24 h" value={compactLKR(todayNet)} hint={`${todayReceipts} receipts`} />
              </View>
              {hourly.length > 0 ? (
                <View style={styles.sparkCard}>
                  <Text style={styles.sparkTitle}>Net sales per hour (24 h)</Text>
                  <View style={styles.sparkRow}>
                    {hourly.map((h) => (
                      <View key={h.hour} style={styles.sparkCol}>
                        <View style={[styles.sparkBar, { height: Math.max(2, Math.round((h.netSales / hourlyMax) * 44)) }]} />
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={adminStyles.muted}>{hourly[0]?.hour.slice(11, 16)}</Text>
                    <Text style={adminStyles.muted}>{hourly[hourly.length - 1]?.hour.slice(11, 16)}</Text>
                  </View>
                </View>
              ) : null}
              <Text style={styles.tickerTitle}>Receipt ticker (last 60 min, newest first)</Text>
            </View>
          }
          ListEmptyComponent={<Text style={adminStyles.empty}>No receipts in the last hour. The ticker updates automatically.</Text>}
          renderItem={({ item }) => {
            const fresh = freshIds.has(item.id)
            return (
              <Pressable
                style={[styles.row, fresh && styles.rowFresh, item.isReturn && styles.rowReturn]}
                onPress={() => router.push({ pathname: '/admin/vendors/[id]', params: { id: item.tenantId } } as any)}
              >
                <View style={{ flex: 1, marginRight: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.rowInvoice}>{item.invoiceNo}</Text>
                    {item.isReturn ? <Pill text="Return" tone="error" /> : null}
                  </View>
                  <Text style={styles.rowVendor} numberOfLines={1}>
                    {item.tenantName}
                    {item.warehouseName ? ` · ${item.warehouseName}` : ''}
                  </Text>
                  <Text style={adminStyles.muted} numberOfLines={1}>
                    {businessTypeLabel(item.businessType)} • {item.cashierName || 'Unknown cashier'} • {item.paymentMethod || 'cash'} • {timeAgo(item.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.rowAmount, item.isReturn && { color: THEME.colors.error }]}>{formatLKR(item.total)}</Text>
              </Pressable>
            )
          }}
        />
      )}
    </AdminShell>
  )
}

const styles = StyleSheet.create({
  pauseBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow },
  pauseBtnOn: { backgroundColor: THEME.colors.secondaryAmber, borderColor: THEME.colors.secondaryAmber },
  pauseText: { fontSize: 11, fontWeight: '700', color: THEME.colors.text },
  sparkCard: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: THEME.colors.border, padding: 14 },
  sparkTitle: { fontSize: 10, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 2, marginBottom: 4 },
  sparkCol: { flex: 1, justifyContent: 'flex-end' },
  sparkBar: { backgroundColor: THEME.colors.primary, borderRadius: 2 },
  tickerTitle: { fontSize: 12, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 12,
    marginBottom: 8,
  },
  rowFresh: { borderColor: THEME.colors.tertiary, backgroundColor: THEME.colors.tertiaryLight },
  rowReturn: { borderColor: THEME.colors.errorLight },
  rowInvoice: { fontSize: 13, fontWeight: '800', color: THEME.colors.text, fontFamily: 'monospace' },
  rowVendor: { fontSize: 12, fontWeight: '700', color: THEME.colors.primary, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: '900', color: THEME.colors.text, fontFamily: 'monospace' },
})
