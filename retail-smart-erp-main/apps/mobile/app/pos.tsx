import React, { useEffect, useState, useMemo, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native'
import { router } from 'expo-router'
import { apiFetch, setToken } from '../src/lib/api'
import { THEME, formatLKR } from '../src/lib/theme'
import { CartDrawerModal, CartLine } from '../src/components/CartDrawerModal'
import { TenderModal } from '../src/components/TenderModal'
import { SaleReceiptModal } from '../src/components/SaleReceiptModal'
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal'

interface Item {
  id: string
  name: string
  sku?: string | null
  barcode?: string | null
  sellingPrice: string
  currentStock?: string | number | null
  categoryId?: string | null
}

interface Category {
  id: string
  name: string
}

export default function PosScreen() {
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [cart, setCart] = useState<CartLine[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Modals state
  const [scannerVisible, setScannerVisible] = useState(false)
  const [cartDrawerVisible, setCartDrawerVisible] = useState(false)
  const [tenderVisible, setTenderVisible] = useState(false)
  const [saleResult, setSaleResult] = useState<{
    invoiceNo: string
    total: number
    change: number
    tenderMethod: string
  } | null>(null)

  // Fetch items & categories on mount
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [itemsRes, catsRes] = await Promise.all([
        apiFetch('/api/items?pageSize=100'),
        apiFetch('/api/categories?all=true'),
      ])

      if (itemsRes.status === 401) {
        await setToken(null)
        router.replace('/login')
        return
      }

      if (itemsRes.ok) {
        const data = await itemsRes.json()
        setItems(data.items || data.data || [])
      }

      if (catsRes.ok) {
        const catData = await catsRes.json()
        setCategories(catData.categories || catData.data || [])
      }
    } catch (e) {
      console.warn('Data fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Filter items by search query and category
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesQuery =
        !query ||
        item.name.toLowerCase().includes(query.toLowerCase()) ||
        (item.barcode && item.barcode.includes(query)) ||
        (item.sku && item.sku.toLowerCase().includes(query.toLowerCase()))

      const matchesCat =
        selectedCategoryId === 'all' || item.categoryId === selectedCategoryId

      return matchesQuery && matchesCat
    })
  }, [items, query, selectedCategoryId])

  // Cart operations
  function triggerToast(text: string) {
    setToastMessage(text)
    setTimeout(() => setToastMessage(null), 1500)
  }

  function addToCart(item: Item) {
    setCart((prev) => {
      const existing = prev.find((p) => p.id === item.id)
      if (existing) {
        return prev.map((p) =>
          p.id === item.id ? { ...p, quantity: p.quantity + 1 } : p
        )
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          sellingPrice: item.sellingPrice,
          quantity: 1,
        },
      ]
    })
    triggerToast(`+1 ${item.name.split(' ')[0]} added`)
  }

  function handleBarcodeScanned(barcode: string) {
    const matched = items.find(
      (i) => i.barcode === barcode || (i.sku && i.sku.toLowerCase() === barcode.toLowerCase())
    )
    if (matched) {
      addToCart(matched)
    } else {
      Alert.alert('Barcode Not Found', `No item registered with barcode: ${barcode}`)
    }
  }

  function updateQuantity(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((p) => {
          if (p.id !== id) return p
          const newQty = p.quantity + delta
          return newQty > 0 ? { ...p, quantity: newQty } : null
        })
        .filter(Boolean) as CartLine[]
    )
  }

  function removeItem(id: string) {
    setCart((prev) => prev.filter((p) => p.id !== id))
  }

  function clearCart() {
    setCart([])
  }

  function holdCart() {
    if (cart.length === 0) return
    Alert.alert('Cart Held', 'Current ticket has been placed on hold.')
    setCart([])
    setCartDrawerVisible(false)
  }

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const cartSubtotal = cart.reduce(
    (sum, line) => sum + Number(line.sellingPrice) * line.quantity,
    0
  )
  const ssclTax = cartSubtotal * 0.025
  const cartTotalPayable = cartSubtotal + ssclTax

  return (
    <View style={styles.container}>
      {/* 1. Header (Stitch "Operational Velocity" Breadcrumb & Status) */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.breadcrumbRow}>
            <Text style={styles.breadcrumbText} numberOfLines={1}>
              Lanka Super Center ▸ Colombo 03 ▸ Counter 02
            </Text>
            <View style={styles.onlinePill}>
              <View style={styles.pulsingDot} />
              <Text style={styles.onlineText}>Online</Text>
            </View>
          </View>
          <Text style={styles.appTitle}>Mobile POS</Text>
        </View>

        <Pressable
          style={styles.shiftBtn}
          onPress={() => router.push('/shifts')}
        >
          <Text style={styles.shiftBtnEmoji}>🕒</Text>
          <Text style={styles.shiftBtnText}>Shift</Text>
        </Pressable>
      </View>

      {/* Quick Navigation to Stitch Modules */}
      <View style={styles.quickNavContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickNavContent}
        >
          <Pressable style={styles.quickNavPill} onPress={() => router.push('/approvals')}>
            <Text style={styles.quickNavPillText}>✓ Approvals</Text>
          </Pressable>
          <Pressable style={styles.quickNavPill} onPress={() => router.push('/inventory')}>
            <Text style={styles.quickNavPillText}>📦 Stock</Text>
          </Pressable>
          <Pressable style={styles.quickNavPill} onPress={() => router.push('/summary')}>
            <Text style={styles.quickNavPillText}>📊 Summary</Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* 2. Top Search & Barcode Scan Row */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Scan barcode (EAN-13/PLU) or search items..."
            placeholderTextColor={THEME.colors.textSubtle}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} style={styles.clearQueryBtn}>
              <Text style={styles.clearQueryText}>✕</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.cameraScanBtn}
            onPress={() => setScannerVisible(true)}
            title="Scan with Camera"
          >
            <Text style={styles.cameraScanText}>📷</Text>
          </Pressable>
        </View>

        {/* 3. Category Horizontal Scroller */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
        >
          <Pressable
            style={[
              styles.catChip,
              selectedCategoryId === 'all' && styles.catChipActive,
            ]}
            onPress={() => setSelectedCategoryId('all')}
          >
            <Text
              style={[
                styles.catChipText,
                selectedCategoryId === 'all' && styles.catChipTextActive,
              ]}
            >
              All Items ({items.length})
            </Text>
          </Pressable>

          {categories.map((cat) => {
            const isSelected = selectedCategoryId === cat.id
            const count = items.filter((i) => i.categoryId === cat.id).length
            return (
              <Pressable
                key={cat.id}
                style={[styles.catChip, isSelected && styles.catChipActive]}
                onPress={() => setSelectedCategoryId(cat.id)}
              >
                <Text
                  style={[
                    styles.catChipText,
                    isSelected && styles.catChipTextActive,
                  ]}
                >
                  {cat.name} {count > 0 ? `(${count})` : ''}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>

      {/* 4. Customer Context Strip */}
      <View style={styles.customerStrip}>
        <View style={styles.customerInfo}>
          <Text style={styles.customerAvatar}>👤</Text>
          <View>
            <View style={styles.customerNameRow}>
              <Text style={styles.customerName}>Walk-in Customer</Text>
              <View style={styles.customerBadge}>
                <Text style={styles.customerBadgeText}>General</Text>
              </View>
            </View>
            <Text style={styles.loyaltySub}>⭐ Earns 1 pt / LKR 100</Text>
          </View>
        </View>
        <Pressable
          style={styles.loyaltyBtn}
          onPress={() => Alert.alert('Customer Lookup', 'Enter Customer Phone or National Identity Card (NIC).')}
        >
          <Text style={styles.loyaltyBtnText}>+ Loyalty / NIC</Text>
        </Pressable>
      </View>

      {/* 5. Product Grid (2 Columns, Stitch Card Hierarchy) */}
      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={THEME.colors.primary} />
          <Text style={styles.loaderText}>Loading items catalog...</Text>
        </View>
      ) : filteredItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>No matching items found</Text>
          <Text style={styles.emptySub}>
            Try adjusting your search query or scan an item barcode.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => {
            const stockNum = item.currentStock ? Number(item.currentStock) : 25
            const isLowStock = stockNum > 0 && stockNum < 15
            return (
              <View style={styles.productCard}>
                {/* Stock Tag */}
                <View style={styles.stockBadgeContainer}>
                  <Text
                    style={[
                      styles.stockBadge,
                      isLowStock ? styles.stockBadgeLow : styles.stockBadgeNormal,
                    ]}
                  >
                    {isLowStock ? `⚠️ ${stockNum} Low` : `${stockNum} in stock`}
                  </Text>
                </View>

                {/* Product Name & SKU */}
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.cardBarcode} numberOfLines={1}>
                    {item.barcode ? `EAN: ${item.barcode}` : item.sku ? `SKU: ${item.sku}` : 'Standard Item'}
                  </Text>
                </View>

                {/* Price & Add Action */}
                <View style={styles.cardFooter}>
                  <View style={styles.priceCol}>
                    <Text style={styles.priceLabel}>Price</Text>
                    <Text style={styles.cardPrice}>{formatLKR(item.sellingPrice)}</Text>
                  </View>
                  <Pressable
                    style={styles.addBtn}
                    onPress={() => addToCart(item)}
                  >
                    <Text style={styles.addBtnText}>+ Add</Text>
                  </Pressable>
                </View>
              </View>
            )
          }}
        />
      )}

      {/* Instant Toast Notification */}
      {toastMessage && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>✓ {toastMessage}</Text>
        </View>
      )}

      {/* 6. Bottom Floating Interactive Cart Drawer Strip */}
      {cart.length > 0 && (
        <View style={styles.cartBar}>
          <Pressable
            style={styles.cartPeek}
            onPress={() => setCartDrawerVisible(true)}
          >
            <View style={styles.cartHandle} />
            <View style={styles.cartPeekRow}>
              <View style={styles.cartCountGroup}>
                <View style={styles.cartCountCircle}>
                  <Text style={styles.cartCountCircleText}>{totalCartCount}</Text>
                </View>
                <Text style={styles.cartItemsLabel}>Items in Cart</Text>
              </View>
              <Text style={styles.cartTaxText}>SSCL (2.5%): {formatLKR(ssclTax)}</Text>
            </View>

            {/* Quick Audit Badges */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.peekBadgesScroll}
            >
              {cart.map((c) => (
                <View key={c.id} style={styles.peekBadge}>
                  <Text style={styles.peekBadgeText}>
                    {c.name.split(' ')[0]} × {c.quantity}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </Pressable>

          {/* Action Row */}
          <View style={styles.cartActionRow}>
            <Pressable
              style={styles.iconActionBtn}
              onPress={holdCart}
              title="Hold Cart"
            >
              <Text style={styles.iconActionEmoji}>⏸</Text>
              <Text style={styles.iconActionLabel}>Hold</Text>
            </Pressable>

            <Pressable
              style={styles.chargeBtn}
              onPress={() => setTenderVisible(true)}
            >
              <View style={styles.chargeCol}>
                <Text style={styles.chargeSub}>Total Payable</Text>
                <Text style={styles.chargeVal}>{formatLKR(cartTotalPayable)}</Text>
              </View>
              <View style={styles.chargeArrowBox}>
                <Text style={styles.chargeArrowText}>Charge →</Text>
              </View>
            </Pressable>
          </View>
        </View>
      )}

      {/* Modals */}
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onBarcodeScanned={handleBarcodeScanned}
      />

      <CartDrawerModal
        visible={cartDrawerVisible}
        onClose={() => setCartDrawerVisible(false)}
        cart={cart}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeItem}
        onClearCart={clearCart}
        onHoldCart={holdCart}
        onProceedToTender={() => {
          setCartDrawerVisible(false)
          setTenderVisible(true)
        }}
      />

      <TenderModal
        visible={tenderVisible}
        onClose={() => setTenderVisible(false)}
        cart={cart}
        onSaleComplete={(data) => {
          setTenderVisible(false)
          setCart([])
          setSaleResult(data)
        }}
      />

      <SaleReceiptModal
        visible={!!saleResult}
        saleData={saleResult}
        onClose={() => setSaleResult(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  headerLeft: { flex: 1, marginRight: 12 },
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  breadcrumbText: { fontSize: 10, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', flexShrink: 1 },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.tertiaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 3,
  },
  pulsingDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: THEME.colors.tertiary },
  onlineText: { fontSize: 9, fontWeight: '800', color: THEME.colors.tertiary },
  appTitle: { fontSize: 20, fontWeight: '800', color: THEME.colors.primary },
  shiftBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  shiftBtnEmoji: { fontSize: 14 },
  shiftBtnText: { fontSize: 13, fontWeight: '700', color: THEME.colors.primary },
  quickNavContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  quickNavContent: {
    gap: 8,
  },
  quickNavPill: {
    backgroundColor: THEME.colors.surfaceContainerLow,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  quickNavPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  searchSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: { fontSize: 14, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13, color: THEME.colors.text },
  clearQueryBtn: { padding: 4 },
  clearQueryText: { fontSize: 12, color: THEME.colors.textMuted, fontWeight: '700' },
  cameraScanBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: THEME.colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  cameraScanText: { fontSize: 16 },
  categoryScroll: { paddingTop: 10, paddingBottom: 4, gap: 8 },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  catChipActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  catChipText: { fontSize: 12, fontWeight: '600', color: THEME.colors.textMuted },
  catChipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  customerStrip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: THEME.colors.surfaceContainerLow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  customerInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customerAvatar: { fontSize: 18 },
  customerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customerName: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  customerBadge: {
    backgroundColor: THEME.colors.secondaryContainer,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  customerBadgeText: { fontSize: 9, fontWeight: '800', color: THEME.colors.onSecondaryContainer },
  loyaltySub: { fontSize: 11, color: THEME.colors.tertiary, fontWeight: '600', marginTop: 1 },
  loyaltyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  loyaltyBtnText: { fontSize: 11, fontWeight: '700', color: THEME.colors.primary },
  loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loaderText: { marginTop: 10, fontSize: 14, color: THEME.colors.textMuted },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: THEME.colors.text, marginBottom: 4 },
  emptySub: { fontSize: 13, color: THEME.colors.textMuted, textAlign: 'center' },
  gridContent: { padding: 12, paddingBottom: 140 },
  productCard: {
    width: '47%',
    margin: '1.5%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    justifyContent: 'space-between',
  },
  stockBadgeContainer: { marginBottom: 6 },
  stockBadge: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  stockBadgeNormal: { backgroundColor: THEME.colors.surfaceContainerLow, color: THEME.colors.tertiary },
  stockBadgeLow: { backgroundColor: THEME.colors.secondaryLight, color: THEME.colors.onSecondaryContainer },
  cardInfo: { minHeight: 46 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: THEME.colors.text, lineHeight: 18 },
  cardBarcode: { fontSize: 10, color: THEME.colors.textMuted, marginTop: 2 },
  cardFooter: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  priceCol: { flex: 1, marginRight: 6 },
  priceLabel: { fontSize: 9, fontWeight: '600', color: THEME.colors.textSubtle, textTransform: 'uppercase' },
  cardPrice: { fontSize: 13, fontWeight: '800', color: THEME.colors.text },
  addBtn: {
    backgroundColor: THEME.colors.surfaceContainerLow,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  addBtnText: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary },
  toast: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  toastText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  cartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 15,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  cartPeek: { marginBottom: 10 },
  cartHandle: {
    width: 36,
    height: 4,
    backgroundColor: THEME.colors.outline,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 6,
  },
  cartPeekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cartCountGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cartCountCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: THEME.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCountCircleText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  cartItemsLabel: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  cartTaxText: { fontSize: 11, fontWeight: '600', color: THEME.colors.textMuted },
  peekBadgesScroll: { marginTop: 6 },
  peekBadge: {
    backgroundColor: THEME.colors.surfaceContainerLow,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 6,
  },
  peekBadgeText: { fontSize: 10, fontWeight: '700', color: THEME.colors.textMuted },
  cartActionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconActionBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: THEME.colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  iconActionEmoji: { fontSize: 16 },
  iconActionLabel: { fontSize: 10, fontWeight: '700', color: THEME.colors.textMuted, marginTop: 1 },
  chargeBtn: {
    flex: 1,
    height: 52,
    backgroundColor: THEME.colors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  chargeCol: { justifyContent: 'center' },
  chargeSub: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase' },
  chargeVal: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', marginTop: 1 },
  chargeArrowBox: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  chargeArrowText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
})
