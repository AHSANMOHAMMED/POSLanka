import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, Switch, Alert, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { adminGet, adminPut, useAdminUser } from '../../../src/lib/adminApi'
import { THEME, formatLKR } from '../../../src/lib/theme'
import { ErrorView, InlineNotice, LoadingView } from '../../../src/components/StateViews'
import { AdminVendorStaff, type AdminStaffRow } from '../../../src/components/admin/AdminVendorStaff'
import { AdminShell, Card, Kpi, ListRow, Pill, SectionTitle, adminStyles, businessTypeLabel, compactLKR, statusTone, timeAgo } from '../../../src/components/admin/AdminShell'

/** Mirrors src/lib/features/flags.ts on the server (labels only; the server normalises unknown keys away). */
const FEATURE_LABELS: Record<string, string> = {
  accounting: 'Accounting module',
  purchase: 'Purchase module',
  credit_customer: 'Credit customers',
  loyalty: 'Loyalty points',
  multi_warehouse: 'Multi-warehouse',
  advanced_reports: 'Advanced reports',
  whatsapp: 'WhatsApp integration',
  quotation: 'Quotation module',
}

interface VendorDetail {
  id: string
  name: string
  slug: string
  email?: string | null
  phone?: string | null
  address?: string | null
  businessType: string
  country?: string | null
  currency?: string | null
  status: string
  plan?: string | null
  lockedAt?: string | null
  lockedReason?: string | null
  createdAt: string
  featureFlags: Record<string, boolean>
  userCount: number
  subscription?: { status: string; currentPeriodEnd?: string | null; trialEndsAt?: string | null; tier?: { name: string } | null } | null
  branches: Array<{ id: string; name: string; isActive?: boolean }>
  counters: Array<{ id: string; name: string; isActive?: boolean }>
}

interface RangeTotals {
  netSales: number
  grossSales: number
  returns: number
  receipts: number
  avgBasket: number
}

interface VendorAnalytics {
  totals: { today: RangeTotals; '7d': RangeTotals; '30d': RangeTotals }
  byBranch: Array<{ warehouseId: string | null; name: string; netSales: number; receipts: number }>
  byCounter: Array<{ posProfileId: string | null; name: string; netSales: number; receipts: number }>
  byCashier: Array<{ userId: string | null; name: string; netSales: number; receipts: number; variance: number }>
  openShifts: Array<{ id: string; entryNumber?: string; cashierName: string; counterName: string; warehouseName: string; openingTime: string }>
}

export default function AdminVendorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [staff, setStaff] = useState<AdminStaffRow[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [analytics, setAnalytics] = useState<VendorAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<'lock' | string | null>(null)
  // Lock / unlock and feature switches are vendor management (owner role); the server enforces it
  const { can } = useAdminUser()
  const canManage = can('vendors.manage')

  const load = useCallback(
    async (silent = false) => {
      if (!id) return
      if (!silent) setLoading(true)
      setError(null)
      setNotice(null)
      const [vRes, aRes] = await Promise.all([
        adminGet<{ vendor: VendorDetail; staff: AdminStaffRow[]; assignableRoles?: string[] }>(`/api/sys-control/vendors/${id}`),
        adminGet<VendorAnalytics>(`/api/sys-control/analytics/vendors/${id}`),
      ])
      if (vRes.ok) {
        setVendor(vRes.data.vendor)
        setStaff(vRes.data.staff || [])
        setRoles(vRes.data.assignableRoles || [])
      } else setError(vRes.error)
      if (aRes.ok) setAnalytics(aRes.data)
      else if (vRes.ok) setNotice(`Sales analytics: ${aRes.error}`)
      setLoading(false)
      setRefreshing(false)
    },
    [id]
  )

  useEffect(() => {
    load()
  }, [load])

  async function toggleLock() {
    if (!vendor) return
    const locking = vendor.status !== 'locked'
    Alert.alert(
      locking ? 'Lock Vendor?' : 'Unlock Vendor?',
      locking
        ? `${vendor.name} will be locked out of POSLanka until unlocked. Open shifts cannot continue.`
        : `${vendor.name} will be set back to active and can trade again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: locking ? 'Lock' : 'Unlock',
          style: locking ? 'destructive' : 'default',
          onPress: async () => {
            setBusy('lock')
            const res = await adminPut<{ success: boolean; vendor?: Partial<VendorDetail> }>(`/api/sys-control/vendors/${vendor.id}`, { status: locking ? 'locked' : 'active' })
            setBusy(null)
            if (!res.ok) {
              Alert.alert('Update Failed', res.error)
              return
            }
            setVendor((prev) => (prev ? { ...prev, status: locking ? 'locked' : 'active', lockedAt: locking ? new Date().toISOString() : null, lockedReason: locking ? 'admin_locked' : null } : prev))
          },
        },
      ]
    )
  }

  async function toggleFlag(flag: string, value: boolean) {
    if (!vendor) return
    const prevFlags = vendor.featureFlags
    const nextFlags = { ...prevFlags, [flag]: value }
    setVendor({ ...vendor, featureFlags: nextFlags })
    setBusy(flag)
    const res = await adminPut<{ featureFlags: Record<string, boolean> }>(`/api/sys-control/vendors/${vendor.id}/features`, { featureFlags: nextFlags })
    setBusy(null)
    if (!res.ok) {
      setVendor((v) => (v ? { ...v, featureFlags: prevFlags } : v))
      Alert.alert('Feature Flag', res.error)
      return
    }
    if (res.data?.featureFlags) setVendor((v) => (v ? { ...v, featureFlags: res.data.featureFlags } : v))
  }

  const flagKeys = vendor ? Array.from(new Set([...Object.keys(FEATURE_LABELS), ...Object.keys(vendor.featureFlags || {})])) : []
  const locked = vendor?.status === 'locked'

  return (
    <AdminShell title={vendor?.name || 'Vendor'} subtitle={vendor ? `${vendor.slug} • ${businessTypeLabel(vendor.businessType)}` : undefined} tab="vendors" back>
      {loading ? (
        <LoadingView text="Loading vendor dossier…" />
      ) : error || !vendor ? (
        <ErrorView message={error || 'Vendor not found'} onRetry={() => load()} />
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

          {/* Status + lock */}
          <Card style={{ padding: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Pill text={vendor.status} tone={statusTone(vendor.status)} />
              {vendor.plan ? <Pill text={vendor.plan} tone="primary" /> : null}
              {vendor.subscription ? <Pill text={`sub: ${vendor.subscription.status}${vendor.subscription.tier?.name ? ` · ${vendor.subscription.tier.name}` : ''}`} tone={statusTone(vendor.subscription.status)} /> : null}
            </View>
            <Text style={[adminStyles.muted, { marginTop: 8 }]}>
              {vendor.userCount} users • {vendor.branches.length} branches • {vendor.counters.length} counters • since {new Date(vendor.createdAt).toLocaleDateString()}
            </Text>
            {vendor.email || vendor.phone ? (
              <Text style={adminStyles.muted}>
                {[vendor.email, vendor.phone].filter(Boolean).join(' • ')}
              </Text>
            ) : null}
            {locked ? (
              <Text style={[adminStyles.muted, { color: THEME.colors.error, marginTop: 4 }]}>
                Locked {vendor.lockedAt ? timeAgo(vendor.lockedAt) : ''}{vendor.lockedReason ? ` (${vendor.lockedReason})` : ''}
              </Text>
            ) : null}
            {canManage ? (
              <Pressable style={[locked ? adminStyles.primaryBtn : adminStyles.dangerBtn, { marginTop: 12 }, busy === 'lock' && { opacity: 0.6 }]} onPress={toggleLock} disabled={busy === 'lock'}>
                {busy === 'lock' ? <ActivityIndicator color="#FFF" /> : <Text style={adminStyles.primaryBtnText}>{locked ? '🔓 Unlock vendor' : '🔒 Lock vendor'}</Text>}
              </Pressable>
            ) : null}
          </Card>

          {/* Sales */}
          {analytics ? (
            <>
              <SectionTitle>Sales</SectionTitle>
              <View style={adminStyles.kpiGrid}>
                <Kpi label="Today" value={compactLKR(analytics.totals.today.netSales)} hint={`${analytics.totals.today.receipts} receipts • avg ${compactLKR(analytics.totals.today.avgBasket)}`} tone="primary" />
                <Kpi label="7 days" value={compactLKR(analytics.totals['7d'].netSales)} hint={`${analytics.totals['7d'].receipts} receipts`} />
                <Kpi label="30 days" value={compactLKR(analytics.totals['30d'].netSales)} hint={`${analytics.totals['30d'].receipts} receipts`} />
                <Kpi label="Returns (30d)" value={compactLKR(analytics.totals['30d'].returns)} tone={analytics.totals['30d'].returns > 0 ? 'warn' : undefined} />
              </View>

              {analytics.openShifts.length > 0 ? (
                <>
                  <SectionTitle>Open shifts ({analytics.openShifts.length})</SectionTitle>
                  <Card>
                    {analytics.openShifts.map((s) => (
                      <ListRow key={s.id} title={`${s.counterName} · ${s.cashierName}`} subtitle={`${s.warehouseName} • opened ${timeAgo(s.openingTime)}`} right={<Pill text="open" tone="ok" />} />
                    ))}
                  </Card>
                </>
              ) : null}

              {analytics.byBranch.length > 0 ? (
                <>
                  <SectionTitle>By branch (30d)</SectionTitle>
                  <Card>
                    {analytics.byBranch.map((b, i) => (
                      <ListRow key={`${b.warehouseId || 'none'}-${i}`} title={b.name} subtitle={`${b.receipts} receipts`} right={formatLKR(b.netSales)} />
                    ))}
                  </Card>
                </>
              ) : null}

              {analytics.byCashier.length > 0 ? (
                <>
                  <SectionTitle>By cashier (30d)</SectionTitle>
                  <Card>
                    {analytics.byCashier.map((c, i) => (
                      <ListRow
                        key={`${c.userId || 'none'}-${i}`}
                        title={c.name}
                        subtitle={`${c.receipts} receipts • drawer variance ${c.variance > 0 ? '+' : ''}${formatLKR(c.variance)}`}
                        right={formatLKR(c.netSales)}
                        tone={Math.abs(c.variance) >= 500 ? 'error' : undefined}
                      />
                    ))}
                  </Card>
                </>
              ) : null}
            </>
          ) : null}

          {/* Staff: add managers / cashiers / … for this vendor */}
          <AdminVendorStaff vendorId={vendor.id} staff={staff} roles={roles} canManage={canManage} onChanged={() => load(true)} />

          {/* Feature flags */}
          <SectionTitle>Feature flags</SectionTitle>
          <Card>
            {flagKeys.map((flag) => (
              <View key={flag} style={styles.flagRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.flagTitle}>{FEATURE_LABELS[flag] || flag}</Text>
                  <Text style={adminStyles.muted}>{flag}</Text>
                </View>
                {busy === flag ? (
                  <ActivityIndicator size="small" color={THEME.colors.primary} />
                ) : (
                  <Switch
                    value={!!vendor.featureFlags?.[flag]}
                    onValueChange={(v) => toggleFlag(flag, v)}
                    disabled={busy !== null || !canManage}
                    trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
                  />
                )}
              </View>
            ))}
          </Card>

          {/* Branches & counters */}
          {vendor.branches.length > 0 ? (
            <>
              <SectionTitle>Branches</SectionTitle>
              <Card>
                {vendor.branches.map((b) => (
                  <ListRow key={b.id} title={b.name} right={<Pill text={b.isActive === false ? 'inactive' : 'active'} tone={b.isActive === false ? 'muted' : 'ok'} />} />
                ))}
              </Card>
            </>
          ) : null}
          {vendor.counters.length > 0 ? (
            <>
              <SectionTitle>POS counters</SectionTitle>
              <Card>
                {vendor.counters.map((c) => (
                  <ListRow key={c.id} title={c.name} right={<Pill text={c.isActive === false ? 'inactive' : 'active'} tone={c.isActive === false ? 'muted' : 'ok'} />} />
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
    </AdminShell>
  )
}

const styles = StyleSheet.create({
  flagRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  flagTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
})
