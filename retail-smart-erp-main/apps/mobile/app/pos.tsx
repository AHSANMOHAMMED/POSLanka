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
  RefreshControl,
  Image,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { apiGet, apiPost, asList, getUser, qs, refreshPermissions, type AuthUser } from '../src/lib/api'
import { hasPermission } from '../src/lib/roles'
import { loadShiftOfflineAware, shiftCounterName, shiftWarehouseName, type Shift } from '../src/lib/shift'
import { calculateCartTax, EMPTY_TAX_CONFIG, loadTaxConfig, taxConfigFromBundle, type TaxConfig } from '../src/lib/tax'
import { isOnline, subscribe as subscribeQueue, syncNow, type QueueState } from '../src/lib/offlineQueue'
import {
  catalogKey,
  findByCode,
  formatAge,
  getBundle,
  refreshBundle,
  searchItems,
  setActiveCatalog,
  subscribeCatalog,
  syncCatalog,
  type CatalogStatus,
  type OfflineBundle,
} from '../src/lib/localdb'
import { OfflineSalesModal } from '../src/components/OfflineSalesModal'
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
import { AlertsBell } from '../src/components/AlertsBell'
import { useKitchenTickets } from '../src/lib/kitchenPrint'
import { cartFromHeld, cartPayable, cartSubtotal as computeCartSubtotal, heldCartItems, lineTotal, scanToLine } from '../src/lib/cartMath'
import { getLocalItem } from '../src/lib/localdb'
import { applyCartQuote, offlineCartQuote, quoteKey, quoteRequestLines, taxableLineTotals, type CartQuote } from '../src/lib/cartPricing'
import { useHeaderPad, useBottomPad } from '../src/lib/safeArea'
import { useFeatureFlags } from '../src/lib/features'

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
  /** Amount payable printed on a price-embedded label (= line total). */
  lineTotal?: number | string | null
  batchNo?: string | null
  expiryDate?: string | null
  gtin?: string | null
}

const EMPTY_QUEUE: QueueState = { pending: 0, rejected: 0, syncing: false, online: true, lastSyncAt: null, lastError: null, synced: 0 }
/** Delta catalog sync cadence while the POS is open (a full refresh happens daily, see localdb). */
const CATALOG_SYNC_MS = 5 * 60_000

function stockOf(item: Item): number | null {
  if (item.trackStock === false) return null
  const raw = item.availableStock ?? item.currentStock
  if (raw === null || raw === undefined) return null
  const n = Number(raw)
  return isNaN(n) ? null : n
}

export default function PosScreen() {
  const headerPad = useHeaderPad()
  const bottomPad = useBottomPad()
  const [user, setUser] = useState<AuthUser | null>(null)

  // Shift gate
  const [shift, setShift] = useState<Shift | null>(null)
  const [shiftLoading, setShiftLoading] = useState(true)
  const [shiftError, setShiftError] = useState<string | null>(null)
  /** true when the shift came from the device cache because the server is unreachable */
  const [shiftOffline, setShiftOffline] = useState(false)

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

  // W6 offline catalog
  const [catalog, setCatalog] = useState<CatalogStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [offlineSalesVisible, setOfflineSalesVisible] = useState(false)
  const [nowTick, setNowTick] = useState(Date.now())
  const scaleConfigRef = useRef<OfflineBundle['scaleBarcode']>(null)

  // Cart / sale
  const [cart, setCart] = useState<CartLine[]>([])
  // H5: cart-level promotions of the current quote (line promotions live on the cart lines)
  const [cartPromotions, setCartPromotions] = useState<CartQuote['cartPromotions']>([])
  const [couponCode, setCouponCode] = useState('')
  // Feature switches set by the platform for this business (coupons, credit, loyalty, WhatsApp …)
  const features = useFeatureFlags()
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
  // Offline bundle: tax templates, categories, scale-label layout (cached on the device).
  const applyBundle = useCallback((b: OfflineBundle | null) => {
    if (!b) return
    scaleConfigRef.current = b.scaleBarcode || null
    if (b.complete === false) return
    const cfg = taxConfigFromBundle(b)
    if (cfg) setTaxConfig(cfg)
    if (Array.isArray(b.categories)) setCategories(b.categories)
  }, [])

  const reloadBundle = useCallback(async () => {
    const { bundle, offline } = await refreshBundle()
    if (bundle && bundle.complete !== false) {
      if (!offline) applyBundle(bundle)
      return
    }
    if (!offline) {
      // Older server without /api/pos/offline-bundle
      loadTaxConfig(null).then(setTaxConfig)
      apiGet<any>('/api/categories?all=true').then((r) => {
        if (r.ok) setCategories(asList<Category>(r.data, 'categories'))
      })
    }
  }, [applyBundle])

  useEffect(() => {
    getUser().then(setUser)
    // Owner may have changed this role's permissions since sign-in.
    refreshPermissions().then((u) => { if (u) setUser(u) }).catch(() => undefined)
    getBundle().then(applyBundle)
    reloadBundle()
    loadBusinessInfo().then(setBusiness)
    const unsubCatalog = subscribeCatalog(setCatalog)
    const unsubQueue = subscribeQueue(setQueueState)
    const tick = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => {
      unsubCatalog()
      unsubQueue()
      clearInterval(tick)
    }
  }, [applyBundle, reloadBundle])

  const loadShift = useCallback(async () => {
    setShiftError(null)
    const r = await loadShiftOfflineAware()
    if (r.status === 401) {
      setShiftLoading(false)
      return
    }
    if (r.shift || !r.offline) setShift(r.shift)
    setShiftOffline(r.offline && !!r.shift)
    if (!r.shift && r.error) {
      setShiftError(r.offline ? `${r.error}\n\nNo open shift is saved on this device yet — connect once to open or load your shift.` : r.error)
    }
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
  // Restaurants: kitchen tickets (KOT) for this cart on the kitchen-role printer.
  const kitchen = useKitchenTickets({ enabled: user?.businessType === 'restaurant', orderKey: clientSaleId, server: user?.name })

  // ------------------------------------------------------------------ catalog
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const warehouseId = shift?.warehouseId
  const tenantSlug = user?.tenantSlug
  // Local catalog is used once it holds items for this tenant + branch (instant, works offline).
  const localReady = !!warehouseId && !!tenantSlug && catalog?.key === catalogKey(tenantSlug, warehouseId) && (catalog?.itemCount ?? 0) > 0

  const fetchItems = useCallback(
    async (page: number, append: boolean) => {
      const seq = ++requestSeq.current
      if (localReady) {
        const r = await searchItems(debouncedQuery, {
          categoryId: selectedCategoryId === 'all' ? null : selectedCategoryId,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          inStockOnly,
        }).catch(() => null)
        if (seq !== requestSeq.current) return
        if (r) {
          setItemsError(null)
          setItems((prev) => (append ? [...prev, ...(r.items as Item[])] : (r.items as Item[])))
          setPagination({ page, pageSize: PAGE_SIZE, total: r.total, totalPages: Math.max(1, Math.ceil(r.total / PAGE_SIZE)) })
          setItemsLoading(false)
          setLoadingMore(false)
          return
        }
      }
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
        setItemsError(res.status === 0 ? 'Offline, and the item catalog is not on this device yet. Connect once to download it — you can still scan items the device knows.' : res.error)
        if (!append) setItems([])
      } else {
        const rows = asList<Item>(res.data)
        setItems((prev) => (append ? [...prev, ...rows] : rows))
        setPagination(res.data?.pagination || null)
      }
      setItemsLoading(false)
      setLoadingMore(false)
    },
    [debouncedQuery, selectedCategoryId, warehouseId, inStockOnly, localReady]
  )
  const fetchItemsRef = useRef(fetchItems)
  fetchItemsRef.current = fetchItems

  // ------------------------------------------------------------------ catalog sync (W6)
  const runCatalogSync = useCallback(
    async (full = false) => {
      if (!warehouseId || !tenantSlug) return
      const r = await syncCatalog(warehouseId, { full, tenantSlug })
      if (r.ok && (r.upserted > 0 || r.deleted > 0)) fetchItemsRef.current(1, false)
    },
    [warehouseId, tenantSlug]
  )

  // On focus: select this tenant + branch catalog, delta-sync it, then every 5 minutes.
  useFocusEffect(
    useCallback(() => {
      if (!warehouseId || !tenantSlug) return
      let cancelled = false
      setActiveCatalog(tenantSlug, warehouseId)
        .then(() => {
          if (!cancelled && isOnline()) runCatalogSync()
        })
        .catch(() => undefined)
      const t = setInterval(() => {
        if (isOnline()) runCatalogSync()
      }, CATALOG_SYNC_MS)
      return () => {
        cancelled = true
        clearInterval(t)
      }
    }, [warehouseId, tenantSlug, runCatalogSync])
  )

  // Back online: refresh the catalog, bundle and shift right away.
  const wasOnline = useRef(queueState.online)
  useEffect(() => {
    if (queueState.online && !wasOnline.current) {
      runCatalogSync()
      reloadBundle()
      loadShift()
    }
    wasOnline.current = queueState.online
  }, [queueState.online, runCatalogSync, reloadBundle, loadShift])

  async function onPullRefresh() {
    setRefreshing(true)
    try {
      await Promise.all([runCatalogSync(), reloadBundle(), loadShift()])
      await fetchItems(1, false)
    } finally {
      setRefreshing(false)
    }
  }

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
  function addToCart(item: Item, qty = 1, opts: { unitPrice?: number; weighed?: boolean; noMerge?: boolean; uom?: string | null; uomFactor?: number; priceLocked?: boolean; priceBarcode?: string } = {}) {
    if (!shift) {
      Alert.alert('No Open Shift', 'Open a shift before selling.')
      return
    }
    if (!(qty > 0)) return
    const available = stockOf(item)
    const price = opts.unitPrice !== undefined && opts.unitPrice !== null && !isNaN(Number(opts.unitPrice)) ? String(opts.unitPrice) : String(item.sellingPrice)
    const sameItem = cart.filter((p) => (p.itemId || p.id) === item.id)
    const uom = opts.uom || null
    const factor = opts.uomFactor || 1
    const sameUnit = sameItem.filter((p) => (p.uom || null) === uom)
    const existing = opts.noMerge
      ? undefined
      : opts.weighed
        ? sameUnit.find((p) => p.sellingPrice === price)
        : sameUnit.find((p) => p.id === item.id) || sameUnit.find((p) => !p.priceLocked)
    // stock is in base units: a box line holds quantity × factor pieces
    const totalForItem = sameItem.reduce((s, p) => s + p.quantity * (p.uomFactor || 1), 0) + qty * factor
    if (available !== null && item.trackStock !== false && totalForItem > available) {
      Alert.alert('Insufficient Stock', `Only ${available} ${item.unit || 'units'} of ${item.name} available at this branch.`)
      return
    }
    if (existing) {
      setCart((prev) => prev.map((p) => (p.id === existing.id ? { ...p, quantity: Math.round((p.quantity + qty) * 1000) / 1000 } : p)))
    } else {
      // Unique line key: `<itemId>#n` for further lines of the same item (never reuse a key that
      // is still in the cart, e.g. after the first line was removed).
      let lineId = item.id
      for (let n = sameItem.length + 1; cart.some((p) => p.id === lineId); n++) lineId = `${item.id}#${n}`
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
          unit: uom || item.unit || (opts.weighed ? 'kg' : undefined),
          taxTemplateId: item.taxTemplateId ?? null,
          trackStock: item.trackStock,
          availableStock: available,
          // H5: unit line (box / pack barcode) and fixed prices (scale label, barcode price override)
          ...(uom ? { uom, uomFactor: factor } : {}),
          ...(opts.priceLocked || opts.weighed ? { priceLocked: true } : {}),
          ...(opts.priceBarcode ? { priceBarcode: opts.priceBarcode } : {}),
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
      // Returns need processReturns on the server; tell the cashier instead of a 403 later.
      if (!hasPermission(user, 'processReturns')) {
        Alert.alert('Return not allowed', 'Your role cannot process returns. Ask a manager to do this return.')
        return
      }
      setReturnQuery(trimmed)
      return
    }
    const addScanned = (item: Item, scan?: ScanInfo | null, unit?: { uom?: string | null; uomFactor?: number; packQty?: number; uomPrice?: number; priceOverride?: number | null; matchedBarcode?: string | null } | null) => {
      // H5: additional / unit barcode (box of 12, pack of 6 …): packQty of that unit at its price
      if (unit && ((unit.uom && (unit.uomFactor || 1) !== 1) || (unit.packQty || 1) !== 1 || unit.priceOverride != null)) {
        addToCart(item, unit.packQty || 1, {
          unitPrice: unit.uomPrice, uom: unit.uom || null, uomFactor: unit.uomFactor || 1,
          priceLocked: unit.priceOverride != null, noMerge: unit.priceOverride != null,
          priceBarcode: unit.priceOverride != null ? unit.matchedBarcode || undefined : undefined,
        })
        setQuery('')
        setDebouncedQuery('')
        return
      }
      // Weighing-scale / GS1 labels: weight → quantity; a printed amount is the line total.
      const line = scanToLine(scan)
      if (line.weighed) addToCart(item, line.quantity, { weighed: true, unitPrice: line.unitPrice, noMerge: line.fixedAmount })
      else addToCart(item)
      setQuery('')
      setDebouncedQuery('')
    }

    // 1. Local catalog first: instant and works offline (same candidate rules as the server).
    if (localReady) {
      const local = await findByCode(trimmed, scaleConfigRef.current).catch(() => null)
      if (local) {
        const isUnitCode = local.matchedBy === 'item_barcode' || local.matchedBy === 'uom_barcode'
        addScanned(local.item as Item, isUnitCode ? null : { symbology: local.scan.symbology, quantity: local.quantity ?? null, unitPrice: local.unitPrice ?? null, lineTotal: local.lineTotal ?? null },
          isUnitCode ? { uom: local.uom, uomFactor: local.uomFactor, packQty: local.packQty, uomPrice: local.uomPrice, priceOverride: local.priceOverride ?? null, matchedBarcode: local.matchedBarcode } : null)
        return
      }
    }
    const offlineNow = !queueState.online || shiftOffline
    if (offlineNow) {
      Alert.alert('Not in Offline Catalog', `No item with barcode / PLU ${trimmed} is saved on this device. It may be new — sync the catalog when back online.`)
      return
    }

    // 2. Server lookup (new items not yet synced to the device)
    setLookupBusy(true)
    const res = await apiGet<Item & { scan?: ScanInfo | null; uom?: string | null; uomFactor?: number; packQty?: number; uomPrice?: number; priceOverride?: number | null; matchedBarcode?: string | null }>(`/api/items/barcode-lookup${qs({ barcode: trimmed, warehouseId: shift.warehouseId })}`)
    setLookupBusy(false)
    if (res.ok && res.data?.id) {
      const d = res.data
      const isUnitCode = (d.scan as { matchedBy?: string } | null | undefined)?.matchedBy === 'item_barcode' || (d.scan as { matchedBy?: string } | null | undefined)?.matchedBy === 'uom_barcode'
      addScanned(d, isUnitCode ? null : d.scan, isUnitCode ? d : null)
      if (localReady) runCatalogSync()
      return
    }
    if (res.status === 404) {
      Alert.alert('Barcode Not Found', `No item registered with barcode / PLU: ${trimmed}`)
    } else if (res.status === 0) {
      Alert.alert('Not in Offline Catalog', `Offline, and barcode / PLU ${trimmed} is not saved on this device.`)
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
    setCouponCode('')
    setCustomer(null)
  }

  async function holdCart() {
    if (cart.length === 0 || !shift || holdBusy) return
    setHoldBusy(true)
    try {
      const res = await apiPost<HeldSale>('/api/held-sales', {
        // itemId is the catalog id (scale lines use `<itemId>#n` as their line key)
        cartItems: heldCartItems(cart),
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
      setCouponCode('')
      setCustomer(null)
      setCartDrawerVisible(false)
      triggerToast(`Held as ${res.data?.holdNumber || 'ticket'}`)
    } finally {
      setHoldBusy(false)
    }
  }

  async function resumeHeld(held: HeldSale) {
    // Restore tax template / stock / unit from the local catalog so the resumed sale is taxed
    // like the original cart (held tickets only store id, name, qty and price).
    const info = new Map<string, Awaited<ReturnType<typeof getLocalItem>>>()
    for (const c of held.cartItems || []) {
      if (c.itemId && !info.has(c.itemId)) info.set(c.itemId, await getLocalItem(c.itemId).catch(() => null))
    }
    setCart(cartFromHeld(held.cartItems || [], (id) => info.get(id) || null))
    if (held.customer) setCustomer({ id: held.customer.id, name: held.customer.name, phone: held.customer.phone })
    setHeldVisible(false)
    triggerToast(`Resumed ${held.holdNumber || 'held ticket'}`)
  }

  // ------------------------------------------------------------------ pricing (H5)
  // Price lists + promotions: server quote online, the shared engine on the cached bundle offline.
  const couponCodes = couponCode ? [couponCode] : []
  const pricingKey = cart.length ? quoteKey(cart, customer?.id, couponCodes) : ''
  useEffect(() => {
    if (!pricingKey) { setCartPromotions([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      let quote: CartQuote | null = null
      if (queueState.online && !shiftOffline) {
        const res = await apiPost<CartQuote>('/api/price-quote', {
          customerId: customer?.id || undefined,
          posProfileId: shift?.posProfileId || undefined,
          couponCodes,
          lines: quoteRequestLines(cart),
        })
        if (res.ok && res.data) quote = res.data
      }
      if (!quote) {
        const bundle = await getBundle().catch(() => null)
        quote = offlineCartQuote(cart, bundle?.pricing, { customerId: customer?.id, posProfileId: shift?.posProfileId, couponCodes })
      }
      if (cancelled || !quote) return
      applyQuote(quote)
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingKey, queueState.online])

  function applyQuote(quote: CartQuote) {
    setCart((prev) => applyCartQuote(prev, quote))
    setCartPromotions(quote.cartPromotions || [])
  }
  const cartPromotionDiscount = Math.round(cartPromotions.reduce((s, p) => s + p.amount, 0) * 100) / 100

  // ------------------------------------------------------------------ totals
  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const cartSubtotal = computeCartSubtotal(cart)
  const cartTax = useMemo(() => {
    const taxable = taxableLineTotals(cart.map((l) => lineTotal(l)), cartPromotionDiscount)
    return calculateCartTax(
      cart.map((l, i) => ({ lineTotal: taxable[i], taxTemplateId: l.taxTemplateId })),
      taxConfig,
      customer?.taxExempt === true
    )
  }, [cart, taxConfig, customer, cartPromotionDiscount])
  const cartTotalPayable = cartPayable(Math.round((cartSubtotal - cartPromotionDiscount) * 100) / 100, cartTax)
  const taxLabel = cartTax.breakdown.length === 1 ? cartTax.breakdown[0].taxName : 'Tax'

  const canApprove = hasPermission(user, 'approveRequisitions') || hasPermission(user, 'approveAdvances')
  const canInventory = hasPermission(user, 'manageInventory')

  function handleSyncPress() {
    setOfflineSalesVisible(true)
    if (queueState.pending === 0) return
    syncNow().then((r) => {
      if (r.stoppedOffline) triggerToast('Still offline — will retry automatically')
      else if (r.synced > 0) triggerToast(`${r.synced} sale(s) synced`)
      else if (r.rejected > 0) triggerToast(`${r.rejected} sale(s) rejected`)
    })
  }

  // ------------------------------------------------------------------ render
  // Roles without createSales (stock, purchasing, reports, HR, custom roles without it) never
  // see the register; the server refuses shifts/sales for them anyway.
  if (user && !hasPermission(user, 'createSales')) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, headerPad]}>
          <Text style={styles.appTitle}>Mobile POS</Text>
        </View>
        <EmptyView icon="🔒" title="Not available for your role" subtitle="Your role cannot make sales. Use the menu for the tasks you can do." />
        <Pressable style={[styles.gateBtn, { alignSelf: 'center', marginBottom: 24 + bottomPad }]} onPress={() => router.replace('/home')}>
          <Text style={styles.gateBtnText}>Open menu →</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header: tenant ▸ branch ▸ counter, online state, offline queue */}
      <View style={[styles.header, headerPad]}>
        <View style={styles.headerLeft}>
          <View style={styles.breadcrumbRow}>
            <Text style={styles.breadcrumbText} numberOfLines={1}>
              {user?.tenantName || 'skyERPOS'} ▸ {shiftWarehouseName(shift) || '—'} ▸ {shiftCounterName(shift) || 'No shift'}
            </Text>
            <View style={[styles.onlinePill, !queueState.online && styles.offlinePill]}>
              <View style={[styles.pulsingDot, !queueState.online && styles.offlineDot]} />
              <Text style={[styles.onlineText, !queueState.online && styles.offlineText]}>{queueState.online ? 'Online' : 'Offline'}</Text>
            </View>
          </View>
          <View style={styles.titleRow}>
            <Image source={require('../assets/icon.png')} style={styles.brandIcon} accessibilityLabel="skyERPOS" />
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

      {/* W6: offline mode + catalog freshness + offline sales */}
      {shift && (shiftOffline || !queueState.online) ? (
        <View style={styles.offlineModeBanner}>
          <Text style={styles.offlineModeText}>📴 Offline mode — sales will sync</Text>
        </View>
      ) : null}
      {shift ? (
        <Pressable style={styles.catalogBar} onPress={() => setOfflineSalesVisible(true)}>
          <Text style={styles.catalogBarText} numberOfLines={1}>
            {catalog?.syncing
              ? 'Updating catalog…'
              : localReady
                ? `Catalog updated ${formatAge(catalog?.lastSyncAt, nowTick)} · ${catalog?.itemCount ?? 0} items`
                : 'Catalog not on this device yet'}
            {queueState.pending > 0 ? ` · ${queueState.pending} pending` : ''}
            {queueState.rejected > 0 ? ` · ${queueState.rejected} need attention` : ''}
          </Text>
        </Pressable>
      ) : null}

      {/* Quick navigation (role-filtered) */}
      <View style={styles.quickNavContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickNavContent}>
          <AlertsBell />
          <Pressable style={styles.quickNavPill} onPress={() => router.push('/home')}>
            <Text style={styles.quickNavPillText}>☰ Menu</Text>
          </Pressable>
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
          {shift && hasPermission(user, 'processReturns') ? (
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
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}>
              <EmptyView icon="📦" title="No matching items found" subtitle="Try another search term or category, or scan a barcode. Pull down to refresh the catalog." />
            </ScrollView>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              numColumns={2}
              contentContainerStyle={styles.gridContent}
              keyboardShouldPersistTaps="handled"
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
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
        <View style={[styles.toast, { top: (Number(headerPad.paddingTop) || 0) + 70 }]}>
          <Text style={styles.toastText}>✓ {toastMessage}</Text>
        </View>
      )}

      {/* Cart bar */}
      {cart.length > 0 && shift && (
        <View style={[styles.cartBar, { paddingBottom: Math.max(24, bottomPad + 12) }]}>
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
        onSendToKitchen={kitchen.enabled ? () => void kitchen.send(cart, 'manual') : undefined}
        tax={cartTax.tax}
        totalPayable={cartTotalPayable}
        couponCode={couponCode}
        onCouponChange={features.has('promotions') ? setCouponCode : undefined}
        cartPromotions={cartPromotions}
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
          cartPromotionDiscount={cartPromotionDiscount}
          couponCodes={couponCodes}
          onPriceChanged={(quote) => { applyQuote(quote as CartQuote); setTenderVisible(false) }}
          online={queueState.online}
          business={business}
          cashierName={user?.name}
          onSaleComplete={(data) => {
            void kitchen.send(cart, 'sale')
            setTenderVisible(false)
            setCart([])
            setCouponCode('')
            setCustomer(null)
            setSaleResult(data)
            // stock shown in the grid reflects the sale (local catalog was adjusted)
            if (localReady) fetchItems(1, false)
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
            runCatalogSync()
          }}
        />
      )}

      <OfflineSalesModal
        visible={offlineSalesVisible}
        onClose={() => setOfflineSalesVisible(false)}
        canDiscard={hasPermission(user, 'manageSales')}
      />

      <SaleReceiptModal visible={!!saleResult} saleData={saleResult} onClose={() => setSaleResult(null)} />
    </View>
  )
}

const styles = StyleSheet.create({
  brandIcon: { width: 30, height: 30, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: THEME.colors.border },
  container: { flex: 1, backgroundColor: THEME.colors.background },
  offlineModeBanner: { backgroundColor: THEME.colors.secondaryLight, paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: THEME.colors.secondaryAmber },
  offlineModeText: { color: THEME.colors.onSecondaryContainer, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  catalogBar: { paddingHorizontal: 16, paddingVertical: 4, backgroundColor: THEME.colors.surfaceContainerLow },
  catalogBarText: { color: THEME.colors.textMuted, fontSize: 11, textAlign: 'center' },
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
