import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { apiGet, apiPost, asList, getUser, qs, type AuthUser } from '../src/lib/api'
import { hasPermission, roleLabel } from '../src/lib/roles'
import { THEME, formatLKR } from '../src/lib/theme'
import { LoadingView, EmptyView, ErrorView, InlineNotice } from '../src/components/StateViews'

type ApprovalKind = 'PR' | 'ADVANCE'

interface ApprovalItem {
  kind: ApprovalKind
  id: string
  refNo: string
  title: string
  submittedBy: string
  department: string
  amount: number
  createdAt: string | null
  requiredBy?: string | null
}

interface RequisitionRow {
  id: string
  requisitionNo: string
  status: string
  requestedByName?: string | null
  department?: string | null
  requiredByDate?: string | null
  purpose?: string | null
  estimatedTotal?: string | number | null
  createdAt?: string | null
}

interface AdvanceRow {
  id: string
  advanceNo: string
  employeeName: string
  requestedAmount: string | number
  purpose?: string | null
  reason?: string | null
  status: string
  requestedAt?: string | null
  createdAt?: string | null
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ApprovalsScreen() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [filter, setFilter] = useState<'ALL' | ApprovalKind>('ALL')
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partialError, setPartialError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reasonTarget, setReasonTarget] = useState<ApprovalItem | null>(null)
  const [reason, setReason] = useState('')

  const canPR = hasPermission(user ?? null, 'approveRequisitions')
  const canAdv = hasPermission(user ?? null, 'approveAdvances')

  useEffect(() => {
    getUser().then((u) => setUser(u))
  }, [])

  const load = useCallback(
    async (silent = false) => {
      if (user === undefined) return
      if (!canPR && !canAdv) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      setPartialError(null)

      const [prRes, advRes] = await Promise.all([
        canPR
          ? apiGet<any>(`/api/purchase-requisitions${qs({ status: 'pending_approval', pageSize: 100, sortBy: 'createdAt', sortOrder: 'desc' })}`)
          : Promise.resolve(null),
        canAdv
          ? apiGet<any>(`/api/employee-advances${qs({ status: 'pending_approval', pageSize: 100 })}`)
          : Promise.resolve(null),
      ])

      const next: ApprovalItem[] = []
      const errors: string[] = []

      if (prRes) {
        if (prRes.ok) {
          for (const r of asList<RequisitionRow>(prRes.data)) {
            next.push({
              kind: 'PR',
              id: r.id,
              refNo: r.requisitionNo,
              title: r.purpose || 'Purchase requisition',
              submittedBy: r.requestedByName || 'Unknown',
              department: r.department || 'General',
              amount: Number(r.estimatedTotal || 0),
              createdAt: r.createdAt || null,
              requiredBy: r.requiredByDate || null,
            })
          }
        } else errors.push(`Requisitions: ${prRes.error}`)
      }
      if (advRes) {
        if (advRes.ok) {
          for (const a of asList<AdvanceRow>(advRes.data)) {
            next.push({
              kind: 'ADVANCE',
              id: a.id,
              refNo: a.advanceNo,
              title: a.purpose || a.reason || 'Employee advance',
              submittedBy: a.employeeName,
              department: 'HR / Payroll',
              amount: Number(a.requestedAmount || 0),
              createdAt: a.requestedAt || a.createdAt || null,
            })
          }
        } else errors.push(`Advances: ${advRes.error}`)
      }

      next.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      setItems(next)

      const allFailed = errors.length > 0 && errors.length === [prRes, advRes].filter(Boolean).length
      if (allFailed) setError(errors.join('\n'))
      else if (errors.length) setPartialError(errors.join('\n'))

      setLoading(false)
      setRefreshing(false)
    },
    [user, canPR, canAdv]
  )

  useEffect(() => {
    load()
  }, [load])

  async function runAction(item: ApprovalItem, action: 'approve' | 'reject', reasonText?: string) {
    setBusyId(item.id)
    try {
      let path: string
      let body: Record<string, unknown> | undefined
      if (item.kind === 'PR') {
        path = `/api/purchase-requisitions/${item.id}/${action}`
        body = action === 'reject' ? { rejectionReason: reasonText } : {}
      } else {
        path = `/api/employee-advances/${item.id}/${action === 'approve' ? 'approve' : 'cancel'}`
        body = action === 'reject' ? { cancellationReason: reasonText } : {}
      }
      const res = await apiPost(path, body)
      if (!res.ok) {
        Alert.alert(action === 'approve' ? 'Approval Failed' : 'Rejection Failed', res.error)
        if (res.status === 400) load(true)
        return
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id))
    } finally {
      setBusyId(null)
    }
  }

  const handleApprove = (item: ApprovalItem) => {
    Alert.alert('Approve Request', `Authorize ${item.refNo} for ${formatLKR(item.amount)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Authorize', onPress: () => runAction(item, 'approve') },
    ])
  }

  const handleReject = (item: ApprovalItem) => {
    setReason('')
    setReasonTarget(item)
  }

  const submitReject = () => {
    if (!reasonTarget) return
    const text = reason.trim()
    if (!text) {
      Alert.alert('Reason Required', 'Enter a reason for declining this request.')
      return
    }
    const target = reasonTarget
    setReasonTarget(null)
    runAction(target, 'reject', text)
  }

  const filteredItems = useMemo(() => items.filter((i) => filter === 'ALL' || i.kind === filter), [items, filter])
  const totalPendingValue = items.reduce((acc, i) => acc + i.amount, 0)
  const prCount = items.filter((i) => i.kind === 'PR').length
  const advCount = items.filter((i) => i.kind === 'ADVANCE').length

  const tabs: Array<{ id: 'ALL' | ApprovalKind; label: string; count: number }> = [{ id: 'ALL', label: 'All', count: items.length }]
  if (canPR) tabs.push({ id: 'PR', label: 'Requisitions', count: prCount })
  if (canAdv) tabs.push({ id: 'ADVANCE', label: 'Advances', count: advCount })

  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/pos'))} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.storeName} numberOfLines={1}>
            {user?.tenantName || 'POSLanka'}
          </Text>
          <Text style={styles.branchSub}>Pending approvals</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {user === undefined ? (
        <LoadingView />
      ) : !canPR && !canAdv ? (
        <EmptyView icon="🔒" title="Not available for your role" subtitle={`${roleLabel(user?.role)} accounts cannot approve requisitions or advances.`} />
      ) : loading ? (
        <LoadingView text="Loading pending approvals…" />
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
          <View style={styles.titleSection}>
            <View style={styles.titleRow}>
              <Text style={styles.mainTitle}>Manager Approvals</Text>
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{items.length} Pending</Text>
              </View>
            </View>
            <Text style={styles.managerText}>
              {user?.name} • {roleLabel(user?.role)}
            </Text>
          </View>

          {partialError ? <InlineNotice text={partialError} tone="warn" /> : null}

          <View style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Pending Value</Text>
              <Text style={styles.metricValue}>{formatLKR(totalPendingValue)}</Text>
              <Text style={styles.metricSub}>{items.length} requests</Text>
            </View>
            {canPR && (
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Requisitions</Text>
                <Text style={styles.metricValue}>{prCount}</Text>
                <Text style={styles.metricSub}>awaiting approval</Text>
              </View>
            )}
            {canAdv && (
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Advances</Text>
                <Text style={[styles.metricValue, { color: THEME.colors.secondary }]}>{advCount}</Text>
                <Text style={styles.metricSub}>awaiting approval</Text>
              </View>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterScrollContent}>
            {tabs.map((tab) => (
              <TouchableOpacity key={tab.id} onPress={() => setFilter(tab.id)} style={[styles.filterPill, filter === tab.id && styles.filterPillActive]}>
                <Text style={[styles.filterPillText, filter === tab.id && styles.filterPillTextActive]}>{tab.label}</Text>
                <View style={[styles.pillCount, filter === tab.id && styles.pillCountActive]}>
                  <Text style={[styles.pillCountText, filter === tab.id && styles.pillCountTextActive]}>{tab.count}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.cardsStack}>
            {filteredItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={{ fontSize: 36, textAlign: 'center' }}>✓</Text>
                <Text style={styles.emptyTitle}>All caught up!</Text>
                <Text style={styles.emptySub}>No pending authorizations matching this filter.</Text>
              </View>
            ) : (
              filteredItems.map((item) => {
                const busy = busyId === item.id
                return (
                  <View key={`${item.kind}-${item.id}`} style={styles.approvalCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardHeaderLeft}>
                        <Text style={styles.refNoText}>{item.refNo}</Text>
                        <View style={[styles.kindPill, item.kind === 'ADVANCE' && styles.kindPillAdvance]}>
                          <Text style={[styles.kindPillText, item.kind === 'ADVANCE' && styles.kindPillTextAdvance]}>
                            {item.kind === 'PR' ? 'REQUISITION' : 'ADVANCE'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.dateText}>{fmtDate(item.createdAt)}</Text>
                    </View>

                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.submitterText}>
                      {item.submittedBy} • <Text style={styles.deptText}>{item.department}</Text>
                    </Text>
                    {item.requiredBy ? (
                      <View style={styles.slaWarningRow}>
                        <Text style={styles.slaWarningText}>⏱ Required by {item.requiredBy}</Text>
                      </View>
                    ) : null}

                    <View style={styles.cardFooter}>
                      <View>
                        <Text style={styles.amountLabel}>Requested Value</Text>
                        <Text style={styles.amountValue}>{formatLKR(item.amount)}</Text>
                      </View>

                      <View style={styles.actionButtons}>
                        {busy ? (
                          <ActivityIndicator color={THEME.colors.primary} />
                        ) : (
                          <>
                            <TouchableOpacity onPress={() => handleReject(item)} style={styles.rejectBtn}>
                              <Text style={styles.rejectBtnText}>✕ Decline</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleApprove(item)} style={styles.approveBtn}>
                              <Text style={styles.approveBtnText}>✓ Approve</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                )
              })
            )}
          </View>
        </ScrollView>
      )}

      <Modal visible={!!reasonTarget} transparent animationType="fade" onRequestClose={() => setReasonTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Decline {reasonTarget?.refNo}</Text>
            <Text style={styles.modalSub}>A reason is required and will be recorded on the request.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Reason for declining"
              placeholderTextColor={THEME.colors.textSubtle}
              value={reason}
              onChangeText={setReason}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setReasonTarget(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={submitReject}>
                <Text style={styles.modalConfirmText}>Decline Request</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  storeName: { fontSize: 14, fontWeight: '700', color: THEME.colors.primary },
  branchSub: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textMuted },
  content: { flex: 1 },
  contentInner: { padding: THEME.spacing.lg, paddingBottom: 40 },
  titleSection: { marginBottom: THEME.spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mainTitle: { fontSize: 20, fontWeight: '800', color: THEME.colors.text },
  pendingBadge: { backgroundColor: THEME.colors.secondaryContainer, paddingHorizontal: 8, paddingVertical: 2, borderRadius: THEME.radius.full },
  pendingBadgeText: { color: THEME.colors.onSecondaryContainer, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' },
  managerText: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  metricsRow: { flexDirection: 'row', gap: 8, marginBottom: THEME.spacing.lg },
  metricCard: { flex: 1, backgroundColor: THEME.colors.card, padding: 10, borderRadius: THEME.radius.lg, borderWidth: 1, borderColor: THEME.colors.border },
  metricLabel: { fontSize: 10, fontFamily: 'monospace', color: THEME.colors.textMuted, textTransform: 'uppercase' },
  metricValue: { fontSize: 14, fontWeight: '800', fontFamily: 'monospace', color: THEME.colors.primary, marginTop: 4 },
  metricSub: { fontSize: 9, color: THEME.colors.textSubtle, marginTop: 2 },
  filterScroll: { marginBottom: THEME.spacing.lg },
  filterScrollContent: { gap: 6 },
  filterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: THEME.colors.surfaceContainerHigh, paddingHorizontal: 12, paddingVertical: 6, borderRadius: THEME.radius.full },
  filterPillActive: { backgroundColor: THEME.colors.primary },
  filterPillText: { fontSize: 12, fontWeight: '600', color: THEME.colors.textMuted },
  filterPillTextActive: { color: THEME.colors.onPrimary },
  pillCount: { backgroundColor: THEME.colors.border, paddingHorizontal: 6, paddingVertical: 1, borderRadius: THEME.radius.full },
  pillCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  pillCountText: { fontSize: 10, fontWeight: '700', color: THEME.colors.text },
  pillCountTextActive: { color: THEME.colors.onPrimary },
  cardsStack: { gap: 12 },
  emptyCard: { backgroundColor: THEME.colors.card, borderRadius: THEME.radius.xl, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: THEME.colors.border },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: THEME.colors.text, marginTop: 12 },
  emptySub: { fontSize: 12, color: THEME.colors.textMuted, textAlign: 'center', marginTop: 4 },
  approvalCard: { backgroundColor: THEME.colors.card, borderRadius: THEME.radius.lg, padding: 14, borderWidth: 1, borderColor: THEME.colors.border, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  refNoText: { fontSize: 12, fontFamily: 'monospace', fontWeight: '700', color: THEME.colors.primary },
  kindPill: { backgroundColor: THEME.colors.primaryLight, paddingHorizontal: 6, paddingVertical: 1, borderRadius: THEME.radius.xs },
  kindPillAdvance: { backgroundColor: THEME.colors.secondaryLight },
  kindPillText: { color: THEME.colors.primary, fontSize: 9, fontFamily: 'monospace', fontWeight: '800' },
  kindPillTextAdvance: { color: THEME.colors.secondary },
  dateText: { fontSize: 10, color: THEME.colors.textSubtle, fontFamily: 'monospace' },
  itemTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  submitterText: { fontSize: 11, color: THEME.colors.textMuted },
  deptText: { fontWeight: '600', color: THEME.colors.text },
  slaWarningRow: { backgroundColor: THEME.colors.secondaryLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: THEME.radius.sm, alignSelf: 'flex-start' },
  slaWarningText: { fontSize: 10, color: THEME.colors.onSecondaryContainer, fontFamily: 'monospace', fontWeight: '700' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: THEME.colors.border, marginTop: 2 },
  amountLabel: { fontSize: 9, fontFamily: 'monospace', color: THEME.colors.textMuted, textTransform: 'uppercase' },
  amountValue: { fontSize: 14, fontWeight: '800', fontFamily: 'monospace', color: THEME.colors.textDark },
  actionButtons: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 60, justifyContent: 'flex-end' },
  rejectBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: THEME.radius.sm, borderWidth: 1, borderColor: THEME.colors.errorLight, backgroundColor: '#FFF5F5' },
  rejectBtnText: { color: THEME.colors.error, fontSize: 11, fontWeight: '700' },
  approveBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: THEME.radius.sm, backgroundColor: THEME.colors.primary },
  approveBtnText: { color: THEME.colors.onPrimary, fontSize: 11, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: THEME.colors.text },
  modalSub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 4, marginBottom: 12 },
  modalInput: { borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, padding: 12, minHeight: 80, fontSize: 14, color: THEME.colors.text, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  modalCancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  modalCancelText: { fontSize: 13, fontWeight: '700', color: THEME.colors.textMuted },
  modalConfirm: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: THEME.colors.error },
  modalConfirmText: { fontSize: 13, fontWeight: '800', color: '#FFF' },
})
