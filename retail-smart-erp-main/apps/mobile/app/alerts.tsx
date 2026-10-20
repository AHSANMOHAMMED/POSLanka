// Alerts inbox + "My alerts" preferences.
//   GET  /api/notifications            inbox (paged) + unreadCount
//   POST /api/notifications/read       { ids } | { all: true }
//   GET/PUT /api/notifications/preferences
// Tapping an alert marks it read and deep-links like a push tap (data.screen).
import React, { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, Pressable, TouchableOpacity, RefreshControl, Switch, ScrollView, TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { api, apiGet, apiPost } from '../src/lib/api'
import { openNotificationTarget } from '../src/lib/notifications'
import { THEME } from '../src/lib/theme'
import { LoadingView, EmptyView, ErrorView } from '../src/components/StateViews'

interface InboxItem {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

interface Prefs {
  enabledTypes: string[] | null
  mutedTypes: string[]
  quietStart: string | null
  quietEnd: string | null
  timezone: string | null
  digestHour: number | null
  pushEnabled: boolean
}

interface TypeInfo { type: string; label: string; description: string; group: string }

const PAGE_SIZE = 20
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DIGEST_CHOICES: Array<number | null> = [null, 6, 7, 8, 9, 10, 12, 18, 20]

function relTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const ICONS: Record<string, string> = {
  low_stock: '📉', out_of_stock: '⛔', expiring_stock: '⏳', stock_digest: '📦', large_refund: '💸', sale_void: '🚫',
  manual_return: '↩', shift_variance: '🧮', offline_sale_rejected: '📴', offline_price_difference: '🏷️',
  intake_sync_errors: '⚠️', intake_awaiting_approval: '📥', requisition_submitted: '📝', advance_requested: '💰',
  subscription_expiring: '📅', import_finished: '✅',
}

export default function AlertsScreen() {
  const [tab, setTab] = useState<'inbox' | 'settings'>('inbox')
  const [items, setItems] = useState<InboxItem[]>([])
  const [unread, setUnread] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (nextPage = 1) => {
    const res = await apiGet<{ data: InboxItem[]; unreadCount: number; pagination: { totalPages: number } }>(
      `/api/notifications?page=${nextPage}&pageSize=${PAGE_SIZE}`,
    )
    if (!res.ok || !res.data) {
      setError(res.error || 'Could not load alerts')
      return
    }
    setError(null)
    const list = res.data.data || []
    setItems((prev) => (nextPage === 1 ? list : [...prev, ...list.filter((i) => !prev.some((p) => p.id === i.id))]))
    setUnread(res.data.unreadCount || 0)
    setPage(nextPage)
    setHasMore(nextPage < (res.data.pagination?.totalPages || 1))
  }, [])

  useEffect(() => {
    load(1).finally(() => setLoading(false))
  }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load(1)
    setRefreshing(false)
  }

  async function markRead(body: { ids?: string[]; all?: true }) {
    const res = await apiPost<{ unreadCount: number }>('/api/notifications/read', body)
    if (!res.ok) return
    const now = new Date().toISOString()
    setItems((prev) => prev.map((i) => (body.all || body.ids?.includes(i.id) ? { ...i, readAt: i.readAt || now } : i)))
    if (typeof res.data?.unreadCount === 'number') setUnread(res.data.unreadCount)
  }

  function openItem(item: InboxItem) {
    if (!item.readAt) void markRead({ ids: [item.id] })
    if (!openNotificationTarget(item.data)) {
      Alert.alert(item.title, item.body || '')
    }
  }

  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/pos'))} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Alerts</Text>
          <Text style={styles.sub}>{unread > 0 ? `${unread} unread` : 'All caught up'}</Text>
        </View>
        {tab === 'inbox' && unread > 0 ? (
          <TouchableOpacity onPress={() => markRead({ all: true })} style={styles.headerAction}>
            <Text style={styles.headerActionText}>Read all</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 64 }} />}
      </View>

      <View style={styles.tabs}>
        {(['inbox', 'settings'] as const).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'inbox' ? 'Inbox' : 'My alerts'}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'settings' ? (
        <PreferencesView />
      ) : loading ? (
        <LoadingView text="Loading alerts…" />
      ) : error && items.length === 0 ? (
        <ErrorView message={error} onRetry={() => { setLoading(true); load(1).finally(() => setLoading(false)) }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={items.length === 0 ? { flex: 1 } : { padding: THEME.spacing.lg, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyView icon="🔔" title="No alerts yet" subtitle="Low stock, refunds, approvals and reminders appear here." />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasMore) void load(page + 1) }}
          renderItem={({ item }) => (
            <Pressable style={[styles.card, !item.readAt && styles.cardUnread]} onPress={() => openItem(item)}>
              <Text style={styles.icon}>{ICONS[item.type] || '🔔'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {item.body ? <Text style={styles.cardBody} numberOfLines={3}>{item.body}</Text> : null}
                <Text style={styles.cardTime}>{relTime(item.createdAt)}</Text>
              </View>
              {!item.readAt ? <View style={styles.dot} /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

function PreferencesView() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [types, setTypes] = useState<TypeInfo[]>([])
  const [tenantTz, setTenantTz] = useState('Asia/Colombo')
  const [quietStart, setQuietStart] = useState('')
  const [quietEnd, setQuietEnd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await apiGet<{ preferences: Prefs; types: TypeInfo[]; tenantTimezone: string }>('/api/notifications/preferences')
    if (!res.ok || !res.data) {
      setError(res.error || 'Could not load preferences')
      return
    }
    setError(null)
    setPrefs(res.data.preferences)
    setTypes(res.data.types || [])
    setTenantTz(res.data.tenantTimezone || 'Asia/Colombo')
    setQuietStart(res.data.preferences.quietStart || '')
    setQuietEnd(res.data.preferences.quietEnd || '')
  }, [])

  useEffect(() => { void load() }, [load])

  if (error) return <ErrorView message={error} onRetry={load} />
  if (!prefs) return <LoadingView text="Loading preferences…" />

  const muted = new Set(prefs.mutedTypes)
  const setType = (type: string, on: boolean) => {
    const next = new Set(prefs.mutedTypes)
    if (on) next.delete(type)
    else next.add(type)
    setPrefs({ ...prefs, mutedTypes: [...next] })
  }

  async function save() {
    if (!prefs) return
    const qs = quietStart.trim()
    const qe = quietEnd.trim()
    if ((qs || qe) && (!HHMM.test(qs) || !HHMM.test(qe))) {
      Alert.alert('Quiet hours', 'Enter both times as HH:MM (24h), e.g. 22:00 and 07:00 — or leave both empty.')
      return
    }
    setSaving(true)
    const res = await api<{ preferences: Prefs }>('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        enabledTypes: prefs.enabledTypes ?? undefined,
        mutedTypes: prefs.mutedTypes,
        quietStart: qs || undefined,
        quietEnd: qe || undefined,
        timezone: prefs.timezone || undefined,
        digestHour: prefs.digestHour ?? undefined,
        pushEnabled: prefs.pushEnabled,
      }),
    })
    setSaving(false)
    if (!res.ok || !res.data) {
      Alert.alert('Not saved', res.error || 'Could not save your preferences.')
      return
    }
    setPrefs(res.data.preferences)
    Alert.alert('Saved', 'Your alert preferences were updated.')
  }

  const groups = Array.from(new Set(types.map((t) => t.group)))

  return (
    <ScrollView contentContainerStyle={{ padding: THEME.spacing.lg, paddingBottom: 60 }}>
      <View style={styles.section}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Push notifications</Text>
            <Text style={styles.rowSub}>Alerts always stay in the inbox</Text>
          </View>
          <Switch value={prefs.pushEnabled} onValueChange={(v) => setPrefs({ ...prefs, pushEnabled: v })} trackColor={{ true: THEME.colors.primary }} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quiet hours ({prefs.timezone || tenantTz})</Text>
        <Text style={styles.rowSub}>No push during these hours; alerts still reach the inbox.</Text>
        <View style={[styles.row, { gap: 8 }]}>
          <TextInput style={styles.input} value={quietStart} onChangeText={setQuietStart} placeholder="22:00" maxLength={5} keyboardType="numbers-and-punctuation" />
          <Text style={styles.rowSub}>to</Text>
          <TextInput style={styles.input} value={quietEnd} onChangeText={setQuietEnd} placeholder="07:00" maxLength={5} keyboardType="numbers-and-punctuation" />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Daily digest</Text>
        <Text style={styles.rowSub}>Low-stock summary and expiring stock, once a day</Text>
        <View style={styles.chips}>
          {(DIGEST_CHOICES.includes(prefs.digestHour) ? DIGEST_CHOICES : [...DIGEST_CHOICES, prefs.digestHour]).map((h) => (
            <Pressable key={String(h)} style={[styles.chip, prefs.digestHour === h && styles.chipActive]} onPress={() => setPrefs({ ...prefs, digestHour: h })}>
              <Text style={[styles.chipText, prefs.digestHour === h && styles.chipTextActive]}>{h === null ? 'Off' : `${String(h).padStart(2, '0')}:00`}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {groups.map((g) => (
        <View key={g} style={styles.section}>
          <Text style={styles.sectionTitle}>{g}</Text>
          {types.filter((t) => t.group === g).map((t) => (
            <View key={t.type} style={styles.row}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.rowTitle}>{t.label}</Text>
                <Text style={styles.rowSub}>{t.description}</Text>
              </View>
              <Switch value={!muted.has(t.type)} onValueChange={(v) => setType(t.type, v)} trackColor={{ true: THEME.colors.primary }} />
            </View>
          ))}
        </View>
      ))}

      <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save my alerts</Text>}
      </Pressable>
    </ScrollView>
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
  title: { fontSize: 14, fontWeight: '700', color: THEME.colors.primary },
  sub: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textMuted },
  headerAction: { width: 64, alignItems: 'flex-end' },
  headerActionText: { fontSize: 12, fontWeight: '700', color: THEME.colors.primary },
  tabs: { flexDirection: 'row', backgroundColor: THEME.colors.card, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: THEME.colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: THEME.colors.textMuted },
  tabTextActive: { color: THEME.colors.primary },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: THEME.colors.card, padding: 12,
    borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border, marginBottom: 8,
  },
  cardUnread: { borderColor: THEME.colors.primary, backgroundColor: THEME.colors.primaryLight },
  icon: { fontSize: 20, marginTop: 1 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  cardBody: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  cardTime: { fontSize: 10, color: THEME.colors.textSubtle, marginTop: 4, fontFamily: 'monospace' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: THEME.colors.primary, marginTop: 6 },
  section: { backgroundColor: THEME.colors.card, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: THEME.colors.text, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  rowTitle: { fontSize: 13, fontWeight: '600', color: THEME.colors.text },
  rowSub: { fontSize: 11, color: THEME.colors.textMuted },
  input: {
    flex: 1, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: THEME.radius.md, paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: 'monospace', fontSize: 14, color: THEME.colors.text, backgroundColor: THEME.colors.surface,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: THEME.radius.full, backgroundColor: THEME.colors.surfaceContainerHigh },
  chipActive: { backgroundColor: THEME.colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: THEME.colors.textMuted },
  chipTextActive: { color: THEME.colors.onPrimary },
  saveBtn: { backgroundColor: THEME.colors.primary, borderRadius: THEME.radius.lg, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
})
