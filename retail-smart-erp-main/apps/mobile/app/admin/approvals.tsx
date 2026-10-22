import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, Modal, TextInput, ActivityIndicator, Alert, StyleSheet, RefreshControl } from 'react-native'
import * as Linking from 'expo-linking'
import { adminGet, adminList, adminPut, useAdminUser } from '../../src/lib/adminApi'
import { THEME, formatLKR } from '../../src/lib/theme'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { AdminShell, Pill, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'

type Filter = 'pending' | 'approved' | 'rejected'

interface PaymentDeposit {
  id: string
  amount: string | number
  currency?: string
  bankReference?: string | null
  depositDate?: string
  receiptUrl?: string | null
  notes?: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewNotes?: string | null
  reviewedAt?: string | null
  periodMonths?: number
  isWalletDeposit?: boolean
  pendingCompanyId?: string | null
  createdAt: string
  account?: { email?: string; fullName?: string } | null
  subscription?: { status?: string; tenant?: { name?: string; slug?: string } | null } | null
}

export default function AdminApprovalsScreen() {
  const [filter, setFilter] = useState<Filter>('pending')
  const [rows, setRows] = useState<PaymentDeposit[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<{ payment: PaymentDeposit; decision: 'approved' | 'rejected' } | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Approving / rejecting slips is billing work (owner or billing role); others see the list
  const { can } = useAdminUser()
  const canReview = can('billing')

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(null)
      const res = await adminGet<any>(`/api/sys-control/payments?status=${filter}`)
      if (!res.ok) {
        setError(res.error)
        setRows([])
      } else {
        setRows(adminList<PaymentDeposit>(res.data, 'payments'))
      }
      setLoading(false)
      setRefreshing(false)
    },
    [filter]
  )

  useEffect(() => {
    load()
  }, [load])

  function openReview(payment: PaymentDeposit, decision: 'approved' | 'rejected') {
    setNotes('')
    setReview({ payment, decision })
  }

  async function submitReview() {
    if (!review) return
    if (review.decision === 'rejected' && !notes.trim()) {
      Alert.alert('Reason Required', 'Tell the vendor why the payment was rejected.')
      return
    }
    setSubmitting(true)
    // Body per src/app/api/sys-control/payments/[id]/route.ts (sysUpdatePaymentSchema): { status, reviewNotes? }.
    // `notes` is sent as well for the mobile contract; the server ignores unknown keys.
    const body = { status: review.decision, reviewNotes: notes.trim() || undefined, notes: notes.trim() || undefined }
    const res = await adminPut<{ success: boolean }>(`/api/sys-control/payments/${review.payment.id}`, body)
    setSubmitting(false)
    if (!res.ok) {
      Alert.alert('Update Failed', res.error)
      return
    }
    setRows((prev) => prev.filter((p) => p.id !== review.payment.id))
    setReview(null)
    Alert.alert(review.decision === 'approved' ? 'Payment Approved' : 'Payment Rejected', review.decision === 'approved' ? 'Subscription activated / extended.' : 'The vendor has been notified.')
  }

  function describe(p: PaymentDeposit): string {
    if (p.isWalletDeposit) return 'Wallet top-up'
    if (p.pendingCompanyId) return 'New company activation'
    if (p.subscription?.tenant?.name) return `${p.subscription.tenant.name} · renewal ${p.periodMonths || 1} mo`
    return `Subscription · ${p.periodMonths || 1} mo`
  }

  return (
    <AdminShell title="Payment Approvals" subtitle={`${rows.length} ${filter}`} tab="approvals">
      <View style={[adminStyles.segment, { paddingHorizontal: 16, paddingTop: 12 }]}>
        {(['pending', 'approved', 'rejected'] as Filter[]).map((f) => (
          <Pressable key={f} style={[adminStyles.segmentBtn, filter === f && adminStyles.segmentBtnActive]} onPress={() => setFilter(f)}>
            <Text style={[adminStyles.segmentText, filter === f && adminStyles.segmentTextActive]}>{f[0].toUpperCase() + f.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <LoadingView text="Loading bank deposits…" />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
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
          ListEmptyComponent={<Text style={adminStyles.empty}>{filter === 'pending' ? 'Nothing waiting for approval.' : `No ${filter} payments.`}</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={styles.title}>{describe(item)}</Text>
                  <Text style={adminStyles.muted}>
                    {item.account?.fullName || item.account?.email || 'Unknown account'}
                    {item.account?.email && item.account?.fullName ? ` • ${item.account.email}` : ''}
                  </Text>
                </View>
                <Text style={styles.amount}>{formatLKR(item.amount)}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Pill text={item.status} tone={item.status === 'approved' ? 'ok' : item.status === 'rejected' ? 'error' : 'warn'} />
                {item.bankReference ? <Pill text={`Ref ${item.bankReference}`} /> : null}
                {item.depositDate ? <Pill text={`Deposited ${new Date(item.depositDate).toLocaleDateString()}`} /> : null}
                <Text style={adminStyles.muted}>{timeAgo(item.createdAt)}</Text>
              </View>
              {item.notes ? <Text style={styles.notes}>"{item.notes}"</Text> : null}
              {item.reviewNotes ? <Text style={styles.notes}>{item.reviewNotes}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                {item.receiptUrl ? (
                  <Pressable style={[adminStyles.ghostBtn, { flex: 1, height: 42 }]} onPress={() => Linking.openURL(item.receiptUrl!)}>
                    <Text style={adminStyles.ghostBtnText}>🧾 Slip</Text>
                  </Pressable>
                ) : null}
                {item.status === 'pending' && canReview ? (
                  <>
                    <Pressable style={[adminStyles.dangerBtn, { flex: 1, height: 42 }]} onPress={() => openReview(item, 'rejected')}>
                      <Text style={adminStyles.dangerBtnText}>Reject</Text>
                    </Pressable>
                    <Pressable style={[adminStyles.primaryBtn, { flex: 1.4, height: 42 }]} onPress={() => openReview(item, 'approved')}>
                      <Text style={adminStyles.primaryBtnText}>✓ Approve</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={!!review} transparent animationType="fade" onRequestClose={() => setReview(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{review?.decision === 'approved' ? 'Approve payment' : 'Reject payment'}</Text>
            {review ? (
              <Text style={adminStyles.muted}>
                {describe(review.payment)} • {formatLKR(review.payment.amount)}
              </Text>
            ) : null}
            <TextInput
              style={[adminStyles.input, { marginTop: 12, minHeight: 80, textAlignVertical: 'top' }]}
              placeholder={review?.decision === 'approved' ? 'Review notes (optional)' : 'Reason for rejection (sent to the vendor)'}
              placeholderTextColor={THEME.colors.textSubtle}
              multiline
              value={notes}
              onChangeText={setNotes}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Pressable style={[adminStyles.ghostBtn, { flex: 1 }]} onPress={() => setReview(null)} disabled={submitting}>
                <Text style={adminStyles.ghostBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[review?.decision === 'approved' ? adminStyles.primaryBtn : adminStyles.dangerBtn, { flex: 1.4 }]} onPress={submitReview} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={adminStyles.primaryBtnText}>{review?.decision === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </AdminShell>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: THEME.colors.border, padding: 14, marginBottom: 10 },
  title: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  amount: { fontSize: 16, fontWeight: '900', color: THEME.colors.text, fontFamily: 'monospace' },
  notes: { marginTop: 8, fontSize: 12, color: THEME.colors.textMuted, fontStyle: 'italic' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: THEME.colors.text, marginBottom: 4 },
})
