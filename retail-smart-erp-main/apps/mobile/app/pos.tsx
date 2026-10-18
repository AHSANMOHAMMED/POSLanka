import { useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  Alert,
} from 'react-native'
import { router } from 'expo-router'
import { apiFetch, setToken } from '../src/lib/api'

type Item = {
  id: string
  name: string
  sellingPrice: string
  barcode?: string | null
}

type CartLine = Item & { quantity: number }

export default function PosScreen() {
  const [items, setItems] = useState<Item[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await apiFetch('/api/items?pageSize=50')
      if (res.status === 401) {
        await setToken(null)
        router.replace('/login')
        return
      }
      const data = await res.json()
      setItems(data.items || data.data || [])
    })()
  }, [])

  const filtered = items.filter(
    (i) =>
      !query ||
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      (i.barcode || '').includes(query)
  )

  const total = cart.reduce(
    (sum, line) => sum + Number(line.sellingPrice) * line.quantity,
    0
  )

  function addToCart(item: Item) {
    setCart((prev) => {
      const existing = prev.find((p) => p.id === item.id)
      if (existing) {
        return prev.map((p) =>
          p.id === item.id ? { ...p, quantity: p.quantity + 1 } : p
        )
      }
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  async function checkout() {
    if (cart.length === 0) return
    setBusy(true)
    try {
      const cartItems = cart.map((c) => ({
        itemId: c.id,
        name: c.name,
        quantity: c.quantity,
        unitPrice: Number(c.sellingPrice),
      }))
      const subtotal = total
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          cartItems,
          paymentMethod: 'cash',
          subtotal,
          discount: 0,
          tax: 0,
          total: subtotal,
          amountPaid: subtotal,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        Alert.alert('Sale failed', data.error || 'Could not complete sale')
        return
      }
      setCart([])
      Alert.alert('Sale complete', `Total LKR ${subtotal.toFixed(2)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>POS</Text>
        <Pressable onPress={() => router.push('/shifts')}>
          <Text style={styles.link}>Shifts</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.search}
        placeholder="Search / barcode"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
      />
      <FlatList
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => addToCart(item)}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text>LKR {Number(item.sellingPrice).toFixed(2)}</Text>
          </Pressable>
        )}
      />
      <View style={styles.cart}>
        <Text style={styles.cartTitle}>
          Cart ({cart.length}) · LKR {total.toFixed(2)}
        </Text>
        <Pressable
          style={[styles.checkout, busy && { opacity: 0.5 }]}
          onPress={checkout}
          disabled={busy || cart.length === 0}
        >
          <Text style={styles.checkoutText}>{busy ? 'Processing…' : 'Cash checkout'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 48 },
  header: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#0f766e' },
  link: { color: '#0f766e', fontWeight: '600' },
  search: {
    margin: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemName: { fontWeight: '500', flex: 1, marginRight: 8 },
  cart: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 16,
    gap: 10,
  },
  cartTitle: { fontWeight: '600' },
  checkout: {
    backgroundColor: '#0f766e',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  checkoutText: { color: '#fff', fontWeight: '700' },
})
