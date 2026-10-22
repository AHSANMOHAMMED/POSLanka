import React, { useEffect, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, TextInput, FlatList, ActivityIndicator, Alert } from 'react-native'
import { apiGet, apiPost, asList, qs } from '../lib/api'
import { THEME, formatLKR } from '../lib/theme'
import { EmptyView, ErrorView } from './StateViews'

export interface Customer {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  loyaltyPoints?: number | null
  loyaltyTier?: string | null
  balance?: string | number | null
  creditLimit?: string | number | null
  taxExempt?: boolean | null
  /** Buyer particulars printed on a TAX INVOICE (GET /api/customers returns the full row) */
  taxId?: string | null
  address?: string | null
  addressLine1?: string | null
  city?: string | null
}

interface Props {
  visible: boolean
  onClose: () => void
  onSelect: (customer: Customer) => void
}

export function CustomerPickerModal({ visible, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [creating, setCreating] = useState(false)
  const [seq, setSeq] = useState(0)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const t = setTimeout(async () => {
      const res = await apiGet<any>(`/api/customers${qs({ search: query.trim() || undefined, pageSize: 20 })}`)
      if (cancelled) return
      if (res.ok) setResults(asList<Customer>(res.data))
      else setError(res.error)
      setLoading(false)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, visible, seq])

  async function createCustomer() {
    const name = newName.trim()
    const phone = newPhone.trim()
    if (!name) {
      Alert.alert('Name Required', 'Enter the customer name.')
      return
    }
    setCreating(true)
    try {
      const res = await apiPost<Customer>('/api/customers', { name, phone: phone || undefined })
      if (!res.ok) {
        Alert.alert('Could Not Create Customer', res.error)
        return
      }
      setNewName('')
      setNewPhone('')
      setShowCreate(false)
      onSelect(res.data)
    } finally {
      setCreating(false)
    }
  }

  if (!visible) return null

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={onClose}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <Text style={styles.title}>Select Customer</Text>
          <Pressable style={styles.addBtn} onPress={() => setShowCreate((v) => !v)}>
            <Text style={styles.addBtnText}>{showCreate ? 'Cancel' : '+ New'}</Text>
          </Pressable>
        </View>

        {showCreate ? (
          <View style={styles.createBox}>
            <TextInput
              style={styles.input}
              placeholder="Customer name"
              placeholderTextColor={THEME.colors.textSubtle}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <TextInput
              style={styles.input}
              placeholder="Phone (optional, 7-15 digits)"
              placeholderTextColor={THEME.colors.textSubtle}
              keyboardType="phone-pad"
              value={newPhone}
              onChangeText={setNewPhone}
            />
            <Pressable style={[styles.primaryBtn, creating && { opacity: 0.6 }]} onPress={createCustomer} disabled={creating}>
              {creating ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Create & Select</Text>}
            </Pressable>
          </View>
        ) : null}

        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or phone..."
            placeholderTextColor={THEME.colors.textSubtle}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {loading ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
        </View>

        {error ? (
          <ErrorView message={error} onRetry={() => setSeq((s) => s + 1)} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(c) => c.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            ListEmptyComponent={
              loading ? null : <EmptyView icon="👤" title="No customers found" subtitle="Try another name or phone, or create a new customer." />
            }
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => onSelect(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowSub}>
                    {item.phone || 'No phone'}
                    {item.loyaltyPoints != null ? ` • ${item.loyaltyPoints} pts` : ''}
                  </Text>
                </View>
                {item.balance != null && Number(item.balance) !== 0 ? (
                  <Text style={[styles.rowBalance, Number(item.balance) < 0 && { color: THEME.colors.error }]}>{formatLKR(item.balance)}</Text>
                ) : null}
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    gap: 12,
  },
  backBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: THEME.colors.text },
  addBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: THEME.colors.primaryLight },
  addBtnText: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary },
  createBox: { padding: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: THEME.colors.border, gap: 10 },
  input: { borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: THEME.colors.text, backgroundColor: THEME.colors.surfaceContainerLow },
  primaryBtn: { height: 46, borderRadius: 10, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  searchBar: { flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 0, backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 12, height: 46, borderWidth: 1, borderColor: THEME.colors.border, gap: 8 },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 14, color: THEME.colors.text },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: THEME.colors.border },
  rowName: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  rowSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
  rowBalance: { fontSize: 12, fontWeight: '800', color: THEME.colors.tertiary },
})
