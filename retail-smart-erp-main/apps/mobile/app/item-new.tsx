// Add product in one minute (owner / stock staff): only the name is required. Item ID (SKU) and
// barcode are made by the server when left empty (or scanned); quantity, prices, unit, category and
// expiry are optional. "Save & add next" keeps the unit / category for the next product.
//   POST /api/items        manageItems   (opening stock goes to the default / first active branch)
//   GET  /api/categories   category chips
import React, { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { apiGet, apiPost, asList, isNetworkError } from '../src/lib/api'
import { hasPermission } from '../src/lib/roles'
import { useSessionUser } from '../src/lib/session'
import { THEME, formatLKR } from '../src/lib/theme'
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal'
import { Card, EmptyState, PrimaryButton, ScreenHeader, uiStyles } from '../src/components/ui'

const UNITS: Array<{ code: string; label: string }> = [
  { code: 'pcs', label: 'Pieces' },
  { code: 'kg', label: 'kg' },
  { code: 'g', label: 'g' },
  { code: 'l', label: 'Litre' },
  { code: 'ml', label: 'ml' },
  { code: 'm', label: 'Metre' },
  { code: 'yd', label: 'Yard' },
  { code: 'ft', label: 'Feet' },
  { code: 'box', label: 'Box' },
  { code: 'pack', label: 'Pack' },
]

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', sku: 'Item ID', barcode: 'Barcode', sellingPrice: 'Selling price', costPrice: 'Purchase price',
  currentStock: 'Quantity', minStock: 'Low stock alert', unit: 'Unit', expiryDate: 'Expiry date', categoryId: 'Category',
}

interface Category { id: string; name: string }
interface Created { id: string; name: string; sku?: string | null; barcode?: string | null; itemCode?: string | null; sellingPrice?: string | number }

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addMonths(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return isoDate(d)
}
const money = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

export default function NewItemScreen() {
  const { user } = useSessionUser()
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [qty, setQty] = useState('')
  const [selling, setSelling] = useState('')
  const [cost, setCost] = useState('')
  const [unit, setUnit] = useState('pcs')
  const [expiry, setExpiry] = useState('')
  const [minStock, setMinStock] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [scanOpen, setScanOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<Created | null>(null)
  const [count, setCount] = useState(0)
  const nameRef = useRef<TextInput>(null)

  useEffect(() => {
    apiGet<any>('/api/categories?all=true').then((r) => {
      if (r.ok) setCategories(asList<Category>(r.data, 'categories').filter((c) => c?.id && c?.name))
    })
  }, [])

  if (user && !hasPermission(user, 'manageItems')) {
    return (
      <View style={uiStyles.screen}>
        <ScreenHeader title="Add product" />
        <EmptyState icon="lock-closed-outline" title="Not available for your role" subtitle="Adding products needs the Manage items permission." />
      </View>
    )
  }

  const expiryValid = !expiry || (/^\d{4}-\d{2}-\d{2}$/.test(expiry) && !Number.isNaN(Date.parse(`${expiry}T00:00:00Z`)))
  const margin = Number(selling) > 0 && Number(cost) > 0 ? Math.round(((Number(selling) - Number(cost)) / Number(selling)) * 1000) / 10 : null

  function reset(keepChoices: boolean) {
    setName('')
    setSku('')
    setBarcode('')
    setQty('')
    setSelling('')
    setCost('')
    setExpiry('')
    setMinStock('')
    setError(null)
    if (!keepChoices) {
      setUnit('pcs')
      setCategoryId(null)
    }
    setTimeout(() => nameRef.current?.focus(), 150)
  }

  async function save(next: boolean, confirmedZeroPrice = false) {
    if (busy) return
    if (!name.trim()) {
      setError('Enter the product name')
      nameRef.current?.focus()
      return
    }
    if (!expiryValid) {
      setError('Expiry date must be YYYY-MM-DD (or leave it empty)')
      return
    }
    if (!confirmedZeroPrice && !(Number(selling) > 0)) {
      Alert.alert('No selling price', 'The product will be saved with price 0 (you can set it later). Save anyway?', [
        { text: 'Add price', style: 'cancel' },
        { text: 'Save', onPress: () => save(next, true) },
      ])
      return
    }
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = {
      name: name.trim(),
      sellingPrice: Number(selling) || 0,
      unit,
      productType: 'stockable',
      trackStock: true,
    }
    if (sku.trim()) body.sku = sku.trim()
    if (barcode.trim()) body.barcode = barcode.trim()
    if (Number(cost) > 0) body.costPrice = Number(cost)
    if (Number(qty) > 0) body.currentStock = Number(qty)
    if (Number(minStock) > 0) body.minStock = Number(minStock)
    if (expiry) body.expiryDate = expiry
    if (categoryId) body.categoryId = categoryId
    const res = await apiPost<Created>('/api/items', body)
    setBusy(false)
    if (!res.ok) {
      if (isNetworkError(res)) {
        setError('No connection. Products are added online — try again when connected.')
        return
      }
      const b = (res.data || {}) as { code?: string; field?: string; value?: string; details?: Array<{ field?: string; message?: string }> }
      if (b.code === 'DUPLICATE' && b.field) setError(`${FIELD_LABELS[b.field] || b.field}${b.value ? ` "${b.value}"` : ''} is already used by another product`)
      else if (Array.isArray(b.details) && b.details.length) setError(b.details.slice(0, 4).map((d) => `${(d.field && FIELD_LABELS[d.field]) || d.field || 'Field'}: ${d.message || 'invalid'}`).join('\n'))
      else setError(res.error || 'Could not save the product')
      return
    }
    setLast(res.data)
    setCount((c) => c + 1)
    if (next) reset(true)
    else {
      Alert.alert('Product added', `${res.data?.name}\nItem ID: ${res.data?.sku || res.data?.itemCode || '—'}\nBarcode: ${res.data?.barcode || '—'}`, [
        { text: 'Print label', onPress: () => router.replace('/labels') },
        { text: 'Add another', onPress: () => reset(true) },
        { text: 'Done', onPress: () => router.back() },
      ])
    }
  }

  return (
    <View style={uiStyles.screen}>
      <ScreenHeader title="Add product" subtitle={count > 0 ? `${count} added this session` : 'Only the name is required'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[uiStyles.content, { paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
          {last ? (
            <Card style={styles.lastCard}>
              <Ionicons name="checkmark-circle" size={22} color={THEME.colors.tertiary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.lastTitle} numberOfLines={1}>Saved: {last.name}</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  ID {last.sku || last.itemCode || '—'} · Barcode {last.barcode || '—'}
                  {last.sellingPrice != null ? ` · ${formatLKR(Number(last.sellingPrice))}` : ''}
                </Text>
              </View>
            </Card>
          ) : null}

          <Card>
            <Text style={styles.label}>Product name *</Text>
            <TextInput ref={nameRef} style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Sunlight soap 100g" placeholderTextColor={THEME.colors.textSubtle} autoFocus returnKeyType="next" maxLength={255} />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Item ID / SKU</Text>
                <TextInput style={styles.input} value={sku} onChangeText={setSku} placeholder="Auto" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="characters" maxLength={100} />
              </View>
              <View style={{ flex: 1.3 }}>
                <Text style={styles.label}>Barcode</Text>
                <View style={styles.inputWithBtn}>
                  <TextInput style={[styles.input, { flex: 1, marginTop: 0 }]} value={barcode} onChangeText={setBarcode} placeholder="Auto" placeholderTextColor={THEME.colors.textSubtle} keyboardType="default" maxLength={100} />
                  <Pressable style={styles.scanBtn} onPress={() => setScanOpen(true)} accessibilityLabel="Scan the barcode">
                    <Ionicons name="barcode-outline" size={22} color={THEME.colors.onPrimary} />
                  </Pressable>
                </View>
              </View>
            </View>
            <Text style={styles.hint}>Leave ID and barcode empty and they are made for you (printable on labels).</Text>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={styles.cardTitle}>Optional</Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Selling price</Text>
                <TextInput style={styles.input} value={selling} onChangeText={(v) => setSelling(money(v))} placeholder="0.00" placeholderTextColor={THEME.colors.textSubtle} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Purchase price</Text>
                <TextInput style={styles.input} value={cost} onChangeText={(v) => setCost(money(v))} placeholder="0.00" placeholderTextColor={THEME.colors.textSubtle} keyboardType="decimal-pad" />
              </View>
            </View>
            {margin !== null ? <Text style={[styles.hint, margin < 0 && { color: THEME.colors.error }]}>Margin {margin}%</Text> : null}

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Quantity in stock</Text>
                <TextInput style={styles.input} value={qty} onChangeText={(v) => setQty(money(v))} placeholder="0" placeholderTextColor={THEME.colors.textSubtle} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Low stock alert at</Text>
                <TextInput style={styles.input} value={minStock} onChangeText={(v) => setMinStock(money(v))} placeholder="—" placeholderTextColor={THEME.colors.textSubtle} keyboardType="decimal-pad" />
              </View>
            </View>

            <Text style={styles.label}>Measure (unit)</Text>
            <View style={styles.chips}>
              {UNITS.map((u) => (
                <Pressable key={u.code} style={[styles.chip, unit === u.code && styles.chipOn]} onPress={() => setUnit(u.code)}>
                  <Text style={[styles.chipText, unit === u.code && styles.chipTextOn]}>{u.label}</Text>
                </Pressable>
              ))}
            </View>
            {['kg', 'g', 'l', 'ml', 'm', 'yd', 'ft'].includes(unit) ? (
              <Text style={styles.hint}>Sold by measure: the till can sell part quantities (e.g. 1.5 or 0.25) and related units (g ↔ kg, ml ↔ L, yard ↔ metre).</Text>
            ) : null}

            <Text style={styles.label}>Expiry date</Text>
            <TextInput style={[styles.input, !expiryValid && { borderColor: THEME.colors.error }]} value={expiry} onChangeText={(v) => setExpiry(v.replace(/[^0-9-]/g, '').slice(0, 10))} placeholder="YYYY-MM-DD (optional)" placeholderTextColor={THEME.colors.textSubtle} keyboardType="numbers-and-punctuation" />
            <View style={styles.chips}>
              {[['+3 months', 3], ['+6 months', 6], ['+1 year', 12], ['+2 years', 24]].map(([label, m]) => (
                <Pressable key={label as string} style={styles.chip} onPress={() => setExpiry(addMonths(m as number))}>
                  <Text style={styles.chipText}>{label}</Text>
                </Pressable>
              ))}
              {expiry ? (
                <Pressable style={styles.chip} onPress={() => setExpiry('')}>
                  <Text style={[styles.chipText, { color: THEME.colors.error }]}>Clear</Text>
                </Pressable>
              ) : null}
            </View>

            {categories.length > 0 ? (
              <>
                <Text style={styles.label}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginTop: 6 }}>
                  <Pressable style={[styles.chip, !categoryId && styles.chipOn]} onPress={() => setCategoryId(null)}>
                    <Text style={[styles.chipText, !categoryId && styles.chipTextOn]}>None</Text>
                  </Pressable>
                  {categories.map((c) => (
                    <Pressable key={c.id} style={[styles.chip, categoryId === c.id && styles.chipOn]} onPress={() => setCategoryId(c.id)}>
                      <Text style={[styles.chipText, categoryId === c.id && styles.chipTextOn]}>{c.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
          </Card>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={THEME.colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={{ gap: 10, marginTop: 16 }}>
            {busy ? (
              <View style={styles.busy}><ActivityIndicator color={THEME.colors.primary} /></View>
            ) : (
              <>
                <PrimaryButton label="Save & add next" icon="add-circle-outline" onPress={() => save(true)} />
                <PrimaryButton label="Save" icon="checkmark" tone="secondary" onPress={() => save(false)} />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <BarcodeScannerModal
        visible={scanOpen}
        title="Scan the product barcode"
        onClose={() => setScanOpen(false)}
        onBarcodeScanned={(code) => {
          setBarcode(code.trim())
          setScanOpen(false)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted, marginTop: 12 },
  cardTitle: { fontSize: 12, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { marginTop: 6, minHeight: 48, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, color: THEME.colors.text, backgroundColor: THEME.colors.card },
  inputWithBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  scanBtn: { width: 48, height: 48, borderRadius: 10, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  hint: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow, marginRight: 6 },
  chipOn: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  chipTextOn: { color: THEME.colors.onPrimary },
  errorBox: { flexDirection: 'row', gap: 8, marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: THEME.colors.errorLight },
  errorText: { flex: 1, fontSize: 13, fontWeight: '600', color: THEME.colors.error },
  lastCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, borderColor: THEME.colors.tertiaryLight },
  lastTitle: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  muted: { fontSize: 12, color: THEME.colors.textMuted },
  busy: { height: 52, alignItems: 'center', justifyContent: 'center' },
})
