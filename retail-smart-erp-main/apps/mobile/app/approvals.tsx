import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native'
import { router } from 'expo-router'
import { THEME, formatLKR } from '../src/lib/theme'

interface ApprovalItem {
  id: string
  refNo: string
  type: 'PR' | 'OVERRIDE' | 'WRITEOFF'
  title: string
  submittedBy: string
  department: string
  amount: number
  urgency: 'HIGH' | 'MEDIUM' | 'NORMAL'
  timeRemaining?: string
  date: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
}

const INITIAL_APPROVALS: ApprovalItem[] = [
  {
    id: '1',
    refNo: 'PR-2026-088',
    type: 'PR',
    title: 'Beverages Safety Buffer Restock',
    submittedBy: 'Nishan D. (Inventory Mgr)',
    department: 'Beverages & Dairy',
    amount: 345000,
    urgency: 'HIGH',
    timeRemaining: '24m remaining',
    date: 'Today, 11:15 AM',
    status: 'PENDING',
  },
  {
    id: '2',
    refNo: 'POS-OVR-041',
    type: 'OVERRIDE',
    title: 'High-Value Bill Discount Exceeded (15%)',
    submittedBy: 'Dilshan P. (Counter 02)',
    department: 'Cashier Station',
    amount: 18200,
    urgency: 'HIGH',
    timeRemaining: '12m remaining',
    date: 'Today, 11:32 AM',
    status: 'PENDING',
  },
  {
    id: '3',
    refNo: 'PR-2026-089',
    type: 'PR',
    title: 'Thermal Paper Rolls 80mm (Box of 50)',
    submittedBy: 'Shantha B. (Procurement)',
    department: 'Store Supplies',
    amount: 45000,
    urgency: 'NORMAL',
    date: 'Today, 10:20 AM',
    status: 'PENDING',
  },
  {
    id: '4',
    refNo: 'WO-2026-012',
    type: 'WRITEOFF',
    title: 'Perishable Dairy Expiry Disposal',
    submittedBy: 'Quality Control Bay',
    department: 'Chilled Storage',
    amount: 154900,
    urgency: 'MEDIUM',
    date: 'Today, 09:45 AM',
    status: 'PENDING',
  },
]

export default function ApprovalsScreen() {
  const [filter, setFilter] = useState<'ALL' | 'PR' | 'OVERRIDE' | 'WRITEOFF'>('ALL')
  const [items, setItems] = useState<ApprovalItem[]>(INITIAL_APPROVALS)

  const handleApprove = (id: string, refNo: string) => {
    Alert.alert('Approve Request', `Authorize ${refNo} for processing?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Authorize',
        onPress: () => {
          setItems(prev =>
            prev.map(i => (i.id === id ? { ...i, status: 'APPROVED' } : i))
          )
        },
      },
    ])
  }

  const handleReject = (id: string, refNo: string) => {
    Alert.alert('Reject Request', `Decline authorization for ${refNo}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: () => {
          setItems(prev =>
            prev.map(i => (i.id === id ? { ...i, status: 'REJECTED' } : i))
          )
        },
      },
    ])
  }

  const handleBatchApprove = () => {
    Alert.alert('Batch Authorization', 'Approve all pending requisitions?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve All',
        onPress: () => {
          setItems(prev => prev.map(i => ({ ...i, status: 'APPROVED' })))
        },
      },
    ])
  }

  const pendingItems = items.filter(i => i.status === 'PENDING')
  const filteredItems = pendingItems.filter(i => {
    if (filter === 'ALL') return true
    return i.type === filter
  })

  const totalPendingValue = pendingItems.reduce((acc, i) => acc + i.amount, 0)

  return (
    <View style={styles.safe}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.storeName}>POSLanka WH-COL03</Text>
          <Text style={styles.branchSub}>Colombo 03 • Hub Synced</Text>
        </View>
        <TouchableOpacity
          onPress={handleBatchApprove}
          style={styles.batchBtn}
        >
          <Text style={styles.batchBtnText}>✓ Batch</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        {/* Title & Manager Identity */}
        <View style={styles.titleSection}>
          <View style={styles.titleRow}>
            <Text style={styles.mainTitle}>Manager Approvals</Text>
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{pendingItems.length} Pending</Text>
            </View>
          </View>
          <Text style={styles.managerText}>Kasun Silva • Store Manager (EMP-0102)</Text>
        </View>

        {/* 3 Metric Cards */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Pending Value</Text>
            <Text style={styles.metricValue}>{formatLKR(totalPendingValue)}</Text>
            <Text style={styles.metricSub}>{pendingItems.length} requisitions</Text>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.urgentDotRow}>
              <Text style={styles.metricLabel}>Urgent SLA</Text>
              <View style={styles.redPulseDot} />
            </View>
            <Text style={[styles.metricValue, { color: THEME.colors.error }]}>2 Under 30m</Text>
            <Text style={[styles.metricSub, { color: THEME.colors.error }]}>Auto-escalation</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Today Cleared</Text>
            <Text style={[styles.metricValue, { color: THEME.colors.tertiary }]}>8 Done</Text>
            <Text style={styles.metricSub}>LKR 1.12M</Text>
          </View>
        </View>

        {/* Category Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
        >
          {[
            { id: 'ALL', label: 'All', count: pendingItems.length },
            { id: 'PR', label: 'Procurement (PR)', count: pendingItems.filter(i => i.type === 'PR').length },
            { id: 'OVERRIDE', label: 'POS Overrides', count: pendingItems.filter(i => i.type === 'OVERRIDE').length },
            { id: 'WRITEOFF', label: 'Write-offs', count: pendingItems.filter(i => i.type === 'WRITEOFF').length },
          ].map(tab => (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setFilter(tab.id as typeof filter)}
              style={[
                styles.filterPill,
                filter === tab.id && styles.filterPillActive,
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  filter === tab.id && styles.filterPillTextActive,
                ]}
              >
                {tab.label}
              </Text>
              <View
                style={[
                  styles.pillCount,
                  filter === tab.id && styles.pillCountActive,
                ]}
              >
                <Text
                  style={[
                    styles.pillCountText,
                    filter === tab.id && styles.pillCountTextActive,
                  ]}
                >
                  {tab.count}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Approvals Cards Stack */}
        <View style={styles.cardsStack}>
          {filteredItems.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={{ fontSize: 36, textAlign: 'center' }}>✓</Text>
              <Text style={styles.emptyTitle}>All caught up!</Text>
              <Text style={styles.emptySub}>No pending authorizations matching this filter.</Text>
            </View>
          ) : (
            filteredItems.map(item => (
              <View key={item.id} style={styles.approvalCard}>
                {/* Card Header */}
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    <Text style={styles.refNoText}>{item.refNo}</Text>
                    {item.urgency === 'HIGH' && (
                      <View style={styles.urgentPill}>
                        <Text style={styles.urgentPillText}>URGENT SLA</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.dateText}>{item.date}</Text>
                </View>

                {/* Card Body */}
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.submitterText}>
                  {item.submittedBy} • <Text style={styles.deptText}>{item.department}</Text>
                </Text>

                {item.timeRemaining && (
                  <View style={styles.slaWarningRow}>
                    <Text style={styles.slaWarningText}>⏱ {item.timeRemaining}</Text>
                  </View>
                )}

                {/* Card Footer & Value */}
                <View style={styles.cardFooter}>
                  <View>
                    <Text style={styles.amountLabel}>Requested Value</Text>
                    <Text style={styles.amountValue}>{formatLKR(item.amount)}</Text>
                  </View>

                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      onPress={() => handleReject(item.id, item.refNo)}
                      style={styles.rejectBtn}
                    >
                      <Text style={styles.rejectBtnText}>✕ Decline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleApprove(item.id, item.refNo)}
                      style={styles.approveBtn}
                    >
                      <Text style={styles.approveBtnText}>✓ Approve</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: THEME.colors.surface,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: THEME.spacing.lg,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: THEME.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  headerCenter: {
    alignItems: 'center',
  },
  storeName: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.primary,
  },
  branchSub: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: THEME.colors.textMuted,
  },
  batchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: THEME.radius.md,
  },
  batchBtnText: {
    color: THEME.colors.onPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: THEME.spacing.lg,
    paddingBottom: 40,
  },
  titleSection: {
    marginBottom: THEME.spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mainTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.colors.text,
  },
  pendingBadge: {
    backgroundColor: THEME.colors.secondaryContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: THEME.radius.full,
  },
  pendingBadgeText: {
    color: THEME.colors.onSecondaryContainer,
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  managerText: {
    fontSize: 12,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: THEME.spacing.lg,
  },
  metricCard: {
    flex: 1,
    backgroundColor: THEME.colors.card,
    padding: 10,
    borderRadius: THEME.radius.lg,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: THEME.colors.textMuted,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: THEME.colors.primary,
    marginTop: 4,
  },
  metricSub: {
    fontSize: 9,
    color: THEME.colors.textSubtle,
    marginTop: 2,
  },
  urgentDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  redPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.colors.error,
  },
  filterScroll: {
    marginBottom: THEME.spacing.lg,
  },
  filterScrollContent: {
    gap: 6,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: THEME.colors.surfaceContainerHigh,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: THEME.radius.full,
  },
  filterPillActive: {
    backgroundColor: THEME.colors.primary,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.textMuted,
  },
  filterPillTextActive: {
    color: THEME.colors.onPrimary,
  },
  pillCount: {
    backgroundColor: THEME.colors.border,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: THEME.radius.full,
  },
  pillCountActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  pillCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  pillCountTextActive: {
    color: THEME.colors.onPrimary,
  },
  cardsStack: {
    gap: 12,
  },
  emptyCard: {
    backgroundColor: THEME.colors.card,
    borderRadius: THEME.radius.xl,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
    marginTop: 12,
  },
  emptySub: {
    fontSize: 12,
    color: THEME.colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  approvalCard: {
    backgroundColor: THEME.colors.card,
    borderRadius: THEME.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refNoText: {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: THEME.colors.primary,
  },
  urgentPill: {
    backgroundColor: THEME.colors.errorLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: THEME.radius.xs,
  },
  urgentPillText: {
    color: THEME.colors.error,
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  dateText: {
    fontSize: 10,
    color: THEME.colors.textSubtle,
    fontFamily: 'monospace',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  submitterText: {
    fontSize: 11,
    color: THEME.colors.textMuted,
  },
  deptText: {
    fontWeight: '600',
    color: THEME.colors.text,
  },
  slaWarningRow: {
    backgroundColor: THEME.colors.errorLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: THEME.radius.sm,
    alignSelf: 'flex-start',
  },
  slaWarningText: {
    fontSize: 10,
    color: THEME.colors.error,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    marginTop: 2,
  },
  amountLabel: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: THEME.colors.textMuted,
    textTransform: 'uppercase',
  },
  amountValue: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: THEME.colors.textDark,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rejectBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: THEME.radius.sm,
    borderWidth: 1,
    borderColor: THEME.colors.errorLight,
    backgroundColor: '#FFF5F5',
  },
  rejectBtnText: {
    color: THEME.colors.error,
    fontSize: 11,
    fontWeight: '700',
  },
  approveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.colors.primary,
  },
  approveBtnText: {
    color: THEME.colors.onPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
})
