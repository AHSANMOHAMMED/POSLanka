import React, { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
} from 'react-native'
import { router } from 'expo-router'
import { apiGet, apiPost, getUser, logout, formatBusinessId, type AuthUser } from '../src/lib/api'
import {
  fetchCurrentShift,
  fetchMyProfiles,
  paymentMethodLabel,
  profilePaymentMethods,
  shiftCounterName,
  shiftWarehouseName,
  type PaymentMethod,
  type PosProfile,
  type Shift,
} from '../src/lib/shift'
import { displayRole, hasPermission } from '../src/lib/roles'
import { THEME, formatLKR } from '../src/lib/theme'
import { ErrorView, EmptyView } from '../src/components/StateViews'
import { getPrinterSettings, isPrintingEnabled, printerErrorMessage, printZReport } from '../src/lib/printer'
import { loadBusinessInfo, resolveReceiptSettings, zReportFromClose } from '../src/lib/receipt'
import { getQueuedSales, isOnline, syncNow } from '../src/lib/offlineQueue'
import { unsyncedSalesForShift } from '../src/lib/shiftGuard'
import { SupervisorPinModal, type SupervisorApprovalRequest } from '../src/components/SupervisorPinModal'
import type { ZReportDetails } from '../src/lib/escpos'
import { useHeaderPad, useBottomPad } from '../src/lib/safeArea'
import { goBack, goToTab } from '../src/lib/nav'
import { ScreenHeader, IconButton, Badge } from '../src/components/ui'

/** H1: structured variance reasons (mirror of SHIFT_VARIANCE_REASONS on the server) */
const VARIANCE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'counting_error', label: 'Counting error' },
  { value: 'change_error', label: 'Wrong change' },
  { value: 'unrecorded_sale', label: 'Sale not recorded' },
  { value: 'unrecorded_expense', label: 'Unrecorded expense' },
  { value: 'card_terminal_mismatch', label: 'Card terminal mismatch' },
  { value: 'theft_suspected', label: 'Suspected theft' },
  { value: 'other', label: 'Other' },
]

const CASH_CATEGORIES = {
  paid_out: [
    { value: 'petty_expense', label: 'Petty expense' },
    { value: 'supplier_payment', label: 'Supplier' },
    { value: 'bank_drop', label: 'Bank drop' },
    { value: 'other', label: 'Other' },
  ],
  paid_in: [
    { value: 'float_top_up', label: 'Float top-up' },
    { value: 'other', label: 'Other' },
  ],
} as const
type CashMovementType = keyof typeof CASH_CATEGORIES

interface CashMovementRow {
  id: string
  movementNo: string
  type: CashMovementType
  category: string
  amount: string
  note: string | null
  status: 'posted' | 'voided'
}

interface ReconciliationRow {
  paymentMethod: string
  openingAmount?: string | number
  expectedAmount?: string | number
  actualAmount?: string | number
  variance?: number
  difference?: number
}

interface CloseShiftResponse {
  success: boolean
  closingEntry?: { id: string; entryNumber?: string; closingTime?: string } | null
  reconciliation?: ReconciliationRow[]
  summary?: {
    totalSales: number
    totalReturns: number
    netSales: number
    totalTransactions: number
    totalVariance: number
  }
  zReport?: ZReportDetails
  varianceReason?: string | null
}

function num(v: string | number | undefined | null): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return isNaN(n) ? 0 : n
}

export default function ShiftsScreen() {
  const headerPad = useHeaderPad()
  const bottomPad = useBottomPad()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [shift, setShift] = useState<Shift | null>(null)
  const [profiles, setProfiles] = useState<PosProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [openingAmounts, setOpeningAmounts] = useState<Record<string, string>>({ cash: '5000.00' })
  const [openingNotes, setOpeningNotes] = useState('')
  const [closingAmounts, setClosingAmounts] = useState<Record<string, string>>({})
  const [closingNotes, setClosingNotes] = useState('')
  const [closingResult, setClosingResult] = useState<CloseShiftResponse | null>(null)
  // H1: the server reports a drawer variance → a structured reason is required to close
  const [varianceInfo, setVarianceInfo] = useState<{ byMethod: Record<string, number>; total: number } | null>(null)
  const [varianceReason, setVarianceReason] = useState('')
  const [varianceNote, setVarianceNote] = useState('')
  /** The shift that was just closed (for the Z-report header) and the print state. */
  const [closedShift, setClosedShift] = useState<Shift | null>(null)
  const [closedNotes, setClosedNotes] = useState<string>('')
  const [printState, setPrintState] = useState<{ status: 'idle' | 'printing' | 'done' | 'error'; message?: string }>({ status: 'idle' })
  const [printerEnabled, setPrinterEnabled] = useState(false)

  useEffect(() => {
    getPrinterSettings().then((s) => setPrinterEnabled(isPrintingEnabled(s)))
  }, [])

  async function printZ(result: CloseShiftResponse, forShift: Shift | null, notes: string) {
    setPrintState({ status: 'printing' })
    try {
      const business = await loadBusinessInfo()
      const z = zReportFromClose(result, { business, shift: forShift, cashier: user?.name, notes })
      // Same branding as receipts: logo + business block filtered by the receipt settings.
      const rs = resolveReceiptSettings(business, forShift)
      z.business = {
        name: business.name,
        legalName: rs.showLegalName ? business.legalName || null : null,
        address: rs.showAddress ? business.address || null : null,
        phone: rs.showPhone ? business.phone || null : null,
        email: rs.showEmail ? business.email || null : null,
        website: rs.showWebsite ? business.website || null : null,
        taxId: rs.showTaxId ? business.taxId || null : null,
        brn: rs.showBrn ? business.brn || null : null,
      }
      z.logo = rs.showLogo && business.logo ? business.logo : null
      await printZReport(z)
      setPrintState({ status: 'done' })
    } catch (e) {
      setPrintState({ status: 'error', message: printerErrorMessage(e) })
    }
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    const [shiftRes, profilesRes] = await Promise.all([fetchCurrentShift(), fetchMyProfiles()])
    if (!shiftRes.ok) {
      setError(shiftRes.error)
      setLoading(false)
      setRefreshing(false)
      return
    }
    setShift(shiftRes.data.shift)
    if (profilesRes.ok) {
      setProfiles(profilesRes.data)
      setSelectedProfileId((prev) => {
        if (prev && profilesRes.data.some((p) => p.id === prev)) return prev
        const def = profilesRes.data.find((p) => p.isUserDefault) || profilesRes.data[0]
        return def?.id || null
      })
    } else if (!shiftRes.data.shift) {
      // Only matters when we need to open a shift.
      setError(profilesRes.error)
    }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    getUser().then(setUser)
    load()
  }, [load])

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) || null,
    [profiles, selectedProfileId]
  )
  const openingMethods = useMemo(() => profilePaymentMethods(selectedProfile), [selectedProfile])

  // Methods that were opened on the current shift — every one of them must be counted on close.
  const closingMethods = useMemo<string[]>(() => {
    const methods = (shift?.balances || []).map((b) => b.paymentMethod)
    return methods.length ? Array.from(new Set(methods)) : ['cash']
  }, [shift])

  async function handleOpenShift() {
    if (!selectedProfile) {
      Alert.alert('POS Profile Required', 'You are not assigned to any POS profile. Ask a manager to assign one.')
      return
    }
    const openingBalances = openingMethods.map((m: PaymentMethod) => ({
      paymentMethod: m,
      amount: Math.max(0, num(openingAmounts[m] ?? '0')),
    }))

    setBusy(true)
    try {
      const res = await apiPost<Shift>('/api/pos-opening-entries', {
        posProfileId: selectedProfile.id,
        openingBalances,
        notes: openingNotes.trim() || undefined,
      })
      if (!res.ok) {
        // 400 (already open / no warehouse) and 403 (not assigned) messages come from the server verbatim.
        Alert.alert(res.status === 0 ? 'Network Error' : 'Could Not Open Shift', res.error)
        if (res.status === 400) load(true)
        return
      }
      setClosingResult(null)
      Alert.alert('Shift Opened', `Register ${res.data.posProfile?.name || selectedProfile.name} is ready for billing.`, [
        { text: 'Go to POS', onPress: () => goToTab('/pos') },
        { text: 'Stay', style: 'cancel', onPress: () => load(true) },
      ])
      setShift(res.data)
    } finally {
      setBusy(false)
    }
  }

  async function handleCloseShift() {
    if (!shift) return
    const missing = closingMethods.filter((m) => (closingAmounts[m] ?? '').trim() === '')
    if (missing.length) {
      Alert.alert(
        'Count Required',
        `Enter the counted amount for: ${missing.map(paymentMethodLabel).join(', ')}. Enter 0 if nothing was collected.`
      )
      return
    }
    const actualAmounts = closingMethods.map((m) => ({ paymentMethod: m, amount: Math.max(0, num(closingAmounts[m])) }))

    setBusy(true)
    try {
      if (varianceInfo && !varianceReason) {
        Alert.alert('Reason Required', 'Select why the drawer does not balance.')
        return
      }
      if (varianceReason === 'other' && !varianceNote.trim()) {
        Alert.alert('Note Required', 'Describe the variance when the reason is "Other".')
        return
      }
      const res = await apiPost<CloseShiftResponse>(`/api/pos-opening-entries/${shift.id}/close`, {
        actualAmounts,
        notes: closingNotes.trim() || undefined,
        varianceReason: varianceReason || undefined,
        varianceNote: varianceNote.trim() || undefined,
      })
      if (!res.ok) {
        const body = res.data as unknown as { code?: string; varianceByMethod?: Record<string, number>; totalVariance?: number } | null
        if (res.status === 400 && body?.code === 'VARIANCE_REASON_REQUIRED') {
          setVarianceInfo({ byMethod: body.varianceByMethod || {}, total: body.totalVariance || 0 })
          Alert.alert('Drawer Does Not Balance', `Variance ${formatLKR(body.totalVariance || 0)}. Recount, or select a reason below and close again.`)
          return
        }
        Alert.alert(res.status === 0 ? 'Network Error' : 'Could Not Close Shift', res.error)
        return
      }
      setVarianceInfo(null)
      setVarianceReason('')
      setVarianceNote('')
      const notes = closingNotes.trim()
      setClosingResult(res.data)
      setClosedShift(shift)
      setClosedNotes(notes)
      setPrintState({ status: 'idle' })
      setClosingAmounts({})
      setClosingNotes('')
      setShift(null)
      // Z-report straight off the close response when auto-print is on.
      const printer = await getPrinterSettings()
      setPrinterEnabled(isPrintingEnabled(printer))
      if (isPrintingEnabled(printer) && printer.autoPrint) printZ(res.data, shift, notes)
    } finally {
      setBusy(false)
    }
  }

  async function confirmClose() {
    if (!shift) return
    // Offline sales of this shift must reach the server before reconciliation, otherwise their
    // cash is counted in the drawer but missing from "expected" (false variance posted to the GL).
    let unsynced = unsyncedSalesForShift(await getQueuedSales(), shift.id, user?.tenantSlug)
    if (unsynced.pending > 0 && isOnline()) {
      setBusy(true)
      try {
        await syncNow()
      } finally {
        setBusy(false)
      }
      unsynced = unsyncedSalesForShift(await getQueuedSales(), shift.id, user?.tenantSlug)
    }
    if (unsynced.pending > 0 || unsynced.rejected > 0) {
      const parts: string[] = []
      if (unsynced.pending > 0) parts.push(`${unsynced.pending} offline sale(s) are still waiting to sync`)
      if (unsynced.rejected > 0) parts.push(`${unsynced.rejected} offline sale(s) were rejected and need attention`)
      Alert.alert(
        'Offline Sales Not Synced',
        `${parts.join(' and ')} (${formatLKR(unsynced.amount)}). Closing now reconciles the drawer without them, so the count will show a variance. Sync them from the POS screen first.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Close Anyway', style: 'destructive', onPress: handleCloseShift },
        ]
      )
      return
    }
    Alert.alert('Close Shift?', 'This ends the current register session and runs reconciliation.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close Shift', style: 'destructive', onPress: handleCloseShift },
    ])
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Shift & float"
        subtitle={user ? `${user.name} • ${displayRole(user)} • ${user.tenantName}${user.businessId ? ` (${formatBusinessId(user.businessId)})` : ''}` : 'Drawer status & reconciliation'}
        right={
          <IconButton
            name="log-out-outline"
            label="Sign out"
            color={THEME.colors.error}
            onPress={() =>
              Alert.alert('Sign Out', 'Sign out of this device?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
              ])
            }
          />
        }
      />

      {user && !hasPermission(user, 'createSales') ? (
        <EmptyView icon="🔒" title="Not available for your role" subtitle="Shifts are for staff who make sales. Your role cannot open a register shift." />
      ) : (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 40 + bottomPad }}
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
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={THEME.colors.primary} />
            <Text style={styles.loadingText}>Checking active drawer status...</Text>
          </View>
        ) : error && !shift ? (
          <ErrorView message={error} onRetry={() => load()} />
        ) : closingResult ? (
          <ReconciliationCard
            result={closingResult}
            onDone={() => setClosingResult(null)}
            printerEnabled={printerEnabled}
            printState={printState}
            onPrint={() => printZ(closingResult, closedShift, closedNotes)}
            onSetupPrinter={() => router.push('/printer')}
          />
        ) : shift ? (
          <View style={styles.activeShiftCard}>
            <View style={styles.statusPill}>
              <View style={styles.pulseDot} />
              <Text style={styles.statusPillText}>SHIFT ACTIVE</Text>
            </View>

            <Text style={styles.shiftId}>{shift.entryNumber || `Shift #${shift.id.slice(0, 8).toUpperCase()}`}</Text>
            <Text style={styles.shiftMeta}>
              Opened: {new Date(shift.openingTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </Text>

            <View style={styles.divider} />

            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Counter Register</Text>
              <Text style={styles.statVal}>{shiftCounterName(shift) || '—'}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Branch / Warehouse</Text>
              <Text style={styles.statVal}>{shiftWarehouseName(shift) || '—'}</Text>
            </View>

            {shift.balances && shift.balances.length > 0 && (
              <View style={styles.floatBox}>
                <Text style={styles.floatBoxTitle}>OPENING FLOAT</Text>
                {shift.balances.map((b, i) => (
                  <View key={`${b.paymentMethod}-${i}`} style={styles.floatRow}>
                    <Text style={styles.floatMethod}>{paymentMethodLabel(b.paymentMethod)}</Text>
                    <Text style={styles.floatAmount}>{formatLKR(b.openingAmount)}</Text>
                  </View>
                ))}
              </View>
            )}

            <Pressable style={styles.posBtn} onPress={() => goToTab('/pos')}>
              <Text style={styles.posBtnText}>Go to POS →</Text>
            </Pressable>

            <CashMovementsSection shift={shift} />

            <View style={styles.closeSection}>
              <Text style={styles.closeTitle}>Close Shift & Reconcile</Text>
              <Text style={styles.closeSub}>Count what is physically in the drawer for each tender opened on this shift:</Text>

              {closingMethods.map((m) => (
                <View key={m} style={styles.amountField}>
                  <Text style={styles.inputLabel}>{paymentMethodLabel(m).toUpperCase()} COUNTED</Text>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputPrefix}>LKR</Text>
                    <TextInput
                      style={styles.cashInput}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={THEME.colors.textSubtle}
                      value={closingAmounts[m] ?? ''}
                      onChangeText={(v) => setClosingAmounts((prev) => ({ ...prev, [m]: v }))}
                    />
                  </View>
                </View>
              ))}

              {varianceInfo && (
                <View style={styles.floatBox}>
                  <Text style={[styles.floatBoxTitle, { color: THEME.colors.error }]}>
                    VARIANCE {Object.entries(varianceInfo.byMethod).filter(([, v]) => Math.abs(v) >= 0.01).map(([m, v]) => `${paymentMethodLabel(m)} ${v > 0 ? '+' : ''}${v.toFixed(2)}`).join(' · ')}
                  </Text>
                  <View style={[styles.quickChips, { flexWrap: 'wrap' }]}>
                    {VARIANCE_REASONS.map((r) => (
                      <Pressable key={r.value} style={[styles.chip, varianceReason === r.value && styles.chipActive]} onPress={() => setVarianceReason(r.value)}>
                        <Text style={[styles.chipText, varianceReason === r.value && styles.chipTextActive]}>{r.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    style={styles.notesInput}
                    placeholder={varianceReason === 'other' ? 'Describe the variance (required)' : 'Variance note (optional)'}
                    placeholderTextColor={THEME.colors.textSubtle}
                    value={varianceNote}
                    onChangeText={setVarianceNote}
                  />
                </View>
              )}

              <TextInput
                style={styles.notesInput}
                placeholder="Closing notes (optional)"
                placeholderTextColor={THEME.colors.textSubtle}
                value={closingNotes}
                onChangeText={setClosingNotes}
              />

              <Pressable style={[styles.closeBtn, busy && { opacity: 0.6 }]} onPress={confirmClose} disabled={busy}>
                <Text style={styles.closeBtnText}>{busy ? 'Submitting…' : 'Reconcile & Close Shift'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.openCard}>
            <Text style={styles.openEmoji}>🔒</Text>
            <Text style={styles.openTitle}>Register Drawer Closed</Text>
            <Text style={styles.openSub}>Pick your counter and enter the starting float to unlock billing.</Text>

            {profiles.length === 0 ? (
              <View style={styles.noProfileBox}>
                <Text style={styles.noProfileTitle}>No POS profile assigned</Text>
                <Text style={styles.noProfileText}>
                  {error || 'A manager must assign you to a POS profile (counter) before you can open a shift.'}
                </Text>
                <Pressable style={styles.retrySmall} onPress={() => load()}>
                  <Text style={styles.retrySmallText}>↻ Check again</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.floatForm}>
                <Text style={styles.inputLabel}>COUNTER / POS PROFILE</Text>
                <View style={styles.profileChips}>
                  {profiles.map((p) => {
                    const active = p.id === selectedProfileId
                    return (
                      <Pressable
                        key={p.id}
                        style={[styles.profileChip, active && styles.chipActive]}
                        onPress={() => setSelectedProfileId(p.id)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.name}</Text>
                        {p.warehouse?.name ? (
                          <Text style={[styles.chipSub, active && styles.chipTextActive]}>{p.warehouse.name}</Text>
                        ) : null}
                      </Pressable>
                    )
                  })}
                </View>

                {selectedProfile && !selectedProfile.warehouseId && !selectedProfile.warehouse ? (
                  <Text style={styles.warnText}>This profile has no warehouse assigned; the server will refuse to open it.</Text>
                ) : null}

                {openingMethods.map((m) => (
                  <View key={m} style={styles.amountField}>
                    <Text style={styles.inputLabel}>OPENING {paymentMethodLabel(m).toUpperCase()} (LKR)</Text>
                    <View style={styles.inputRow}>
                      <Text style={styles.inputPrefix}>LKR</Text>
                      <TextInput
                        style={styles.cashInput}
                        keyboardType="decimal-pad"
                        value={openingAmounts[m] ?? (m === 'cash' ? '5000.00' : '0')}
                        onChangeText={(v) => setOpeningAmounts((prev) => ({ ...prev, [m]: v }))}
                        placeholder="0.00"
                        placeholderTextColor={THEME.colors.textSubtle}
                      />
                    </View>
                    {m === 'cash' && (
                      <View style={styles.quickChips}>
                        {['2000.00', '5000.00', '10000.00'].map((amt) => (
                          <Pressable
                            key={amt}
                            style={[styles.chip, openingAmounts.cash === amt && styles.chipActive]}
                            onPress={() => setOpeningAmounts((prev) => ({ ...prev, cash: amt }))}
                          >
                            <Text style={[styles.chipText, openingAmounts.cash === amt && styles.chipTextActive]}>
                              LKR {parseFloat(amt).toLocaleString()}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                ))}

                <TextInput
                  style={styles.notesInput}
                  placeholder="Opening notes (optional)"
                  placeholderTextColor={THEME.colors.textSubtle}
                  value={openingNotes}
                  onChangeText={setOpeningNotes}
                />

                <Pressable style={[styles.openBtn, busy && { opacity: 0.6 }]} onPress={handleOpenShift} disabled={busy}>
                  <Text style={styles.openBtnText}>{busy ? 'Opening Drawer…' : '🔓 Open Shift & Start Billing'}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>
      )}
    </View>
  )
}

function ReconciliationCard({
  result,
  onDone,
  printerEnabled,
  printState,
  onPrint,
  onSetupPrinter,
}: {
  result: CloseShiftResponse
  onDone: () => void
  printerEnabled: boolean
  printState: { status: 'idle' | 'printing' | 'done' | 'error'; message?: string }
  onPrint: () => void
  onSetupPrinter: () => void
}) {
  const rows = result.reconciliation || []
  const summary = result.summary
  const totalVariance = summary?.totalVariance ?? rows.reduce((s, r) => s + (r.variance ?? r.difference ?? num(r.actualAmount) - num(r.expectedAmount)), 0)
  const varianceColor = (v: number) => (Math.abs(v) < 0.005 ? THEME.colors.tertiary : v < 0 ? THEME.colors.error : THEME.colors.secondary)

  return (
    <View style={styles.activeShiftCard}>
      <View style={[styles.statusPill, { backgroundColor: THEME.colors.surfaceContainerHigh }]}>
        <Text style={[styles.statusPillText, { color: THEME.colors.text }]}>SHIFT CLOSED</Text>
      </View>
      <Text style={styles.shiftId}>{result.closingEntry?.entryNumber || 'Reconciliation'}</Text>
      {result.closingEntry?.closingTime ? (
        <Text style={styles.shiftMeta}>
          Closed: {new Date(result.closingEntry.closingTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        </Text>
      ) : null}

      <View style={styles.divider} />

      {summary && (
        <View style={styles.summaryGrid}>
          <SummaryTile label="Gross Sales" value={formatLKR(summary.totalSales)} />
          <SummaryTile label="Returns" value={formatLKR(summary.totalReturns)} />
          <SummaryTile label="Net Sales" value={formatLKR(summary.netSales)} />
          <SummaryTile label="Transactions" value={String(summary.totalTransactions)} />
        </View>
      )}

      <Text style={styles.floatBoxTitle}>RECONCILIATION BY TENDER</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { flex: 1.3 }]}>Method</Text>
        <Text style={styles.th}>Expected</Text>
        <Text style={styles.th}>Actual</Text>
        <Text style={styles.th}>Variance</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.shiftMeta}>No reconciliation rows returned.</Text>
      ) : (
        rows.map((r, i) => {
          const variance = r.variance ?? r.difference ?? num(r.actualAmount) - num(r.expectedAmount)
          return (
            <View key={`${r.paymentMethod}-${i}`} style={styles.tableRow}>
              <Text style={[styles.td, { flex: 1.3, fontWeight: '700' }]}>{paymentMethodLabel(r.paymentMethod)}</Text>
              <Text style={styles.td}>{formatLKR(r.expectedAmount).replace('LKR ', '')}</Text>
              <Text style={styles.td}>{formatLKR(r.actualAmount).replace('LKR ', '')}</Text>
              <Text style={[styles.td, { color: varianceColor(variance), fontWeight: '800' }]}>
                {variance > 0 ? '+' : ''}
                {formatLKR(variance).replace('LKR ', '')}
              </Text>
            </View>
          )
        })
      )}

      <View style={[styles.totalVarianceBox, { borderColor: varianceColor(totalVariance) }]}>
        <Text style={styles.totalVarianceLabel}>Total variance</Text>
        <Text style={[styles.totalVarianceVal, { color: varianceColor(totalVariance) }]}>
          {totalVariance > 0 ? '+' : ''}
          {formatLKR(totalVariance)}
        </Text>
      </View>

      {printState.status !== 'idle' ? (
        <View style={[styles.printStatus, printState.status === 'error' && { backgroundColor: THEME.colors.errorLight }]}>
          {printState.status === 'printing' ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
          <Text style={[styles.printStatusText, printState.status === 'error' && { color: THEME.colors.error }]}>
            {printState.status === 'printing' ? 'Printing Z-report…' : printState.status === 'done' ? 'Z-report sent to printer' : printState.message}
          </Text>
        </View>
      ) : null}

      {printerEnabled ? (
        <Pressable style={styles.printBtn} onPress={onPrint} disabled={printState.status === 'printing'}>
          <Text style={styles.printBtnText}>🖨️ {printState.status === 'done' ? 'Print Z-Report Again' : 'Print Z-Report'}</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.setupPrinterBtn} onPress={onSetupPrinter}>
          <Text style={styles.setupPrinterText}>🖨️ Set up a printer to print the Z-report</Text>
        </Pressable>
      )}

      <Pressable style={styles.openBtn} onPress={onDone}>
        <Text style={styles.openBtnText}>Open a New Shift</Text>
      </Pressable>
    </View>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    gap: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: THEME.colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  headerSub: { fontSize: 11, color: THEME.colors.textMuted },
  logoutBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: THEME.colors.border },
  logoutText: { fontSize: 11, fontWeight: '700', color: THEME.colors.error },
  scroll: { flex: 1, padding: 16 },
  centerBox: { padding: 40, alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: THEME.colors.textMuted },
  activeShiftCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: THEME.colors.tertiaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
  },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.colors.tertiary },
  statusPillText: { fontSize: 11, fontWeight: '800', color: THEME.colors.tertiary },
  shiftId: { fontSize: 20, fontWeight: '800', color: THEME.colors.text },
  shiftMeta: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: THEME.colors.border, marginVertical: 16 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  statLabel: { fontSize: 13, color: THEME.colors.textMuted },
  statVal: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  floatBox: { marginTop: 16, padding: 14, backgroundColor: THEME.colors.surfaceContainerLow, borderRadius: 12 },
  floatBoxTitle: { fontSize: 10, fontWeight: '800', color: THEME.colors.textMuted, letterSpacing: 0.5, marginBottom: 8 },
  floatRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  floatMethod: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  floatAmount: { fontSize: 14, fontWeight: '800', color: THEME.colors.primary },
  posBtn: {
    marginTop: 16,
    height: 46,
    borderRadius: 10,
    backgroundColor: THEME.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posBtnText: { color: THEME.colors.primary, fontWeight: '800', fontSize: 14 },
  closeSection: { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: THEME.colors.border },
  closeTitle: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  closeSub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2, marginBottom: 12 },
  amountField: { marginBottom: 12 },
  closeBtn: {
    height: 48,
    backgroundColor: THEME.colors.error,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  closeBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  openCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  openEmoji: { fontSize: 40, marginBottom: 12 },
  openTitle: { fontSize: 20, fontWeight: '800', color: THEME.colors.text },
  openSub: { fontSize: 13, color: THEME.colors.textMuted, textAlign: 'center', marginTop: 4, marginBottom: 20 },
  noProfileBox: { width: '100%', padding: 16, borderRadius: 12, backgroundColor: THEME.colors.secondaryLight, alignItems: 'center' },
  noProfileTitle: { fontSize: 14, fontWeight: '800', color: THEME.colors.onSecondaryContainer },
  noProfileText: { fontSize: 12, color: THEME.colors.onSecondaryContainer, textAlign: 'center', marginTop: 4 },
  retrySmall: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#FFFFFF' },
  retrySmallText: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary },
  floatForm: { width: '100%' },
  inputLabel: { fontSize: 11, fontWeight: '700', color: THEME.colors.textMuted, marginBottom: 6 },
  profileChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  profileChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    minWidth: '47%',
  },
  chipSub: { fontSize: 10, color: THEME.colors.textMuted, marginTop: 1 },
  warnText: { fontSize: 12, color: THEME.colors.error, marginBottom: 10 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    paddingHorizontal: 16,
    height: 52,
  },
  inputPrefix: { fontSize: 16, fontWeight: '800', color: THEME.colors.textMuted, marginRight: 8 },
  cashInput: { flex: 1, fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  notesInput: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: THEME.colors.text,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  quickChips: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  chipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 11, fontWeight: '700', color: THEME.colors.text },
  chipTextActive: { color: '#FFF' },
  openBtn: {
    height: 52,
    backgroundColor: THEME.colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  openBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  summaryTile: {
    width: '48%',
    padding: 12,
    borderRadius: 10,
    backgroundColor: THEME.colors.surfaceContainerLow,
  },
  summaryLabel: { fontSize: 10, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase' },
  summaryValue: { fontSize: 15, fontWeight: '800', color: THEME.colors.text, marginTop: 2 },
  tableHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  th: { flex: 1, fontSize: 10, fontWeight: '800', color: THEME.colors.textMuted, textAlign: 'right' },
  tableRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  td: { flex: 1, fontSize: 12, color: THEME.colors.text, textAlign: 'right' },
  totalVarianceBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  totalVarianceLabel: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  totalVarianceVal: { fontSize: 18, fontWeight: '900' },
  printStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: THEME.colors.primaryLight, padding: 10, borderRadius: 10, marginBottom: 10 },
  printStatusText: { flex: 1, fontSize: 12, fontWeight: '600', color: THEME.colors.primary },
  printBtn: { height: 48, borderRadius: 12, backgroundColor: THEME.colors.text, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  printBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  setupPrinterBtn: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.colors.surfaceContainerLow, marginBottom: 4 },
  setupPrinterText: { color: THEME.colors.textMuted, fontSize: 12, fontWeight: '700' },
})

/** H1: cash paid in / out of the drawer during the open shift (supervisor PIN when required). */
function CashMovementsSection({ shift }: { shift: Shift }) {
  const [type, setType] = useState<CashMovementType>('paid_out')
  const [category, setCategory] = useState<string>('petty_expense')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<CashMovementRow[]>([])
  const [approval, setApproval] = useState<(SupervisorApprovalRequest & { retry: (token: string) => void }) | null>(null)

  const load = useCallback(async () => {
    const res = await apiGet<{ data: CashMovementRow[] }>(`/api/pos-cash-movements?openingEntryId=${shift.id}`)
    if (res.ok) setRows(res.data?.data || [])
  }, [shift.id])

  useEffect(() => {
    load()
  }, [load])

  async function submit(approvalToken?: string) {
    const value = Math.round(num(amount) * 100) / 100
    if (!(value > 0)) {
      Alert.alert('Amount Required', 'Enter an amount greater than zero.')
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<CashMovementRow>('/api/pos-cash-movements', {
        openingEntryId: shift.id, type, category, amount: value, note: note.trim() || undefined, approvalToken,
      })
      const body = res.data as unknown as { code?: string; scopes?: string[] } | null
      if (!res.ok && res.status === 403 && body?.code === 'APPROVAL_REQUIRED') {
        setApproval({ scopes: body.scopes || [], message: res.error, amount: value, posOpeningEntryId: shift.id, retry: (t) => submit(t) })
        return
      }
      if (!res.ok) {
        Alert.alert('Cash Movement Failed', res.error)
        return
      }
      setAmount('')
      setNote('')
      load()
    } finally {
      setBusy(false)
    }
  }

  async function voidRow(row: CashMovementRow, approvalToken?: string) {
    const res = await apiPost<CashMovementRow>(`/api/pos-cash-movements/${row.id}/void`, { reason: 'Voided on device', approvalToken })
    const body = res.data as unknown as { code?: string; scopes?: string[] } | null
    if (!res.ok && res.status === 403 && body?.code === 'APPROVAL_REQUIRED') {
      setApproval({ scopes: body.scopes || ['cash_movement_void'], message: res.error, amount: num(row.amount), posOpeningEntryId: shift.id, retry: (t) => voidRow(row, t) })
      return
    }
    if (!res.ok) {
      Alert.alert('Void Failed', res.error)
      return
    }
    load()
  }

  return (
    <View style={styles.floatBox}>
      <Text style={styles.floatBoxTitle}>CASH PAID IN / OUT</Text>
      <View style={styles.quickChips}>
        {(['paid_out', 'paid_in'] as CashMovementType[]).map((t) => (
          <Pressable key={t} style={[styles.chip, type === t && styles.chipActive]} onPress={() => { setType(t); setCategory(CASH_CATEGORIES[t][0].value) }}>
            <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{t === 'paid_out' ? 'Paid Out' : 'Paid In'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[styles.quickChips, { flexWrap: 'wrap' }]}>
        {CASH_CATEGORIES[type].map((c) => (
          <Pressable key={c.value} style={[styles.chip, category === c.value && styles.chipActive]} onPress={() => setCategory(c.value)}>
            <Text style={[styles.chipText, category === c.value && styles.chipTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[styles.inputRow, { marginTop: 10 }]}>
        <Text style={styles.inputPrefix}>LKR</Text>
        <TextInput style={styles.cashInput} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={THEME.colors.textSubtle} value={amount} onChangeText={setAmount} />
      </View>
      <TextInput style={styles.notesInput} placeholder={category === 'other' ? 'Note (required)' : 'Note (optional)'} placeholderTextColor={THEME.colors.textSubtle} value={note} onChangeText={setNote} />
      <Pressable style={[styles.posBtn, busy && { opacity: 0.6 }]} onPress={() => submit()} disabled={busy}>
        <Text style={styles.posBtnText}>{busy ? 'Saving…' : `Record ${type === 'paid_out' ? 'Paid Out' : 'Paid In'}`}</Text>
      </Pressable>
      {rows.map((r) => (
        <View key={r.id} style={styles.floatRow}>
          <Text style={[styles.floatMethod, r.status === 'voided' && { textDecorationLine: 'line-through', color: THEME.colors.textSubtle }]}>
            {r.movementNo} {CASH_CATEGORIES[r.type]?.find((c) => c.value === r.category)?.label || r.category}
          </Text>
          <Text style={styles.floatAmount}>{r.type === 'paid_out' ? '-' : '+'}{formatLKR(r.amount)}</Text>
          {r.status === 'posted' && r.category !== 'void_refund' ? (
            <Pressable onPress={() => Alert.alert('Void Movement?', `Void ${r.movementNo}?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Void', style: 'destructive', onPress: () => voidRow(r) },
            ])}>
              <Text style={{ color: THEME.colors.error, fontWeight: '700', marginLeft: 8 }}>Void</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <SupervisorPinModal
        request={approval}
        onCancel={() => setApproval(null)}
        onApproved={(token) => {
          const retry = approval?.retry
          setApproval(null)
          retry?.(token)
        }}
      />
    </View>
  )
}
