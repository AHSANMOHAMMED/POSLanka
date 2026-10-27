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
  Keyboard,
  useWindowDimensions,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import * as Crypto from 'expo-crypto'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { apiGet, apiPost, asList, getUser, qs, refreshPermissions, type AuthUser } from '../../src/lib/api'
import { hasPermission } from '../../src/lib/roles'
import { loadShiftOfflineAware, shiftCounterName, shiftWarehouseName, type Shift } from '../../src/lib/shift'
import { calculateCartTax, EMPTY_TAX_CONFIG, loadTaxConfig, taxConfigFromBundle, type TaxConfig } from '../../src/lib/tax'
import { isOnline, subscribe as subscribeQueue, syncNow, type QueueState } from '../../src/lib/offlineQueue'
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
} from '../../src/lib/localdb'
import { OfflineSalesModal } from '../../src/components/OfflineSalesModal'
import { THEME, formatLKR } from '../../src/lib/theme'
import { CartDrawerModal, CartLine } from '../../src/components/CartDrawerModal'
import { TenderModal, type SaleResultData } from '../../src/components/TenderModal'
import { SaleReceiptModal } from '../../src/components/SaleReceiptModal'
import { BarcodeScannerModal } from '../../src/components/BarcodeScannerModal'
import { CustomerPickerModal, type Customer } from '../../src/components/CustomerPickerModal'
import { HeldSalesModal, type HeldSale } from '../../src/components/HeldSalesModal'
import { ReturnModal } from '../../src/components/ReturnModal'
import { LoadingView, ErrorView } from '../../src/components/StateViews'
import { EmptyState, IconButton, ScreenHeader } from '../../src/components/ui'
import { invoiceNoFromScan, loadBusinessInfo, type BusinessInfo } from '../../src/lib/receipt'
import { AlertsBell } from '../../src/components/AlertsBell'
import { useKitchenTickets } from '../../src/lib/kitchenPrint'
import { cartFromHeld, cartPayable, cartSubtotal as computeCartSubtotal, heldCartItems, lineTotal, scanToLine } from '../../src/lib/cartMath'
import { getLocalItem } from '../../src/lib/localdb'
import { applyCartQuote, offlineCartQuote, quoteKey, quoteRequestLines, taxableLineTotals, type CartQuote } from '../../src/lib/cartPricing'
import { useHeaderPad } from '../../src/lib/safeArea'
import { useFeatureFlags } from '../../src/lib/features'

/** Search wording of the newer business types (same terminology as the web POS, src/lib/terminology.ts) */
const SEARCH_PLACEHOLDER_BY_TYPE: Record<string, string> = {
  electronics: 'Scan barcode / IMEI or search models',
  hardware: 'Scan barcode or search items, sizes',
  print_studio: 'Search prints, sizes, services',
  office: 'Search services & products',
}

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
  const headerPad = useHeaderPad(4)
  const { width: screenW, height: screenH } = useWindowDimensions()
  const gridCols = screenW >= 900 ? 4 : screenW >= 600 ? 3 : 2
  /** Cart lines area: about three lines on a phone, never more than a third of the screen. */
  const cartListMax = Math.min(Math.round(screenH * 0.3), 3 * 60 + 20)
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
  // Sticky cart panel: lines expanded (collapsed automatically while the keyboard is up)
  const [cartOpen, setCartOpen] = useState(true)
  const [keyboardUp, setKeyboardUp] = useState(false)

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function triggerToast(text: string) {
    setToastMessage(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMessage(null), 1500)
  }
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
    triggerToast(`${qtyLabel} ${item.name} added`)
  }

  async function lookupBarcode(code: string) {
    // Receipt QR with the verification link: /v/<BusinessID>/<invoiceNo>
    const trimmed = invoiceNoFromScan(code)
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
      // A product with sizes / colours is sold by its variant: list them instead of adding the parent
      if ((d as { hasVariants?: boolean }).hasVariants) {
        setQuery(d.name)
        Alert.alert('Choose the size / colour', `${d.name} comes in several sizes or colours. Tap the one the customer is buying.`)
        return
      }
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

  // ---- touch helpers for the grid + sticky cart (UI only; quantities go through updateQuantity)
  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of cart) {
      const key = l.itemId || l.id
      m.set(key, (m.get(key) || 0) + l.quantity)
    }
    return m
  }, [cart])

  function changeQty(lineId: string, delta: number) {
    Haptics.selectionAsync().catch(() => undefined)
    updateQuantity(lineId, delta)
  }

  /** "−" on a product card: one less of the most recently added line of that item. */
  function decrementItem(itemId: string) {
    const line = [...cart].reverse().find((l) => (l.itemId || l.id) === itemId)
    if (line) changeQty(line.id, -1)
  }

  function confirmRemove(line: CartLine) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
    Alert.alert('Remove item', `Remove ${line.name} from the cart?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeItem(line.id) },
    ])
  }

  function confirmClear() {
    Alert.alert('Clear cart', 'Remove every item and the linked customer?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearCart() },
    ])
  }

  function openTender() {
    Keyboard.dismiss()
    setTenderVisible(true)
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
        <ScreenHeader title="Sell" back={false} />
        <EmptyState icon="lock-closed-outline" title="Not available for your role" subtitle="Your role cannot make sales. Use the tabs below for the tasks you can do." actionLabel="Go to Home" onAction={() => router.navigate('/home')} />
      </View>
    )
  }

  const canReturn = !!shift && hasPermission(user, 'processReturns')
  const showFullCart = cartOpen && !keyboardUp
  const lastLine = cart[cart.length - 1]

  return (
    <View style={styles.container}>
      {/* Header: register title, branch ▸ counter, online state + register actions */}
      <View style={[styles.header, headerPad]}>
        <View style={styles.headerLeft}>
          <View style={styles.titleRow}>
            <Text style={styles.appTitle}>Sell</Text>
            <View style={[styles.onlinePill, !queueState.online && styles.offlinePill]}>
              <View style={[styles.pulsingDot, !queueState.online && styles.offlineDot]} />
              <Text style={[styles.onlineText, !queueState.online && styles.offlineText]}>{queueState.online ? 'Online' : 'Offline'}</Text>
            </View>
          </View>
          <Text style={styles.breadcrumbText} numberOfLines={1}>
            {shiftWarehouseName(shift) || user?.tenantName || 'skyERPOS'} ▸ {shiftCounterName(shift) || 'No shift'}
          </Text>
        </View>
        <IconButton name="pause-circle-outline" label="Held tickets" onPress={() => setHeldVisible(true)} />
        {canReturn ? (
          <IconButton
            name="return-down-back-outline"
            label="Return"
            onPress={() => {
              setQuery('')
              setReturnQuery('INV-')
            }}
          />
        ) : null}
        <IconButton name="time-outline" label="Shift" onPress={() => router.push('/shifts')} />
        <AlertsBell compact />
      </View>

      {/* W6: offline mode + pending sync + catalog freshness */}
      {queueState.pending + queueState.rejected > 0 ? (
        <Pressable style={[styles.syncBar, queueState.rejected > 0 && styles.syncBarError]} onPress={handleSyncPress} accessibilityRole="button">
          {queueState.syncing ? <ActivityIndicator size="small" color={THEME.colors.onSecondaryContainer} /> : <Ionicons name="sync-outline" size={16} color={queueState.rejected > 0 ? THEME.colors.error : THEME.colors.onSecondaryContainer} />}
          <Text style={[styles.syncBarText, queueState.rejected > 0 && { color: THEME.colors.error }]} numberOfLines={1}>
            {queueState.pending} pending{queueState.rejected > 0 ? ` · ${queueState.rejected} failed` : ''} · Tap to sync
          </Text>
        </Pressable>
      ) : shift && (shiftOffline || !queueState.online) ? (
        <View style={styles.offlineModeBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={THEME.colors.onSecondaryContainer} />
          <Text style={styles.offlineModeText}>Offline mode — sales are saved and will sync</Text>
        </View>
      ) : null}

      {shiftLoading ? (
        <LoadingView text="Checking your shift…" />
      ) : !shift && shiftError ? (
        <ErrorView message={shiftError} onRetry={loadShift} />
      ) : !shift ? (
        <View style={styles.gateWrap}>
          <View style={styles.gateCard}>
            <View style={styles.gateIcon}>
              <Ionicons name="lock-closed" size={30} color={THEME.colors.onSecondaryContainer} />
            </View>
            <Text style={styles.gateTitle}>No open shift</Text>
            <Text style={styles.gateSub}>Sales are blocked until you open a shift on a POS counter. Your opening float is recorded for reconciliation.</Text>
            <Pressable style={styles.gateBtn} onPress={() => router.push('/shifts')}>
              <Ionicons name="lock-open-outline" size={18} color="#FFF" />
              <Text style={styles.gateBtnText}>Open shift</Text>
            </Pressable>
            <Pressable style={styles.gateRetry} onPress={loadShift}>
              <Ionicons name="refresh" size={14} color={THEME.colors.primary} />
              <Text style={styles.gateRetryText}>Re-check</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          {/* Search & scan */}
          <View style={styles.searchSection}>
            <View style={styles.searchRow}>
              <View style={styles.searchBar}>
                <Ionicons name="search" size={20} color={THEME.colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={SEARCH_PLACEHOLDER_BY_TYPE[user?.businessType || ''] || 'Search items or type a barcode'}
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
                  <Pressable onPress={() => setQuery('')} style={styles.clearQueryBtn} hitSlop={8} accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={20} color={THEME.colors.textSubtle} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable style={({ pressed }) => [styles.cameraScanBtn, pressed && { opacity: 0.8 }]} onPress={() => setScannerVisible(true)} accessibilityLabel="Scan with camera">
                <Ionicons name="scan" size={26} color="#FFF" />
              </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll} keyboardShouldPersistTaps="handled">
              <Pressable hitSlop={{ top: 4, bottom: 4 }} style={[styles.catChip, selectedCategoryId === 'all' && styles.catChipActive]} onPress={() => setSelectedCategoryId('all')}>
                <Text style={[styles.catChipText, selectedCategoryId === 'all' && styles.catChipTextActive]}>
                  All{pagination && selectedCategoryId === 'all' ? ` · ${pagination.total}` : ''}
                </Text>
              </Pressable>
              {categories.map((cat) => {
                const isSelected = selectedCategoryId === cat.id
                return (
                  <Pressable key={cat.id} hitSlop={{ top: 4, bottom: 4 }} style={[styles.catChip, isSelected && styles.catChipActive]} onPress={() => setSelectedCategoryId(cat.id)}>
                    <Text style={[styles.catChipText, isSelected && styles.catChipTextActive]}>
                      {cat.name}
                      {isSelected && pagination ? ` · ${pagination.total}` : ''}
                    </Text>
                  </Pressable>
                )
              })}
              <Pressable hitSlop={{ top: 4, bottom: 4 }} style={[styles.catChip, styles.catChipOutline, inStockOnly && styles.catChipActive]} onPress={() => setInStockOnly((v) => !v)}>
                <Ionicons name={inStockOnly ? 'checkbox' : 'square-outline'} size={14} color={inStockOnly ? '#FFF' : THEME.colors.textMuted} />
                <Text style={[styles.catChipText, inStockOnly && styles.catChipTextActive]}>In stock</Text>
              </Pressable>
            </ScrollView>
          </View>

          {/* Customer strip */}
          <Pressable style={styles.customerStrip} onPress={() => setCustomerPickerVisible(true)} accessibilityRole="button" accessibilityLabel={customer ? `Customer ${customer.name}, change` : 'Add customer'}>
            <View style={[styles.customerAvatar, customer && { backgroundColor: THEME.colors.primary }]}>
              <Ionicons name={customer ? 'person' : 'person-outline'} size={16} color={customer ? '#FFF' : THEME.colors.textMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.customerName} numberOfLines={1}>
                {customer ? customer.name : 'Walk-in customer'}
              </Text>
              <Text style={styles.loyaltySub} numberOfLines={1}>
                {customer
                  ? `${customer.phone || 'No phone'}${customer.loyaltyPoints != null ? ` · ${customer.loyaltyPoints} pts` : ''}${
                      customer.balance != null && Number(customer.balance) !== 0 ? ` · Credit ${formatLKR(customer.balance)}` : ''
                    }`
                  : 'Tap to link a customer (credit, loyalty)'}
              </Text>
            </View>
            {customer ? (
              <Pressable style={styles.customerClear} onPress={() => setCustomer(null)} hitSlop={6} accessibilityLabel="Remove customer">
                <Ionicons name="close" size={18} color={THEME.colors.error} />
              </Pressable>
            ) : (
              <Ionicons name="add-circle" size={24} color={THEME.colors.primary} />
            )}
          </Pressable>

          {/* Catalog freshness */}
          <Pressable style={styles.catalogBar} onPress={() => setOfflineSalesVisible(true)}>
            <Text style={styles.catalogBarText} numberOfLines={1}>
              {catalog?.syncing
                ? 'Updating catalog…'
                : localReady
                  ? `Catalog updated ${formatAge(catalog?.lastSyncAt, nowTick)} · ${catalog?.itemCount ?? 0} items`
                  : 'Catalog not on this device yet'}
            </Text>
          </Pressable>

          {/* Product grid */}
          <View style={{ flex: 1 }}>
            {itemsLoading ? (
              <LoadingView text="Loading items…" />
            ) : itemsError ? (
              <ErrorView message={itemsError} onRetry={() => fetchItems(1, false)} />
            ) : items.length === 0 ? (
              <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}>
                <EmptyState icon="cube-outline" title="No matching items" subtitle="Try another search or category, or scan a barcode. Pull down to refresh the catalog." />
              </ScrollView>
            ) : (
              <FlatList
                key={`grid-${gridCols}`}
                data={items}
                keyExtractor={(item) => item.id}
                numColumns={gridCols}
                contentContainerStyle={styles.gridContent}
                columnWrapperStyle={styles.gridRow}
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
                  const inCart = qtyByItem.get(item.id) || 0
                  return (
                    <Pressable
                      style={({ pressed }) => [styles.productCard, inCart > 0 && styles.productCardInCart, isOut && { opacity: 0.55 }, pressed && { transform: [{ scale: 0.98 }] }]}
                      onPress={() => addToCart(item)}
                      disabled={isOut}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${item.name}, ${formatLKR(item.sellingPrice)}`}
                    >
                      <View style={styles.cardTop}>
                        <Text style={[styles.stockBadge, isOut ? styles.stockBadgeOut : isLowStock ? styles.stockBadgeLow : styles.stockBadgeNormal]} numberOfLines={1}>
                          {!tracked ? 'Untracked' : isOut ? 'Out of stock' : isLowStock ? `Low · ${stockNum}` : `${stockNum} in stock`}
                        </Text>
                        {inCart > 0 ? (
                          <View style={styles.inCartBadge}>
                            <Text style={styles.inCartText}>{Math.round(inCart * 1000) / 1000}</Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.cardBarcode} numberOfLines={1}>
                        {item.barcode || (item.pluCode ? `PLU ${item.pluCode}` : item.sku ? `SKU ${item.sku}` : ' ')}
                      </Text>

                      <View style={styles.cardFooter}>
                        <View style={styles.priceCol}>
                          <Text style={styles.cardPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                            {formatLKR(item.sellingPrice)}
                          </Text>
                          {item.unit ? <Text style={styles.priceLabel}>per {item.unit}</Text> : null}
                        </View>
                        {inCart > 0 ? (
                          <Pressable style={styles.cardMinus} onPress={() => decrementItem(item.id)} hitSlop={4} accessibilityLabel={`One less ${item.name}`}>
                            <Ionicons name="remove" size={20} color={THEME.colors.primary} />
                          </Pressable>
                        ) : null}
                        <View style={[styles.addBtn, isOut && { backgroundColor: THEME.colors.borderStrong }]}>
                          <Ionicons name="add" size={22} color="#FFF" />
                        </View>
                      </View>
                    </Pressable>
                  )
                }}
              />
            )}

            {toastMessage && (
              <View style={styles.toast} pointerEvents="none">
                <Ionicons name="checkmark-circle" size={16} color="#4ADE80" />
                <Text style={styles.toastText}>{toastMessage}</Text>
              </View>
            )}
          </View>

          {/* Sticky cart: lines with quick +/- (long-press removes), total and Pay */}
          {cart.length > 0 ? (
            <View style={styles.cartBar}>
              <Pressable style={styles.cartToggle} onPress={() => setCartOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={cartOpen ? 'Collapse cart' : 'Expand cart'}>
                <View style={styles.cartCountCircle}>
                  <Text style={styles.cartCountCircleText}>{Math.round(totalCartCount * 1000) / 1000}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cartItemsLabel} numberOfLines={1}>
                    {cart.length} line{cart.length === 1 ? '' : 's'}
                    {!showFullCart && lastLine ? ` · ${lastLine.name} × ${lastLine.quantity}` : ''}
                  </Text>
                  <Text style={styles.cartTaxText}>
                    {taxLabel}
                    {cartTax.hasInclusiveTax ? ' (incl.)' : ''}: {formatLKR(cartTax.tax)}
                    {cartPromotionDiscount > 0 ? ` · Promo −${formatLKR(cartPromotionDiscount)}` : ''}
                  </Text>
                </View>
                <Pressable style={styles.cartDetailsBtn} onPress={() => setCartDrawerVisible(true)} hitSlop={6}>
                  <Text style={styles.cartDetailsText}>Details</Text>
                </Pressable>
                <Ionicons name={cartOpen ? 'chevron-down' : 'chevron-up'} size={22} color={THEME.colors.textMuted} />
              </Pressable>

              {showFullCart ? (
                <ScrollView style={{ maxHeight: cartListMax }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {cart.map((line) => (
                    <Pressable
                      key={line.id}
                      style={({ pressed }) => [styles.cartLine, pressed && { backgroundColor: THEME.colors.surfaceContainerLow }]}
                      onLongPress={() => confirmRemove(line)}
                      delayLongPress={350}
                      accessibilityHint="Long-press to remove"
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.cartLineName} numberOfLines={1}>
                          {line.name}
                        </Text>
                        <Text style={styles.cartLineSub} numberOfLines={1}>
                          {formatLKR(line.sellingPrice)}
                          {line.uom ? ` / ${line.uom}` : ''}
                          {line.promotionDiscount ? ` · −${formatLKR(line.promotionDiscount)}` : ''}
                          {'  '}= {formatLKR(lineTotal(line))}
                        </Text>
                      </View>
                      <View style={styles.stepper}>
                        <Pressable style={styles.stepBtn} onPress={() => changeQty(line.id, -1)} accessibilityLabel={`Decrease ${line.name}`}>
                          <Ionicons name={line.quantity <= 1 ? 'trash-outline' : 'remove'} size={20} color={line.quantity <= 1 ? THEME.colors.error : THEME.colors.primary} />
                        </Pressable>
                        <Text style={styles.stepQty}>{Math.round(line.quantity * 1000) / 1000}</Text>
                        <Pressable style={styles.stepBtn} onPress={() => changeQty(line.id, 1)} accessibilityLabel={`Increase ${line.name}`}>
                          <Ionicons name="add" size={20} color={THEME.colors.primary} />
                        </Pressable>
                      </View>
                    </Pressable>
                  ))}
                  <Text style={styles.cartHint}>Long-press a line to remove it</Text>
                </ScrollView>
              ) : null}

              <View style={styles.cartActionRow}>
                <Pressable style={styles.iconActionBtn} onPress={holdCart} disabled={holdBusy} accessibilityLabel="Hold cart">
                  {holdBusy ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : <Ionicons name="pause" size={20} color={THEME.colors.primary} />}
                  <Text style={styles.iconActionLabel}>Hold</Text>
                </Pressable>
                <Pressable style={styles.iconActionBtn} onPress={confirmClear} accessibilityLabel="Clear cart">
                  <Ionicons name="trash-outline" size={20} color={THEME.colors.error} />
                  <Text style={[styles.iconActionLabel, { color: THEME.colors.error }]}>Clear</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.chargeBtn, pressed && { opacity: 0.9 }]} onPress={openTender} accessibilityRole="button" accessibilityLabel={`Pay ${formatLKR(cartTotalPayable)}`}>
                  <View style={styles.chargeCol}>
                    <Text style={styles.chargeSub}>Pay</Text>
                    <Text style={styles.chargeVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {formatLKR(cartTotalPayable)}
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward-circle" size={30} color="#FFF" />
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
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
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
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
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.borderStrong,
  },
  headerLeft: { flex: 1, marginRight: 4, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  appTitle: { fontSize: 20, fontWeight: '800', color: THEME.colors.text },
  breadcrumbText: { fontSize: 12, fontWeight: '600', color: THEME.colors.textMuted, marginTop: 1 },
  onlinePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.colors.tertiaryLight, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, gap: 4 },
  offlinePill: { backgroundColor: THEME.colors.errorLight },
  pulsingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.colors.tertiary },
  offlineDot: { backgroundColor: THEME.colors.error },
  onlineText: { fontSize: 10, fontWeight: '800', color: THEME.colors.tertiaryContainer },
  offlineText: { color: THEME.colors.error },
  syncBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 40, backgroundColor: THEME.colors.secondaryLight },
  syncBarError: { backgroundColor: THEME.colors.errorLight },
  syncBarText: { flex: 1, fontSize: 13, fontWeight: '700', color: THEME.colors.onSecondaryContainer },
  offlineModeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: THEME.colors.secondaryLight, paddingHorizontal: 16, paddingVertical: 6 },
  offlineModeText: { color: THEME.colors.onSecondaryContainer, fontSize: 12, fontWeight: '700' },
  catalogBar: { paddingHorizontal: 16, paddingVertical: 3, backgroundColor: THEME.colors.surfaceContainerLow },
  catalogBarText: { color: THEME.colors.textSubtle, fontSize: 10, textAlign: 'center' },
  gateWrap: { flex: 1, justifyContent: 'center', padding: 24 },
  gateCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: THEME.colors.border, ...THEME.shadow },
  gateIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: THEME.colors.secondaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  gateTitle: { fontSize: 20, fontWeight: '800', color: THEME.colors.text },
  gateSub: { fontSize: 13, color: THEME.colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 18 },
  gateBtn: { width: '100%', height: 52, borderRadius: 14, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  gateBtnText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  gateRetry: { marginTop: 12, minHeight: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  gateRetryText: { color: THEME.colors.primary, fontWeight: '700', fontSize: 13 },
  searchSection: { backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingTop: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    paddingHorizontal: 12,
    height: 52,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, color: THEME.colors.text },
  clearQueryBtn: { padding: 4 },
  cameraScanBtn: { width: 52, height: 52, borderRadius: 14, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center', ...THEME.shadow },
  categoryScroll: { paddingVertical: 8, gap: 8 },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  catChipOutline: { backgroundColor: '#FFFFFF', borderStyle: 'dashed' },
  catChipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  catChipText: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  catChipTextActive: { color: '#FFFFFF' },
  customerStrip: {
    paddingHorizontal: 12,
    minHeight: 52,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.colors.borderStrong,
  },
  customerAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: THEME.colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  customerName: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  loyaltySub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 1 },
  customerClear: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.colors.errorLight },
  gridContent: { padding: 8, paddingBottom: 16 },
  gridRow: { gap: 8, paddingHorizontal: 0 },
  loadMoreBtn: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center', borderRadius: 12, backgroundColor: THEME.colors.surfaceContainerHigh },
  loadMoreText: { fontSize: 13, fontWeight: '800', color: THEME.colors.primary },
  productCard: {
    flex: 1,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1.5,
    borderColor: THEME.colors.border,
    minHeight: 150,
    justifyContent: 'space-between',
    ...THEME.shadow,
  },
  productCardInCart: { borderColor: THEME.colors.primary, backgroundColor: '#FBFDFF' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 4 },
  stockBadge: { flexShrink: 1, fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  stockBadgeNormal: { backgroundColor: THEME.colors.tertiaryLight, color: THEME.colors.tertiaryContainer },
  stockBadgeLow: { backgroundColor: THEME.colors.secondaryLight, color: THEME.colors.onSecondaryContainer },
  stockBadgeOut: { backgroundColor: THEME.colors.errorLight, color: THEME.colors.error },
  inCartBadge: { minWidth: 26, height: 26, paddingHorizontal: 6, borderRadius: 13, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  inCartText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text, lineHeight: 19 },
  cardBarcode: { fontSize: 10, color: THEME.colors.textSubtle, marginTop: 2 },
  cardFooter: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceCol: { flex: 1, minWidth: 0 },
  priceLabel: { fontSize: 10, color: THEME.colors.textSubtle },
  cardPrice: { fontSize: 15, fontWeight: '800', color: THEME.colors.primary, fontVariant: ['tabular-nums'] },
  cardMinus: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF' },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  toast: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    zIndex: 100,
    elevation: 6,
    maxWidth: '90%',
  },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  cartBar: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 14,
    borderTopWidth: 1,
    borderColor: THEME.colors.border,
  },
  cartToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  cartCountCircle: { minWidth: 30, height: 30, paddingHorizontal: 6, borderRadius: 15, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  cartCountCircleText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  cartItemsLabel: { fontSize: 14, fontWeight: '800', color: THEME.colors.text },
  cartTaxText: { fontSize: 11, fontWeight: '600', color: THEME.colors.textMuted, marginTop: 1 },
  cartDetailsBtn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: THEME.colors.primaryLight, justifyContent: 'center' },
  cartDetailsText: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary },
  cartLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: THEME.colors.border },
  cartLineName: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  cartLineSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 24, backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border },
  stepBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  stepQty: { minWidth: 30, textAlign: 'center', fontSize: 15, fontWeight: '800', color: THEME.colors.text, fontVariant: ['tabular-nums'] },
  cartHint: { fontSize: 10, color: THEME.colors.textSubtle, textAlign: 'center', paddingVertical: 4 },
  cartActionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  iconActionBtn: { width: 56, height: 56, borderRadius: 14, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: THEME.colors.border },
  iconActionLabel: { fontSize: 10, fontWeight: '700', color: THEME.colors.primary, marginTop: 1 },
  chargeBtn: {
    flex: 1,
    height: 56,
    backgroundColor: THEME.colors.tertiaryContainer,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 4,
  },
  chargeCol: { flex: 1, justifyContent: 'center', minWidth: 0 },
  chargeSub: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 0.6 },
  chargeVal: { fontSize: 20, fontWeight: '900', color: '#FFFFFF' },
})
