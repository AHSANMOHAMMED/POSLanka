import React, { useCallback, useEffect, useState } from 'react'
import { Text, FlatList, Pressable, StyleSheet, View, TextInput, Alert, Modal } from 'react-native'
import { apiGet, apiPost, asList, qs } from '../src/lib/api'
import { THEME, formatLKR } from '../src/lib/theme'
import { ScreenHeader } from '../src/components/ui'
import { ErrorView, LoadingView } from '../src/components/StateViews'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function PurchaseOrdersScreen() {
  const insets = useSafeAreaInsets()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [supplierName, setSupplierName] = useState('')
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiGet<any>(`/api/purchase-orders${qs({ pageSize: 50 })}`)
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRows(asList(res.data, 'data', 'purchaseOrders'))
    setError(null)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function createDraft() {
    const res = await apiPost('/api/purchase-orders', {
      status: 'draft',
      notes: notes.trim() || undefined,
      supplierName: supplierName.trim() || undefined,
      items: [],
      lines: [],
    })
    if (!res.ok) Alert.alert('Failed', res.error)
    else {
      setCreateOpen(false)
      setSupplierName('')
      setNotes('')
      load()
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME.colors.background, paddingTop: insets.top }}>
      <ScreenHeader
        title="Purchase orders"
        right={
          <Pressable onPress={() => setCreateOpen(true)}>
            <Text style={{ color: THEME.colors.primary, fontWeight: '800' }}>New</Text>
          </Pressable>
        }
      />
      {loading ? (
        <LoadingView text="Loading…" />
      ) : error ? (
        <ErrorView message={error} onRetry={load} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={<Text style={styles.empty}>No purchase orders.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.name}>{item.poNumber || item.number || item.id}</Text>
              <Text style={styles.meta}>
                {item.status || '—'} · {formatLKR(Number(item.total || item.grandTotal || 0))}
              </Text>
            </View>
          )}
        />
      )}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.name}>Draft PO</Text>
            <TextInput style={styles.input} placeholder="Supplier name" value={supplierName} onChangeText={setSupplierName} />
            <TextInput style={styles.input} placeholder="Notes" value={notes} onChangeText={setNotes} />
            <Pressable style={styles.btn} onPress={createDraft}>
              <Text style={styles.btnText}>Create draft</Text>
            </Pressable>
            <Pressable onPress={() => setCreateOpen(false)}>
              <Text style={{ textAlign: 'center', marginTop: 10, color: THEME.colors.textMuted }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, padding: 12, marginBottom: 8 },
  name: { fontWeight: '800', color: THEME.colors.text },
  meta: { color: THEME.colors.textMuted, marginTop: 4, fontSize: 12 },
  empty: { textAlign: 'center', color: THEME.colors.textMuted, marginTop: 40 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  input: { borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, padding: 12, marginBottom: 8 },
  btn: { backgroundColor: THEME.colors.primary, borderRadius: 10, padding: 14, alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: '800' },
})
