import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native'
import { router } from 'expo-router'
import { apiFetch } from '../src/lib/api'
import { THEME, formatLKR } from '../src/lib/theme'

interface ShiftData {
  id: string
  periodStartDate: string
  status: 'open' | 'closed'
  posProfile?: { name: string }
  warehouse?: { name: string }
  balances?: Array<{ paymentMethod: string; amount: string }>
}

export default function ShiftsScreen() {
  const [shift, setShift] = useState<ShiftData | null>(null)
  const [loading, setLoading] = useState(true)
  const [openingFloat, setOpeningFloat] = useState('5000.00')
  const [closingCash, setClosingCash] = useState('')
  const [busy, setBusy] = useState(false)

  const fetchShift = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/pos-opening-entries?current=true')
      if (res.ok) {
        const data = await res.json()
        setShift(data.shift || null)
      }
    } catch (e) {
      console.warn('Error fetching current shift:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchShift()
  }, [fetchShift])

  async function handleOpenShift() {
    setBusy(true)
    try {
      // First fetch available profiles
      const profRes = await apiFetch('/api/pos-profiles')
      const profData = await profRes.json()
      const profileId = profData.profiles?.[0]?.id || profData.data?.[0]?.id

      if (!profileId) {
        Alert.alert('Configuration Error', 'No POS profile found on the server. Please create a POS profile in settings.')
        return
      }

      const res = await apiFetch('/api/pos-opening-entries', {
        method: 'POST',
        body: JSON.stringify({
          posProfileId: profileId,
          openingBalances: [{ paymentMethod: 'cash', amount: parseFloat(openingFloat) || 0 }],
          notes: 'Mobile POS Cashier Shift',
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        Alert.alert('Shift Error', err.error || 'Failed to open shift.')
        return
      }

      Alert.alert('Shift Opened', 'Register cash drawer float is recorded.')
      fetchShift()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not open shift')
    } finally {
      setBusy(false)
    }
  }

  async function handleCloseShift() {
    if (!shift) return
    setBusy(true)
    try {
      const actualCash = parseFloat(closingCash) || 0
      const res = await apiFetch(`/api/pos-opening-entries/${shift.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          actualAmounts: [{ paymentMethod: 'cash', amount: actualCash }],
          notes: 'Closed from Mobile POS',
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        Alert.alert('Closing Error', err.error || 'Failed to close shift.')
        return
      }

      Alert.alert('Shift Closed', 'Reconciliation report generated.')
      fetchShift()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not close shift')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Cashier Shift & Float</Text>
          <Text style={styles.headerSub}>Drawer Status & Daily Reconciliation</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={THEME.colors.primary} />
            <Text style={styles.loadingText}>Checking active drawer status...</Text>
          </View>
        ) : shift ? (
          /* Active Shift View */
          <View style={styles.activeShiftCard}>
            <View style={styles.statusPill}>
              <View style={styles.pulseDot} />
              <Text style={styles.statusPillText}>SHIFT ACTIVE</Text>
            </View>

            <Text style={styles.shiftId}>Shift #{shift.id.slice(0, 8).toUpperCase()}</Text>
            <Text style={styles.shiftMeta}>
              Opened: {new Date(shift.periodStartDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>

            <View style={styles.divider} />

            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Counter Register</Text>
              <Text style={styles.statVal}>{shift.posProfile?.name || 'Main Counter'}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Location Warehouse</Text>
              <Text style={styles.statVal}>{shift.warehouse?.name || 'Colombo Superstore'}</Text>
            </View>

            {/* Opening Float Details */}
            {shift.balances && shift.balances.length > 0 && (
              <View style={styles.floatBox}>
                <Text style={styles.floatBoxTitle}>INITIAL OPENING FLOAT</Text>
                {shift.balances.map((b, i) => (
                  <View key={i} style={styles.floatRow}>
                    <Text style={styles.floatMethod}>{b.paymentMethod.toUpperCase()}</Text>
                    <Text style={styles.floatAmount}>{formatLKR(b.amount)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Close Shift Box */}
            <View style={styles.closeSection}>
              <Text style={styles.closeTitle}>Close Shift & Reconcile</Text>
              <Text style={styles.closeSub}>Count physical cash in the drawer and input below:</Text>
              <View style={styles.inputRow}>
                <Text style={styles.inputPrefix}>LKR</Text>
                <TextInput
                  style={styles.cashInput}
                  keyboardType="numeric"
                  placeholder="0.00"
                  value={closingCash}
                  onChangeText={setClosingCash}
                />
              </View>
              <Pressable
                style={[styles.closeBtn, busy && { opacity: 0.6 }]}
                onPress={handleCloseShift}
                disabled={busy}
              >
                <Text style={styles.closeBtnText}>{busy ? 'Submitting…' : 'Reconcile & Close Shift'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          /* No Active Shift -> Open New Shift */
          <View style={styles.openCard}>
            <Text style={styles.openEmoji}>🔒</Text>
            <Text style={styles.openTitle}>Register Drawer Closed</Text>
            <Text style={styles.openSub}>
              Enter the starting cash float amount to unlock the point of sale register.
            </Text>

            <View style={styles.floatForm}>
              <Text style={styles.inputLabel}>OPENING CASH FLOAT (LKR)</Text>
              <View style={styles.inputRow}>
                <Text style={styles.inputPrefix}>LKR</Text>
                <TextInput
                  style={styles.cashInput}
                  keyboardType="numeric"
                  value={openingFloat}
                  onChangeText={setOpeningFloat}
                  placeholder="5000.00"
                />
              </View>

              <View style={styles.quickChips}>
                {['2000.00', '5000.00', '10000.00'].map((amt) => (
                  <Pressable
                    key={amt}
                    style={[styles.chip, openingFloat === amt && styles.chipActive]}
                    onPress={() => setOpeningFloat(amt)}
                  >
                    <Text style={[styles.chipText, openingFloat === amt && styles.chipTextActive]}>
                      LKR {parseFloat(amt).toLocaleString()}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                style={[styles.openBtn, busy && { opacity: 0.6 }]}
                onPress={handleOpenShift}
                disabled={busy}
              >
                <Text style={styles.openBtnText}>{busy ? 'Opening Drawer…' : '🔓 Open Shift & Start Billing'}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
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
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: THEME.colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  headerSub: { fontSize: 11, color: THEME.colors.textMuted },
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
  floatBox: {
    marginTop: 16,
    padding: 14,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 12,
  },
  floatBoxTitle: { fontSize: 10, fontWeight: '800', color: THEME.colors.textMuted, letterSpacing: 0.5, marginBottom: 8 },
  floatRow: { flexDirection: 'row', justifyContent: 'space-between' },
  floatMethod: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  floatAmount: { fontSize: 14, fontWeight: '800', color: THEME.colors.primary },
  closeSection: { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: THEME.colors.border },
  closeTitle: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  closeSub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2, marginBottom: 12 },
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
  floatForm: { width: '100%' },
  inputLabel: { fontSize: 11, fontWeight: '700', color: THEME.colors.textMuted, marginBottom: 6 },
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
  quickChips: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 20 },
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
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  openBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
})
