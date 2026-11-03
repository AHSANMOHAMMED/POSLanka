// Restaurant POS: order type (dine-in / takeaway / delivery) and table. The choice is printed on the
// kitchen ticket and labels held tickets; the sale itself is a normal till sale.
import React, { useEffect, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native'
import { apiGet, asList, qs } from '../lib/api'
import { THEME } from '../lib/theme'

export type RestaurantOrderType = 'dine_in' | 'takeaway' | 'delivery'

export interface RestaurantContext {
  orderType: RestaurantOrderType
  tableId?: string
  table?: string
  tableArea?: string
}

interface TableRow {
  id: string
  name: string
  area?: string | null
  status?: string | null
  capacity?: number | null
}

const TYPES: Array<{ key: RestaurantOrderType; label: string; emoji: string }> = [
  { key: 'dine_in', label: 'Dine-in', emoji: '🍽️' },
  { key: 'takeaway', label: 'Takeaway', emoji: '🥡' },
  { key: 'delivery', label: 'Delivery', emoji: '🛵' },
]

export function restaurantLabel(c: RestaurantContext | null | undefined): string {
  if (!c) return ''
  const t = TYPES.find((x) => x.key === c.orderType)
  return c.orderType === 'dine_in' && c.table ? `${t?.label} · ${c.table}` : t?.label || ''
}

export function RestaurantOrderSheet({ visible, warehouseId, value, onClose, onChange }: { visible: boolean; warehouseId?: string | null; value: RestaurantContext | null; onClose: () => void; onChange: (c: RestaurantContext | null) => void }) {
  const [type, setType] = useState<RestaurantOrderType>('dine_in')
  const [tables, setTables] = useState<TableRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setType(value?.orderType || 'dine_in')
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<any>(`/api/restaurant-tables${qs({ all: 'true', warehouseId: warehouseId || undefined })}`).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) setTables(asList<TableRow>(res.data))
      else setError(res.status === 403 ? 'Tables are not available for your role.' : res.status === 0 ? 'Offline — you can still pick an order type.' : res.error)
    })
    return () => { cancelled = true }
  }, [visible, warehouseId, value?.orderType])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Order type &amp; table</Text>
          <Text style={styles.sub}>Shown on the kitchen ticket</Text>
          <View style={styles.seg}>
            {TYPES.map((t) => (
              <Pressable key={t.key} style={[styles.segBtn, type === t.key && styles.segBtnOn]} onPress={() => setType(t.key)} accessibilityRole="button" accessibilityState={{ selected: type === t.key }}>
                <Text style={styles.segEmoji}>{t.emoji}</Text>
                <Text style={[styles.segText, type === t.key && { color: '#FFF' }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          {type === 'dine_in' ? (
            loading ? (
              <ActivityIndicator style={{ padding: 24 }} color={THEME.colors.primary} />
            ) : (
              <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={styles.grid}>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {!error && tables.length === 0 ? <Text style={styles.empty}>No tables set up yet. Add them on the web (Restaurant → Tables).</Text> : null}
                {tables.map((tb) => {
                  const on = value?.tableId === tb.id
                  const busy = tb.status === 'occupied' || tb.status === 'unavailable'
                  return (
                    <Pressable key={tb.id} style={[styles.table, on && styles.tableOn, busy && !on && { opacity: 0.5 }]} onPress={() => onChange({ orderType: 'dine_in', tableId: tb.id, table: tb.name, tableArea: tb.area || undefined })} accessibilityRole="button">
                      <Text style={[styles.tableName, on && { color: '#FFF' }]} numberOfLines={1}>{tb.name}</Text>
                      <Text style={[styles.tableSub, on && { color: '#E2E8F0' }]} numberOfLines={1}>{busy ? (tb.status || '').replace(/^\w/, (c) => c.toUpperCase()) : tb.area || (tb.capacity ? `${tb.capacity} seats` : 'Free')}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            )
          ) : null}
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => { onChange(null); onClose() }}>
              <Text style={styles.btnGhostText}>Clear</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => {
              if (type !== 'dine_in') onChange({ orderType: type })
              else if (value?.orderType !== 'dine_in') onChange({ orderType: 'dine_in' })
              onClose()
            }}>
              <Text style={styles.btnPrimaryText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: THEME.colors.outline, alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  sub: { fontSize: 12, color: THEME.colors.textMuted, marginBottom: 12 },
  seg: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  segBtn: { flex: 1, minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', gap: 2 },
  segBtnOn: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  segEmoji: { fontSize: 20 },
  segText: { fontSize: 13, fontWeight: '800', color: THEME.colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  table: { width: '31%', minHeight: 64, borderRadius: 12, padding: 8, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: '#FFF', justifyContent: 'center' },
  tableOn: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  tableName: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  tableSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
  error: { fontSize: 13, fontWeight: '700', color: THEME.colors.error },
  empty: { fontSize: 13, color: THEME.colors.textMuted },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: THEME.colors.border },
  btnGhostText: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  btnPrimary: { backgroundColor: THEME.colors.primary },
  btnPrimaryText: { fontSize: 15, fontWeight: '800', color: '#FFF' },
})
