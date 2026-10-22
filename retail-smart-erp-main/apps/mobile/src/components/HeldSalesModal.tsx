import React, { useCallback, useEffect, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, FlatList, Alert } from 'react-native'
import { apiDelete, apiGet, asList } from '../lib/api'
import { THEME, formatLKR } from '../lib/theme'
import { LoadingView, EmptyView, ErrorView } from './StateViews'
import { useHeaderPad } from '../lib/safeArea'

export interface HeldSaleItem {
  itemId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
}

export interface HeldSale {
  id: string
  holdNumber?: string | null
  cartItems: HeldSaleItem[]
  subtotal?: string | number | null
  notes?: string | null
  customerId?: string | null
  customerName?: string | null
  customer?: { id: string; name: string; phone?: string | null } | null
  heldByUser?: { fullName?: string | null; name?: string | null } | null
  createdAt: string
  expiresAt?: string | null
}

interface Props {
  visible: boolean
  onClose: () => void
  onResume: (held: HeldSale) => void
}

export function HeldSalesModal({ visible, onClose, onResume }: Props) {
  const headerPad = useHeaderPad()
  const [items, setItems] = useState<HeldSale[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await apiGet<any>('/api/held-sales')
    if (res.ok) setItems(asList<HeldSale>(res.data))
    else setError(res.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (visible) load()
  }, [visible, load])

  async function resume(held: HeldSale) {
    setBusyId(held.id)
    try {
      const res = await apiDelete(`/api/held-sales/${held.id}`)
      if (!res.ok && res.status !== 404) {
        Alert.alert('Could Not Resume', res.error)
        return
      }
      onResume(held)
    } finally {
      setBusyId(null)
    }
  }

  function discard(held: HeldSale) {
    Alert.alert('Discard Held Sale', `Delete ${held.holdNumber || 'this held ticket'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          setBusyId(held.id)
          const res = await apiDelete(`/api/held-sales/${held.id}`)
          setBusyId(null)
          if (!res.ok && res.status !== 404) {
            Alert.alert('Could Not Discard', res.error)
            return
          }
          setItems((prev) => prev.filter((h) => h.id !== held.id))
        },
      },
    ])
  }

  if (!visible) return null

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, headerPad]}>
          <Pressable style={styles.backBtn} onPress={onClose}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <Text style={styles.title}>Held Tickets</Text>
          <Pressable style={styles.refreshBtn} onPress={load}>
            <Text style={styles.refreshText}>↻</Text>
          </Pressable>
        </View>

        {loading ? (
          <LoadingView text="Loading held tickets…" />
        ) : error ? (
          <ErrorView message={error} onRetry={load} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(h) => h.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            ListEmptyComponent={<EmptyView icon="⏸" title="No held tickets" subtitle="Carts you put on hold will appear here." />}
            renderItem={({ item }) => {
              const count = (item.cartItems || []).reduce((s, c) => s + (Number(c.quantity) || 0), 0)
              const subtotal = item.subtotal != null ? Number(item.subtotal) : (item.cartItems || []).reduce((s, c) => s + (Number(c.total) || 0), 0)
              const who = item.heldByUser?.fullName || item.heldByUser?.name || ''
              const busy = busyId === item.id
              return (
                <View style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.holdNo}>{item.holdNumber || `#${item.id.slice(0, 8).toUpperCase()}`}</Text>
                    <Text style={styles.time}>{new Date(item.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
                  </View>
                  <Text style={styles.customer}>{item.customer?.name || item.customerName || 'Walk-in customer'}{who ? ` • held by ${who}` : ''}</Text>
                  <Text style={styles.lines} numberOfLines={2}>
                    {(item.cartItems || []).map((c) => `${c.name} ×${c.quantity}`).join(', ')}
                  </Text>
                  <View style={styles.cardBottom}>
                    <Text style={styles.subtotal}>
                      {count} items • {formatLKR(subtotal)}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable style={styles.discardBtn} onPress={() => discard(item)} disabled={busy}>
                        <Text style={styles.discardText}>Discard</Text>
                      </Pressable>
                      <Pressable style={[styles.resumeBtn, busy && { opacity: 0.6 }]} onPress={() => resume(item)} disabled={busy}>
                        <Text style={styles.resumeText}>{busy ? '…' : 'Resume'}</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              )
            }}
          />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: { paddingTop: 48, paddingBottom: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: THEME.colors.border, gap: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: THEME.colors.text },
  refreshBtn: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.colors.surfaceContainerLow },
  refreshText: { fontSize: 18, color: THEME.colors.primary, fontWeight: '800' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: THEME.colors.border, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  holdNo: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary, fontFamily: 'monospace' },
  time: { fontSize: 10, color: THEME.colors.textSubtle },
  customer: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  lines: { fontSize: 11, color: THEME.colors.textMuted },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: THEME.colors.border },
  subtotal: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  discardBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: THEME.colors.errorLight },
  discardText: { fontSize: 11, fontWeight: '700', color: THEME.colors.error },
  resumeBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: THEME.colors.primary },
  resumeText: { fontSize: 11, fontWeight: '800', color: '#FFF' },
})
