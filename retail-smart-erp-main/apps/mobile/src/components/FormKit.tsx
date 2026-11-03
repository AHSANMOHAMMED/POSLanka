// Small form building blocks shared by the native manage screens (customers, suppliers, quotations,
// purchase orders, stock transfers, settings): labelled field, select row, bottom sheet, option /
// item pickers. Styling follows THEME and ui.tsx.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { apiGet, asList, qs } from '../lib/api'
import { THEME, formatLKR } from '../lib/theme'
import { EmptyState } from './ui'

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  error,
  autoCapitalize,
  editable = true,
  hint,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  keyboardType?: KeyboardTypeOptions
  multiline?: boolean
  error?: string | null
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  editable?: boolean
  hint?: string
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 76, textAlignVertical: 'top' }, !!error && { borderColor: THEME.colors.error }, !editable && { opacity: 0.6 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={THEME.colors.textSubtle}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        editable={editable}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

export function SelectField({ label, value, placeholder = 'Choose…', onPress, error }: { label: string; value?: string | null; placeholder?: string; onPress: () => void; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={[styles.input, styles.select, !!error && { borderColor: THEME.colors.error }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value || placeholder}`}>
        <Text style={[styles.selectText, !value && { color: THEME.colors.textSubtle }]} numberOfLines={1}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={THEME.colors.textMuted} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

/** Bottom sheet with a scrolling body and an optional pinned footer. */
export function SheetModal({ visible, title, subtitle, onClose, children, footer, tall }: { visible: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; tall?: boolean }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, tall && { height: '90%' }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
              {subtitle ? <Text style={styles.sheetSub} numberOfLines={2}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={THEME.colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView style={tall ? { flex: 1 } : undefined} contentContainerStyle={{ padding: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function SheetButtons({ onCancel, onSave, saveLabel = 'Save', busy, disabled }: { onCancel: () => void; onSave: () => void; saveLabel?: string; busy?: boolean; disabled?: boolean }) {
  return (
    <View style={styles.btnRow}>
      <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel} disabled={busy}>
        <Text style={styles.btnGhostText}>Cancel</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.btnPrimary, (busy || disabled) && { opacity: 0.55 }]} onPress={onSave} disabled={busy || disabled}>
        {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnPrimaryText}>{saveLabel}</Text>}
      </Pressable>
    </View>
  )
}

export interface Option {
  id: string
  label: string
  sub?: string
}

/** Pick one entry from a list (suppliers, branches …) with a local filter. */
export function OptionSheet({ visible, title, options, loading, error, onSelect, onClose, emptyText = 'Nothing to choose from.' }: { visible: boolean; title: string; options: Option[]; loading?: boolean; error?: string | null; onSelect: (o: Option) => void; onClose: () => void; emptyText?: string }) {
  const [q, setQ] = useState('')
  useEffect(() => {
    if (visible) setQ('')
  }, [visible])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? options.filter((o) => `${o.label} ${o.sub || ''}`.toLowerCase().includes(t)) : options
  }, [options, q])
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: '80%' }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetTitle, { flex: 1 }]}>{title}</Text>
            <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={THEME.colors.textMuted} />
            </Pressable>
          </View>
          {options.length > 8 ? (
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={THEME.colors.textMuted} />
              <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" autoCorrect={false} />
            </View>
          ) : null}
          {loading ? (
            <ActivityIndicator style={{ padding: 28 }} color={THEME.colors.primary} />
          ) : error ? (
            <Text style={[styles.error, { padding: 20 }]}>{error}</Text>
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(o) => o.id}
              contentContainerStyle={{ padding: 16, paddingTop: 8 }}
              ListEmptyComponent={<EmptyState icon="file-tray-outline" title={emptyText} />}
              renderItem={({ item }) => (
                <Pressable style={styles.optionRow} onPress={() => onSelect(item)} accessibilityRole="button">
                  <Text style={styles.optionTitle} numberOfLines={1}>{item.label}</Text>
                  {item.sub ? <Text style={styles.optionSub} numberOfLines={1}>{item.sub}</Text> : null}
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  )
}

export interface PickedItem {
  id: string
  name: string
  sku?: string | null
  barcode?: string | null
  unit?: string | null
  sellingPrice: number
  costPrice: number
}

/** Search the catalog (GET /api/items) and pick one product — used for quotation / PO / transfer lines. */
export function ItemSearchSheet({ visible, onClose, onSelect, warehouseId, title = 'Add a product' }: { visible: boolean; onClose: () => void; onSelect: (item: PickedItem) => void; warehouseId?: string | null; title?: string }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<PickedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (visible) {
      setQ('')
      setRows([])
      setError(null)
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const s = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      const res = await apiGet<any>(`/api/items${qs({ search: q.trim() || undefined, warehouseId: warehouseId || undefined, hideVariants: 'false', pageSize: 30 })}`)
      if (s !== seq.current) return
      setLoading(false)
      if (!res.ok) {
        setRows([])
        setError(res.status === 0 ? 'Offline — products need a connection.' : res.error)
        return
      }
      setError(null)
      setRows(
        asList<any>(res.data).map((i) => ({
          id: String(i.id),
          name: String(i.name),
          sku: i.sku,
          barcode: i.barcode,
          unit: i.unit,
          sellingPrice: Number(i.sellingPrice) || 0,
          costPrice: Number(i.costPrice) || 0,
        }))
      )
    }, 250)
    return () => clearTimeout(t)
  }, [q, visible, warehouseId])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { height: '80%' }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetTitle, { flex: 1 }]}>{title}</Text>
            <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={THEME.colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={THEME.colors.textMuted} />
            <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Name, barcode or SKU" placeholderTextColor={THEME.colors.textSubtle} autoFocus autoCapitalize="none" autoCorrect={false} />
            {loading ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
          </View>
          {error ? <Text style={[styles.error, { padding: 16 }]}>{error}</Text> : null}
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingTop: 8 }}
            ListEmptyComponent={loading || error ? null : <EmptyState icon="cube-outline" title="No products found" />}
            renderItem={({ item }) => (
              <Pressable style={styles.optionRow} onPress={() => onSelect(item)} accessibilityRole="button">
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.optionTitle} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.optionSub} numberOfLines={1}>{item.barcode || item.sku || 'No barcode'}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.price}>{formatLKR(item.sellingPrice)}</Text>
                  {item.costPrice > 0 ? <Text style={styles.optionSub}>cost {formatLKR(item.costPrice)}</Text> : null}
                </View>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  )
}

/** Screen-level search box used above lists. */
export function SearchBar({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.listSearchWrap}>
      <View style={[styles.searchBar, { marginHorizontal: 16 }]}>
        <Ionicons name="search" size={18} color={THEME.colors.textMuted} />
        <TextInput style={styles.searchInput} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
        {value ? (
          <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={THEME.colors.textSubtle} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

export function parseMoney(v: string): number {
  const n = parseFloat(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

const styles = StyleSheet.create({
  field: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '800', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 },
  input: { minHeight: 48, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: THEME.colors.text, backgroundColor: THEME.colors.surfaceContainerLow },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  selectText: { flex: 1, fontSize: 15, color: THEME.colors.text },
  error: { marginTop: 4, fontSize: 12, fontWeight: '700', color: THEME.colors.error },
  hint: { marginTop: 4, fontSize: 11, color: THEME.colors.textSubtle },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: THEME.colors.outline, alignSelf: 'center', marginTop: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  sheetSub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: THEME.colors.border },
  btnGhostText: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  btnPrimary: { backgroundColor: THEME.colors.primary },
  btnPrimaryText: { fontSize: 15, fontWeight: '800', color: '#FFF' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, height: 46, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow },
  searchInput: { flex: 1, fontSize: 14, color: THEME.colors.text },
  listSearchWrap: { backgroundColor: THEME.colors.card, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.colors.border },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: '#FFF', marginBottom: 8 },
  optionTitle: { fontSize: 15, fontWeight: '700', color: THEME.colors.text },
  optionSub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  price: { fontSize: 14, fontWeight: '900', color: THEME.colors.primary, fontVariant: ['tabular-nums'] },
})
