import React, { useEffect, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native'
import { THEME } from '../lib/theme'
import { apiPost } from '../lib/api'

/**
 * H1: supervisor PIN approval on the device. POST /api/auth/verify-pin (scope 'supervisor')
 * returns a signed, single-use approval token for `scopes`, which the caller sends with the
 * action the server refused (403 APPROVAL_REQUIRED).
 */
export interface SupervisorApprovalRequest {
  scopes: string[]
  message: string
  amount?: number
  posOpeningEntryId?: string
}

interface Props {
  request: SupervisorApprovalRequest | null
  onApproved: (token: string, approverName: string) => void
  onCancel: () => void
}

export function SupervisorPinModal({ request, onApproved, onCancel }: Props) {
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (request) {
      setPin('')
      setReason('')
      setError(null)
    }
  }, [request])

  async function approve() {
    if (!request) return
    if (!/^\d{4,6}$/.test(pin)) {
      setError('Enter the supervisor PIN (4-6 digits)')
      return
    }
    setBusy(true)
    setError(null)
    const res = await apiPost<{ ok: boolean; approvalToken?: string; user?: { name?: string } }>('/api/auth/verify-pin', {
      pin,
      scope: 'supervisor',
      permission: 'manageSales',
      reason: reason.trim() || undefined,
      approvalScopes: request.scopes,
      context: { posOpeningEntryId: request.posOpeningEntryId, amount: request.amount, detail: request.message.slice(0, 500) },
    })
    setBusy(false)
    if (!res.ok || !res.data?.approvalToken) {
      setError(res.ok ? 'This user cannot approve this action' : res.error)
      return
    }
    onApproved(res.data.approvalToken, res.data.user?.name || 'Supervisor')
  }

  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Supervisor Approval</Text>
          <Text style={styles.message}>{request?.message}</Text>
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
            placeholder="Supervisor PIN"
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            editable={!busy}
          />
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)"
            maxLength={200}
            editable={!busy}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel} disabled={busy}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={approve} disabled={busy}>
              {busy ? <ActivityIndicator color={THEME.colors.onPrimary} /> : <Text style={styles.btnPrimaryText}>Approve</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: THEME.colors.card, borderRadius: 12, padding: 20 },
  title: { fontSize: 18, fontWeight: '700', color: THEME.colors.text, marginBottom: 6 },
  message: { fontSize: 14, color: THEME.colors.textMuted, marginBottom: 14 },
  input: {
    borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, color: THEME.colors.text, marginBottom: 10,
  },
  error: { color: THEME.colors.error, fontSize: 13, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  btn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8, minWidth: 96, alignItems: 'center' },
  btnGhost: { borderWidth: 1, borderColor: THEME.colors.border },
  btnGhostText: { color: THEME.colors.text, fontWeight: '600' },
  btnPrimary: { backgroundColor: THEME.colors.primary },
  btnPrimaryText: { color: THEME.colors.onPrimary, fontWeight: '700' },
})
