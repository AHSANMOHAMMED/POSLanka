import React, { useEffect, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { THEME, formatLKR } from '../lib/theme'
import { manualDiscountAmount, type ManualDiscountType } from '../lib/cartMath'

export interface DiscountInput {
  type: ManualDiscountType
  value: number
  /** Resulting amount (LKR) on the base the sheet was opened with */
  amount: number
  reason: string
}

interface Props {
  visible: boolean
  /** "Bill discount" / "Discount on Rice 5kg" */
  title: string
  /** Amount the discount applies to (bill subtotal or line total) */
  base: number
  /** Counter's max discount % (shown as a hint) */
  maxPercent?: number | null
  initial?: { type: ManualDiscountType; value: number; reason?: string } | null
  onClose: () => void
  onApply: (d: DiscountInput) => void
  /** Remove an existing discount */
  onRemove?: () => void
}

export function DiscountModal({ visible, title, base, maxPercent, initial, onClose, onApply, onRemove }: Props) {
  const [type, setType] = useState<ManualDiscountType>('percentage')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!visible) return
    setType(initial?.type || 'percentage')
    setValue(initial?.value ? String(initial.value) : '')
    setReason(initial?.reason || '')
  }, [visible, initial])

  const num = parseFloat(value) || 0
  const amount = manualDiscountAmount(base, type, num)
  const pct = base > 0 ? Math.round((amount / base) * 10000) / 100 : 0
  const tooBig = type === 'fixed' ? num > base + 0.004 : num > 100
  const valid = num > 0 && !tooBig && amount > 0

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>
            On {formatLKR(base)}
            {maxPercent != null && maxPercent < 100 ? ` · counter limit ${maxPercent}% (above it a supervisor PIN is asked)` : ''}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.seg}>
              {(['percentage', 'fixed'] as const).map((t) => (
                <Pressable key={t} style={[styles.segBtn, type === t && styles.segBtnOn]} onPress={() => setType(t)} accessibilityRole="button" accessibilityState={{ selected: type === t }}>
                  <Text style={[styles.segText, type === t && styles.segTextOn]}>{t === 'percentage' ? 'Percent %' : 'Amount LKR'}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={[styles.input, tooBig && { borderColor: THEME.colors.error }]}
              value={value}
              onChangeText={(v) => setValue(v.replace(/[^0-9.]/g, ''))}
              placeholder={type === 'percentage' ? 'e.g. 10' : 'e.g. 250.00'}
              placeholderTextColor={THEME.colors.textSubtle}
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.quickRow}>
              {(type === 'percentage' ? [5, 10, 15, 20] : [50, 100, 250, 500]).map((q) => (
                <Pressable key={q} style={styles.quick} onPress={() => setValue(String(q))}>
                  <Text style={styles.quickText}>{type === 'percentage' ? `${q}%` : q}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (optional)"
              placeholderTextColor={THEME.colors.textSubtle}
              maxLength={200}
            />
            <View style={styles.preview}>
              <Text style={styles.previewLabel}>Discount</Text>
              <Text style={styles.previewVal}>
                −{formatLKR(valid ? amount : 0)}
                {valid ? ` (${pct}%)` : ''}
              </Text>
            </View>
            {tooBig ? <Text style={styles.error}>{type === 'fixed' ? 'More than the amount it is applied to' : 'Cannot be more than 100%'}</Text> : null}
          </ScrollView>
          <View style={styles.row}>
            {onRemove ? (
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={onRemove}>
                <Text style={[styles.btnGhostText, { color: THEME.colors.error }]}>Remove</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
            )}
            <Pressable style={[styles.btn, styles.btnPrimary, !valid && { opacity: 0.5 }]} disabled={!valid} onPress={() => onApply({ type, value: num, amount, reason: reason.trim() })}>
              <Text style={styles.btnPrimaryText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28, maxHeight: '85%' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: THEME.colors.outline, alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  sub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2, marginBottom: 12 },
  seg: { flexDirection: 'row', backgroundColor: THEME.colors.surfaceContainerLow, borderRadius: 12, padding: 3, marginBottom: 10 },
  segBtn: { flex: 1, minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: THEME.colors.primary },
  segText: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  segTextOn: { color: '#FFF' },
  input: { borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 50, fontSize: 18, fontWeight: '700', color: THEME.colors.text, backgroundColor: THEME.colors.surfaceContainerLow, marginBottom: 8 },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  quick: { flex: 1, minHeight: 40, borderRadius: 10, backgroundColor: THEME.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  quickText: { fontSize: 14, fontWeight: '800', color: THEME.colors.primary },
  preview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: THEME.colors.secondaryLight, marginTop: 4 },
  previewLabel: { fontSize: 13, fontWeight: '700', color: THEME.colors.onSecondaryContainer },
  previewVal: { fontSize: 16, fontWeight: '900', color: THEME.colors.onSecondaryContainer },
  error: { marginTop: 6, fontSize: 12, fontWeight: '700', color: THEME.colors.error },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: THEME.colors.border },
  btnGhostText: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  btnPrimary: { backgroundColor: THEME.colors.primary },
  btnPrimaryText: { fontSize: 15, fontWeight: '800', color: '#FFF' },
})
