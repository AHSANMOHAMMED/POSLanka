import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, Switch, Alert, ActivityIndicator, RefreshControl, StyleSheet, Modal, TextInput } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { adminGet, adminPost, adminPut, useAdminUser } from '../../../src/lib/adminApi'
import { THEME, formatLKR } from '../../../src/lib/theme'
import { ErrorView, InlineNotice, LoadingView } from '../../../src/components/StateViews'
import { AdminVendorStaff, type AdminStaffRow } from '../../../src/components/admin/AdminVendorStaff'
import { AdminShell, Card, Kpi, ListRow, Pill, SectionTitle, adminStyles, businessTypeLabel, compactLKR, statusTone, timeAgo } from '../../../src/components/admin/AdminShell'

/** Feature catalogue from the server (GET /api/sys-control/vendors/[id] → featureDefs) */
interface FeatureDef { key: string; label: string; description: string; group: string; applies: boolean }

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
  counters: Array<{ id: string; name: string; status?: string | null }>
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
  const [featureDefs, setFeatureDefs] = useState<FeatureDef[]>([])
  const [showOtherFeatures, setShowOtherFeatures] = useState(false)
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
        adminGet<{ vendor: VendorDetail; staff: AdminStaffRow[]; assignableRoles?: string[]; featureDefs?: FeatureDef[] }>(`/api/sys-control/vendors/${id}`),
        adminGet<VendorAnalytics>(`/api/sys-control/analytics/vendors/${id}`),
      ])
      if (vRes.ok) {
        setVendor(vRes.data.vendor)
        setStaff(vRes.data.staff || [])
        setRoles(vRes.data.assignableRoles || [])
        setFeatureDefs(vRes.data.featureDefs || [])
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

  const [suspendOpen, setSuspendOpen] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')

  // Suspend / reactivate go through the vendor actions (audited with a reason; reactivating also
  // resumes a billing-locked or archived subscription, like the web console)
  async function runAction(body: { action: 'suspend'; reason: string } | { action: 'reactivate' }) {
    if (!vendor) return
    setBusy('lock')
    const res = await adminPost<{ success: boolean; status?: string; warning?: string; message?: string }>(`/api/sys-control/vendors/${vendor.id}/actions`, body)
    setBusy(null)
    if (!res.ok) {
      Alert.alert('Update Failed', res.error)
      return
    }
    setSuspendOpen(false)
    setSuspendReason('')
    const status = res.data?.status || (body.action === 'suspend' ? 'suspended' : 'active')
    setVendor((prev) => (prev ? { ...prev, status, lockedAt: status === 'active' ? null : new Date().toISOString(), lockedReason: status === 'active' ? null : 'admin_suspended' } : prev))
    if (res.data?.warning) Alert.alert('Reactivated', res.data.warning)
    load(true)
  }

  function toggleLock() {
    if (!vendor) return
    if (vendor.status === 'active') {
      setSuspendOpen(true)
      return
    }
    Alert.alert('Reactivate vendor?', `${vendor.name} (now ${vendor.status}) will be set back to active and can trade again.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reactivate', onPress: () => runAction({ action: 'reactivate' }) },
    ])
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

  const relevantFeatures = featureDefs.filter((d) => d.applies || showOtherFeatures)
  const featureGroups = Array.from(new Set(relevantFeatures.map((d) => d.group)))
  const locked = !!vendor && vendor.status !== 'active'

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
                {vendor.status.charAt(0).toUpperCase() + vendor.status.slice(1)} {vendor.lockedAt ? timeAgo(vendor.lockedAt) : ''}{vendor.lockedReason ? ` (${vendor.lockedReason})` : ''}
              </Text>
            ) : null}
            {canManage ? (
              <Pressable style={[locked ? adminStyles.primaryBtn : adminStyles.dangerBtn, { marginTop: 12 }, busy === 'lock' && { opacity: 0.6 }]} onPress={toggleLock} disabled={busy === 'lock'}>
                {busy === 'lock' ? <ActivityIndicator color="#FFF" /> : <Text style={adminStyles.primaryBtnText}>{locked ? '🔓 Reactivate vendor' : '🔒 Suspend vendor'}</Text>}
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

          {/* Stock value, sales, cost and profit: totals and item by item */}
          {can('vendors.impersonate') ? (
            <Pressable style={adminStyles.primaryBtn} onPress={() => router.push({ pathname: '/admin/vendor-business', params: { vendorId: vendor.id, vendorName: vendor.name } })}>
              <Text style={adminStyles.primaryBtnText}>📊  Sales, stock & profit</Text>
            </Pressable>
          ) : null}

          {/* Every table of this vendor: view, search, add / edit / delete, export */}
          {can('vendors.impersonate') ? (
            <Pressable style={adminStyles.ghostBtn} onPress={() => router.push({ pathname: '/admin/vendor-data', params: { vendorId: vendor.id, vendorName: vendor.name } })}>
              <Text style={adminStyles.ghostBtnText}>🗄  All data (items, sales, customers…)</Text>
            </Pressable>
          ) : null}

          {/* What the vendor deleted: restore or purge */}
          {can('vendors.impersonate') ? (
            <Pressable style={adminStyles.ghostBtn} onPress={() => router.push({ pathname: '/admin/recycle-bin', params: { vendorId: vendor.id, vendorName: vendor.name } })}>
              <Text style={adminStyles.ghostBtnText}>🗑  Recycle bin (restore / purge)</Text>
            </Pressable>
          ) : null}

          {/* Staff: add managers / cashiers / … for this vendor */}
          <AdminVendorStaff vendorId={vendor.id} staff={staff} roles={roles} canManage={canManage} onChanged={() => load(true)} />

          {/* Feature switches, grouped; ones for other business types folded away */}
          <SectionTitle>Feature switches</SectionTitle>
          {featureGroups.map((g) => (
            <Card key={g}>
              <Text style={styles.groupTitle}>{g}</Text>
              {relevantFeatures.filter((d) => d.group === g).map((d) => (
                <View key={d.key} style={styles.flagRow}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={styles.flagTitle}>{d.label}</Text>
                    <Text style={adminStyles.muted}>{d.description}</Text>
                  </View>
                  {busy === d.key ? (
                    <ActivityIndicator size="small" color={THEME.colors.primary} />
                  ) : (
                    <Switch
                      value={!!vendor.featureFlags?.[d.key]}
                      onValueChange={(v) => toggleFlag(d.key, v)}
                      disabled={busy !== null || !canManage}
                      trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
                    />
                  )}
                </View>
              ))}
            </Card>
          ))}
          {featureDefs.some((d) => !d.applies) ? (
            <Pressable onPress={() => setShowOtherFeatures((v) => !v)}>
              <Text style={[adminStyles.muted, { color: THEME.colors.primary, fontWeight: '700' }]}>
                {showOtherFeatures ? 'Hide features for other business types' : 'Show features for other business types'}
              </Text>
            </Pressable>
          ) : null}

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
                  <ListRow key={c.id} title={c.name} right={<Pill text={c.status || 'active'} tone={statusTone(c.status || 'active')} />} />
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
      <Modal visible={suspendOpen} transparent animationType="fade" onRequestClose={() => setSuspendOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Suspend {vendor?.name}?</Text>
            <Text style={adminStyles.muted}>Staff cannot sign in (web and app) until reactivated. Data is kept. The reason goes into the audit log.</Text>
            <TextInput style={styles.modalInput} placeholder="Reason (e.g. unpaid subscription)" placeholderTextColor={THEME.colors.textSubtle} value={suspendReason} onChangeText={setSuspendReason} autoFocus />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable style={[adminStyles.primaryBtn, { flex: 1, backgroundColor: THEME.colors.textMuted }]} onPress={() => setSuspendOpen(false)}>
                <Text style={adminStyles.primaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[adminStyles.dangerBtn, { flex: 1 }, (suspendReason.trim().length < 3 || busy === 'lock') && { opacity: 0.5 }]} disabled={suspendReason.trim().length < 3 || busy === 'lock'} onPress={() => runAction({ action: 'suspend', reason: suspendReason.trim() })}>
                {busy === 'lock' ? <ActivityIndicator color="#FFF" /> : <Text style={adminStyles.primaryBtnText}>Suspend</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </AdminShell>
  )
}

const styles = StyleSheet.create({
  modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: THEME.colors.text, marginBottom: 6 },
  modalInput: { marginTop: 12, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: THEME.colors.text },
  flagRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  flagTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  groupTitle: { fontSize: 11, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
})
