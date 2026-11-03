// Payments: bank-transfer slips (review lives in Approvals) and PayHere card payments with refunds.
// APIs: payments, payhere-transactions, POST payhere-transactions/[id]/refund (billing).
import React, { useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, RefreshControl, TextInput, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { adminPost, useAdminUser } from '../../src/lib/adminApi'
import { THEME } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Pill, adminStyles, statusTone } from '../../src/components/admin/AdminShell'
import { Btn, Field, FilterChips, FormModal, ListFooter, MoreShell, Notice } from '../../src/components/admin/AdminForm'
import { alertIfFailed, fmtDateTime, fmtMoney, parseNum, titleCase, usePagedList } from '../../src/lib/adminForms'

type Source = 'bank' | 'payhere'

interface Slip {
  id: string
  amount: string | number
  currency?: string
  bankReference?: string | null
  status: 'pending' | 'approved' | 'rejected' | string
  createdAt: string
  isWalletDeposit?: boolean
  periodMonths?: number
  account?: { email?: string; fullName?: string } | null
  tenant?: { name?: string } | null
  pendingCompany?: { name?: string } | null
}

interface PayhereTx {
  id: string
  orderId: string
  payherePaymentId?: string | null
  amount: string | number
  currency?: string
  status: string
  paymentMethod?: string | null
  description?: string | null
  billingCycle?: string | null
  refundStatus?: string | null
  refundedAmount?: string | number | null
  refundError?: string | null
  createdAt: string
  paidAt?: string | null
  account?: { email?: string; fullName?: string } | null
  tenant?: { name?: string } | null
}

const SLIP_STATUSES = ['pending', 'approved', 'rejected', 'all'] as const
const PAYHERE_STATUSES = ['all', 'success', 'pending', 'failed', 'cancelled', 'refunded', 'charged_back'] as const

function refundable(t: PayhereTx): number {
  if (t.status !== 'success') return 0
  if (t.refundStatus === 'processing' || t.refundStatus === 'refunded') return 0
  return Math.max(0, Number(t.amount) - Number(t.refundedAmount || 0))
}

export default function AdminPaymentsScreen() {
  const { can } = useAdminUser()
  const canBill = can('billing')
  const [source, setSource] = useState<Source>('bank')
  const [slipStatus, setSlipStatus] = useState<(typeof SLIP_STATUSES)[number]>('pending')
  const [phStatus, setPhStatus] = useState<(typeof PAYHERE_STATUSES)[number]>('all')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const slips = usePagedList<Slip>({
    path: (page) => {
      const p = new URLSearchParams({ page: String(page), pageSize: '25', status: slipStatus })
      if (debounced) p.set('q', debounced)
      return `/api/sys-control/payments?${p.toString()}`
    },
    pick: (b) => ({ rows: Array.isArray(b?.payments) ? b.payments : [], total: b?.pagination?.total }),
    deps: [slipStatus, debounced],
    enabled: source === 'bank',
  })
  const payhere = usePagedList<PayhereTx>({
    path: (page) => {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (phStatus !== 'all') p.set('status', phStatus)
      if (debounced) p.set('q', debounced)
      return `/api/sys-control/payhere-transactions?${p.toString()}`
    },
    pick: (b) => ({ rows: Array.isArray(b?.transactions) ? b.transactions : [], total: b?.pagination?.total }),
    deps: [phStatus, debounced],
    enabled: source === 'payhere',
  })
  const refundsConfigured = payhere.extra?.refundsConfigured !== false
  const slipCounts: Record<string, number> = slips.extra?.statusCounts || {}
  const phTotals: Record<string, { count: number; amount: number }> = payhere.extra?.statusTotals || {}

  const [refundTx, setRefundTx] = useState<PayhereTx | null>(null)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function openRefund(t: PayhereTx) {
    setRefundTx(t)
    setReason('')
    setAmount('')
    setFormError(null)
  }

  async function submitRefund() {
    if (!refundTx) return
    const max = refundable(refundTx)
    if (reason.trim().length < 3) return setFormError('Give a short reason (3+ characters).')
    const amt = amount.trim() ? parseNum(amount) : undefined
    if (amount.trim() && (amt === undefined || amt <= 0)) return setFormError('Enter a valid amount, or leave blank to refund everything left.')
    if (amt !== undefined && amt > max + 0.001) return setFormError(`At most ${fmtMoney(max, refundTx.currency)} can still be refunded.`)
    setBusy(true)
    const res = await adminPost(`/api/sys-control/payhere-transactions/${refundTx.id}/refund`, { reason: reason.trim(), ...(amt !== undefined ? { amount: amt } : {}) })
    setBusy(false)
    if (!alertIfFailed(res, 'Refund failed')) return
    setRefundTx(null)
    payhere.silentReload()
  }

  const active = source === 'bank' ? slips : payhere

  return (
    <MoreShell title="Payments" subtitle={`${active.total} ${source === 'bank' ? 'bank slips' : 'PayHere payments'}`}>
      <View style={[adminStyles.segment, { paddingHorizontal: 16, paddingTop: 12 }]}>
        {(['bank', 'payhere'] as Source[]).map((s) => (
          <Pressable key={s} style={[adminStyles.segmentBtn, source === s && adminStyles.segmentBtnActive]} onPress={() => setSource(s)}>
            <Text style={[adminStyles.segmentText, source === s && adminStyles.segmentTextActive]}>{s === 'bank' ? 'Bank slips' : 'PayHere'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.searchWrap}>
        <TextInput
          style={adminStyles.input}
          placeholder={source === 'bank' ? 'Search email, vendor or reference…' : 'Search order, payment id, email or vendor…'}
          placeholderTextColor={THEME.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {source === 'bank' ? (
        <FilterChips value={slipStatus} onChange={(v) => setSlipStatus(v)} options={SLIP_STATUSES.map((s) => ({ value: s, label: titleCase(s), count: s === 'all' ? undefined : slipCounts[s] }))} />
      ) : (
        <FilterChips value={phStatus} onChange={(v) => setPhStatus(v)} options={PAYHERE_STATUSES.map((s) => ({ value: s, label: titleCase(s), count: s === 'all' ? undefined : phTotals[s]?.count }))} />
      )}

      {source === 'bank' ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Btn label={`Review pending slips (${slipCounts.pending ?? 0})`} tone="ghost" onPress={() => router.push('/admin/approvals' as any)} />
        </View>
      ) : null}

      {active.loading ? (
        <LoadingView text="Loading payments…" />
      ) : active.error ? (
        <ErrorView message={active.error} onRetry={active.reload} />
      ) : source === 'bank' ? (
        <FlatList
          data={slips.rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={adminStyles.content}
          refreshControl={<RefreshControl refreshing={slips.refreshing} onRefresh={slips.refresh} />}
          onEndReached={slips.loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Text style={adminStyles.empty}>No bank slips in this state.</Text>}
          ListFooterComponent={<ListFooter loadingMore={slips.loadingMore} hasMore={slips.hasMore} shown={slips.rows.length} total={slips.total} onMore={slips.loadMore} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.isWalletDeposit ? 'Wallet top-up' : item.pendingCompany?.name ? `${item.pendingCompany.name} · activation` : item.tenant?.name || 'Subscription payment'}
                </Text>
                <Text style={adminStyles.muted} numberOfLines={1}>{item.account?.fullName || item.account?.email || ''}</Text>
                <Text style={adminStyles.muted} numberOfLines={1}>
                  {item.bankReference ? `Ref ${item.bankReference} · ` : ''}{fmtDateTime(item.createdAt)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                  <Pill text={item.status} tone={item.status === 'approved' ? 'ok' : item.status === 'rejected' ? 'error' : 'warn'} />
                </View>
              </View>
              <Text style={styles.amount}>{fmtMoney(item.amount, item.currency)}</Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={payhere.rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={adminStyles.content}
          refreshControl={<RefreshControl refreshing={payhere.refreshing} onRefresh={payhere.refresh} />}
          onEndReached={payhere.loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={!refundsConfigured ? <Notice tone="warn" text="PayHere refunds are not configured on the server (PAYHERE_APP_ID / PAYHERE_APP_SECRET), so refunds are unavailable." /> : null}
          ListEmptyComponent={<Text style={adminStyles.empty}>No PayHere payments match.</Text>}
          ListFooterComponent={<ListFooter loadingMore={payhere.loadingMore} hasMore={payhere.hasMore} shown={payhere.rows.length} total={payhere.total} onMore={payhere.loadMore} />}
          renderItem={({ item }) => {
            const left = refundable(item)
            return (
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.tenant?.name || item.account?.fullName || item.account?.email || item.orderId}</Text>
                  <Text style={adminStyles.muted} numberOfLines={1}>{item.description || item.orderId}</Text>
                  <Text style={adminStyles.muted} numberOfLines={1}>
                    {item.paymentMethod ? `${item.paymentMethod} · ` : ''}{fmtDateTime(item.paidAt || item.createdAt)}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Pill text={item.status} tone={item.status === 'success' ? 'ok' : statusTone(item.status) === 'muted' ? 'muted' : 'error'} />
                    {item.refundStatus ? <Pill text={`refund: ${item.refundStatus}${Number(item.refundedAmount) ? ` ${fmtMoney(item.refundedAmount, item.currency)}` : ''}`} tone={item.refundStatus === 'failed' ? 'error' : 'warn'} /> : null}
                  </View>
                  {item.refundError ? <Text style={[adminStyles.muted, { color: THEME.colors.error }]} numberOfLines={2}>{item.refundError}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={styles.amount}>{fmtMoney(item.amount, item.currency)}</Text>
                  {canBill && refundsConfigured && left > 0 ? (
                    <Pressable style={styles.refundBtn} onPress={() => openRefund(item)}>
                      <Text style={styles.refundText}>Refund</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )
          }}
        />
      )}

      <FormModal
        visible={!!refundTx}
        title="Refund payment"
        message={refundTx ? `${refundTx.tenant?.name || refundTx.account?.email || refundTx.orderId} · paid ${fmtMoney(refundTx.amount, refundTx.currency)} · refundable ${fmtMoney(refundable(refundTx), refundTx.currency)}` : undefined}
        confirmLabel="Refund"
        danger
        busy={busy}
        onCancel={() => setRefundTx(null)}
        onConfirm={submitRefund}
      >
        <Field label="Reason *" value={reason} onChangeText={setReason} autoCapitalize="sentences" />
        <Field label="Amount (blank = everything left)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Notice tone="warn" text="The refund goes through PayHere to the customer's card. The subscription is not changed; shorten or end it separately if needed." />
        {formError ? <View style={{ marginTop: 8 }}><Notice tone="error" text={formError} /></View> : null}
      </FormModal>
    </MoreShell>
  )
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 8 },
  name: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  amount: { fontSize: 13, fontWeight: '800', color: THEME.colors.text, fontFamily: 'monospace' },
  refundBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: THEME.colors.error },
  refundText: { fontSize: 11, fontWeight: '800', color: THEME.colors.error },
})
