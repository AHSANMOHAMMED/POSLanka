import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, FlatList, TextInput, Pressable, Alert, Modal, StyleSheet } from 'react-native'
import { apiGet, apiPost, apiPut, asList, qs } from '../src/lib/api'
import { getUser } from '../src/lib/api'
import { can } from '../src/lib/modules'
import { THEME, formatLKR } from '../src/lib/theme'
import { ScreenHeader } from '../src/components/ui'
import { ErrorView, LoadingView } from '../src/components/StateViews'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function CustomersScreen() {
  const insets = useSafeAreaInsets()
  const [rows, setRows] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<any | null>(null)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    getUser().then(setUser)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiGet<any>(`/api/customers${qs({ search: q, pageSize: 50 })}`)
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRows(asList(res.data, 'customers', 'data'))
    setError(null)
  }, [q])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  async function save() {
    if (!edit) return
    if (!can(user, 'manageCustomers') && !can(user, 'createSales')) {
      Alert.alert('Forbidden')
      return
    }
    const body = {
      name: String(edit.name || '').trim(),
      phone: edit.phone || undefined,
      email: edit.email || undefined,
      address: edit.address || undefined,
    }
    if (!body.name) {
      Alert.alert('Name required')
      return
    }
    const res = edit.id
      ? await apiPut(`/api/customers/${edit.id}`, body)
      : await apiPost('/api/customers', body)
    if (!res.ok) Alert.alert('Save failed', res.error)
    else {
      setEdit(null)
      load()
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME.colors.background, paddingTop: insets.top }}>
      <ScreenHeader
        title="Customers"
        right={
          <Pressable onPress={() => setEdit({ name: '', phone: '', email: '', address: '' })}>
            <Text style={{ color: THEME.colors.primary, fontWeight: '800' }}>Add</Text>
          </Pressable>
        }
      />
      <TextInput
        style={styles.search}
        placeholder="Search…"
        value={q}
        onChangeText={setQ}
        placeholderTextColor={THEME.colors.textSubtle}
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
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => setEdit(item)}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {item.phone || '—'} · bal {formatLKR(Number(item.balance || item.creditBalance || 0))}
              </Text>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!edit} transparent animationType="slide" onRequestClose={() => setEdit(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.name}>{edit?.id ? 'Edit customer' : 'New customer'}</Text>
            <TextInput style={styles.search} placeholder="Name" value={edit?.name || ''} onChangeText={(v) => setEdit((e: any) => ({ ...e, name: v }))} />
            <TextInput style={styles.search} placeholder="Phone" value={edit?.phone || ''} onChangeText={(v) => setEdit((e: any) => ({ ...e, phone: v }))} keyboardType="phone-pad" />
            <TextInput style={styles.search} placeholder="Email" value={edit?.email || ''} onChangeText={(v) => setEdit((e: any) => ({ ...e, email: v }))} autoCapitalize="none" />
            <TextInput style={[styles.search, { minHeight: 64 }]} placeholder="Address" value={edit?.address || ''} onChangeText={(v) => setEdit((e: any) => ({ ...e, address: v }))} multiline />
            <Pressable style={styles.btn} onPress={save}>
              <Text style={styles.btnText}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setEdit(null)}>
              <Text style={{ textAlign: 'center', color: THEME.colors.textMuted, marginTop: 10 }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: THEME.colors.text,
  },
  row: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 12,
    marginBottom: 8,
  },
  name: { fontWeight: '800', color: THEME.colors.text },
  meta: { color: THEME.colors.textMuted, marginTop: 4, fontSize: 12 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  btn: { backgroundColor: THEME.colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#FFF', fontWeight: '800' },
})
