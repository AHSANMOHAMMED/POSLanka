import React, { useEffect, useRef, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, TextInput, FlatList, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { apiGet, asList, qs } from '../lib/api'
import { findByCode, searchItems, type OfflineBundle } from '../lib/localdb'
import { THEME, formatLKR } from '../lib/theme'
import { useHeaderPad } from '../lib/safeArea'
import { BarcodeScannerModal } from './BarcodeScannerModal'
import { EmptyState } from './ui'

interface PriceRow {
  id: string
  name: string
  code: string | null
  price: string
  unit: string | null
  stock: number | null
}

interface Props {
  visible: boolean
  onClose: () => void
  warehouseId?: string | null
  /** Use the on-device catalog (works offline) */
  localReady: boolean
  scaleConfig?: OfflineBundle['scaleBarcode']
}

function rowFromServer(i: any): PriceRow {
  const raw = i.availableStock ?? i.currentStock
  const stock = i.trackStock === false || raw == null || isNaN(Number(raw)) ? null : Number(raw)
  return { id: String(i.id), name: String(i.name || ''), code: i.barcode || (i.pluCode ? `PLU ${i.pluCode}` : i.sku ? `SKU ${i.sku}` : null), price: String(i.sellingPrice ?? '0'), unit: i.unit || null, stock }
}

/** Price check: look an item up by name / barcode / scan and see its price and stock — nothing is added to the cart. */
export function PriceCheckModal({ visible, onClose, warehouseId, localReady, scaleConfig }: Props) {
  const headerPad = useHeaderPad()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<PriceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanner, setScanner] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!visible) {
      setQuery('')
      setRows([])
      setError(null)
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const q = query.trim()
    if (!q) {
      setRows([])
      setError(null)
      return
    }
    const s = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      let out: PriceRow[] | null = null
      if (localReady) {
        const r = await searchItems(q, { limit: 30 }).catch(() => null)
        if (r) {
          out = r.items.map((i) => ({
            id: i.id,
            name: i.name,
            code: i.barcode || (i.pluCode ? `PLU ${i.pluCode}` : i.sku ? `SKU ${i.sku}` : null),
            price: i.sellingPrice,
            unit: i.unit,
            stock: i.trackStock === false || i.availableStock == null ? null : i.availableStock,
          }))
        }
      }
      if (!out) {
        const res = await apiGet<any>(`/api/items${qs({ search: q, warehouseId: warehouseId || undefined, pageSize: 30 })}`)
        if (s !== seq.current) return
        if (!res.ok) {
          setRows([])
          setError(res.status === 0 ? 'Offline and the catalog is not on this device yet.' : res.error)
          setLoading(false)
          return
        }
        out = asList<any>(res.data).map(rowFromServer)
      }
      if (s !== seq.current) return
      setError(null)
      setRows(out)
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query, visible, localReady, warehouseId])

  async function onScan(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    setQuery('')
    setLoading(true)
    setError(null)
    if (localReady) {
      const m = await findByCode(trimmed, scaleConfig).catch(() => null)
      if (m) {
        const i = m.item
        setRows([{ id: i.id, name: i.name, code: m.matchedBarcode || i.barcode || i.sku, price: String(m.uomPrice ?? m.unitPrice ?? i.sellingPrice), unit: m.uom || i.unit, stock: i.trackStock === false || i.availableStock == null ? null : i.availableStock }])
        setLoading(false)
        return
      }
    }
    const res = await apiGet<any>(`/api/items/barcode-lookup${qs({ barcode: trimmed, warehouseId: warehouseId || undefined })}`)
    setLoading(false)
    if (res.ok && res.data?.id) setRows([rowFromServer(res.data)])
    else {
      setRows([])
      setError(res.status === 404 ? `No item with barcode / PLU ${trimmed}` : res.status === 0 ? `Offline, and ${trimmed} is not saved on this device.` : res.error)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, headerPad]}>
          <Pressable style={styles.backBtn} onPress={onClose} accessibilityLabel="Close price check">
            <Ionicons name="arrow-back" size={22} color={THEME.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Price check</Text>
            <Text style={styles.sub}>Look up a price — nothing is added to the cart</Text>
          </View>
        </View>
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color={THEME.colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Item name, barcode or SKU"
              placeholderTextColor={THEME.colors.textSubtle}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => (/^\d{8,}$/.test(query.trim()) ? onScan(query) : undefined)}
            />
            {loading ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
          </View>
          <Pressable style={styles.scanBtn} onPress={() => setScanner(true)} accessibilityLabel="Scan a barcode">
            <Ionicons name="scan" size={24} color="#FFF" />
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
          ListEmptyComponent={loading || error ? null : <EmptyState icon="pricetag-outline" title={query ? 'No matching items' : 'Scan or search an item'} subtitle="The selling price and stock on hand are shown here." />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.code || 'No barcode'} · {item.stock === null ? 'Stock not tracked' : item.stock <= 0 ? 'Out of stock' : `${item.stock} in stock`}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.price}>{formatLKR(item.price)}</Text>
                {item.unit ? <Text style={styles.meta}>per {item.unit}</Text> : null}
              </View>
            </View>
          )}
        />
        <BarcodeScannerModal visible={scanner} onClose={() => setScanner(false)} onBarcodeScanned={onScan} title="Scan to check price" />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: { paddingBottom: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.colors.borderStrong },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.colors.surfaceContainerLow },
  title: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  sub: { fontSize: 12, color: THEME.colors.textMuted },
  searchRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: '#FFF' },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 52, borderRadius: 14, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow },
  searchInput: { flex: 1, fontSize: 15, color: THEME.colors.text },
  scanBtn: { width: 52, height: 52, borderRadius: 14, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  error: { marginHorizontal: 16, marginTop: 10, fontSize: 13, fontWeight: '700', color: THEME.colors.error },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF', borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: THEME.colors.border },
  name: { fontSize: 15, fontWeight: '700', color: THEME.colors.text },
  meta: { fontSize: 12, color: THEME.colors.textMuted, marginTop: 2 },
  price: { fontSize: 18, fontWeight: '900', color: THEME.colors.primary, fontVariant: ['tabular-nums'] },
})
