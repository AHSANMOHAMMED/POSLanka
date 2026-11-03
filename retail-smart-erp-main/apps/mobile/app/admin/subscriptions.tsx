// Subscriptions: list + extend months / set end date / lock / unlock via PUT subscriptions/[id].
// Listing needs read; the actions need billing (the server checks again).
import React, { useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, RefreshControl, TextInput, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { adminPut, useAdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Pill, adminStyles, statusTone } from '../../src/components/admin/AdminShell'
import { Btn, Choice, Field, FilterChips, FormModal, ListFooter, MoreShell, Notice } from '../../src/components/admin/AdminForm'
import { alertIfFailed, fmtBytes, fmtDate, isDateOnly, parseIntStrict, titleCase, usePagedList } from '../../src/lib/adminForms'

interface SubRow {
  id: string
  status: string
  billingCycle?: string | null
  currentPeriodEnd?: string | null
  trialEndsAt?: string | null
  tenant?: { id: string; name: string; slug: string; businessId?: string; status?: string } | null
  tier?: { id?: string; displayName?: string; name?: string } | null
  billingAccount?: { email?: string; fullName?: string } | null
  usage?: { storageBytes: number; fileStorageBytes: number }
}

type Action = 'extend' | 'date' | 'lock' | 'unlock'
const STATUSES = ['all', 'trial', 'active', 'past_due', 'locked', 'cancelled'] as const

export default function AdminSubscriptionsScreen() {
  const { can } = useAdminUser()
  const canBill = can('billing')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
  const [expiring, setExpiring] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const list = usePagedList<SubRow>({
    path: (page) => {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (status !== 'all') p.set('status', status)
      if (expiring) p.set('view', 'expiring')
      if (debounced) p.set('q', debounced)
      return `/api/sys-control/subscriptions?${p.toString()}`
    },
    pick: (b) => ({ rows: Array.isArray(b?.subscriptions) ? b.subscriptions : [], total: b?.pagination?.total }),
    deps: [status, expiring, debounced],
  })
  const counts: Record<string, number> = list.extra?.statusCounts || {}

  const [selected, setSelected] = useState<SubRow | null>(null)
  const [action, setAction] = useState<Action>('extend')
  const [months, setMonths] = useState('1')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [grant, setGrant] = useState('0')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function open(row: SubRow) {
    setSelected(row)
    setAction(row.status === 'locked' ? 'unlock' : 'extend')
    setMonths('1')
    setEndDate('')
    setReason('')
    setGrant('0')
    setFormError(null)
  }

  async function submit() {
    if (!selected) return
    const body: Record<string, unknown> = {}
    if (action === 'extend') {
      const m = parseIntStrict(months)
      if (!m || m === 0 || Math.abs(m) > 120) return setFormError('Enter a whole number of months (not 0, e.g. 1 or -1).')
      body.extendMonths = m
      if (reason.trim()) body.reason = reason.trim()
    } else if (action === 'date') {
      if (!isDateOnly(endDate.trim())) return setFormError('Use the format YYYY-MM-DD.')
      if (new Date(`${endDate.trim()}T23:59:59`).getTime() < Date.now()) return setFormError('The end date cannot be in the past.')
      body.setEndDate = new Date(`${endDate.trim()}T23:59:59`).toISOString()
      if (reason.trim()) body.reason = reason.trim()
    } else if (action === 'lock') {
      if (reason.trim().length < 3) return setFormError('Give a short reason for the lock (3+ characters).')
      body.lock = true
      body.lockReason = reason.trim()
    } else {
      const g = parseIntStrict(grant) ?? 0
      if (g < 0 || g > 12) return setFormError('Free months must be between 0 and 12.')
      body.unlock = true
      if (g > 0) body.unlockGrantMonths = g
      if (reason.trim()) body.reason = reason.trim()
    }
    setBusy(true)
    const res = await adminPut(`/api/sys-control/subscriptions/${selected.id}`, body)
    setBusy(false)
    if (!alertIfFailed(res, 'Update failed')) return
    setSelected(null)
    list.silentReload()
  }

  const locked = selected?.status === 'locked'

  return (
    <MoreShell title="Subscriptions" subtitle={`${list.total} subscriptions${expiring ? ' · expiring ≤ 7 days' : ''}`}>
      <View style={styles.searchWrap}>
        <TextInput
          style={adminStyles.input}
          placeholder="Search vendor, slug, Business ID or owner…"
          placeholderTextColor={THEME.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <FilterChips
        value={status}
        onChange={setStatus}
        options={STATUSES.map((s) => ({ value: s, label: s === 'all' ? 'All' : titleCase(s), count: s === 'all' ? undefined : counts[s] }))}
      />
      <Pressable style={styles.expiringRow} onPress={() => setExpiring((v) => !v)}>
        <Pill text={expiring ? 'expiring soon: on' : 'expiring soon: off'} tone={expiring ? 'warn' : 'muted'} />
      </Pressable>

      {list.loading ? (
        <LoadingView text="Loading subscriptions…" />
      ) : list.error ? (
        <ErrorView message={list.error} onRetry={list.reload} />
      ) : (
        <FlatList
          data={list.rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={adminStyles.content}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Text style={adminStyles.empty}>No subscriptions match.</Text>}
          ListFooterComponent={<ListFooter loadingMore={list.loadingMore} hasMore={list.hasMore} shown={list.rows.length} total={list.total} onMore={list.loadMore} />}
          renderItem={({ item }) => {
            const end = item.status === 'trial' ? item.trialEndsAt || item.currentPeriodEnd : item.currentPeriodEnd
            return (
              <Pressable style={styles.row} onPress={() => open(item)}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.tenant?.name || 'Unknown vendor'}</Text>
                  <Text style={adminStyles.muted} numberOfLines={1}>
                    {item.tier?.displayName || item.tier?.name || '—'} · {item.billingCycle || 'monthly'} · ends {fmtDate(end)}
                  </Text>
                  <Text style={adminStyles.muted} numberOfLines={1}>
                    {item.billingAccount?.email || ''}
                    {item.usage ? ` · ${fmtBytes(item.usage.storageBytes)} db` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                    <Pill text={item.status} tone={statusTone(item.status)} />
                    {item.tenant?.status && item.tenant.status !== 'active' ? <Pill text={`vendor ${item.tenant.status}`} tone="error" /> : null}
                  </View>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )
          }}
        />
      )}

      <FormModal
        visible={!!selected}
        title={selected?.tenant?.name || 'Subscription'}
        message={selected ? `${selected.tier?.displayName || ''} · ${selected.status} · ends ${fmtDate(selected.status === 'trial' ? selected.trialEndsAt || selected.currentPeriodEnd : selected.currentPeriodEnd)}` : undefined}
        confirmLabel={canBill ? (action === 'lock' ? 'Lock' : action === 'unlock' ? 'Unlock' : 'Apply') : null}
        danger={action === 'lock'}
        busy={busy}
        onCancel={() => setSelected(null)}
        onConfirm={submit}
      >
        {!canBill ? <Notice tone="warn" text="Changing subscriptions needs the Billing or Owner role." /> : null}
        {canBill ? (
          <>
            <Choice
              value={action}
              onChange={(a) => { setAction(a); setFormError(null) }}
              options={[
                { value: 'extend', label: 'Extend months' },
                { value: 'date', label: 'Set end date' },
                ...(locked ? [{ value: 'unlock' as const, label: 'Unlock' }] : [{ value: 'lock' as const, label: 'Lock' }]),
              ]}
            />
            {action === 'extend' ? <Field label="Months to add" value={months} onChangeText={setMonths} keyboardType="numbers-and-punctuation" hint="Counted from the later of today and the current end. Negative values shorten." /> : null}
            {action === 'date' ? <Field label="New end date" value={endDate} onChangeText={setEndDate} placeholder="2027-01-31" keyboardType="numbers-and-punctuation" hint="Reactivates a past-due, cancelled or locked subscription." /> : null}
            {action === 'unlock' ? <Field label="Free months to grant (0–12)" value={grant} onChangeText={setGrant} keyboardType="number-pad" hint="0 resumes on the subscription's own dates." /> : null}
            <Field label={action === 'lock' ? 'Lock reason *' : 'Reason (audit log)'} value={reason} onChangeText={setReason} autoCapitalize="sentences" />
            {action === 'lock' ? <Notice tone="warn" text="Locking blocks the vendor's staff from signing in until unlocked." /> : null}
            {formError ? <Notice tone="error" text={formError} /> : null}
          </>
        ) : null}
        {selected?.tenant?.id ? (
          <Btn
            label="Open vendor"
            tone="ghost"
            style={{ marginTop: 10 }}
            onPress={() => {
              const id = selected.tenant!.id
              setSelected(null)
              router.push({ pathname: '/admin/vendors/[id]', params: { id } } as any)
            }}
          />
        ) : null}
      </FormModal>
    </MoreShell>
  )
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 12 },
  expiringRow: { paddingHorizontal: 16, paddingBottom: 4, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 8 },
  name: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  chevron: { fontSize: 22, color: THEME.colors.textSubtle, fontWeight: '700' },
})
