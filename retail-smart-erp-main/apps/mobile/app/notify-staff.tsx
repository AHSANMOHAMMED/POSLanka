// Compose a staff push + inbox message (managers / owners only — server enforces manageUsers).
// POST /api/staff/notifications → deliverAlert('staff_announcement') → Expo push on phones.
import React, { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, RefreshControl,
} from 'react-native'
import { apiGet, apiPost } from '../src/lib/api'
import { THEME } from '../src/lib/theme'
import { LoadingView, ErrorView } from '../src/components/StateViews'
import { ScreenHeader } from '../src/components/ui'
import { Field } from '../src/components/FormKit'

type Audience = 'selected' | 'managers' | 'all'
interface StaffRow { id: string; fullName: string; role: string }

export default function NotifyStaffScreen() {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [canBroadcastAll, setCanBroadcastAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audience, setAudience] = useState<Audience>('selected')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const res = await apiGet<{ staff: StaffRow[]; canBroadcastAll: boolean }>('/api/staff/notifications')
    if (!res.ok || !res.data) {
      setError(res.error || 'Could not load colleagues')
      return
    }
    setError(null)
    setStaff(res.data.staff || [])
    setCanBroadcastAll(!!res.data.canBroadcastAll)
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  function toggle(id: string) {
    setPicked((p) => ({ ...p, [id]: !p[id] }))
  }

  async function send() {
    const t = title.trim()
    const b = body.trim()
    if (t.length < 3) return Alert.alert('Title', 'Enter a short title (3+ characters).')
    if (b.length < 3) return Alert.alert('Message', 'Enter a message (3+ characters).')
    const userIds = Object.keys(picked).filter((id) => picked[id])
    if (audience === 'selected' && userIds.length === 0) {
      return Alert.alert('Recipients', 'Pick at least one colleague, or choose Managers / Everyone.')
    }
    setSending(true)
    const res = await apiPost<{ recipients: number; pushSent: number; inApp: number }>('/api/staff/notifications', {
      title: t,
      body: b,
      audience,
      userIds: audience === 'selected' ? userIds : [],
    })
    setSending(false)
    if (!res.ok) return Alert.alert('Not sent', res.error || 'Could not send.')
    const r = res.data
    Alert.alert(
      'Sent',
      `Delivered to ${r?.recipients ?? 0} staff · ${r?.inApp ?? 0} inbox · ${r?.pushSent ?? 0} phone push${(r?.pushSent ?? 0) === 1 ? '' : 'es'}.`,
    )
    setTitle('')
    setBody('')
    setPicked({})
  }

  if (loading) return <LoadingView text="Loading staff…" />
  if (error && staff.length === 0) return <ErrorView message={error} onRetry={() => { setLoading(true); load().finally(() => setLoading(false)) }} />

  const audiences: Array<{ value: Audience; label: string; hint: string; hide?: boolean }> = [
    { value: 'selected', label: 'Selected', hint: 'Pick up to 20 colleagues below' },
    { value: 'managers', label: 'Managers', hint: 'Owners & managers', hide: !canBroadcastAll },
    { value: 'all', label: 'Everyone', hint: 'All active staff (1×/day)', hide: !canBroadcastAll },
  ]

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Notify staff" subtitle="Push + inbox on their phones" />
      <ScrollView
        contentContainerStyle={{ padding: THEME.spacing.lg, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)) }} />}
      >
        <Text style={styles.hint}>
          Managers only. Message reaches the Alerts inbox and, when push is allowed, their phone.
        </Text>

        <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Need change at counter 2" autoCapitalize="sentences" />
        <Field label="Message" value={body} onChangeText={setBody} placeholder="What should they know?" multiline autoCapitalize="sentences" />

        {(title.trim() || body.trim()) ? (
          <View style={styles.preview} accessibilityRole="summary">
            <Text style={styles.previewLabel}>Preview</Text>
            <Text style={styles.rowTitle}>{title.trim() || 'Title'}</Text>
            <Text style={styles.sub}>{body.trim() || 'Message'}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Send to</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {audiences.filter((a) => !a.hide).map((a) => (
            <Pressable
              key={a.value}
              style={[styles.chip, audience === a.value && styles.chipOn]}
              onPress={() => setAudience(a.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: audience === a.value }}
              accessibilityLabel={a.label}
            >
              <Text style={[styles.chipText, audience === a.value && styles.chipTextOn]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sub}>{audiences.find((a) => a.value === audience)?.hint}</Text>

        {audience === 'selected' && (
          <View style={styles.list}>
            {staff.length === 0 ? (
              <Text style={styles.sub}>No other staff in this company.</Text>
            ) : staff.map((s) => {
              const on = !!picked[s.id]
              return (
                <Pressable
                  key={s.id}
                  style={[styles.row, on && styles.rowOn]}
                  onPress={() => toggle(s.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${s.fullName}, ${s.role}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{s.fullName}</Text>
                    <Text style={styles.sub}>{s.role}</Text>
                  </View>
                  <Text style={styles.check}>{on ? '✓' : ''}</Text>
                </Pressable>
              )
            })}
          </View>
        )}

        <Pressable style={[styles.send, sending && { opacity: 0.6 }]} onPress={send} disabled={sending} accessibilityRole="button" accessibilityLabel="Send notification">
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Send notification</Text>}
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.colors.surface },
  hint: { fontSize: 13, color: THEME.colors.textMuted, marginBottom: 14, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted, marginBottom: 6, marginTop: 4 },
  sub: { fontSize: 11, color: THEME.colors.textMuted, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: THEME.radius.full, backgroundColor: THEME.colors.card, borderWidth: 1, borderColor: THEME.colors.border },
  chipOn: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  chipTextOn: { color: THEME.colors.onPrimary },
  list: { marginTop: 4, marginBottom: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: THEME.radius.lg, backgroundColor: THEME.colors.card, borderWidth: 1, borderColor: THEME.colors.border },
  rowOn: { borderColor: THEME.colors.primary, backgroundColor: THEME.colors.primaryLight },
  rowTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  check: { fontSize: 18, fontWeight: '800', color: THEME.colors.primary, width: 24, textAlign: 'center' },
  preview: { backgroundColor: THEME.colors.card, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 10 },
  previewLabel: { fontSize: 11, fontWeight: '800', color: THEME.colors.textMuted, marginBottom: 4, textTransform: 'uppercase' },
  send: { marginTop: 8, backgroundColor: THEME.colors.primary, borderRadius: THEME.radius.lg, paddingVertical: 14, alignItems: 'center' },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '800' },
})
