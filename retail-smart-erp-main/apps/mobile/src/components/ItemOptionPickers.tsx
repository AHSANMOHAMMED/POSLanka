// Pickers shown before an item is added to the cart when it needs a choice:
//   - VariantPickerModal: a product sold by size / colour (GET /api/items/:id/variants)
//   - SerialPickerModal: a serial-tracked product (GET /api/items/:id/serial-numbers, status available)
import React, { useEffect, useMemo, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, FlatList, TextInput, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { apiGet, asList, qs } from '../lib/api'
import { THEME, formatLKR } from '../lib/theme'
import { EmptyState } from './ui'

export interface VariantChoice {
  id: string
  name: string
  sku?: string | null
  barcode?: string | null
  sellingPrice: string
  unit?: string | null
  trackStock?: boolean
  taxTemplateId?: string | null
  availableStock: number | null
  /** "Size: M · Colour: Black" */
  label: string
}

export interface SerialChoice {
  id: string
  serialNumber: string
}

function Sheet({ visible, title, subtitle, onClose, children, footer }: { visible: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {subtitle ? <Text style={styles.sub} numberOfLines={2}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={THEME.colors.textMuted} />
            </Pressable>
          </View>
          {children}
          {footer}
        </View>
      </View>
    </Modal>
  )
}

export function VariantPickerModal({ item, warehouseId, onClose, onPick }: { item: { id: string; name: string } | null; warehouseId?: string | null; onClose: () => void; onPick: (v: VariantChoice) => void }) {
  const [rows, setRows] = useState<VariantChoice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!item) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setRows([])
    apiGet<any>(`/api/items/${item.id}/variants${qs({ warehouseId: warehouseId || undefined })}`).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (!res.ok) {
        setError(res.status === 0 ? 'Sizes and colours need a connection.' : res.error)
        return
      }
      const list = Array.isArray(res.data?.variants) ? res.data.variants : []
      setRows(
        list.map((v: any) => {
          const attrs = (v.variantAttributes || {}) as Record<string, string>
          const label = Object.entries(attrs).filter(([, val]) => val).map(([k, val]) => `${k}: ${val}`).join(' · ')
          const raw = v.availableStock
          const stock = v.trackStock === false || raw == null || isNaN(Number(raw)) ? null : Number(raw)
          return {
            id: String(v.id), name: String(v.name), sku: v.sku, barcode: v.barcode,
            sellingPrice: String(v.sellingPrice ?? '0'), unit: v.unit, trackStock: v.trackStock, taxTemplateId: v.taxTemplateId ?? null,
            availableStock: stock, label: label || String(v.name),
          } as VariantChoice
        })
      )
    })
    return () => { cancelled = true }
  }, [item, warehouseId])

  return (
    <Sheet visible={!!item} title={item?.name || 'Choose a variant'} subtitle="Tap the size / colour the customer is buying" onClose={onClose}>
      {loading ? (
        <ActivityIndicator style={{ padding: 28 }} color={THEME.colors.primary} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(v) => v.id}
          style={{ maxHeight: 420 }}
          contentContainerStyle={{ padding: 16, paddingTop: 4 }}
          ListEmptyComponent={<EmptyState icon="shirt-outline" title="No variants" subtitle="This product has no sizes or colours set up." />}
          renderItem={({ item: v }) => {
            const out = v.availableStock !== null && v.availableStock <= 0
            return (
              <Pressable style={[styles.row, out && { opacity: 0.45 }]} disabled={out} onPress={() => onPick(v)} accessibilityRole="button" accessibilityLabel={`${v.label}, ${formatLKR(v.sellingPrice)}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{v.label}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {v.barcode || v.sku || 'No barcode'} · {v.availableStock === null ? 'Stock not tracked' : out ? 'Out of stock' : `${v.availableStock} in stock`}
                  </Text>
                </View>
                <Text style={styles.price}>{formatLKR(v.sellingPrice)}</Text>
              </Pressable>
            )
          }}
        />
      )}
    </Sheet>
  )
}

export function SerialPickerModal({ item, warehouseId, onClose, onPick, onSkip, excludeIds }: { item: { id: string; name: string } | null; /** serial ids already in the cart */ excludeIds?: string[]; warehouseId?: string | null; onClose: () => void; onPick: (serials: SerialChoice[]) => void; /** Sell without recording a serial (offline / none in stock) */ onSkip?: () => void }) {
  const [rows, setRows] = useState<SerialChoice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    if (!item) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setRows([])
    setPicked([])
    setQuery('')
    apiGet<any>(`/api/items/${item.id}/serial-numbers${qs({ status: 'available', warehouseId: warehouseId || undefined, all: 'true' })}`).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (!res.ok) {
        setError(res.status === 0 ? 'Serial numbers need a connection.' : res.error)
        return
      }
      setRows(asList<any>(res.data).map((r) => ({ id: String(r.id), serialNumber: String(r.serialNumber) })))
    })
    return () => { cancelled = true }
  }, [item, warehouseId])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const open = excludeIds?.length ? rows.filter((r) => !excludeIds.includes(r.id)) : rows
    return q ? open.filter((r) => r.serialNumber.toLowerCase().includes(q)) : open
  }, [rows, query, excludeIds])

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  return (
    <Sheet
      visible={!!item}
      title={item?.name || 'Choose serial numbers'}
      subtitle="This product is sold by serial number / IMEI. Tick the units being sold."
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Pressable
            style={[styles.addBtn, picked.length === 0 && { opacity: 0.5 }]}
            disabled={picked.length === 0}
            onPress={() => onPick(rows.filter((r) => picked.includes(r.id)))}
          >
            <Text style={styles.addBtnText}>{picked.length ? `Add ${picked.length} to cart` : 'Pick a serial number'}</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={THEME.colors.textMuted} />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search serial / IMEI" placeholderTextColor={THEME.colors.textSubtle} autoCapitalize="characters" autoCorrect={false} />
      </View>
      {loading ? (
        <ActivityIndicator style={{ padding: 28 }} color={THEME.colors.primary} />
      ) : error ? (
        <View>
          <Text style={styles.error}>{error}</Text>
          {onSkip ? (
            <Pressable style={[styles.addBtn, { marginHorizontal: 16, backgroundColor: THEME.colors.surfaceContainerHigh }]} onPress={onSkip}>
              <Text style={[styles.addBtnText, { color: THEME.colors.text }]}>Add without a serial number</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(r) => r.id}
          style={{ maxHeight: 340 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingTop: 8 }}
          ListEmptyComponent={<EmptyState icon="barcode-outline" title="No serial numbers in stock" subtitle="Receive stock with serial numbers first (Stock intake / purchase)." />}
          renderItem={({ item: r }) => {
            const on = picked.includes(r.id)
            return (
              <Pressable style={[styles.row, on && styles.rowOn]} onPress={() => toggle(r.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? THEME.colors.primary : THEME.colors.textMuted} />
                <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>{r.serialNumber}</Text>
              </Pressable>
            )
          }}
        />
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24, maxHeight: '88%' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: THEME.colors.outline, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  sub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  error: { padding: 20, fontSize: 13, fontWeight: '700', color: THEME.colors.error },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: '#FFF', marginBottom: 8 },
  rowOn: { borderColor: THEME.colors.primary, backgroundColor: THEME.colors.primaryLight },
  rowTitle: { fontSize: 15, fontWeight: '700', color: THEME.colors.text },
  rowSub: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  price: { fontSize: 15, fontWeight: '900', color: THEME.colors.primary, fontVariant: ['tabular-nums'] },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, height: 46, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow },
  searchInput: { flex: 1, fontSize: 14, color: THEME.colors.text },
  footer: { paddingHorizontal: 16, paddingTop: 4 },
  addBtn: { minHeight: 52, borderRadius: 14, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
})
