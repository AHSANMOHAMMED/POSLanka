import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
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
import { router, useFocusEffect } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { apiGet, apiPost, asList, getUser, qs, type AuthUser } from '../src/lib/api'
import { hasPermission } from '../src/lib/roles'
import { fetchCurrentShift, shiftCounterName, shiftWarehouseName, type Shift } from '../src/lib/shift'
import { calculateCartTax, EMPTY_TAX_CONFIG, loadTaxConfig, type TaxConfig } from '../src/lib/tax'
import { retryRejected, subscribe as subscribeQueue, syncNow, type QueueState } from '../src/lib/offlineQueue'
import { THEME, formatLKR } from '../src/lib/theme'
import { CartDrawerModal, CartLine } from '../src/components/CartDrawerModal'
import { TenderModal, type SaleResultData } from '../src/components/TenderModal'
import { SaleReceiptModal } from '../src/components/SaleReceiptModal'
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal'
import { CustomerPickerModal, type Customer } from '../src/components/CustomerPickerModal'
import { HeldSalesModal, type HeldSale } from '../src/components/HeldSalesModal'
import { ReturnModal } from '../src/components/ReturnModal'
import { LoadingView, EmptyView, ErrorView } from '../src/components/StateViews'
import { loadBusinessInfo, type BusinessInfo } from '../src/lib/receipt'

interface Item {
  id: string
  name: string
  sku?: string | null
  barcode?: string | null
  pluCode?: string | null
  sellingPrice: string
  unit?: string | null
  isWeighable?: boolean
  trackStock?: boolean
  imageUrl?: string | null
  categoryId?: string | null
  taxTemplateId?: string | null
  currentStock?: string | number | null
  availableStock?: string | number | null
}

interface Category {
  id: string
  name: string
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const PAGE_SIZE = 60
const BARCODE_RE = /^\d{8,}$/
/** Receipt QR codes / typed invoice numbers open the returns flow instead of an item lookup. */
const INVOICE_RE = /^(INV|RTN|OFF)-/i

/** Extra decoding the server attaches to barcode lookups (scale / price-embedded / GS1 codes). */
interface ScanInfo {
  symbology?: string
  normalized?: string
  /** Weight in kg for weighing-scale barcodes. */
  quantity?: number | string | null
  /** Price per unit embedded in the barcode. */
  unitPrice?: number | string | null
  batchNo?: string | null
  expiryDate?: string | null
  gtin?: string | null
}

const EMPTY_QUEUE: QueueState = { pending: 0, rejected: 0, syncing: false, online: true, lastSyncAt: null, lastError: null }

function stockOf(item: Item): number | null {
  if (item.trackStock === false) return null
  const raw = item.availableStock ?? item.currentStock
  if (raw === null || raw === undefined) return null
  const n = Number(raw)
  return isNaN(n) ? null : n
}

export default function PosScreen() {
  const [user, setUser] = useState<AuthUser | null>(null)

  // Shift gate
  const [shift, setShift] = useState<Shift | null>(null)
  const [shiftLoading, setShiftLoading] = useState(true)
  const [shiftError, setShiftError] = useState<string | null>(null)

  // Catalog
  const [items, setItems] = useState<Item[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const requestSeq = useRef(0)

  // Cart / sale
  const [cart, setCart] = useState<CartLine[]>([])
  const [clientSaleId, setClientSaleId] = useState<string | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [taxConfig, setTaxConfig] = useState<TaxConfig>(EMPTY_TAX_CONFIG)
  const [holdBusy, setHoldBusy] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [queueState, setQueueState] = useState<QueueState>(EMPTY_QUEUE)
  const [business, setBusiness] = useState<BusinessInfo | null>(null)
  const [returnQuery, setReturnQuery] = useState<string | null>(null)

  // Modals
  const [scannerVisible, setScannerVisible] = useState(false)
  const [cartDrawerVisible, setCartDrawerVisible] = useState(false)
  const [tenderVisible, setTenderVisible] = useState(false)
  const [customerPickerVisible, setCustomerPickerVisible] = useState(false)
  const [heldVisible, setHeldVisible] = useState(false)
  const [saleResult, setSaleResult] = useState<SaleResultData | null>(null)

  // ------------------------------------------------------------------ init
  useEffect(() => {
    getUser().then(setUser)
    apiGet<any>('/api/categories?all=true').then((r) => {
      if (r.ok) setCategories(asList<Category>(r.data, 'categories'))
    })
    loadTaxConfig().then(setTaxConfig)
    loadBusinessInfo().then(setBusiness)
    return subscribeQueue(setQueueState)
  }, [])

  const loadShift = useCallback(async () => {
    setShiftError(null)
    const res = await fetchCurrentShift()
    if (res.ok) setShift(res.data.shift)
    else if (res.status !== 401) setShiftError(res.error)
    setShiftLoading(false)
  }, [])

  // Re-check the shift whenever the screen regains focus (e.g. after /shifts).
  useFocusEffect(
    useCallback(() => {
      loadShift()
    }, [loadShift])
  )

  // One clientSaleId per cart: created when the first line is added, kept across
  // failed attempts, and reset once the cart is emptied (sale success / clear / hold).
  useEffect(() => {
    if (cart.length > 0 && !clientSaleId) setClientSaleId(Crypto.randomUUID())
    else if (cart.length === 0 && clientSaleId) setClientSaleId(null)
  }, [cart.length, clientSaleId])

  // ------------------------------------------------------------------ catalog
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const warehouseId = shift?.warehouseId

  const fetchItems = useCallback(
    async (page: number, append: boolean) => {
      const seq = ++requestSeq.current
      if (append) setLoadingMore(true)
      else setItemsLoading(true)
      setItemsError(null)

      const res = await apiGet<{ data: Item[]; pagination: Pagination }>(
        `/api/items${qs({
          search: debouncedQuery || undefined,
          categoryId: selectedCategoryId === 'all' ? undefined : selectedCategoryId,
          warehouseId,
          inStockOnly: inStockOnly ? 'true' : undefined,
          page,
          pageSize: PAGE_SIZE,
        })}`
      )
      if (seq !== requestSeq.current) return

      if (!res.ok) {
        setItemsError(res.error)
        if (!append) setItems([])
      } else {
        const rows = asList<Item>(res.data)
        setItems((prev) => (append ? [...prev, ...rows] : rows))
        setPagination(res.data?.pagination || null)
      }
      setItemsLoading(false)
      setLoadingMore(false)
    },
    [debouncedQuery, selectedCategoryId, warehouseId, inStockOnly]
  )

  const hasShift = !!shift
  useEffect(() => {
    if (hasShift) fetchItems(1, false)
  }, [hasShift, fetchItems])

  const hasMore = !!pagination && pagination.page < pagination.totalPages
  function loadMore() {
    if (!hasMore || loadingMore || itemsLoading || !pagination) return
    fetchItems(pagination.page + 1, true)
  }

  // ------------------------------------------------------------------ cart ops
  function triggerToast(text: string) {
    setToastMessage(text)
    setTimeout(() => setToastMessage(null), 1500)
  }

  /**
   * Adds an item. `opts.unitPrice` overrides the catalog price (price-embedded
   * barcodes) and `opts.weighed` marks a scale line: weighed lines of the same
   * item merge only when their unit price matches, otherwise a new line is added.
   */
  function addToCart(item: Item, qty = 1, opts: { unitPrice?: number; weighed?: boolean } = {}) {
    if (!shift) {
      Alert.alert('No Open Shift', 'Open a shift before selling.')
      return
    }
    if (!(qty > 0)) return
    const available = stockOf(item)
    const price = opts.unitPrice !== undefined && opts.unitPrice !== null && !isNaN(Number(opts.unitPrice)) ? String(opts.unitPrice) : String(item.sellingPrice)
    const sameItem = cart.filter((p) => (p.itemId || p.id) === item.id)
    const existing = opts.weighed ? sameItem.find((p) => p.sellingPrice === price) : sameItem.find((p) => p.id === item.id) || sameItem[0]
    const totalForItem = sameItem.reduce((s, p) => s + p.quantity, 0) + qty
    if (available !== null && item.trackStock !== false && totalForItem > available) {
      Alert.alert('Insufficient Stock', `Only ${available} ${item.unit || 'units'} of ${item.name} available at this branch.`)
      return
    }
    if (existing) {
      setCart((prev) => prev.map((p) => (p.id === existing.id ? { ...p, quantity: Math.round((p.quantity + qty) * 1000) / 1000 } : p)))
    } else {
      const lineId = opts.weighed && sameItem.length ? `${item.id}#${sameItem.length + 1}` : item.id
      setCart((prev) => [
        ...prev,
        {
          id: lineId,
          itemId: item.id,
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          sellingPrice: price,
          quantity: qty,
          unit: item.unit || (opts.weighed ? 'kg' : undefined),
          taxTemplateId: item.taxTemplateId ?? null,
          trackStock: item.trackStock,
          availableStock: available,
        },
      ])
    }
    const qtyLabel = opts.weighed ? `${qty} ${item.unit || 'kg'}` : `+${qty}`
    triggerToast(`${qtyLabel} ${item.name.split(' ')[0]} added`)
  }

  async function lookupBarcode(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (!shift) {
      Alert.alert('No Open Shift', 'Open a shift before scanning items.')
      return
    }
    // A receipt QR / invoice number → start a return against that sale.
    if (INVOICE_RE.test(trimmed)) {
      setQuery('')
      setDebouncedQuery('')
      setReturnQuery(trimmed)
      return
    }
    setLookupBusy(true)
    const res = await apiGet<Item & { scan?: ScanInfo | null }>(`/api/items/barcode-lookup${qs({ barcode: trimmed, warehouseId: shift.warehouseId })}`)
    setLookupBusy(false)
    if (res.ok && res.data?.id) {
      const scan = res.data.scan
      const scanQty = scan?.quantity !== undefined && scan?.quantity !== null ? Number(scan.quantity) : NaN
      const scanPrice = scan?.unitPrice !== undefined && scan?.unitPrice !== null ? Number(scan.unitPrice) : NaN
      if (!isNaN(scanQty) && scanQty > 0) {
        // Weighing-scale barcode: quantity is the weight (kg); price may be embedded too.
        addToCart(res.data, Math.round(scanQty * 1000) / 1000, { weighed: true, unitPrice: !isNaN(scanPrice) && scanPrice > 0 ? scanPrice : undefined })
      } else if (!isNaN(scanPrice) && scanPrice > 0) {
        // Price-embedded barcode without weight: one unit at the embedded price.
        addToCart(res.data, 1, { weighed: true, unitPrice: scanPrice })
      } else {
        addToCart(res.data)
      }
      setQuery('')
      setDebouncedQuery('')
      return
    }
    if (res.status === 404) {
      Alert.alert('Barcode Not Found', `No item registered with barcode / PLU: ${trimmed}`)
    } else {
      Alert.alert('Lookup Failed', res.error || 'Could not look up this barcode.')
    }
  }

  function handleSubmitSearch() {
    const q = query.trim()
    if (BARCODE_RE.test(q) || INVOICE_RE.test(q)) {
      lookupBarcode(q)
      return
    }
    setDebouncedQuery(q)
  }

  function updateQuantity(id: string, delta: number) {
    const line = cart.find((p) => p.id === id)
    if (!line) return
    const newQty = line.quantity + delta
    if (delta > 0 && line.trackStock !== false && line.availableStock != null && newQty > line.availableStock) {
      Alert.alert('Insufficient Stock', `Only ${line.availableStock} available for ${line.name}.`)
      return
    }
    setCart((prev) => (newQty > 0 ? prev.map((p) => (p.id === id ? { ...p, quantity: newQty } : p)) : prev.filter((p) => p.id !== id)))
  }

  function removeItem(id: string) {
    setCart((prev) => prev.filter((p) => p.id !== id))
  }

  function clearCart() {
    setCart([])
    setCustomer(null)
  }

  async function holdCart() {
    if (cart.length === 0 || !shift || holdBusy) return
    setHoldBusy(true)
    try {
      const res = await apiPost<HeldSale>('/api/held-sales', {
        cartItems: cart.map((c) => ({
          itemId: c.id,
          name: c.name,
          quantity: c.quantity,
          unitPrice: Number(c.sellingPrice),
          total: Number(c.sellingPrice) * c.quantity,
        })),
        subtotal: cartSubtotal,
        warehouseId: shift.warehouseId,
        customerId: customer?.id,
        customerName: customer?.name,
      })
      if (!res.ok) {
        Alert.alert('Could Not Hold Ticket', res.error)
        return
      }
      setCart([])
      setCustomer(null)
      setCartDrawerVisible(false)
      triggerToast(`Held as ${res.data?.holdNumber || 'ticket'}`)
    } finally {
      setHoldBusy(false)
    }
  }

  function resumeHeld(held: HeldSale) {
    setCart(
      (held.cartItems || []).map((c) => ({
        id: c.itemId,
        name: c.name,
        sellingPrice: String(c.unitPrice),
        quantity: Number(c.quantity) || 1,
      }))
    )
    if (held.customer) setCustomer({ id: held.customer.id, name: held.customer.name, phone: held.customer.phone })
    setHeldVisible(false)
    triggerToast(`Resumed ${held.holdNumber || 'held ticket'}`)
  }

  // ------------------------------------------------------------------ totals
  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const cartSubtotal = cart.reduce((sum, line) => sum + Number(line.sellingPrice) * line.quantity, 0)
  const cartTax = useMemo(
    () =>
      calculateCartTax(
        cart.map((l) => ({ lineTotal: Number(l.sellingPrice) * l.quantity, taxTemplateId: l.taxTemplateId })),
        taxConfig,
        customer?.taxExempt === true
      ),
    [cart, taxConfig, customer]
  )
  const cartTotalPayable = cartTax.hasInclusiveTax ? cartSubtotal : cartSubtotal + cartTax.tax
  const taxLabel = cartTax.breakdown.length === 1 ? cartTax.breakdown[0].taxName : 'Tax'

  const canApprove = hasPermission(user, 'approveRequisitions') || hasPermission(user, 'approveAdvances')
  const canInventory = hasPermission(user, 'manageInventory')

  function handleSyncPress() {
    if (queueState.rejected > 0 && queueState.pending === 0) {
      Alert.alert(
        'Rejected Offline Sales',
        `${queueState.rejected} queued sale(s) were rejected by the server.${queueState.lastError ? `\n\nLast error: ${queueState.lastError}` : ''}`,
        [
          { text: 'Close', style: 'cancel' },
          { text: 'Retry', onPress: () => retryRejected() },
        ]
      )
      return
    }
    syncNow().then((r) => {
      if (r.stoppedOffline) triggerToast('Still offline — will retry automatically')
      else if (r.synced > 0) triggerToast(`${r.synced} sale(s) synced`)
      else if (r.rejected > 0) triggerToast(`${r.rejected} sale(s) rejected`)
    })
  }

  // ------------------------------------------------------------------ render
  return (
    <View style={styles.container}>
      {/* Header: tenant ▸ branch ▸ counter, online state, offline queue */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.breadcrumbRow}>
            <Text style={styles.breadcrumbText} numberOfLines={1}>
              {user?.tenantName || 'POSLanka'} ▸ {shiftWarehouseName(shift) || '—'} ▸ {shiftCounterName(shift) || 'No shift'}
            </Text>
            <View style={[styles.onlinePill, !queueState.online && styles.offlinePill]}>
              <View style={[styles.pulsingDot, !queueState.online && styles.offlineDot]} />
              <Text style={[styles.onlineText, !queueState.online && styles.offlineText]}>{queueState.online ? 'Online' : 'Offline'}</Text>
            </View>
          </View>
          <View style={styles.titleRow}>
            <Text style={styles.appTitle}>Mobile POS</Text>
            {queueState.pending + queueState.rejected > 0 && (
              <Pressable style={[styles.pendingBadge, queueState.rejected > 0 && styles.pendingBadgeError]} onPress={handleSyncPress}>
                {queueState.syncing ? (
                  <ActivityIndicator size="small" color={THEME.colors.onSecondaryContainer} />
                ) : (
                  <Text style={styles.pendingBadgeText}>
                    ⏳ {queueState.pending} pending{queueState.rejected > 0 ? ` · ${queueState.rejected} failed` : ''} · Sync now
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        </View>

        <Pressable style={styles.shiftBtn} onPress={() => router.push('/shifts')}>
          <Text style={styles.shiftBtnEmoji}>🕒</Text>
          <Text style={styles.shiftBtnText}>Shift</Text>
        </Pressable>
      </View>

      {/* Quick navigation (role-filtered) */}
      <View style={styles.quickNavContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickNavContent}>
          <Pressable style={styles.quickNavPill} onPress={() => setHeldVisible(true)}>
            <Text style={styles.quickNavPillText}>⏸ Held</Text>
          </Pressable>
          {canApprove && (
            <Pressable style={styles.quickNavPill} onPress={() => router.push('/approvals')}>
              <Text style={styles.quickNavPillText}>✓ Approvals</Text>
            </Pressable>
          )}
          {canInventory && (
            <Pressable style={styles.quickNavPill} onPress={() => router.push('/inventory')}>
              <Text style={styles.quickNavPillText}>📦 Stock</Text>
            </Pressable>
          )}
          {hasPermission(user, 'submitStockIntake') && (
            <Pressable style={styles.quickNavPill} onPress={() => router.push('/intake')}>
              <Text style={styles.quickNavPillText}>📥 Intake</Text>
            </Pressable>
          )}
          {hasPermission(user, 'manageUsers') && (
            <Pressable style={styles.quickNavPill} onPress={() => router.push('/staff')}>
              <Text style={styles.quickNavPillText}>👥 Staff</Text>
            </Pressable>
          )}
          <Pressable style={styles.quickNavPill} onPress={() => router.push('/summary')}>
            <Text style={styles.quickNavPillText}>📊 Summary</Text>
          </Pressable>
          <Pressable style={styles.quickNavPill} onPress={() => router.push('/printer')}>
            <Text style={styles.quickNavPillText}>🖨️ Printer</Text>
          </Pressable>
          {shift ? (
            <Pressable
              style={styles.quickNavPill}
              onPress={() => {
                setQuery('')
                setReturnQuery('INV-')
              }}
            >
              <Text style={styles.quickNavPillText}>↩ Return</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>

      {shiftLoading ? (
        <LoadingView text="Checking your shift…" />
      ) : !shift && shiftError ? (
        <ErrorView message={shiftError} onRetry={loadShift} />
      ) : !shift ? (
        <View style={styles.gateWrap}>
          <View style={styles.gateCard}>
            <Text style={styles.gateEmoji}>🔒</Text>
            <Text style={styles.gateTitle}>No open shift</Text>
            <Text style={styles.gateSub}>Sales are blocked until you open a shift on a POS counter. Your opening float is recorded for reconciliation.</Text>
            <Pressable style={styles.gateBtn} onPress={() => router.push('/shifts')}>
              <Text style={styles.gateBtnText}>Open Shift →</Text>
            </Pressable>
            <Pressable style={styles.gateRetry} onPress={loadShift}>
              <Text style={styles.gateRetryText}>↻ Re-check</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          {/* Search & scan */}
          <View style={styles.searchSection}>
            <View style={styles.searchBar}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Scan barcode / PLU / INV-… or search items"
                placeholderTextColor={THEME.colors.textSubtle}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={handleSubmitSearch}
                returnKeyType="search"
                blurOnSubmit={false}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {lookupBusy ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
              {query ? (
                <Pressable onPress={() => setQuery('')} style={styles.clearQueryBtn}>
                  <Text style={styles.clearQueryText}>✕</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.cameraScanBtn} onPress={() => setScannerVisible(true)} accessibilityLabel="Scan with camera">
                <Text style={styles.cameraScanText}>📷</Text>
              </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
              <Pressable style={[styles.catChip, selectedCategoryId === 'all' && styles.catChipActive]} onPress={() => setSelectedCategoryId('all')}>
                <Text style={[styles.catChipText, selectedCategoryId === 'all' && styles.catChipTextActive]}>
                  All Items{pagination && selectedCategoryId === 'all' ? ` (${pagination.total})` : ''}
                </Text>
              </Pressable>
              {categories.map((cat) => {
                const isSelected = selectedCategoryId === cat.id
                return (
                  <Pressable key={cat.id} style={[styles.catChip, isSelected && styles.catChipActive]} onPress={() => setSelectedCategoryId(cat.id)}>
                    <Text style={[styles.catChipText, isSelected && styles.catChipTextActive]}>
                      {cat.name}
                      {isSelected && pagination ? ` (${pagination.total})` : ''}
                    </Text>
                  </Pressable>
                )
              })}
              <Pressable style={[styles.catChip, styles.catChipOutline, inStockOnly && styles.catChipActive]} onPress={() => setInStockOnly((v) => !v)}>
                <Text style={[styles.catChipText, inStockOnly && styles.catChipTextActive]}>In stock only</Text>
              </Pressable>
            </ScrollView>
          </View>

          {/* Customer strip */}
          <View style={styles.customerStrip}>
            <View style={styles.customerInfo}>
              <Text style={styles.customerAvatar}>👤</Text>
              <View style={{ flexShrink: 1 }}>
                <View style={styles.customerNameRow}>
                  <Text style={styles.customerName} numberOfLines={1}>
                    {customer ? customer.name : 'Walk-in Customer'}
                  </Text>
                  <View style={styles.customerBadge}>
                    <Text style={styles.customerBadgeText}>{customer ? 'Linked' : 'General'}</Text>
                  </View>
                </View>
                <Text style={styles.loyaltySub} numberOfLines={1}>
                  {customer
                    ? `${customer.phone || 'No phone'}${customer.loyaltyPoints != null ? ` • ⭐ ${customer.loyaltyPoints} pts` : ''}${
                        customer.balance != null && Number(customer.balance) !== 0 ? ` • Credit ${formatLKR(customer.balance)}` : ''
                      }`
                    : 'Link a customer for credit sales & loyalty'}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {customer ? (
                <Pressable style={styles.loyaltyBtn} onPress={() => setCustomer(null)}>
                  <Text style={[styles.loyaltyBtnText, { color: THEME.colors.error }]}>✕</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.loyaltyBtn} onPress={() => setCustomerPickerVisible(true)}>
                <Text style={styles.loyaltyBtnText}>{customer ? 'Change' : '+ Customer'}</Text>
              </Pressable>
            </View>
          </View>

          {/* Product grid */}
          {itemsLoading ? (
            <LoadingView text="Loading items catalog..." />
          ) : itemsError ? (
            <ErrorView message={itemsError} onRetry={() => fetchItems(1, false)} />
          ) : items.length === 0 ? (
            <EmptyView icon="📦" title="No matching items found" subtitle="Try another search term or category, or scan a barcode." />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              numColumns={2}
              contentContainerStyle={styles.gridContent}
              keyboardShouldPersistTaps="handled"
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                loadingMore ? (
                  <View style={{ padding: 16 }}>
                    <ActivityIndicator color={THEME.colors.primary} />
                  </View>
                ) : hasMore ? (
                  <Pressable style={styles.loadMoreBtn} onPress={loadMore}>
                    <Text style={styles.loadMoreText}>
                      Load more ({items.length} of {pagination?.total ?? items.length})
                    </Text>
                  </Pressable>
                ) : null
              }
              renderItem={({ item }) => {
                const stockNum = stockOf(item)
                const tracked = item.trackStock !== false && stockNum !== null
                const isOut = tracked && stockNum! <= 0
                const isLowStock = tracked && stockNum! > 0 && stockNum! < 15
                return (
                  <View style={styles.productCard}>
                    <View style={styles.stockBadgeContainer}>
                      <Text style={[styles.stockBadge, isOut ? styles.stockBadgeOut : isLowStock ? styles.stockBadgeLow : styles.stockBadgeNormal]}>
                        {!tracked ? 'Untracked' : isOut ? 'Out of stock' : isLowStock ? `⚠️ ${stockNum} Low` : `${stockNum} in stock`}
                      </Text>
                    </View>

                    <View style={styles.cardInfo}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.cardBarcode} numberOfLines={1}>
                        {item.barcode ? `EAN: ${item.barcode}` : item.pluCode ? `PLU: ${item.pluCode}` : item.sku ? `SKU: ${item.sku}` : 'Standard Item'}
                      </Text>
                    </View>

                    <View style={styles.cardFooter}>
                      <View style={styles.priceCol}>
                        <Text style={styles.priceLabel}>Price{item.unit ? ` / ${item.unit}` : ''}</Text>
                        <Text style={styles.cardPrice}>{formatLKR(item.sellingPrice)}</Text>
                      </View>
                      <Pressable style={[styles.addBtn, isOut && { opacity: 0.4 }]} onPress={() => addToCart(item)} disabled={isOut}>
                        <Text style={styles.addBtnText}>+ Add</Text>
                      </Pressable>
                    </View>
                  </View>
                )
              }}
            />
          )}
        </>
      )}

      {toastMessage && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>✓ {toastMessage}</Text>
        </View>
      )}

      {/* Cart bar */}
      {cart.length > 0 && shift && (
        <View style={styles.cartBar}>
          <Pressable style={styles.cartPeek} onPress={() => setCartDrawerVisible(true)}>
            <View style={styles.cartHandle} />
            <View style={styles.cartPeekRow}>
              <View style={styles.cartCountGroup}>
                <View style={styles.cartCountCircle}>
                  <Text style={styles.cartCountCircleText}>{totalCartCount}</Text>
                </View>
                <Text style={styles.cartItemsLabel}>Items in Cart</Text>
              </View>
              <Text style={styles.cartTaxText}>
                {taxLabel}
                {cartTax.hasInclusiveTax ? ' (incl.)' : ''}: {formatLKR(cartTax.tax)}
              </Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.peekBadgesScroll}>
              {cart.map((c) => (
                <View key={c.id} style={styles.peekBadge}>
                  <Text style={styles.peekBadgeText}>
                    {c.name.split(' ')[0]} × {c.quantity}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </Pressable>

          <View style={styles.cartActionRow}>
            <Pressable style={styles.iconActionBtn} onPress={holdCart} disabled={holdBusy} accessibilityLabel="Hold cart">
              {holdBusy ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : <Text style={styles.iconActionEmoji}>⏸</Text>}
              <Text style={styles.iconActionLabel}>Hold</Text>
            </Pressable>

            <Pressable style={styles.chargeBtn} onPress={() => setTenderVisible(true)}>
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
      <BarcodeScannerModal visible={scannerVisible} onClose={() => setScannerVisible(false)} onBarcodeScanned={lookupBarcode} />

      <CustomerPickerModal
        visible={customerPickerVisible}
        onClose={() => setCustomerPickerVisible(false)}
        onSelect={(c) => {
          setCustomer(c)
          setCustomerPickerVisible(false)
        }}
      />

      <HeldSalesModal visible={heldVisible} onClose={() => setHeldVisible(false)} onResume={resumeHeld} />

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
        tax={cartTax.tax}
        taxLabel={taxLabel}
        taxInclusive={cartTax.hasInclusiveTax}
      />

      {shift && clientSaleId && (
        <TenderModal
          visible={tenderVisible}
          onClose={() => setTenderVisible(false)}
          cart={cart}
          shift={shift}
          customer={customer}
          clientSaleId={clientSaleId}
          taxConfig={taxConfig}
          online={queueState.online}
          business={business}
          cashierName={user?.name}
          onSaleComplete={(data) => {
            setTenderVisible(false)
            setCart([])
            setCustomer(null)
            setSaleResult(data)
          }}
        />
      )}

      {shift && returnQuery !== null && (
        <ReturnModal
          visible={returnQuery !== null}
          onClose={() => setReturnQuery(null)}
          invoiceQuery={returnQuery}
          shift={shift}
          business={business}
          cashierName={user?.name}
          onReturnComplete={(data) => {
            setReturnQuery(null)
            setSaleResult(data)
            fetchItems(1, false)
          }}
        />
      )}

      <SaleReceiptModal visible={!!saleResult} saleData={saleResult} onClose={() => setSaleResult(null)} />
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
  offlinePill: { backgroundColor: THEME.colors.errorLight },
  pulsingDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: THEME.colors.tertiary },
  offlineDot: { backgroundColor: THEME.colors.error },
  onlineText: { fontSize: 9, fontWeight: '800', color: THEME.colors.tertiary },
  offlineText: { color: THEME.colors.error },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  appTitle: { fontSize: 20, fontWeight: '800', color: THEME.colors.primary },
  pendingBadge: {
    backgroundColor: THEME.colors.secondaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    minHeight: 22,
    justifyContent: 'center',
  },
  pendingBadgeError: { backgroundColor: THEME.colors.errorLight },
  pendingBadgeText: { fontSize: 10, fontWeight: '800', color: THEME.colors.onSecondaryContainer },
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
  quickNavContent: { gap: 8 },
  quickNavPill: {
    backgroundColor: THEME.colors.surfaceContainerLow,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  quickNavPillText: { fontSize: 11, fontWeight: '700', color: THEME.colors.text },
  gateWrap: { flex: 1, justifyContent: 'center', padding: 24 },
  gateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  gateEmoji: { fontSize: 42, marginBottom: 10 },
  gateTitle: { fontSize: 20, fontWeight: '800', color: THEME.colors.text },
  gateSub: { fontSize: 13, color: THEME.colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 18 },
  gateBtn: { width: '100%', height: 50, borderRadius: 12, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  gateBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  gateRetry: { marginTop: 12, padding: 8 },
  gateRetryText: { color: THEME.colors.primary, fontWeight: '700', fontSize: 12 },
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
    gap: 6,
  },
  searchIcon: { fontSize: 14 },
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
  catChipOutline: { backgroundColor: '#FFFFFF', borderStyle: 'dashed' },
  catChipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
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
    gap: 8,
  },
  customerInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  customerAvatar: { fontSize: 18 },
  customerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customerName: { fontSize: 13, fontWeight: '700', color: THEME.colors.text, flexShrink: 1 },
  customerBadge: { backgroundColor: THEME.colors.secondaryContainer, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
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
  gridContent: { padding: 12, paddingBottom: 160 },
  loadMoreBtn: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: THEME.colors.surfaceContainerHigh,
  },
  loadMoreText: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary },
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
  stockBadge: { alignSelf: 'flex-start', fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  stockBadgeNormal: { backgroundColor: THEME.colors.surfaceContainerLow, color: THEME.colors.tertiary },
  stockBadgeLow: { backgroundColor: THEME.colors.secondaryLight, color: THEME.colors.onSecondaryContainer },
  stockBadgeOut: { backgroundColor: THEME.colors.errorLight, color: THEME.colors.error },
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
  cartHandle: { width: 36, height: 4, backgroundColor: THEME.colors.outline, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  cartPeekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cartCountGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cartCountCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  cartCountCircleText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  cartItemsLabel: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  cartTaxText: { fontSize: 11, fontWeight: '600', color: THEME.colors.textMuted },
  peekBadgesScroll: { marginTop: 6 },
  peekBadge: { backgroundColor: THEME.colors.surfaceContainerLow, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 6 },
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
  chargeArrowBox: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  chargeArrowText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
})
