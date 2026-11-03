import React, { useEffect, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { THEME, formatLKR } from '../lib/theme'

interface Props {
  visible: boolean
  total: number
  lineCount: number
  customerName?: string | null
  onClose: () => void
  /** validUntil = YYYY-MM-DD. Resolve true when saved. */
  onSubmit: (input: { validUntil: string; notes: string }) => Promise<boolean>
}

function plusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Save as quotation": confirms the validity and notes, then the POS posts the cart lines to POST /api/quotations. */
export function QuoteFromCartModal({ visible, total, lineCount, customerName, onClose, onSubmit }: Props) {
  const [days, setDays] = useState(14)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (visible) {
      setDays(14)
      setNotes('')
      setBusy(false)
    }
  }, [visible])

  async function submit() {
    setBusy(true)
    try {
      await onSubmit({ validUntil: plusDays(days), notes: notes.trim() })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={{ flex: 1 }} onPress={busy ? undefined : onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Save as quotation</Text>
          <Text style={styles.sub}>
            {lineCount} line{lineCount === 1 ? '' : 's'} · about {formatLKR(total)} · {customerName ? `for ${customerName}` : 'walk-in (no customer linked)'}
          </Text>
          <Text style={styles.label}>Valid for</Text>
          <View style={styles.chips}>
            {[7, 14, 30].map((d) => (
              <Pressable key={d} style={[styles.chip, days === d && styles.chipOn]} onPress={() => setDays(d)}>
                <Text style={[styles.chipText, days === d && { color: '#FFF' }]}>{d} days</Text>
              </Pressable>
            ))}
          </View>
          <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Notes for the customer (optional)" placeholderTextColor={THEME.colors.textSubtle} multiline maxLength={2000} />
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose} disabled={busy}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnPrimaryText}>Save quotation</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: THEME.colors.outline, alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  sub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', marginBottom: 6 },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  input: { minHeight: 70, textAlignVertical: 'top', borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, padding: 12, fontSize: 14, color: THEME.colors.text, backgroundColor: THEME.colors.surfaceContainerLow },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: THEME.colors.border },
  btnGhostText: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  btnPrimary: { backgroundColor: THEME.colors.primary },
  btnPrimaryText: { fontSize: 15, fontWeight: '800', color: '#FFF' },
})
