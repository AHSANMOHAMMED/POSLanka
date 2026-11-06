// One business type: its features (how many vendors have each on, how many used it in the last
// 30 days, what new vendors start with, bulk on / off) and its vendors (sales, features on / used /
// idle). Bulk changes go through PUT /api/sys-control/business-types/[type]/features (audited).
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, FlatList, Pressable, Switch, Alert, ActivityIndicator, RefreshControl, TextInput, StyleSheet } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { adminApi, adminGet, adminPut, useAdminUser } from '../../../src/lib/adminApi'
import { THEME } from '../../../src/lib/theme'
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '../../../src/components/StateViews'
import { AdminShell, Card, Kpi, Pill, SectionTitle, SegmentChips, adminStyles, businessTypeLabel, compactLKR, statusTone, timeAgo } from '../../../src/components/admin/AdminShell'
import { Btn, Choice, FilterChips, FormModal, LinkButton, Notice } from '../../../src/components/admin/AdminForm'

interface TypeFeature {
  key: string
  label: string
  description: string
  group: string
  /** What switching it off does to the vendor (shown before a bulk "off") */
  offEffect: string | null
  /** Relevant to this business type */
  applies: boolean
  usageTracked: boolean
  enabledCount: number
  usedCount: number | null
  activity: number | null
}

interface TypeTenant {
  id: string
  name: string
  slug: string
  businessId?: string | null
  businessSegments?: string[] | null
  status: string
  plan?: string | null
  createdAt: string
  netSales30d: number
  receipts30d: number
  lastSaleAt: string | null
  featureFlags: Record<string, boolean>
  enabledCount: number
  usedFeatures: string[]
  unusedEnabled: string[]
}

interface TypeDetail {
  type: string
  label: string
  usageDays: number
  tenantCount: number
  activeTenants30d: number
  netSales30d: number
  preset: Record<string, boolean>
  codePreset: Record<string, boolean>
  presetOverridden: string[]
  groups: string[]
  features: TypeFeature[]
  tenants: TypeTenant[]
}

interface ApplyResponse {
  changes: Record<string, boolean>
  updatedTenants: number
  updatedTenantIds: string[]
  preset: Record<string, boolean>
  presetOverridden: string[]
}

type Tab = 'features' | 'vendors'
type Scope = 'both' | 'existing' | 'new'

type Row = { kind: 'group'; key: string; title: string; features: TypeFeature[] } | { kind: 'tenant'; key: string; tenant: TypeTenant }

const SCOPE_OPTIONS = [
  { value: 'both', label: 'Both' },
  { value: 'existing', label: 'Existing vendors' },
  { value: 'new', label: 'New vendors' },
]

function groupFeatures(list: TypeFeature[], order: string[], suffix = ''): Row[] {
  const groups = [...order, ...Array.from(new Set(list.map((f) => f.group))).filter((g) => !order.includes(g))]
  return groups
    .map((g) => ({ kind: 'group' as const, key: `${suffix}${g}`, title: g, features: list.filter((f) => f.group === g) }))
    .filter((r) => r.features.length > 0)
}

export default function AdminBusinessTypeDetailScreen() {
  const { type } = useLocalSearchParams<{ type: string }>()
  const [data, setData] = useState<TypeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('features')
  const [showOther, setShowOther] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busyFlag, setBusyFlag] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ flag: string; value: boolean } | null>(null)
  const [scope, setScope] = useState<Scope>('both')
  const [applying, setApplying] = useState(false)
  const [resetting, setResetting] = useState(false)
  const { can } = useAdminUser()
  const canManage = can('vendors.manage')

  const load = useCallback(
    async (silent = false) => {
      if (!type) return
      if (!silent) setLoading(true)
      setError(null)
      const res = await adminGet<TypeDetail>(`/api/sys-control/business-types/${encodeURIComponent(type)}`)
      if (res.ok) setData(res.data)
      // A failed silent refresh keeps the figures already on screen
      else if (silent) setNotice(res.error)
      else setError(res.error)
      setLoading(false)
      setRefreshing(false)
    },
    [type]
  )

  useEffect(() => {
    load()
  }, [load])

  const featureByKey = useMemo(() => new Map((data?.features || []).map((f) => [f.key, f])), [data])
  const days = data?.usageDays ?? 30
  const total = data?.tenantCount ?? 0

  const statusOptions = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of data?.tenants || []) counts[t.status] = (counts[t.status] || 0) + 1
    return [{ value: 'all', label: 'All', count: data?.tenants.length ?? 0 }, ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ value: s, label: s, count: n }))]
  }, [data])

  const rows: Row[] = useMemo(() => {
    if (!data) return []
    if (tab === 'features') {
      const out = groupFeatures(data.features.filter((f) => f.applies), data.groups)
      if (showOther) out.push(...groupFeatures(data.features.filter((f) => !f.applies), data.groups, 'other:').map((r) => (r.kind === 'group' ? { ...r, title: `${r.title} · not used by this type` } : r)))
      return out
    }
    const q = query.trim().toLowerCase()
    return [...data.tenants]
      .filter((t) => statusFilter === 'all' || t.status === statusFilter)
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q) || (t.businessId || '').toLowerCase().includes(q))
      .sort((a, b) => b.netSales30d - a.netSales30d || a.name.localeCompare(b.name))
      .map((t) => ({ kind: 'tenant' as const, key: t.id, tenant: t }))
  }, [data, tab, showOther, query, statusFilter])

  const otherCount = data ? data.features.filter((f) => !f.applies).length : 0

  // ---------------------------------------------------------------- writes

  /** Only the switch new vendors start with (no existing vendor changes). Optimistic. */
  async function setPreset(flag: string, value: boolean) {
    if (!data || !type) return
    const prev = { preset: data.preset, presetOverridden: data.presetOverridden }
    setData({ ...data, preset: { ...data.preset, [flag]: value } })
    setBusyFlag(flag)
    const res = await adminPut<ApplyResponse>(`/api/sys-control/business-types/${encodeURIComponent(type)}/features`, {
      changes: { [flag]: value },
      applyToExisting: false,
      applyToNew: true,
    })
    setBusyFlag(null)
    if (!res.ok) {
      setData((d) => (d ? { ...d, ...prev } : d))
      Alert.alert('New-vendor default', res.error)
      return
    }
    setData((d) => (d ? { ...d, preset: res.data.preset, presetOverridden: res.data.presetOverridden } : d))
  }

  function openBulk(flag: string, value: boolean) {
    setScope('both')
    setConfirm({ flag, value })
  }

  async function applyBulk() {
    if (!confirm || !type) return
    setApplying(true)
    const res = await adminPut<ApplyResponse>(`/api/sys-control/business-types/${encodeURIComponent(type)}/features`, {
      changes: { [confirm.flag]: confirm.value },
      applyToExisting: scope !== 'new',
      applyToNew: scope !== 'existing',
    })
    setApplying(false)
    if (!res.ok) {
      Alert.alert('Change features', res.error)
      return
    }
    const label = featureByKey.get(confirm.flag)?.label || confirm.flag
    const parts: string[] = []
    if (scope !== 'new') parts.push(`${res.data.updatedTenants} ${res.data.updatedTenants === 1 ? 'vendor' : 'vendors'} updated`)
    if (scope !== 'existing') parts.push(`new vendors start with it ${confirm.value ? 'on' : 'off'}`)
    setConfirm(null)
    setData((d) => (d ? { ...d, preset: res.data.preset, presetOverridden: res.data.presetOverridden } : d))
    Alert.alert(`${label} ${confirm.value ? 'on' : 'off'}`, `${parts.join('; ')}.`)
    load(true)
  }

  function confirmReset() {
    if (!data || !type) return
    const n = data.presetOverridden.length
    Alert.alert(
      'Reset new-vendor defaults?',
      `New ${data.label} vendors will start with the standard features again (${n} ${n === 1 ? 'change' : 'changes'} dropped). Existing vendors are not touched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setResetting(true)
            const res = await adminApi<{ preset: Record<string, boolean>; presetOverridden: string[] }>(`/api/sys-control/business-types/${encodeURIComponent(type)}/features`, { method: 'DELETE' })
            setResetting(false)
            if (!res.ok) {
              Alert.alert('Reset defaults', res.error)
              return
            }
            setData((d) => (d ? { ...d, preset: res.data.preset, presetOverridden: res.data.presetOverridden || [] } : d))
          },
        },
      ]
    )
  }

  // ---------------------------------------------------------------- render

  const header = data ? (
    <View style={{ gap: 12, marginBottom: 4 }}>
      {notice ? <InlineNotice text={notice} tone="warn" /> : null}
      <View style={adminStyles.kpiGrid}>
        <Kpi label="Vendors" value={String(data.tenantCount)} tone="primary" />
        <Kpi label={`Active (${days} d)`} value={String(data.activeTenants30d)} hint={total > 0 ? `${Math.round((data.activeTenants30d / total) * 100)}% made a sale` : undefined} tone="ok" />
        <Kpi label={`Net sales (${days} d)`} value={compactLKR(data.netSales30d)} hint={total > 0 ? `avg ${compactLKR(data.netSales30d / total)} / vendor` : undefined} />
        <Kpi label="Features" value={String(data.features.filter((f) => f.applies).length)} hint={`${Object.values(data.preset).filter(Boolean).length} on for new vendors`} />
      </View>

      {data.presetOverridden.length > 0 ? (
        <Card style={{ padding: 14, gap: 8 }}>
          <Text style={styles.cardTitle}>
            {data.presetOverridden.length} {data.presetOverridden.length === 1 ? 'feature' : 'features'} changed for new vendors
          </Text>
          <Text style={adminStyles.muted}>
            {data.presetOverridden.map((k) => `${featureByKey.get(k)?.label || k} (${data.preset[k] ? 'on' : 'off'})`).join(', ')}
          </Text>
          {canManage ? <Btn label="Reset new-vendor defaults" tone="ghost" onPress={confirmReset} busy={resetting} /> : null}
        </Card>
      ) : null}

      <View style={adminStyles.segment}>
        {(['features', 'vendors'] as Tab[]).map((t) => (
          <Pressable key={t} style={[adminStyles.segmentBtn, tab === t && adminStyles.segmentBtnActive]} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[adminStyles.segmentText, tab === t && adminStyles.segmentTextActive]}>
              {t === 'features' ? `Features (${data.features.filter((f) => f.applies).length})` : `Vendors (${data.tenantCount})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'features' ? (
        <Text style={adminStyles.muted}>
          “On for” counts vendors with the switch on; “used” counts vendors with activity in the last {days} days. The switch sets what NEW vendors start with.
        </Text>
      ) : (
        <View style={{ gap: 4 }}>
          <TextInput
            style={adminStyles.input}
            placeholder="Search name, slug or Business ID…"
            placeholderTextColor={THEME.colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          <View style={{ marginHorizontal: -16 }}>
            <FilterChips options={statusOptions} value={statusFilter} onChange={(v) => setStatusFilter(v)} />
          </View>
          <View style={styles.legend}>
            <FeatureChip label="on + used" tone="ok" />
            <FeatureChip label="on + idle" tone="warn" />
            <FeatureChip label="on (not tracked)" tone="primary" />
            <FeatureChip label="off" tone="muted" />
          </View>
        </View>
      )}
    </View>
  ) : null

  const confirmFeature = confirm ? featureByKey.get(confirm.flag) : undefined
  const changingExisting = confirm && confirmFeature ? (confirm.value ? total - confirmFeature.enabledCount : confirmFeature.enabledCount) : 0
  const presetAlready = confirm && data ? !!data.preset[confirm.flag] === confirm.value : false

  return (
    <AdminShell title={data?.label || businessTypeLabel(type)} subtitle={data ? `${data.tenantCount} vendors • features & usage (${days} d)` : 'Business type'} tab="more" back tabs backHref="/admin/business-types">
      {loading ? (
        <LoadingView text="Loading business type…" />
      ) : error || !data ? (
        <ErrorView message={error || 'Business type not found'} onRetry={() => load()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={adminStyles.content}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={9}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                setNotice(null)
                load(true)
              }}
            />
          }
          ListHeaderComponent={header}
          ListEmptyComponent={
            tab === 'features' ? (
              <EmptyView icon="🧩" title="No features for this type" />
            ) : data.tenants.length === 0 ? (
              <EmptyView icon="🏪" title={`No ${data.label} vendors yet`} subtitle="New vendors of this type start with the switches on the Features tab." />
            ) : (
              <Text style={adminStyles.empty}>No vendors match.</Text>
            )
          }
          ListFooterComponent={
            tab === 'features' && otherCount > 0 ? (
              <Pressable onPress={() => setShowOther((v) => !v)} style={{ paddingVertical: 6 }}>
                <Text style={styles.link}>{showOther ? 'Hide features not used by this type' : `Not used by this type (${otherCount})`}</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) =>
            item.kind === 'group' ? (
              <View style={{ gap: 6 }}>
                <SectionTitle>{item.title}</SectionTitle>
                <Card>
                  {item.features.map((f) => (
                    <FeatureRow
                      key={f.key}
                      f={f}
                      total={total}
                      days={days}
                      preset={!!data.preset[f.key]}
                      changed={data.presetOverridden.includes(f.key)}
                      canManage={canManage}
                      busy={busyFlag === f.key}
                      disabled={busyFlag !== null || applying}
                      onPreset={(v) => setPreset(f.key, v)}
                      onBulk={(v) => openBulk(f.key, v)}
                    />
                  ))}
                </Card>
              </View>
            ) : (
              <TenantRow
                t={item.tenant}
                features={data.features}
                expanded={expanded === item.tenant.id}
                onToggle={() => setExpanded((e) => (e === item.tenant.id ? null : item.tenant.id))}
                days={days}
                businessType={data.type}
              />
            )
          }
        />
      )}

      <FormModal
        visible={!!confirm}
        title={confirm && confirmFeature ? `Turn ${confirm.value ? 'on' : 'off'} “${confirmFeature.label}”?` : 'Change feature'}
        message={data ? `${data.label} vendors` : undefined}
        confirmLabel={confirm ? (confirm.value ? 'Turn on' : 'Turn off') : 'Apply'}
        danger={!!confirm && !confirm.value}
        busy={applying}
        disabled={!((scope !== 'new' && changingExisting > 0) || (scope !== 'existing' && !presetAlready))}
        onCancel={() => (applying ? undefined : setConfirm(null))}
        onConfirm={applyBulk}
      >
        {confirm && confirmFeature ? (
          <View style={{ gap: 10 }}>
            <Choice<Scope> label="Apply to" options={SCOPE_OPTIONS} value={scope} onChange={(v) => setScope(v)} />
            {scope !== 'new' ? (
              <Text style={styles.confirmLine}>
                {changingExisting === 0
                  ? `All ${total} existing ${total === 1 ? 'vendor already has' : 'vendors already have'} it ${confirm.value ? 'on' : 'off'}.`
                  : `${changingExisting} of ${total} existing ${total === 1 ? 'vendor' : 'vendors'} will change (${total - changingExisting} already ${confirm.value ? 'on' : 'off'}).`}
              </Text>
            ) : null}
            {scope !== 'existing' ? (
              <Text style={styles.confirmLine}>
                {presetAlready ? `New vendors already start with it ${confirm.value ? 'on' : 'off'}.` : `New vendors will start with it ${confirm.value ? 'on' : 'off'}.`}
              </Text>
            ) : null}
            {!confirm.value && confirmFeature.offEffect && scope !== 'new' ? <Notice tone="warn" text={`When off: ${confirmFeature.offEffect}`} /> : null}
            {!confirm.value && confirmFeature.usedCount ? (
              <Notice tone="error" text={`${confirmFeature.usedCount} ${confirmFeature.usedCount === 1 ? 'vendor used' : 'vendors used'} this in the last ${days} days.`} />
            ) : null}
            <Text style={adminStyles.muted}>Other switches and settings are not changed. The change is recorded in the audit log.</Text>
          </View>
        ) : null}
      </FormModal>
    </AdminShell>
  )
}

function FeatureRow({
  f,
  total,
  days,
  preset,
  changed,
  canManage,
  busy,
  disabled,
  onPreset,
  onBulk,
}: {
  f: TypeFeature
  total: number
  days: number
  preset: boolean
  changed: boolean
  canManage: boolean
  busy: boolean
  disabled: boolean
  onPreset: (v: boolean) => void
  onBulk: (v: boolean) => void
}) {
  const pct = total > 0 ? Math.round((f.enabledCount / total) * 100) : 0
  return (
    <View style={styles.featureRow}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={styles.featureTitle}>{f.label}</Text>
            {changed ? <Pill text="changed" tone="warn" /> : null}
          </View>
          {f.description ? (
            <Text style={adminStyles.muted} numberOfLines={2}>
              {f.description}
            </Text>
          ) : null}
          <Text style={styles.stats}>
            On for {f.enabledCount}/{total}
            {'  •  '}
            {f.usedCount === null ? 'usage not tracked' : `Used by ${f.usedCount} (${days} d)${f.activity ? ` · ${f.activity.toLocaleString()} records` : ''}`}
          </Text>
          <View style={adminStyles.bar}>
            <View style={[adminStyles.barFill, { width: `${pct}%` }]} />
          </View>
        </View>
        <View style={{ alignItems: 'center', minWidth: 64 }}>
          <Text style={styles.switchCaption}>New vendors</Text>
          {busy ? (
            <ActivityIndicator size="small" color={THEME.colors.primary} style={{ height: 31 }} />
          ) : (
            <Switch
              value={preset}
              onValueChange={onPreset}
              disabled={!canManage || disabled}
              trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
              accessibilityLabel={`New ${f.label} default`}
            />
          )}
        </View>
      </View>
      {canManage ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Pressable style={[styles.smallBtn, disabled && { opacity: 0.5 }]} disabled={disabled} onPress={() => onBulk(true)}>
            <Text style={[styles.smallBtnText, { color: THEME.colors.tertiary }]}>All on</Text>
          </Pressable>
          <Pressable style={[styles.smallBtn, disabled && { opacity: 0.5 }]} disabled={disabled} onPress={() => onBulk(false)}>
            <Text style={[styles.smallBtnText, { color: THEME.colors.error }]}>All off</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function TenantRow({
  t,
  features,
  expanded,
  onToggle,
  days,
  businessType,
}: {
  t: TypeTenant
  features: TypeFeature[]
  expanded: boolean
  onToggle: () => void
  days: number
  businessType: string
}) {
  const used = new Set(t.usedFeatures)
  const idle = new Set(t.unusedEnabled)
  const shown = expanded ? features.filter((f) => f.applies || t.featureFlags[f.key]) : []
  return (
    <Pressable style={styles.tenant} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tenantName} numberOfLines={1}>
            {t.name}
          </Text>
          <Text style={adminStyles.muted} numberOfLines={1}>
            {[t.businessId, t.slug].filter(Boolean).join(' • ')}
            {t.lastSaleAt ? ` • last sale ${timeAgo(t.lastSaleAt)}` : ' • no sales'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.sales}>{compactLKR(t.netSales30d)}</Text>
          <Text style={adminStyles.muted}>{t.receipts30d} receipts</Text>
        </View>
      </View>
      <SegmentChips businessType={businessType} segments={t.businessSegments} />
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pill text={t.status} tone={statusTone(t.status)} />
        {t.plan ? <Pill text={t.plan} tone="primary" /> : null}
        <Text style={styles.counts}>
          {t.enabledCount} on • {t.usedFeatures.length} used • {t.unusedEnabled.length} idle
        </Text>
        <Text style={styles.chevron}>{expanded ? '▴' : '▾'}</Text>
      </View>
      {expanded ? (
        <View style={{ marginTop: 10, gap: 10 }}>
          <View style={styles.chips}>
            {shown.map((f) => {
              const on = !!t.featureFlags[f.key]
              const tone = !on ? 'muted' : used.has(f.key) ? 'ok' : idle.has(f.key) ? 'warn' : 'primary'
              return <FeatureChip key={f.key} label={f.label} tone={tone} />
            })}
          </View>
          <Text style={adminStyles.muted}>
            Idle = on but no activity in {days} days. Since {new Date(t.createdAt).toLocaleDateString()}.
          </Text>
          <LinkButton label="Open vendor ›" onPress={() => router.push({ pathname: '/admin/vendors/[id]', params: { id: t.id } } as any)} />
        </View>
      ) : null}
    </Pressable>
  )
}

function FeatureChip({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'primary' | 'muted' }) {
  const bg = tone === 'ok' ? THEME.colors.tertiaryLight : tone === 'warn' ? THEME.colors.secondaryLight : tone === 'primary' ? THEME.colors.primaryLight : THEME.colors.surfaceContainerLow
  const fg = tone === 'ok' ? THEME.colors.tertiaryContainer : tone === 'warn' ? THEME.colors.onSecondaryContainer : tone === 'primary' ? THEME.colors.primary : THEME.colors.textSubtle
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color: fg }, tone === 'muted' && { textDecorationLine: 'line-through' }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 13, fontWeight: '800', color: THEME.colors.onSecondaryContainer },
  link: { fontSize: 12, fontWeight: '700', color: THEME.colors.primary },
  confirmLine: { fontSize: 13, fontWeight: '600', color: THEME.colors.text },
  featureRow: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  featureTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  stats: { fontSize: 11, fontWeight: '700', color: THEME.colors.text, marginTop: 4 },
  switchCaption: { fontSize: 9, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', marginBottom: 2 },
  smallBtn: { flex: 1, height: 34, borderRadius: 8, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { fontSize: 12, fontWeight: '800' },
  tenant: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12 },
  tenantName: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  sales: { fontSize: 13, fontWeight: '900', color: THEME.colors.text, fontFamily: 'monospace' },
  counts: { fontSize: 11, fontWeight: '700', color: THEME.colors.textMuted, flex: 1 },
  chevron: { fontSize: 14, color: THEME.colors.textSubtle, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  chipText: { fontSize: 11, fontWeight: '700' },
})
