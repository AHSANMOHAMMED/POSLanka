import React, { useMemo, useState } from 'react'
import { View, Text, Pressable, Alert, StyleSheet, ScrollView } from 'react-native'
import { router } from 'expo-router'
import { apiPost } from '../src/lib/api'
import { THEME, formatLKR } from '../src/lib/theme'
import { ScreenHeader } from '../src/components/ui'
import { Field } from '../src/components/FormKit'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSessionUser } from '../src/lib/session'
import { openWeb } from '../src/lib/modules'

interface Line { name: string; qty: string; price: string }

/** Create a draft quotation with FormKit-style lines (or open full editor on the web). */
export default function QuotationNewScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useSessionUser()
  const [customerName, setCustomerName] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([{ name: '', qty: '1', price: '' }])
  const [busy, setBusy] = useState(false)

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0),
    [lines],
  )

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  async function save() {
    const items = lines
      .map((l) => ({
        name: l.name.trim() || 'Item',
        quantity: Number(l.qty) || 1,
        unitPrice: Number(l.price) || 0,
      }))
      .filter((i) => i.name && (i.quantity > 0 || i.unitPrice > 0))
    if (!items.length) {
      Alert.alert('Lines', 'Add at least one item with a name.')
      return
    }
    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    setBusy(true)
    const res = await apiPost('/api/quotations', {
      customerName: customerName.trim() || 'Walk-in',
      notes: notes.trim() || undefined,
      items,
      lines: items,
      subtotal: total,
      total,
      status: 'draft',
    })
    setBusy(false)
    if (!res.ok) Alert.alert('Failed', res.error)
    else {
      Alert.alert('Saved', `Draft quotation ${formatLKR(total)}`, [{ text: 'OK', onPress: () => router.back() }])
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME.colors.background, paddingTop: insets.top }}>
      <ScreenHeader
        title="New quotation"
        right={
          <Pressable onPress={() => openWeb(user, '/quotations/new')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open on web">
            <Text style={{ color: THEME.colors.primary, fontWeight: '700', fontSize: 13 }}>Full editor</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>Quick draft on this phone. Use Full editor on the web for taxes, discounts and templates.</Text>
        <Field label="Customer" value={customerName} onChangeText={setCustomerName} placeholder="Walk-in customer" autoCapitalize="words" />
        <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline />

        <Text style={styles.section}>Lines</Text>
        {lines.map((l, i) => (
          <View key={i} style={styles.lineCard}>
            <Field label={`Item ${i + 1}`} value={l.name} onChangeText={(v) => setLine(i, { name: v })} placeholder="Item name" />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field label="Qty" value={l.qty} onChangeText={(v) => setLine(i, { qty: v })} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Unit price" value={l.price} onChangeText={(v) => setLine(i, { price: v })} keyboardType="decimal-pad" />
              </View>
            </View>
            {lines.length > 1 ? (
              <Pressable onPress={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} accessibilityRole="button" accessibilityLabel={`Remove item ${i + 1}`}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        <Pressable style={styles.addLine} onPress={() => setLines((prev) => [...prev, { name: '', qty: '1', price: '' }])} accessibilityRole="button">
          <Text style={styles.addLineText}>+ Add line</Text>
        </Pressable>

        <Text style={styles.total}>Subtotal {formatLKR(subtotal)}</Text>
        <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} onPress={save} disabled={busy} accessibilityRole="button" accessibilityLabel="Create quotation">
          <Text style={styles.btnText}>{busy ? 'Saving…' : 'Create draft quotation'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  lead: { fontSize: 13, color: THEME.colors.textMuted, marginBottom: 12, lineHeight: 18 },
  section: { fontSize: 13, fontWeight: '800', color: THEME.colors.text, marginTop: 8, marginBottom: 6 },
  lineCard: { backgroundColor: THEME.colors.card, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 10, marginBottom: 10 },
  row2: { flexDirection: 'row', gap: 8 },
  remove: { color: THEME.colors.error, fontWeight: '700', fontSize: 13, marginTop: 4 },
  addLine: { paddingVertical: 10, alignItems: 'center' },
  addLineText: { color: THEME.colors.primary, fontWeight: '800' },
  total: { fontSize: 16, fontWeight: '800', color: THEME.colors.text, marginVertical: 12 },
  btn: { backgroundColor: THEME.colors.primary, borderRadius: 10, padding: 14, alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: '800' },
})
