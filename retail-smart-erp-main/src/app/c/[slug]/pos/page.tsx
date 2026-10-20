'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { Clock, Loader2 } from 'lucide-react'
import { CustomerFormModal, VehicleModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import {
  ShiftOpenModal,
  ShiftCloseModal,
  DiscountModal,
  ProductGrid,
  CartPanel,
  POSPaymentModal,
  HeldSalesModal,
  ReturnLookupModal,
  VehicleMismatchDialog,
  SaleSuccessModal,
  SupervisorAuthModal,
  CashierLockModal,
} from '@/components/pos'
import { POS_SEARCH_INPUT_ID } from '@/components/pos/ProductGrid'
import { publishPosDisplay, createIdlePosDisplayState } from '@/lib/pos/display-channel'
import { WeightInputModal } from '@/components/pos/WeightInputModal'
import { OfflineStatusBanner } from '@/components/pos/OfflineStatusBanner'
import { SerialPickerModal } from '@/components/pos/SerialPickerModal'
import { ModifierPickerModal } from '@/components/pos/ModifierPickerModal'
import { PrinterSettingsModal } from '@/components/pos/PrinterSettingsModal'
import { CameraScanModal } from '@/components/pos/CameraScanModal'
import type {
  Item,
  Category,
  CartItem,
  Customer,
  Vehicle,
  VehicleMake,
  HeldSale,
  SaleForReturn,
  ActiveShift,
  TenantInfo,
  LoyaltyProgram,
  PaymentMethodConfig,
  RestaurantTable,
  SelectedModifier,
  GiftCardInfo,
} from '@/components/pos/types'
import { toast } from '@/components/ui/toast'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useDebouncedValue } from '@/hooks/useDebounce'
import { quickPrint } from '@/hooks/usePrint'
import { usePrinter } from '@/hooks/usePrinter'
import { fetchLogoRaster, loadReceiptModel } from '@/lib/print/receipt-loader'
import { renderReceiptHtml } from '@/lib/print/receipt-html'
import type { PaperSize } from '@/lib/print/types'
import { useCurrency } from '@/hooks/useCurrency'
import { roundCurrency } from '@/lib/utils/currency'
import { calculateItemTax, aggregateTaxBreakdown, type ResolvedTaxTemplate, type TaxBreakdownItem } from '@/lib/utils/tax-template'
import { POS_ITEMS_LIMIT } from '@/components/pos/types'
import { usePOSBusinessConfig } from '@/hooks/usePOSBusinessConfig'
import { useOfflinePos } from '@/hooks/useOfflinePos'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatItemLabel } from '@/lib/utils/item-display'

/** Printed receipt / return / offline receipt numbers scanned at the POS (W8). */
const RECEIPT_CODE_RE = /^(INV|RTN|OFF)-/i

export default function POSPage() {
  const { currency: currencyCode } = useCurrency()
  const config = usePOSBusinessConfig()
  const company = useCompany()
  const router = useRouter()
  const params = useParams()

  // Dealership redirect
  useEffect(() => {
    if (config.redirectToDealPipeline) {
      router.replace(`/c/${params.slug}/dealership/sales`)
    }
  }, [config.redirectToDealPipeline, router, params.slug])

  // Load cart from converted quotation (sessionStorage)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('poslanka_quote_cart')
      if (!raw) return
      const data = JSON.parse(raw) as {
        customerId?: string | null
        customerName?: string | null
        cartItems?: Array<{
          itemId?: string | null
          name: string
          quantity: number
          unitPrice: number
          discount?: number
          tax?: number
        }>
      }
      sessionStorage.removeItem('poslanka_quote_cart')
      if (data.cartItems?.length) {
        setCart(
          data.cartItems.map((line, idx) => {
            const qty = line.quantity || 1
            const price = line.unitPrice || 0
            return {
              cartLineId: `quote-${idx}-${line.itemId || idx}`,
              itemId: line.itemId || '',
              name: line.name,
              quantity: qty,
              unitPrice: price,
              total: qty * price - (line.discount || 0),
              taxAmount: line.tax || 0,
            } satisfies CartItem
          })
        )
        if (data.customerName) {
          setSelectedCustomer({
            id: data.customerId || '',
            name: data.customerName,
            phone: null,
            loyaltyPoints: 0,
          } as Customer)
        }
        toast.success('Quotation loaded into cart')
      }
    } catch {
      // ignore bad session payload
    }
  }, [])

  // Core state
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [hasMoreItems, setHasMoreItems] = useState(false)
  const [searchingItems, setSearchingItems] = useState(false)

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)

  // Payment state
  const [showPayment, setShowPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [refundMethod, setRefundMethod] = useState('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [customerCredit, setCustomerCredit] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [splitSecondMethod, setSplitSecondMethod] = useState('card')
  const [splitSecondAmount, setSplitSecondAmount] = useState('')
  const { online, queueSale, cacheCatalog, loadCachedCatalog } = useOfflinePos()
  // Gift card state
  const [giftCardNumber, setGiftCardNumber] = useState('')
  const [giftCardInfo, setGiftCardInfo] = useState<GiftCardInfo | null>(null)
  const [giftCardLookupLoading, setGiftCardLookupLoading] = useState(false)
  // Modal states
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showVehicleModal, setShowVehicleModal] = useState(false)
  const [pendingCustomerName, setPendingCustomerName] = useState('')

  // Held sales state
  const [heldSales, setHeldSales] = useState<HeldSale[]>([])
  const [showHeldSalesModal, setShowHeldSalesModal] = useState(false)
  const [holdingInProgress, setHoldingInProgress] = useState(false)

  // Return mode state
  const [isReturnMode, setIsReturnMode] = useState(false)
  const [returnAgainstSale, setReturnAgainstSale] = useState<SaleForReturn | null>(null)
  const [showReturnLookupModal, setShowReturnLookupModal] = useState(false)
  const [returnSearchQuery, setReturnSearchQuery] = useState('')
  const [returnSearchResults, setReturnSearchResults] = useState<SaleForReturn[]>([])
  const [searchingReturns, setSearchingReturns] = useState(false)
  const [returnModeConfirm, setReturnModeConfirm] = useState(false)
  // Exchange (W8): return lines kept as credit while the replacement items are rung up
  const [exchangeFrom, setExchangeFrom] = useState<{
    sale: SaleForReturn
    returnLines: Array<{ originalSaleItemId: string; quantity: number; serialNumberIds?: string[] }>
    credit: number
  } | null>(null)

  // Confirm dialogs
  const [recallConfirm, setRecallConfirm] = useState<{ open: boolean; heldSale: HeldSale | null }>({ open: false, heldSale: null })
  const [deleteHeldConfirm, setDeleteHeldConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })

  // Shift Management State
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [shiftLoading, setShiftLoading] = useState(true)
  const [showShiftOpenModal, setShowShiftOpenModal] = useState(false)
  const [showShiftCloseModal, setShowShiftCloseModal] = useState(false)

  // Vehicle mismatch
  const [showMismatchDialog, setShowMismatchDialog] = useState(false)
  const [mismatchInfo, setMismatchInfo] = useState<{ vehicleOwnerName: string; vehicleOwnerId: string } | null>(null)
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null)

  // Discount state
  const [saleDiscount, setSaleDiscount] = useState<{ type: 'percentage' | 'fixed'; value: number; reason: string }>({ type: 'percentage', value: 0, reason: '' })
  const [showDiscountModal, setShowDiscountModal] = useState(false)

  // Supervisor override + terminal lock
  const { data: sessionData } = useSession()
  const cashierName = sessionData?.user?.name || ''
  type SupervisorRequest =
    | { type: 'custom_discount'; discount: { type: 'percentage' | 'fixed'; value: number; reason: string } }
    | { type: 'price_override'; cartLineId: string; newPrice: number; itemName: string; originalPrice: number }
    | { type: 'cart_void' }
  const [supervisorRequest, setSupervisorRequest] = useState<SupervisorRequest | null>(null)
  const [terminalLocked, setTerminalLocked] = useState(false)
  const [clearCartConfirm, setClearCartConfirm] = useState(false)
  const lastActivityRef = useRef(Date.now())
  // One idempotency key per cart: survives retries, reset after a successful sale / clear
  const clientSaleIdRef = useRef<string>(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')
  const newClientSaleId = () => { clientSaleIdRef.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '' }

  // Supermarket: weighable item state
  const [weightInputItem, setWeightInputItem] = useState<Item | null>(null)

  // Serial number picker state
  const [serialPickerItem, setSerialPickerItem] = useState<Item | null>(null)

  // Restaurant state
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway' | 'delivery'>('dine_in')
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [restaurantOrderId, setRestaurantOrderId] = useState<string | null>(null)
  const [tipAmount, setTipAmount] = useState(0)
  const [showModifierPicker, setShowModifierPicker] = useState(false)
  const [modifierPickerItem, setModifierPickerItem] = useState<Item | null>(null)

  // Receipt / tenant info state
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null)
  const [printingReceipt] = useState(false)
  // Receipt printer (ESC/POS via USB / Bluetooth / print agent) + camera scanner
  const printer = usePrinter()
  const [showPrinterSettings, setShowPrinterSettings] = useState(false)
  const [showCameraScan, setShowCameraScan] = useState(false)

  // Sale success modal state
  const [lastSale, setLastSale] = useState<{ invoiceNo: string; total: number; isReturn: boolean } | null>(null)
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)

  // Tax template state
  const [taxTemplatesMap, setTaxTemplatesMap] = useState<Map<string, ResolvedTaxTemplate>>(new Map())
  const [defaultTaxTemplate, setDefaultTaxTemplate] = useState<ResolvedTaxTemplate | null>(null)

  // Loyalty state
  const [loyaltyProgram, setLoyaltyProgram] = useState<LoyaltyProgram | null>(null)
  const [loyaltyPointsToRedeem, setLoyaltyPointsToRedeem] = useState('')
  const [showLoyaltyRedeem, setShowLoyaltyRedeem] = useState(false)

  // Cost center check
  const [hasCostCenters, setHasCostCenters] = useState(false)

  // Derived values
  const posWarehouse = activeShift?.warehouse || null
  const posProfile = activeShift?.posProfile
  const allowDiscount = posProfile?.allowDiscountChange !== false
  const maxDiscountPct = posProfile ? parseFloat(posProfile.maxDiscountPercent) : 100

  // Enabled payment methods from profile
  const enabledPaymentMethods: PaymentMethodConfig[] = useMemo(() => {
    const methods = posProfile?.paymentMethods
    if (methods && methods.length > 0) {
      return [...methods].sort((a, b) => a.sortOrder - b.sortOrder)
    }
    return [
      { paymentMethod: 'cash', isDefault: true, allowInReturns: true, sortOrder: 0 },
      { paymentMethod: 'card', isDefault: false, allowInReturns: true, sortOrder: 1 },
      { paymentMethod: 'bank_transfer', isDefault: false, allowInReturns: true, sortOrder: 2 },
    ]
  }, [posProfile?.paymentMethods])

  const enabledRefundMethods = useMemo(() => {
    const methods = enabledPaymentMethods
      .filter(pm => pm.allowInReturns && pm.paymentMethod !== 'gift_card')
      .map(pm => pm.paymentMethod)
    if (!methods.includes('credit')) methods.push('credit')
    return methods
  }, [enabledPaymentMethods])

  useEffect(() => {
    const defaultMethod = enabledPaymentMethods.find(pm => pm.isDefault)
    if (defaultMethod) {
      setPaymentMethod(defaultMethod.paymentMethod)
    } else if (enabledPaymentMethods.length > 0) {
      setPaymentMethod(enabledPaymentMethods[0].paymentMethod)
    }
  }, [enabledPaymentMethods])

  useUnsavedChangesWarning(cart.length > 0, 'You have items in your cart. Are you sure you want to leave?')

  const debouncedReturnSearchQuery = useDebouncedValue(returnSearchQuery, 300)
  const debouncedItemSearch = useDebouncedValue(search, 300)

  // ─── Data Fetchers ────────────────────────────────────────────

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories?all=true')
      if (res.ok) {
        const data = await res.json()
        setCategories(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching categories:', error)
    }
  }, [])

  const fetchItems = useCallback(async (searchQuery?: string, warehouseId?: string | null, categoryId?: string | null) => {
    try {
      setSearchingItems(true)
      const params = new URLSearchParams()
      params.set('pageSize', String(POS_ITEMS_LIMIT))
      params.set('inStockOnly', 'true')
      if (searchQuery) params.set('search', searchQuery)
      if (warehouseId) params.set('warehouseId', warehouseId)
      if (categoryId) params.set('categoryId', categoryId)

      // Offline: serve from the cached catalog snapshot
      const serveFromCache = async () => {
        const cached = (await loadCachedCatalog()) as Item[]
        const q = (searchQuery || '').toLowerCase()
        const filtered = cached.filter(i =>
          (!categoryId || i.categoryId === categoryId) &&
          (!q || i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q) || (i.barcode || '').includes(q) || (i.pluCode || '') === q)
        )
        setItems(filtered.slice(0, POS_ITEMS_LIMIT))
        setHasMoreItems(filtered.length > POS_ITEMS_LIMIT)
        if (cached.length === 0) toast.warning('Offline and no cached catalog yet')
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await serveFromCache()
        return
      }

      const res = await fetch(`/api/items?${params.toString()}`)
      if (res.ok) {
        const response = await res.json()
        const data = response.data || response
        const pagination = response.pagination
        setItems(data)
        setHasMoreItems(pagination && pagination.total > POS_ITEMS_LIMIT)
        void cacheCatalog(Array.isArray(data) ? data : [])
      } else {
        toast.error('Failed to load items')
      }
    } catch (error) {
      console.error('Error fetching items:', error)
      // Network failure → fall back to the offline snapshot
      try {
        const cached = (await loadCachedCatalog()) as Item[]
        if (cached.length > 0) {
          setItems(cached.slice(0, POS_ITEMS_LIMIT))
          setHasMoreItems(cached.length > POS_ITEMS_LIMIT)
          toast.warning('Showing cached catalog (offline)')
          return
        }
      } catch { /* ignore */ }
      toast.error('Failed to load items')
    } finally {
      setSearchingItems(false)
    }
  }, [cacheCatalog, loadCachedCatalog])

  // Warm the offline catalog snapshot for this branch in the background (up to 2,000 items)
  const catalogWarmedFor = useRef<string | null>(null)
  useEffect(() => {
    const warehouseId = activeShift?.warehouse?.id
    if (!warehouseId || !online || catalogWarmedFor.current === warehouseId) return
    catalogWarmedFor.current = warehouseId
    let cancelled = false
    ;(async () => {
      for (let page = 1; page <= 10 && !cancelled; page++) {
        try {
          const res = await fetch(`/api/items?pageSize=200&page=${page}&inStockOnly=true&warehouseId=${warehouseId}`)
          if (!res.ok) break
          const body = await res.json()
          const data: unknown[] = Array.isArray(body) ? body : (body.data || [])
          if (data.length > 0) await cacheCatalog(data)
          if (!body.pagination || page >= body.pagination.totalPages) break
        } catch {
          break
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeShift?.warehouse?.id, online, cacheCatalog])

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers?all=true')
      if (res.ok) {
        const data = await res.json()
        setCustomers(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
    }
  }, [])

  const fetchVehicles = useCallback(async () => {
    if (!config.showVehicleSelector) return
    try {
      const res = await fetch('/api/vehicles?all=true')
      if (res.ok) {
        const data = await res.json()
        setVehicles(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error)
    }
  }, [config.showVehicleSelector])

  const fetchMakes = useCallback(async () => {
    if (!config.showVehicleSelector) return
    try {
      const res = await fetch('/api/vehicle-makes?all=true')
      if (res.ok) {
        const data = await res.json()
        setMakes(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching makes:', error)
    }
  }, [config.showVehicleSelector])

  const fetchHeldSales = useCallback(async () => {
    try {
      const res = await fetch('/api/held-sales?all=true')
      if (res.ok) {
        const data = await res.json()
        setHeldSales(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching held sales:', error)
    }
  }, [])

  const fetchActiveShift = useCallback(async () => {
    try {
      const res = await fetch('/api/pos-opening-entries?current=true')
      if (res.ok) {
        const data = await res.json()
        setActiveShift(data.shift || null)
      }
    } catch (error) {
      console.error('Error fetching active shift:', error)
    } finally {
      setShiftLoading(false)
    }
  }, [])

  const fetchTenantInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant')
      if (res.ok) {
        const tenant = await res.json()
        setTenantInfo({
          name: tenant.name || '',
          phone: tenant.phone || null,
          address: tenant.address || null,
          email: tenant.email || null,
          currency: tenant.currency || 'LKR',
          taxRate: parseFloat(tenant.taxRate) || 0,
          taxInclusive: tenant.taxInclusive || false,
        })
      }
    } catch (error) {
      console.error('Error fetching tenant info:', error)
    }
  }, [])

  const fetchTaxTemplates = useCallback(async () => {
    try {
      const [ttRes, settingsRes] = await Promise.all([
        fetch('/api/accounting/tax-templates?all=true'),
        fetch('/api/accounting/settings'),
      ])
      if (ttRes.ok) {
        const data = await ttRes.json()
        const list: Array<{ id: string; name: string; isActive: boolean; items: Array<{ taxName: string; rate: string; accountId: string | null; includedInPrice: boolean }> }> = Array.isArray(data) ? data : data.data || []
        const map = new Map<string, ResolvedTaxTemplate>()
        for (const t of list) {
          if (t.isActive) {
            map.set(t.id, {
              id: t.id,
              name: t.name,
              items: t.items.map(i => ({
                taxName: i.taxName,
                rate: Number(i.rate),
                accountId: i.accountId,
                includedInPrice: i.includedInPrice,
              })),
            })
          }
        }
        setTaxTemplatesMap(map)

        // Set default template from accounting settings
        if (settingsRes.ok) {
          const settings = await settingsRes.json()
          if (settings.defaultTaxTemplateId && map.has(settings.defaultTaxTemplateId)) {
            setDefaultTaxTemplate(map.get(settings.defaultTaxTemplateId)!)
          }
        }
      }
    } catch {
      // Tax templates are optional
    }
  }, [])

  const fetchTables = useCallback(async () => {
    if (!config.showTableSelector) return
    try {
      const res = await fetch('/api/restaurant-tables?all=true')
      if (res.ok) {
        const data = await res.json()
        const items = Array.isArray(data) ? data : (data.data || [])
        setTables(items.filter((t: RestaurantTable) => t.status !== undefined))
      }
    } catch (error) {
      console.error('Error fetching tables:', error)
    }
  }, [config.showTableSelector])

  const fetchLoyaltyProgram = useCallback(async () => {
    try {
      const res = await fetch('/api/loyalty-programs')
      if (res.ok) {
        const data = await res.json()
        if (data && data.id) {
          setLoyaltyProgram(data)
        }
      }
    } catch (error) {
      console.error('Error fetching loyalty program:', error)
    }
  }, [])

  // ─── Effects ──────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([fetchCategories(), fetchCustomers(), fetchVehicles(), fetchMakes(), fetchHeldSales(), fetchActiveShift(), fetchTenantInfo(), fetchLoyaltyProgram(), fetchTables(), fetchTaxTemplates(),
      fetch('/api/accounting/cost-centers?all=true').then(r => r.ok ? r.json() : []).then(data => {
        const list = Array.isArray(data) ? data : data.data || []
        setHasCostCenters(list.filter((c: { isGroup?: boolean }) => !c.isGroup).length > 0)
      }).catch(() => {}),
    ])
      .finally(() => setLoading(false))
  }, [fetchCategories, fetchCustomers, fetchVehicles, fetchMakes, fetchHeldSales, fetchActiveShift, fetchTenantInfo, fetchLoyaltyProgram, fetchTables, fetchTaxTemplates])

  useEffect(() => {
    if (posWarehouse) {
      fetchItems(undefined, posWarehouse.id, selectedCategory)
    }
  }, [posWarehouse, fetchItems, selectedCategory])

  useEffect(() => {
    if (loading || !posWarehouse) return
    fetchItems(debouncedItemSearch || undefined, posWarehouse.id, selectedCategory)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedItemSearch, posWarehouse?.id, selectedCategory, loading, fetchItems])

  const handleItemsUpdate = useCallback(() => {
    fetchItems(debouncedItemSearch || undefined, posWarehouse?.id, selectedCategory)
  }, [fetchItems, debouncedItemSearch, posWarehouse?.id, selectedCategory])

  useRealtimeData(handleItemsUpdate, { entityType: ['item', 'warehouse-stock'], refreshOnMount: false })
  useRealtimeData(fetchCustomers, { entityType: 'customer', refreshOnMount: false })
  useRealtimeData(fetchVehicles, { entityType: 'vehicle', refreshOnMount: false })
  useRealtimeData(fetchHeldSales, { entityType: ['held-sale', 'pos-closing'], refreshOnMount: false })
  useRealtimeData(fetchActiveShift, { entityType: 'pos-shift', refreshOnMount: false })
  useRealtimeData(fetchTables, { entityType: 'table', refreshOnMount: false })

  // Supermarket: barcode auto-add effect
  useEffect(() => {
    if (!config.enableBarcodeAutoAdd || !debouncedItemSearch || !posWarehouse || isReturnMode || RECEIPT_CODE_RE.test(debouncedItemSearch.trim())) return
    const barcode = debouncedItemSearch.trim()
    if (!barcode || barcode.length < 3) return

    async function tryBarcodeAutoAdd() {
      try {
        const res = await fetch(`/api/items/barcode-lookup?barcode=${encodeURIComponent(barcode)}&warehouseId=${posWarehouse!.id}`)
        if (res.ok) {
          const item: Item = await res.json()
          addScannedItem(item)
          setSearch('')
        }
      } catch {
        // Not a barcode match, ignore
      }
    }
    tryBarcodeAutoAdd()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enableBarcodeAutoAdd, debouncedItemSearch, posWarehouse?.id, isReturnMode])

  // Return search effect
  useEffect(() => {
    async function searchSalesForReturn() {
      if (!debouncedReturnSearchQuery.trim()) {
        setReturnSearchResults([])
        return
      }
      setSearchingReturns(true)
      try {
        // Receipt codes (INV-/RTN-/OFF-) resolve exactly through the lookup endpoint
        if (RECEIPT_CODE_RE.test(debouncedReturnSearchQuery.trim())) {
          const lookupRes = await fetch(`/api/sales/lookup?code=${encodeURIComponent(debouncedReturnSearchQuery.trim())}`)
          if (lookupRes.ok) {
            const found = await lookupRes.json()
            setReturnSearchResults(found?.sale ? [found.sale] : [])
            return
          }
        }
        const res = await fetch(`/api/sales?search=${encodeURIComponent(debouncedReturnSearchQuery)}&status=completed&pageSize=20&all=true`)
        if (res.ok) {
          const data = await res.json()
          setReturnSearchResults(Array.isArray(data) ? data : [])
        }
      } catch (error) {
        console.error('Error searching sales:', error)
        toast.error('Failed to search sales')
      } finally {
        setSearchingReturns(false)
      }
    }
    searchSalesForReturn()
  }, [debouncedReturnSearchQuery])

  // ─── Cart Functions ───────────────────────────────────────────

  function addToCart(item: Item) {
    // Serial-tracked items need serial picker first
    if (item.trackSerialNumbers && !isReturnMode) {
      setSerialPickerItem(item)
      return
    }

    // Supermarket: weighable items need weight input first
    if (config.enableWeighableItems && item.isWeighable && !isReturnMode) {
      setWeightInputItem(item)
      return
    }

    // Restaurant: check for modifiers before adding
    if (config.enableModifiers && !isReturnMode) {
      setModifierPickerItem(item)
      setShowModifierPicker(true)
      return
    }

    addToCartDirect(item)
  }

  /** Add a scanned item honouring scan-derived quantity/price (weighing-scale labels, GS1 net weight / price). */
  function addScannedItem(item: Item & { scan?: { quantity?: number; unitPrice?: number; lineTotal?: number; symbology?: string } }) {
    const scan = item.scan
    if (scan && typeof scan.quantity === 'number' && scan.quantity > 0 && (scan.symbology === 'scale' || item.isWeighable || scan.symbology === 'gs1')) {
      if (isReturnMode) { addToCart(item); return }
      const unitPrice = typeof scan.unitPrice === 'number' && scan.unitPrice > 0 ? scan.unitPrice : parseFloat(item.sellingPrice)
      const total = roundCurrency(typeof scan.lineTotal === 'number' && scan.lineTotal > 0 ? scan.lineTotal : scan.quantity * unitPrice)
      setCart(prev => [...prev, {
        cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        itemId: item.id,
        name: formatItemLabel(item, company.businessType),
        quantity: 1,
        unitPrice: total,
        total,
        weight: scan.quantity,
        isWeighable: true,
        taxTemplateId: item.taxTemplateId || null,
      }])
      return
    }
    addToCart(item)
  }

  function addToCartWithWeight(item: Item, weight: number) {
    const unitPrice = parseFloat(item.sellingPrice)
    const total = weight * unitPrice
    setCart([...cart, {
      cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      itemId: item.id,
      name: formatItemLabel(item, company.businessType),
      quantity: 1,
      unitPrice: total,
      total,
      weight,
      isWeighable: true,
      taxTemplateId: item.taxTemplateId || null,
    }])
    setWeightInputItem(null)
  }

  function addToCartWithModifiers(modifiers: SelectedModifier[]) {
    if (!modifierPickerItem) return
    const item = modifierPickerItem
    const basePrice = parseFloat(item.sellingPrice)
    const modifierTotal = modifiers.reduce((sum, m) => sum + m.price, 0)
    const unitPrice = basePrice + modifierTotal

    // With modifiers, always add as new line (different modifier combos = different lines)
    setCart([...cart, {
      cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      itemId: item.id,
      name: formatItemLabel(item, company.businessType),
      quantity: 1,
      unitPrice,
      total: unitPrice,
      modifiers: modifiers.length > 0 ? modifiers : undefined,
      taxTemplateId: item.taxTemplateId || null,
    }])

    // If restaurant order exists, send item to order (and kitchen)
    if (restaurantOrderId) {
      sendItemToRestaurantOrder(item, modifiers, unitPrice).catch(console.error)
    }

    setModifierPickerItem(null)
    setShowModifierPicker(false)
  }

  function addToCartWithSerials(serialIds: string[]) {
    if (!serialPickerItem) return
    const item = serialPickerItem
    const price = parseFloat(item.sellingPrice)
    const quantity = serialIds.length

    // Serial-tracked items always add as a new line (never combine)
    setCart(prev => [...prev, {
      cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      itemId: item.id,
      name: formatItemLabel(item, company.businessType),
      quantity,
      unitPrice: price,
      total: quantity * price,
      taxTemplateId: item.taxTemplateId || null,
      serialNumberIds: serialIds,
    }])
    setSerialPickerItem(null)
  }

  function addToCartDirect(item: Item) {
    const price = parseFloat(item.sellingPrice)
    const stock = parseFloat(item.availableStock)

    if (isReturnMode) {
      setCart(prev => {
        const existing = prev.find(c => c.itemId === item.id && c.unitPrice === price)
        if (existing) {
          return prev.map(c =>
            c.cartLineId === existing.cartLineId
              ? { ...c, quantity: c.quantity - 1, total: (c.quantity - 1) * c.unitPrice }
              : c
          )
        } else {
          toast.success(`${item.name} added for return`)
          return [...prev, {
            cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            itemId: item.id,
            name: formatItemLabel(item, company.businessType),
            quantity: -1,
            unitPrice: price,
            total: -price,
          }]
        }
      })
      return
    }

    if (item.trackStock && stock <= 0) {
      toast.error('This item is out of stock')
      return
    }

    setCart(prev => {
      const existing = prev.find(c => c.itemId === item.id && c.unitPrice === price)
      const totalInCart = prev.filter(c => c.itemId === item.id).reduce((sum, c) => sum + c.quantity, 0)

      if (item.trackStock && totalInCart >= stock) {
        toast.warning('Not enough stock available')
        return prev
      }

      if (existing) {
        return prev.map(c =>
          c.cartLineId === existing.cartLineId
            ? { ...c, quantity: c.quantity + 1, total: (c.quantity + 1) * c.unitPrice }
            : c
        )
      } else {
        return [...prev, {
          cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          itemId: item.id,
          name: formatItemLabel(item, company.businessType),
          quantity: 1,
          unitPrice: price,
          total: price,
          taxTemplateId: item.taxTemplateId || null,
        }]
      }
    })
  }

  function updateQuantity(cartLineId: string, delta: number) {
    const cartItem = cart.find(c => c.cartLineId === cartLineId)
    if (!cartItem) return

    // Serial-tracked items cannot change quantity (must remove and re-add)
    if (cartItem.serialNumberIds?.length) {
      toast.warning('Remove and re-add to change serial number selection')
      return
    }

    const item = items.find(i => i.id === cartItem.itemId)
    if (!item && !isReturnMode) return

    const newQty = cartItem.quantity + delta
    if (isReturnMode) {
      if (newQty === 0) { removeFromCart(cartLineId); return }
      if (cartItem.maxReturnQuantity !== undefined && (newQty > 0 || Math.abs(newQty) > cartItem.maxReturnQuantity)) {
        toast.warning(`Only ${cartItem.maxReturnQuantity} returnable on this invoice line`)
        return
      }
    } else {
      if (newQty <= 0) return
    }

    if (!isReturnMode && item && item.trackStock) {
      const totalInCart = cart.filter(c => c.itemId === cartItem.itemId).reduce((sum, c) => sum + c.quantity, 0)
      const availableStock = parseFloat(item.availableStock)
      if (totalInCart + delta > availableStock) {
        toast.warning('Not enough stock available')
        return
      }
    }

    setCart(cart.map(c =>
      c.cartLineId === cartLineId
        ? { ...c, quantity: newQty, total: newQty * c.unitPrice }
        : c
    ))
  }

  function removeFromCart(cartLineId: string) {
    setCart(cart.filter(c => c.cartLineId !== cartLineId))
  }

  function applyPrice(cartLineId: string, newPrice: number) {
    setCart(prev => prev.map(c =>
      c.cartLineId === cartLineId
        ? { ...c, unitPrice: newPrice, total: c.quantity * newPrice }
        : c
    ))
  }

  function updatePrice(cartLineId: string, newPrice: number) {
    if (isNaN(newPrice) || newPrice <= 0) {
      toast.error('Price must be greater than zero')
      return
    }
    // Counter profile forbids rate changes → a supervisor must approve
    if (posProfile?.allowRateChange === false) {
      const line = cart.find(c => c.cartLineId === cartLineId)
      if (line && line.unitPrice !== newPrice) {
        setSupervisorRequest({ type: 'price_override', cartLineId, newPrice, itemName: line.name, originalPrice: line.unitPrice })
      }
      return
    }
    setCart(cart.map(c =>
      c.cartLineId === cartLineId
        ? { ...c, unitPrice: newPrice, total: c.quantity * newPrice }
        : c
    ))
  }

  function setQuantityDirectly(cartLineId: string, newQty: number) {
    if (newQty === 0) { removeFromCart(cartLineId); return }
    setCart(cart.map(c =>
      c.cartLineId === cartLineId
        ? { ...c, quantity: newQty, total: newQty * c.unitPrice }
        : c
    ))
  }

  function clearCart() {
    newClientSaleId()
    setCart([])
    setSelectedCustomer(null)
    setSelectedVehicle(null)
    setIsReturnMode(false)
    setReturnAgainstSale(null)
    setExchangeFrom(null)
    setSaleDiscount({ type: 'percentage', value: 0, reason: '' })
    setLoyaltyPointsToRedeem('')
    setShowLoyaltyRedeem(false)
    setRestaurantOrderId(null)
    setSelectedTableId(null)
    setTipAmount(0)
    setGiftCardNumber('')
    setGiftCardInfo(null)
  }

  // ─── Restaurant Functions ───────────────────────────────────

  async function handleTableSelect(tableId: string) {
    if (!config.showTableSelector) return

    // If already selected, deselect
    if (tableId === selectedTableId) {
      setSelectedTableId(null)
      return
    }

    setSelectedTableId(tableId)

    // Auto-create restaurant order when table is selected (dine_in)
    if (orderType === 'dine_in' && !restaurantOrderId) {
      try {
        const res = await fetch('/api/restaurant-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId,
            customerId: selectedCustomer?.id,
            orderType: 'dine_in',
          }),
        })
        if (res.ok) {
          const order = await res.json()
          setRestaurantOrderId(order.id)
          toast.success(`Table assigned — Order ${order.orderNo}`)
          fetchTables() // Refresh table statuses
        } else {
          const error = await res.json()
          toast.error(error.error || 'Failed to create order')
          setSelectedTableId(null)
        }
      } catch (error) {
        console.error('Error creating restaurant order:', error)
        toast.error('Failed to create order')
        setSelectedTableId(null)
      }
    }
  }

  async function ensureRestaurantOrder(): Promise<string | null> {
    if (restaurantOrderId) return restaurantOrderId

    // For takeaway/delivery, create order on first item add
    if (!config.showTableSelector) return null

    try {
      const body: Record<string, unknown> = {
        orderType,
        customerId: selectedCustomer?.id,
      }
      if (orderType === 'dine_in' && selectedTableId) {
        body.tableId = selectedTableId
      }

      const res = await fetch('/api/restaurant-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const order = await res.json()
        setRestaurantOrderId(order.id)
        return order.id
      }
    } catch (error) {
      console.error('Error creating restaurant order:', error)
    }
    return null
  }

  async function sendItemToRestaurantOrder(item: Item, modifiers: SelectedModifier[], unitPrice: number) {
    const orderId = await ensureRestaurantOrder()
    if (!orderId) return

    try {
      await fetch(`/api/restaurant-orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          itemName: item.name,
          quantity: 1,
          unitPrice,
          modifiers: modifiers.length > 0 ? modifiers : undefined,
        }),
      })
    } catch (error) {
      console.error('Error adding item to restaurant order:', error)
    }
  }

  async function handleSendToKitchen() {
    if (!restaurantOrderId || cart.length === 0) return
    toast.success('Items sent to kitchen')
  }

  // ─── Held Sales Functions ─────────────────────────────────────

  async function holdSale() {
    if (cart.length === 0) return
    setHoldingInProgress(true)
    try {
      const res = await fetch('/api/held-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer?.id,
          vehicleId: selectedVehicle?.id,
          warehouseId: posWarehouse?.id,
          cartItems: cart,
          subtotal,
        }),
      })
      if (res.ok) {
        const held = await res.json()
        toast.success(`Sale held as ${held.holdNumber}`)
        clearCart()
        fetchHeldSales()
      } else {
        const error = await res.json()
        toast.error(error.error || 'Failed to hold sale')
      }
    } catch (error) {
      console.error('Error holding sale:', error)
      toast.error('Failed to hold sale')
    } finally {
      setHoldingInProgress(false)
    }
  }

  function recallHeldSale(heldSale: HeldSale) {
    if (cart.length > 0) {
      setRecallConfirm({ open: true, heldSale })
      return
    }
    performRecallHeldSale(heldSale)
  }

  async function performRecallHeldSale(heldSale: HeldSale) {
    const validCartItems: CartItem[] = []
    const invalidItems: string[] = []
    const outOfStockItems: string[] = []

    for (const cartItem of heldSale.cartItems) {
      const item = items.find(i => i.id === cartItem.itemId)
      if (!item) {
        invalidItems.push(cartItem.name)
      } else {
        // Add back this held sale's reserved qty since it will be released on recall
        const availableStock = parseFloat(item.availableStock) + (item.trackStock ? cartItem.quantity : 0)
        if (item.trackStock && availableStock <= 0) {
          outOfStockItems.push(cartItem.name)
        } else {
          const adjustedQty = item.trackStock ? Math.min(cartItem.quantity, availableStock) : cartItem.quantity
          validCartItems.push({
            cartLineId: cartItem.cartLineId || `${cartItem.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            itemId: cartItem.itemId,
            name: cartItem.name,
            quantity: adjustedQty,
            unitPrice: cartItem.unitPrice,
            total: adjustedQty * cartItem.unitPrice,
          })
          if (item.trackStock && adjustedQty < cartItem.quantity) {
            toast.warning(`${cartItem.name}: quantity adjusted to ${adjustedQty} (stock limited)`)
          }
        }
      }
    }

    if (invalidItems.length > 0) toast.warning(`Removed items no longer available: ${invalidItems.join(', ')}`)
    if (outOfStockItems.length > 0) toast.warning(`Removed out-of-stock items: ${outOfStockItems.join(', ')}`)

    if (validCartItems.length === 0) {
      toast.error('No valid items to recall. Held sale preserved.')
      setShowHeldSalesModal(false)
      return
    }

    setCart(validCartItems)

    if (heldSale.customerId) {
      const cust = customers.find(c => c.id === heldSale.customerId)
      setSelectedCustomer(cust || null)
      if (!cust) toast.info('Customer no longer exists')
    } else {
      setSelectedCustomer(null)
    }

    if (heldSale.vehicleId) {
      const veh = vehicles.find(v => v.id === heldSale.vehicleId)
      setSelectedVehicle(veh || null)
      if (!veh) toast.info('Vehicle no longer exists')
    } else {
      setSelectedVehicle(null)
    }

    try {
      await fetch(`/api/held-sales/${heldSale.id}`, { method: 'DELETE' })
      fetchHeldSales()
    } catch (error) {
      console.error('Error deleting held sale:', error)
    }

    setShowHeldSalesModal(false)
    toast.success(`Recalled ${heldSale.holdNumber}`)
  }

  function deleteHeldSale(id: string) {
    setDeleteHeldConfirm({ open: true, id })
  }

  async function performDeleteHeldSale() {
    if (!deleteHeldConfirm.id) return
    try {
      const res = await fetch(`/api/held-sales/${deleteHeldConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Held sale deleted')
        fetchHeldSales()
      }
    } catch (error) {
      console.error('Error deleting held sale:', error)
      toast.error('Failed to delete held sale')
    } finally {
      setDeleteHeldConfirm({ open: false, id: null })
    }
  }

  // ─── Return Functions ─────────────────────────────────────────

  async function loadSaleForReturn(listed: SaleForReturn) {
    // Always refresh through the lookup endpoint: remaining quantities + server refund prices
    let sale: SaleForReturn = listed
    try {
      const res = await fetch(`/api/sales/lookup?code=${encodeURIComponent(listed.invoiceNo)}`)
      if (res.ok) {
        const found = await res.json()
        if (found?.sale) sale = found.sale
      }
    } catch {
      // fall back to the listed sale (server still validates everything)
    }

    // Filter out gift card items — they are non-returnable — and fully returned lines
    const giftCount = sale.items.filter(item => item.isGiftCard || item.item?.isGiftCard).length
    const returnableItems = sale.items.filter(item =>
      !(item.isGiftCard || item.item?.isGiftCard)
      && parseFloat(item.quantity) > 0
      && (item.remainingQuantity === undefined || item.remainingQuantity > 0))

    if (returnableItems.length === 0) {
      toast.error(giftCount > 0 && giftCount === sale.items.length
        ? 'This sale contains only gift card items which cannot be returned'
        : `Invoice ${sale.invoiceNo} has already been fully returned`)
      return
    }

    setCart([])
    setIsReturnMode(true)
    setReturnAgainstSale(sale)
    if (sale.customer) setSelectedCustomer(sale.customer)

    if (giftCount > 0) {
      toast.warning(`${giftCount} gift card item(s) excluded from return — gift cards are non-returnable`)
    }

    const returnItems: CartItem[] = []
    for (const item of returnableItems) {
      const remaining = item.remainingQuantity ?? Math.abs(parseFloat(item.quantity))
      // Unit refund incl. tax after discounts (server-computed); legacy fallback: line average
      const unitPrice = item.refundUnitAmount ?? (Math.abs(parseFloat(item.total)) / Math.abs(parseFloat(item.quantity) || 1))
      const serialIds = item.remainingSerialNumberIds ?? (item.serialNumberIds as string[] | undefined) ?? []
      if (serialIds.length) {
        // Serial-tracked: one cart line per serial still on the invoice
        for (let i = 0; i < Math.min(serialIds.length, remaining); i++) {
          returnItems.push({
            cartLineId: `return-${item.id}-${Date.now()}-${i}`,
            itemId: item.itemId ?? '',
            name: item.itemName,
            quantity: -1,
            unitPrice,
            total: -unitPrice,
            serialNumberIds: [serialIds[i]],
            originalSaleItemId: item.id,
            maxReturnQuantity: 1,
          })
        }
      } else {
        returnItems.push({
          cartLineId: `return-${item.id}-${Date.now()}-0`,
          itemId: item.itemId ?? '',
          name: item.itemName,
          quantity: -remaining,
          unitPrice,
          total: -Math.round(remaining * unitPrice * 100) / 100,
          originalSaleItemId: item.id,
          maxReturnQuantity: remaining,
        })
      }
    }

    setCart(returnItems)
    setShowReturnLookupModal(false)
    setReturnSearchQuery('')
    setReturnSearchResults([])
    toast.info(`Loaded invoice ${sale.invoiceNo} for return`)
  }

  /** Exchange: keep the selected return lines as credit and sell new items against it. */
  function startExchange() {
    if (!isReturnMode || !returnAgainstSale) return
    const lines = cart.filter(l => l.originalSaleItemId && l.quantity !== 0)
    if (lines.length === 0) {
      toast.error('Select the items being returned first')
      return
    }
    const byLine = new Map<string, { quantity: number; serialNumberIds: string[] }>()
    for (const l of lines) {
      const cur = byLine.get(l.originalSaleItemId!) || { quantity: 0, serialNumberIds: [] }
      cur.quantity += Math.abs(l.quantity)
      cur.serialNumberIds.push(...(l.serialNumberIds || []))
      byLine.set(l.originalSaleItemId!, cur)
    }
    setExchangeFrom({
      sale: returnAgainstSale,
      returnLines: [...byLine.entries()].map(([originalSaleItemId, v]) => ({
        originalSaleItemId, quantity: v.quantity, serialNumberIds: v.serialNumberIds.length ? v.serialNumberIds : undefined,
      })),
      credit: Math.round(Math.abs(lines.reduce((sum, l) => sum + l.total, 0)) * 100) / 100,
    })
    setCart([])
    setIsReturnMode(false)
    setReturnAgainstSale(null)
    toast.info('Exchange: add the replacement items, then take payment for the difference')
  }

  async function completeExchange() {
    if (!exchangeFrom) return
    setProcessing(true)
    try {
      const res = await fetch('/api/sales/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalSaleId: exchangeFrom.sale.id,
          returnLines: exchangeFrom.returnLines,
          newCartItems: cart.map(c => ({
            itemId: c.itemId, name: c.name, quantity: c.quantity, unitPrice: c.unitPrice,
            discount: 0, serialNumberIds: c.serialNumberIds,
          })),
          paymentMethod: ['cash', 'card', 'bank_transfer'].includes(paymentMethod) ? paymentMethod : 'cash',
          amountPaid: parseFloat(amountPaid) || 0,
          refundMethod: 'cash',
          warehouseId: posWarehouse?.id,
          posOpeningEntryId: activeShift?.id,
          customerId: selectedCustomer?.id,
          clientSaleId: clientSaleIdRef.current || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to process exchange')
        return
      }
      const diff = Number(data.net?.difference || 0)
      clearCart()
      setShowPayment(false)
      setAmountPaid('')
      setCreditAmount('')
      fetchItems(debouncedItemSearch || undefined, posWarehouse?.id, selectedCategory)
      toast.success(diff >= 0
        ? `Exchange done: ${data.returnSale?.invoiceNo} → ${data.sale?.invoiceNo}, collected ${diff.toFixed(2)}`
        : `Exchange done: ${data.returnSale?.invoiceNo} → ${data.sale?.invoiceNo}, refund ${Math.abs(diff).toFixed(2)}`)
      setLastSale({ invoiceNo: data.sale?.invoiceNo, total: Math.abs(diff), isReturn: diff < 0 })
      setLastSaleId(data.sale?.id)
    } catch (error) {
      console.error('Error processing exchange:', error)
      toast.error('Error processing exchange')
    } finally {
      setProcessing(false)
    }
  }

  function cancelReturnMode() {
    setIsReturnMode(false)
    setReturnAgainstSale(null)
    setCart([])
    setSelectedCustomer(null)
    setSelectedVehicle(null)
  }

  // ─── Vehicle Mismatch Handlers ────────────────────────────────

  function handleVehicleSelect(vehicleId: string) {
    const vehicle = vehicles.find(v => v.id === vehicleId)
    if (!vehicle) {
      setSelectedVehicle(null)
      return
    }
    if (selectedCustomer?.id && vehicle.customerId && vehicle.customerId !== selectedCustomer.id) {
      const owner = customers.find(c => c.id === vehicle.customerId)
      setPendingVehicle(vehicle)
      setMismatchInfo({ vehicleOwnerName: owner?.name || 'another customer', vehicleOwnerId: vehicle.customerId })
      setShowMismatchDialog(true)
    } else {
      setSelectedVehicle(vehicle)
      if (vehicle.customerId && !selectedCustomer) {
        setSelectedCustomer(customers.find(c => c.id === vehicle.customerId) || null)
      }
    }
  }

  // ─── Computed Values ──────────────────────────────────────────

  const subtotal = cart.reduce((sum, item) => sum + item.total, 0)
  const itemCount = cart.reduce((sum, item) => sum + Math.abs(item.quantity), 0)

  const discountAmount = saleDiscount.value > 0
    ? roundCurrency(saleDiscount.type === 'percentage'
      ? (Math.abs(subtotal) * saleDiscount.value) / 100
      : saleDiscount.value)
    : 0
  const afterDiscount = subtotal - (subtotal >= 0 ? discountAmount : -discountAmount)

  const loyaltyRedeemPoints = parseInt(loyaltyPointsToRedeem) || 0
  const loyaltyConversionFactor = loyaltyProgram ? parseFloat(loyaltyProgram.conversionFactor) : 0
  const customerTier = loyaltyProgram?.tiers?.find(t => t.tier === (selectedCustomer?.loyaltyTier || 'bronze') && t.isActive)
  const tierRedeemRate = customerTier ? parseFloat(customerTier.redeemRate) : 1
  const loyaltyRedeemValue = roundCurrency(loyaltyRedeemPoints * loyaltyConversionFactor * tierRedeemRate)

  const isTaxExempt = selectedCustomer?.taxExempt === true

  // Per-item tax calculation using tax templates
  const { tax, saleTaxBreakdown, cartWithTax } = useMemo(() => {
    if (isTaxExempt || isReturnMode || cart.length === 0) {
      return { tax: 0, saleTaxBreakdown: [] as TaxBreakdownItem[], cartWithTax: cart }
    }

    // Proportionally distribute discount across items
    const absSubtotal = Math.abs(subtotal)
    const discRatio = absSubtotal > 0 ? 1 - (discountAmount / absSubtotal) : 1

    let totalTax = 0
    const allBreakdowns: TaxBreakdownItem[][] = []
    const updatedCart = cart.map(item => {
      // Resolve template: item-level → default → null (zero tax)
      const templateId = item.taxTemplateId
      const template = templateId ? taxTemplatesMap.get(templateId) || defaultTaxTemplate : defaultTaxTemplate
      const discountedLineTotal = item.total * discRatio
      const result = calculateItemTax(discountedLineTotal, template, false)
      totalTax += result.totalTax
      if (result.breakdown.length > 0) {
        allBreakdowns.push(result.breakdown)
      }
      return {
        ...item,
        taxRate: result.effectiveRate,
        taxAmount: result.totalTax,
        taxBreakdown: result.breakdown.length > 0 ? result.breakdown : undefined,
        taxTemplateId: template?.id || null,
      }
    })

    return {
      tax: roundCurrency(totalTax),
      saleTaxBreakdown: aggregateTaxBreakdown(allBreakdowns),
      cartWithTax: updatedCart,
    }
  }, [cart, subtotal, discountAmount, isTaxExempt, isReturnMode, taxTemplatesMap, defaultTaxTemplate])

  // Check if any template has inclusive components
  const hasInclusiveTax = useMemo(() => {
    return saleTaxBreakdown.some(b => b.includedInPrice)
  }, [saleTaxBreakdown])

  const total = hasInclusiveTax ? afterDiscount : afterDiscount + tax

  const filteredVehicles = useMemo(() => {
    if (!selectedCustomer?.id) return vehicles
    const customerVehicles = vehicles.filter(v => v.customerId === selectedCustomer.id)
    const otherVehicles = vehicles.filter(v => v.customerId !== selectedCustomer.id)
    return [...customerVehicles, ...otherVehicles]
  }, [vehicles, selectedCustomer?.id])

  // ─── Gift Card Lookup ─────────────────────────────────────────

  async function lookupGiftCard() {
    if (!giftCardNumber.trim() || giftCardLookupLoading) return
    setGiftCardLookupLoading(true)
    setGiftCardInfo(null)
    try {
      const res = await fetch(`/api/gift-cards/lookup?cardNumber=${encodeURIComponent(giftCardNumber.trim())}`)
      if (res.ok) {
        const data = await res.json()
        const info: GiftCardInfo = {
          id: data.id,
          cardNumber: data.cardNumber,
          currentBalance: parseFloat(data.currentBalance) || 0,
          status: data.status,
          expiryDate: data.expiryDate,
          customerName: data.customerName,
        }
        setGiftCardInfo(info)
        // Auto-fill amount with min(balance, payableTotal)
        const tip = config.enableTips ? tipAmount : 0
        const payableTotal = Math.max(0, total - loyaltyRedeemValue + tip)
        const creditUsed = parseFloat(creditAmount) || 0
        const remaining = Math.max(0, payableTotal - creditUsed)
        if (info.status === 'active') {
          setAmountPaid(Math.min(info.currentBalance, remaining).toFixed(2))
        }
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Gift card not found')
      }
    } catch {
      toast.error('Failed to look up gift card')
    } finally {
      setGiftCardLookupLoading(false)
    }
  }

  function handlePaymentMethodChange(method: string) {
    setPaymentMethod(method)
    // Clear gift card state when switching away from gift_card
    if (method !== 'gift_card') {
      setGiftCardNumber('')
      setGiftCardInfo(null)
    }
  }

  // ─── Payment / Sale Completion ────────────────────────────────

  // ─── Supervisor PIN override ───────────────────────────────────
  async function authorizeSupervisor(pin: string, reason: string): Promise<boolean> {
    if (!supervisorRequest) return false
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, scope: 'supervisor', permission: 'manageSales', reason }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 429) throw new Error(data.error || 'Too many attempts')
    if (!res.ok || !data.ok) return false
    const approver: string = data.user?.name || 'Supervisor'
    if (supervisorRequest.type === 'custom_discount') {
      const d = supervisorRequest.discount
      setSaleDiscount({ ...d, reason: `${d.reason} — approved by ${approver}` })
    } else if (supervisorRequest.type === 'price_override') {
      applyPrice(supervisorRequest.cartLineId, supervisorRequest.newPrice)
    } else if (supervisorRequest.type === 'cart_void') {
      clearCart()
    }
    toast.success(`Approved by ${approver}`)
    setSupervisorRequest(null)
    return true
  }

  // ─── Terminal lock (F8 / idle) ────────────────────────────────
  async function unlockTerminal(pin: string): Promise<boolean> {
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, scope: 'self' }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 400 || res.status === 429) throw new Error(data.error || 'PIN check failed')
    if (!res.ok || !data.ok) return false
    setTerminalLocked(false)
    lastActivityRef.current = Date.now()
    return true
  }

  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now() }
    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'touchstart', 'wheel']
    events.forEach(ev => window.addEventListener(ev, bump, { passive: true }))
    const timer = window.setInterval(() => {
      if (!activeShift || terminalLocked) return
      let minutes = 10
      try { minutes = parseInt(localStorage.getItem('poslanka:pos-lock-minutes') || '10', 10) || 10 } catch { /* ignore */ }
      if (minutes > 0 && Date.now() - lastActivityRef.current > minutes * 60_000) setTerminalLocked(true)
    }, 15_000)
    return () => {
      events.forEach(ev => window.removeEventListener(ev, bump))
      window.clearInterval(timer)
    }
  }, [activeShift, terminalLocked])

  // ─── Scan fast path: Enter in the search box = immediate exact lookup ──
  function focusSearch() {
    const el = document.getElementById(POS_SEARCH_INPUT_ID) as HTMLInputElement | null
    if (el) { el.focus(); el.select() }
  }

  async function handleScanSubmit(code: string): Promise<boolean> {
    const trimmed = code.trim()
    if (!trimmed) return false
    // Receipt barcode (INV-/RTN-/OFF-) → open the return lookup with that sale
    if (RECEIPT_CODE_RE.test(trimmed)) {
      setSearch('')
      setReturnSearchQuery(trimmed.toUpperCase())
      setShowReturnLookupModal(true)
      return true
    }
    if (posWarehouse) {
      try {
        const res = await fetch(`/api/items/barcode-lookup?barcode=${encodeURIComponent(trimmed)}&warehouseId=${posWarehouse.id}`)
        if (res.ok) {
          const item: Item = await res.json()
          addScannedItem(item)
          setSearch('')
          return true
        }
      } catch {
        // fall through to local matching
      }
    }
    const q = trimmed.toLowerCase()
    const exact = items.filter(i => i.barcode === trimmed || i.pluCode === trimmed || (i.sku || '').toLowerCase() === q)
    const candidates = exact.length > 0
      ? exact
      : items.filter(i => i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q) || (i.barcode || '').includes(trimmed))
    if (candidates.length === 1) {
      addToCart(candidates[0])
      setSearch('')
      return true
    }
    if (candidates.length === 0) toast.error(`No item found for "${trimmed}"`)
    return false
  }

  // ─── Keyboard shortcuts ────────────────────────────────────────
  useEffect(() => {
    const isTyping = (el: Element | null) =>
      !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)
    const modalOpen = showPayment || showDiscountModal || showHeldSalesModal || showCustomerModal || showVehicleModal
      || showShiftOpenModal || showShiftCloseModal || showReturnLookupModal || !!supervisorRequest || clearCartConfirm

    function onKey(e: KeyboardEvent) {
      if (terminalLocked) return
      switch (e.key) {
        case 'F1':
          e.preventDefault(); focusSearch(); break
        case 'F2':
          e.preventDefault(); if (!modalOpen && cart.length > 0 && !holdingInProgress) holdSale(); break
        case 'F3':
          e.preventDefault(); if (!modalOpen) setShowHeldSalesModal(true); break
        case 'F4':
          e.preventDefault(); if (!modalOpen && allowDiscount && cart.length > 0) setShowDiscountModal(true); break
        case 'F6':
          e.preventDefault(); if (!modalOpen) { if (cart.length > 0) setReturnModeConfirm(true); else setShowReturnLookupModal(true) } break
        case 'F8':
          e.preventDefault(); if (activeShift) setTerminalLocked(true); break
        case 'F9':
          e.preventDefault(); if (!modalOpen && cart.length > 0 && activeShift) openPaymentModal(); break
        case 'Escape':
          if (!modalOpen && search) { setSearch(''); focusSearch() } break
        case 'Delete':
          if (e.ctrlKey && !modalOpen && cart.length > 0) { e.preventDefault(); setClearCartConfirm(true) } break
        case '/':
          if (!isTyping(document.activeElement)) { e.preventDefault(); focusSearch() } break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPayment, showDiscountModal, showHeldSalesModal, showCustomerModal, showVehicleModal, showShiftOpenModal, showShiftCloseModal,
      showReturnLookupModal, supervisorRequest, clearCartConfirm, terminalLocked, cart.length, holdingInProgress, allowDiscount, activeShift, search])

  // ─── Customer-facing display mirror (/pos/display) ─────────────
  useEffect(() => {
    if (lastSale) {
      publishPosDisplay({
        ...createIdlePosDisplayState(company.tenantName, cashierName),
        status: 'paid',
        total: lastSale.total,
        invoiceNo: lastSale.invoiceNo,
        changeDue: paymentMethod === 'cash' ? Math.max(0, (parseFloat(amountPaid) || 0) - lastSale.total) : undefined,
      })
      return
    }
    if (cart.length === 0) {
      publishPosDisplay(createIdlePosDisplayState(company.tenantName, cashierName))
      return
    }
    publishPosDisplay({
      tenantName: company.tenantName,
      cashierName,
      items: cart.map(c => ({ id: c.cartLineId, name: c.name, quantity: c.quantity, unitPrice: c.unitPrice, total: c.total })),
      subtotal,
      discount: discountAmount,
      tax,
      total,
      status: showPayment ? 'paying' : 'cart',
      updatedAt: new Date().toISOString(),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, subtotal, discountAmount, tax, total, showPayment, lastSale, company.tenantName, cashierName])

  async function openPaymentModal() {
    let credit = 0
    if (selectedCustomer?.id) {
      try {
        const res = await fetch(`/api/customers/${selectedCustomer.id}/credit`)
        if (res.ok) {
          const data = await res.json()
          credit = parseFloat(data.balance) || 0
        }
      } catch (error) {
        console.error('Error fetching customer credit:', error)
      }
    }
    setCustomerCredit(credit)
    const tip = config.enableTips ? tipAmount : 0
    const payableTotal = Math.max(0, total - loyaltyRedeemValue + tip - (exchangeFrom?.credit || 0))
    setAmountPaid(payableTotal.toFixed(2))
    setCreditAmount('')
    setShowPayment(true)
  }

  async function completeSale() {
    if (cart.length === 0 || processing) return

    // Validate cost center
    if (hasCostCenters && !posProfile?.costCenterId) {
      toast.error('Cost Center is required. Please configure a Cost Center in your POS Profile settings.')
      return
    }

    if (exchangeFrom) {
      await completeExchange()
      return
    }

    if (isReturnMode) {
      // Returns without an invoice need a reason (server rejects them otherwise)
      let returnReason: string | undefined
      if (!returnAgainstSale) {
        const reason = window.prompt('Reason for return without receipt')?.trim()
        if (!reason) {
          toast.error('A reason is required for a return without a receipt')
          return
        }
        returnReason = reason.slice(0, 50)
      }
      setProcessing(true)
      try {
        const res = await fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: selectedCustomer?.id,
            warehouseId: posWarehouse?.id,
            costCenterId: posProfile?.costCenterId || null,
            posOpeningEntryId: activeShift?.id,
            cartItems: cart,
            paymentMethod: refundMethod,
            subtotal,
            discount: discountAmount,
            tax,
            total,
            amountPaid: 0,
            creditAmount: 0,
            addOverpaymentToCredit: refundMethod === 'credit',
            clientSaleId: clientSaleIdRef.current || undefined,
            isReturn: true,
            returnAgainst: returnAgainstSale?.id,
            // refund is priced by the server from the original invoice; it answers with refundAmount
            refundMethod,
            returnReason,
          }),
        })

        if (res.ok) {
          const sale = await res.json()
          clearCart()
          setShowPayment(false)
          setAmountPaid('')
          setCreditAmount('')
          fetchItems(debouncedItemSearch || undefined, posWarehouse?.id, selectedCategory)
          setLastSale({ invoiceNo: sale.invoiceNo, total: Number(sale.refundAmount ?? Math.abs(Number(sale.total))), isReturn: true })
          setLastSaleId(sale.id)
        } else {
          const error = await res.json()
          toast.error(error.error || 'Failed to process return')
        }
      } catch (error) {
        console.error('Error processing return:', error)
        toast.error('Error processing return')
      } finally {
        setProcessing(false)
      }
      return
    }

    // Credit sales require a customer (need to know who owes the money)
    if (paymentMethod === 'credit' && !selectedCustomer) {
      toast.error('Please select a customer for credit sales')
      return
    }

    const creditVal = parseFloat(creditAmount) || 0
    const amountVal = parseFloat(amountPaid) || 0
    if (creditVal < 0 || amountVal < 0) {
      toast.error('Amounts cannot be negative')
      return
    }
    if (creditVal > customerCredit) {
      toast.error('Credit amount exceeds available balance')
      return
    }
    const tip = config.enableTips ? tipAmount : 0
    const payableTotal = Math.max(0, total - loyaltyRedeemValue + tip)
    if (creditVal > payableTotal) {
      toast.error('Credit amount cannot exceed total')
      return
    }

    const creditUsed = creditVal
    const remainingAfterCredit = Math.max(0, payableTotal - creditUsed)
    const cashCardPaid = amountVal
    // Credit payment = sell on credit (no money received now), so amountPaid must be 0
    const effectiveCashCardPaid = paymentMethod === 'credit' ? 0 : (paymentMethod === 'cash' ? cashCardPaid : Math.min(cashCardPaid, remainingAfterCredit))

    const saleTotal = Math.max(0, total - loyaltyRedeemValue + tip)
    const secondAmt = splitEnabled ? (parseFloat(splitSecondAmount) || 0) : 0
    const firstAmt = splitEnabled
      ? Math.max(0, saleTotal - creditUsed - secondAmt)
      : effectiveCashCardPaid
    const paymentSplits =
      splitEnabled && secondAmt > 0
        ? [
            { method: paymentMethod, amount: firstAmt },
            { method: splitSecondMethod, amount: secondAmt },
          ].filter((s) => s.amount > 0)
        : undefined

    const salePayload = {
      clientSaleId: clientSaleIdRef.current || undefined,
      customerId: selectedCustomer?.id,
      vehicleId: selectedVehicle?.id,
      warehouseId: posWarehouse?.id,
      costCenterId: posProfile?.costCenterId || null,
      posOpeningEntryId: activeShift?.id,
      customerName: selectedCustomer?.name,
      vehiclePlate: selectedVehicle?.licensePlate,
      vehicleDescription: selectedVehicle
        ? `${selectedVehicle.year ? `${selectedVehicle.year} ` : ''}${selectedVehicle.make} ${selectedVehicle.model}`
        : undefined,
      cartItems: cartWithTax,
      paymentMethod,
      paymentSplits,
      subtotal,
      discount: discountAmount,
      discountType: saleDiscount.value > 0 ? saleDiscount.type : undefined,
      discountReason: saleDiscount.value > 0 ? saleDiscount.reason : undefined,
      tax,
      taxBreakdown: saleTaxBreakdown.length > 0 ? saleTaxBreakdown : undefined,
      total: saleTotal,
      amountPaid: splitEnabled ? firstAmt + secondAmt : effectiveCashCardPaid,
      creditAmount: creditUsed,
      addOverpaymentToCredit: false,
      loyaltyPointsRedeemed: loyaltyRedeemPoints > 0 ? loyaltyRedeemPoints : undefined,
      loyaltyRedeemValue: loyaltyRedeemValue > 0 ? loyaltyRedeemValue : undefined,
      restaurantOrderId: restaurantOrderId || undefined,
      tipAmount: tip > 0 ? tip : undefined,
      giftCardId: paymentMethod === 'gift_card' && giftCardInfo ? giftCardInfo.id : undefined,
    }

    setProcessing(true)
    try {
      if (!online) {
        await queueSale(salePayload as Record<string, unknown>)
        clearCart()
        setShowPayment(false)
        setAmountPaid('')
        setCreditAmount('')
        setSplitEnabled(false)
        setSplitSecondAmount('')
        toast.success('Sale queued offline — will sync when online')
        return
      }

      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(salePayload),
      })

      if (res.ok) {
        const sale = await res.json()

        // Complete restaurant order with skipSaleCreation (POS handles payment)
        if (restaurantOrderId) {
          fetch(`/api/restaurant-orders/${restaurantOrderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'completed',
              skipSaleCreation: true,
              saleId: sale.id,
              tipAmount: tip > 0 ? String(tip) : undefined,
            }),
          }).catch(console.error)
        }

        if (posProfile?.printReceiptOnComplete && sale.id) {
          printReceiptForSale(sale.id)
        }

        if (selectedCustomer?.id && loyaltyProgram) {
          fetchCustomers()
        }

        clearCart()
        setShowPayment(false)
        setAmountPaid('')
        setCreditAmount('')
        setSplitEnabled(false)
        setSplitSecondAmount('')
        fetchItems(debouncedItemSearch || undefined, posWarehouse?.id, selectedCategory)
        setLastSale({ invoiceNo: sale.invoiceNo, total: saleTotal, isReturn: false })
        setLastSaleId(sale.id)
        // Show generated gift card numbers
        if (sale.generatedGiftCards?.length) {
          const cards = sale.generatedGiftCards as { cardNumber: string; balance: number }[]
          for (const card of cards) {
            toast.success(`Gift Card Created: ${card.cardNumber} — Balance: ${currencyCode} ${card.balance.toFixed(2)}`)
          }
        }
      } else {
        const error = await res.json()
        toast.error(error.error || 'Failed to complete sale')
      }
    } catch (error) {
      console.error('Error completing sale:', error)
      try {
        await queueSale(salePayload as Record<string, unknown>)
        clearCart()
        setShowPayment(false)
        setAmountPaid('')
        setCreditAmount('')
        setSplitEnabled(false)
        setSplitSecondAmount('')
        toast.success('Network error — sale queued offline')
      } catch {
        toast.error('Error completing sale')
      }
    } finally {
      setProcessing(false)
    }
  }

  // ─── Receipt Printing ─────────────────────────────────────────

  async function printReceiptForSale(saleId: string) {
    // Direct ESC/POS printing (USB / Bluetooth / print agent). Falls back to the HTML path below on failure.
    if (printer.isRawPrinter) {
      const printed = await printer.printReceipt(saleId, {
        posProfile: posProfile || null,
        cashier: cashierName || null,
        counter: posProfile?.name || null,
      })
      if (printed) {
        setLastSale(null)
        setLastSaleId(null)
        return
      }
      toast.warning(printer.status.message ? `Printer: ${printer.status.message}. Using browser print.` : 'Printer unavailable, using browser print')
    }
    try {
      // Shared receipt model -> branded HTML (logo, business profile, invoice barcode / QR).
      const { model } = await loadReceiptModel(saleId, {
        posProfile: posProfile || null,
        cashier: cashierName || null,
        counter: posProfile?.name || null,
      })
      const paperWidth: 58 | 80 = posProfile?.receiptPrintFormat === '58mm' ? 58 : 80
      const logo = model.logo.show ? await fetchLogoRaster(paperWidth === 58 ? 384 : 576, model.logo.widthPct, model.logo.url) : null
      const html = await renderReceiptHtml(model, paperWidth, {
        logoSrc: logo?.pngBase64 ? `data:image/png;base64,${logo.pngBase64}` : model.logo.url,
      })

      // Map POS profile receiptPrintFormat to PaperSize key
      const formatMap: Record<string, PaperSize> = {
        '58mm': 'thermal_58mm',
        '80mm': 'thermal_80mm',
        'A4': 'a4',
      }
      const paperSize = posProfile?.receiptPrintFormat
        ? formatMap[posProfile.receiptPrintFormat]
        : undefined

      await quickPrint('receipt', `Receipt-${model.invoiceNo}`, html, { paperSize })

      // Auto-close success modal after print dialog closes
      setLastSale(null)
      setLastSaleId(null)
    } catch (error) {
      console.error('Error printing receipt:', error)
      toast.error('Failed to print receipt')
    }
  }

  // ─── Loading States ───────────────────────────────────────────

  if (config.redirectToDealPipeline) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (shiftLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto" />
          <p className="text-gray-500 mt-4 font-medium">Loading POS...</p>
        </div>
      </div>
    )
  }

  if (loading && items.length === 0 && activeShift) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner size="xl" text="Loading POS..." />
      </div>
    )
  }

  if (!shiftLoading && !activeShift) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 m-4 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Clock size={40} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Start Your Shift</h2>
          <p className="text-gray-500 mt-2 mb-6">Open a shift to start making sales</p>

          <button
            onClick={() => setShowShiftOpenModal(true)}
            className="w-full py-4 bg-gradient-to-r from-green-600 to-green-500 text-white rounded-2xl font-bold text-lg shadow-lg hover:from-green-700 hover:to-green-600 transition-all"
          >
            Open Shift
          </button>

          <ShiftOpenModal
            isOpen={showShiftOpenModal}
            onClose={() => setShowShiftOpenModal(false)}
            onShiftOpened={(shift) => {
              setActiveShift(shift)
              setShowShiftOpenModal(false)
            }}
          />
        </div>
      </div>
    )
  }

  // ─── Main Render ──────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] bg-gray-100 -m-5 overflow-hidden font-sans">
      <OfflineStatusBanner />
      {exchangeFrom && (
        <div className="w-full bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-sm shrink-0">
          <span className="text-amber-900">
            Exchange for <span className="font-semibold">{exchangeFrom.sale.invoiceNo}</span> — credit{' '}
            <span className="font-mono font-semibold">{exchangeFrom.credit.toFixed(2)}</span>
            {cart.length > 0 && (
              <> · {total - exchangeFrom.credit >= 0 ? 'to collect' : 'to refund'}{' '}
                <span className="font-mono font-semibold">{Math.abs(total - exchangeFrom.credit).toFixed(2)}</span></>
            )}
          </span>
          <button
            type="button"
            onClick={() => { setExchangeFrom(null); toast.info('Exchange cancelled') }}
            className="text-amber-800 hover:text-amber-950 underline text-xs"
          >
            Cancel exchange
          </button>
        </div>
      )}
      {/* Stitch "Operational Velocity" Operational Context Bar */}
      <div className="w-full bg-slate-900 text-slate-300 px-4 py-1.5 flex items-center justify-between text-xs font-mono border-b border-slate-800 shrink-0 select-none">
        <div className="flex items-center gap-2.5">
          <span className="font-extrabold text-white uppercase tracking-wider">{company.tenantName || 'POSLanka'}</span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-300">{posWarehouse?.name || 'No branch'}</span>
          <span className="text-slate-600">•</span>
          <span className="text-teal-400 font-bold">{posProfile?.name || 'No counter'}</span>
          {cashierName && (<>
            <span className="text-slate-600">•</span>
            <span className="text-slate-300">{cashierName}</span>
          </>)}
          <span className="text-slate-600">•</span>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-bold border ${online ? 'bg-emerald-950 text-emerald-400 border-emerald-800/80' : 'bg-red-950 text-red-300 border-red-800/80'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-bold">
            {activeShift ? `Shift ${activeShift.entryNumber}` : 'No open shift'}
          </span>
          <span className="text-slate-600 hidden xl:inline">•</span>
          <span className="text-slate-500 hidden xl:inline" title="Keyboard shortcuts">
            F1 Search · F2 Hold · F3 Held · F4 Discount · F6 Return · F8 Lock · F9 Pay · Enter Scan
          </span>
          <button
            type="button"
            onClick={() => setShowCameraScan(true)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700"
            title="Scan barcode with camera"
          >
            Camera
          </button>
          <button
            type="button"
            onClick={() => setShowPrinterSettings(true)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700"
            title={`Printer: ${printer.transportLabel}${printer.deviceName ? ` (${printer.deviceName})` : ''}`}
          >
            Printer: {printer.transportLabel}
          </button>
          {activeShift && (
            <button
              type="button"
              onClick={() => setTerminalLocked(true)}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700"
              title="Lock terminal (F8)"
            >
              Lock
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
      <ProductGrid
        items={items}
        categories={categories}
        search={search}
        onSearchChange={setSearch}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        onAddToCart={addToCart}
        isReturnMode={isReturnMode}
        searchingItems={searchingItems}
        hasMoreItems={hasMoreItems}
        activeShift={activeShift}
        posWarehouseName={posWarehouse?.name || null}
        onOpenShift={() => setShowShiftOpenModal(true)}
        onCloseShift={() => setShowShiftCloseModal(true)}
        onOpenReturnLookup={() => setShowReturnLookupModal(true)}
        cartHasItems={cart.length > 0}
        onReturnModeConfirm={() => setReturnModeConfirm(true)}
        config={config}
        businessType={company.businessType}
        onScanSubmit={handleScanSubmit}
      />

      <CartPanel
        cart={cart}
        isReturnMode={isReturnMode}
        returnAgainstSale={returnAgainstSale}
        config={config}
        selectedCustomer={selectedCustomer}
        selectedVehicle={selectedVehicle}
        customers={customers}
        filteredVehicles={filteredVehicles}
        onCustomerChange={setSelectedCustomer}
        onVehicleSelect={handleVehicleSelect}
        onCreateCustomer={(name) => { setPendingCustomerName(name); setShowCustomerModal(true) }}
        onCreateVehicle={() => setShowVehicleModal(true)}
        onUpdateQuantity={updateQuantity}
        onRemoveFromCart={removeFromCart}
        onUpdatePrice={updatePrice}
        onSetQuantityDirectly={setQuantityDirectly}
        onClearCart={clearCart}
        onCancelReturnMode={cancelReturnMode}
        onStartExchange={returnAgainstSale ? startExchange : undefined}
        subtotal={subtotal}
        itemCount={itemCount}
        discountAmount={discountAmount}
        saleDiscount={saleDiscount}
        tax={tax}
        isTaxExempt={isTaxExempt}
        total={total}
        loyaltyRedeemValue={loyaltyRedeemValue}
        loyaltyRedeemPoints={loyaltyRedeemPoints}
        heldSales={heldSales}
        onShowHeldSales={() => setShowHeldSalesModal(true)}
        holdingInProgress={holdingInProgress}
        onHoldSale={holdSale}
        onOpenPayment={openPaymentModal}
        allowDiscount={allowDiscount}
        onShowDiscount={() => setShowDiscountModal(true)}
        loyaltyProgram={loyaltyProgram}
        orderType={orderType}
        onOrderTypeChange={config.showOrderTypeSelector ? setOrderType : undefined}
        tables={tables}
        selectedTableId={selectedTableId}
        onTableSelect={config.showTableSelector ? handleTableSelect : undefined}
        tipAmount={tipAmount}
        onTipChange={config.enableTips ? setTipAmount : undefined}
        onSendToKitchen={config.enableKitchenSend ? handleSendToKitchen : undefined}
        restaurantOrderId={restaurantOrderId}
      />

      <POSPaymentModal
        isOpen={showPayment}
        onClose={() => setShowPayment(false)}
        onCompleteSale={completeSale}
        isReturnMode={isReturnMode}
        splitEnabled={splitEnabled}
        setSplitEnabled={setSplitEnabled}
        splitSecondMethod={splitSecondMethod}
        setSplitSecondMethod={setSplitSecondMethod}
        splitSecondAmount={splitSecondAmount}
        setSplitSecondAmount={setSplitSecondAmount}
        total={exchangeFrom ? Math.max(0, total - exchangeFrom.credit) : total}
        loyaltyRedeemValue={loyaltyRedeemValue}
        selectedCustomer={selectedCustomer}
        processing={processing}
        paymentMethod={paymentMethod}
        setPaymentMethod={handlePaymentMethodChange}
        refundMethod={refundMethod}
        setRefundMethod={setRefundMethod}
        amountPaid={amountPaid}
        setAmountPaid={setAmountPaid}
        creditAmount={creditAmount}
        setCreditAmount={setCreditAmount}
        customerCredit={customerCredit}
        enabledPaymentMethods={enabledPaymentMethods}
        enabledRefundMethods={enabledRefundMethods}
        loyaltyProgram={loyaltyProgram}
        loyaltyPointsToRedeem={loyaltyPointsToRedeem}
        setLoyaltyPointsToRedeem={setLoyaltyPointsToRedeem}
        showLoyaltyRedeem={showLoyaltyRedeem}
        setShowLoyaltyRedeem={setShowLoyaltyRedeem}
        tierRedeemRate={tierRedeemRate}
        loyaltyRedeemPoints={loyaltyRedeemPoints}
        tipAmount={config.enableTips ? tipAmount : undefined}
        currency={tenantInfo?.currency}
        giftCardNumber={giftCardNumber}
        setGiftCardNumber={setGiftCardNumber}
        giftCardInfo={giftCardInfo}
        giftCardLookupLoading={giftCardLookupLoading}
        onLookupGiftCard={lookupGiftCard}
      />

      <HeldSalesModal
        isOpen={showHeldSalesModal}
        onClose={() => setShowHeldSalesModal(false)}
        heldSales={heldSales}
        onRecall={recallHeldSale}
        onDelete={deleteHeldSale}
      />

      <ReturnLookupModal
        isOpen={showReturnLookupModal}
        onClose={() => { setShowReturnLookupModal(false); setReturnSearchQuery(''); setReturnSearchResults([]) }}
        onLoadSaleForReturn={loadSaleForReturn}
        onManualReturnMode={() => { setShowReturnLookupModal(false); setIsReturnMode(true); setReturnAgainstSale(null); toast.info('Manual return mode - add items from product list') }}
        returnSearchQuery={returnSearchQuery}
        setReturnSearchQuery={setReturnSearchQuery}
        returnSearchResults={returnSearchResults}
        searchingReturns={searchingReturns}
      />

      <VehicleMismatchDialog
        isOpen={showMismatchDialog}
        mismatchInfo={mismatchInfo}
        pendingVehicle={pendingVehicle}
        onKeepCustomer={() => {
          if (pendingVehicle) setSelectedVehicle(pendingVehicle)
          setShowMismatchDialog(false)
          setMismatchInfo(null)
          setPendingVehicle(null)
        }}
        onUseVehicleOwner={() => {
          if (mismatchInfo) {
            const owner = customers.find(c => c.id === mismatchInfo.vehicleOwnerId)
            setSelectedCustomer(owner || null)
          }
          if (pendingVehicle) setSelectedVehicle(pendingVehicle)
          setShowMismatchDialog(false)
          setMismatchInfo(null)
          setPendingVehicle(null)
        }}
        onCancel={() => {
          setShowMismatchDialog(false)
          setMismatchInfo(null)
          setPendingVehicle(null)
        }}
      />

      <CustomerFormModal
        isOpen={showCustomerModal}
        onClose={() => { setShowCustomerModal(false); setPendingCustomerName('') }}
        onSaved={(customer) => { setCustomers([...customers, customer]); setSelectedCustomer(customer) }}
        initialName={pendingCustomerName}
      />

      <VehicleModal
        isOpen={showVehicleModal}
        onClose={() => setShowVehicleModal(false)}
        onCreated={(vehicle) => {
          fetchVehicles()
          setSelectedVehicle(vehicle as Vehicle)
          if (vehicle.customerId) setSelectedCustomer(customers.find(c => c.id === vehicle.customerId) || null)
        }}
        customers={customers}
        makes={makes}
        onMakesUpdated={fetchMakes}
        onCustomersUpdated={fetchCustomers}
        selectedCustomerId={selectedCustomer?.id}
      />

      {/* Sale Success Modal */}
      <SaleSuccessModal
        lastSale={lastSale}
        lastSaleId={lastSaleId}
        onDismiss={() => { setLastSale(null); setLastSaleId(null) }}
        onPrintReceipt={printReceiptForSale}
        printingReceipt={printingReceipt}
      />

      <ConfirmModal
        isOpen={recallConfirm.open}
        onClose={() => setRecallConfirm({ open: false, heldSale: null })}
        onConfirm={() => {
          if (recallConfirm.heldSale) performRecallHeldSale(recallConfirm.heldSale)
          setRecallConfirm({ open: false, heldSale: null })
        }}
        title="Replace Cart"
        message="Current cart will be replaced. Continue?"
        confirmText="Replace"
        variant="warning"
      />

      <ConfirmModal
        isOpen={deleteHeldConfirm.open}
        onClose={() => setDeleteHeldConfirm({ open: false, id: null })}
        onConfirm={performDeleteHeldSale}
        title="Delete Held Sale"
        message="Are you sure you want to delete this held sale?"
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmModal
        isOpen={returnModeConfirm}
        onClose={() => setReturnModeConfirm(false)}
        onConfirm={() => {
          clearCart()
          setShowReturnLookupModal(true)
          setReturnModeConfirm(false)
        }}
        title="Start Return"
        message="Clear current cart and start a return?"
        confirmText="Continue"
        variant="warning"
      />

      <ShiftCloseModal
        isOpen={showShiftCloseModal}
        shift={activeShift}
        onClose={() => setShowShiftCloseModal(false)}
        onShiftClosed={() => {
          setActiveShift(null)
          setShowShiftCloseModal(false)
          if (cart.length > 0) {
            toast.warning('Shift closed. Cart has been cleared.')
            clearCart()
          }
        }}
      />

      <DiscountModal
        isOpen={showDiscountModal}
        onClose={() => setShowDiscountModal(false)}
        onApply={(discount) => setSaleDiscount(discount)}
        onRemove={() => setSaleDiscount({ type: 'percentage', value: 0, reason: '' })}
        currentDiscount={saleDiscount}
        subtotal={Math.abs(subtotal)}
        maxDiscountPercent={maxDiscountPct}
        allowDiscount={allowDiscount}
        onRequestOverride={(discount) => setSupervisorRequest({ type: 'custom_discount', discount })}
      />

      {/* Supervisor PIN override (discount over limit, locked price, cart void) */}
      <SupervisorAuthModal
        isOpen={!!supervisorRequest}
        onClose={() => setSupervisorRequest(null)}
        onAuthorize={authorizeSupervisor}
        actionType={supervisorRequest?.type || 'custom_discount'}
        title="Supervisor Approval Required"
        contextDetails={{
          cashierName,
          ticketNumber: activeShift?.entryNumber,
          ...(supervisorRequest?.type === 'custom_discount'
            ? {
                discountPercent: supervisorRequest.discount.type === 'percentage'
                  ? supervisorRequest.discount.value
                  : Math.abs(subtotal) > 0 ? (supervisorRequest.discount.value / Math.abs(subtotal)) * 100 : 0,
              }
            : supervisorRequest?.type === 'price_override'
              ? { itemName: supervisorRequest.itemName, originalPrice: supervisorRequest.originalPrice, requestedPrice: supervisorRequest.newPrice }
              : {}),
        }}
      />

      {/* Terminal lock screen */}
      <CashierLockModal
        isOpen={terminalLocked}
        cashierName={cashierName || 'Cashier'}
        terminalName={posProfile?.name || posWarehouse?.name || 'POS'}
        shiftNumber={activeShift?.entryNumber || ''}
        onUnlock={unlockTerminal}
        onSwitchUser={() => signOut({ callbackUrl: `/c/${params.slug}/login` })}
      />

      <ConfirmModal
        isOpen={clearCartConfirm}
        onClose={() => setClearCartConfirm(false)}
        onConfirm={() => { clearCart(); setClearCartConfirm(false) }}
        title="Clear Cart"
        message="Remove all items from the current sale?"
        confirmText="Clear"
        variant="danger"
      />

      {/* Supermarket: Weight Input Modal */}
      <WeightInputModal
        isOpen={!!weightInputItem}
        item={weightInputItem}
        onClose={() => setWeightInputItem(null)}
        onConfirm={(weight) => {
          if (weightInputItem) addToCartWithWeight(weightInputItem, weight)
        }}
      />

      {/* Serial Number Picker Modal */}
      <SerialPickerModal
        isOpen={!!serialPickerItem}
        item={serialPickerItem}
        warehouseId={posWarehouse?.id || null}
        quantity={1}
        onClose={() => setSerialPickerItem(null)}
        onConfirm={addToCartWithSerials}
      />

      {/* Restaurant: Modifier Picker Modal */}
      <ModifierPickerModal
        isOpen={showModifierPicker}
        itemId={modifierPickerItem?.id || null}
        itemName={modifierPickerItem?.name || ''}
        onClose={() => { setShowModifierPicker(false); setModifierPickerItem(null) }}
        onConfirm={addToCartWithModifiers}
      />

      {/* Receipt printer settings (per terminal) */}
      <PrinterSettingsModal isOpen={showPrinterSettings} onClose={() => setShowPrinterSettings(false)} />

      {/* Camera barcode scanner (tablets / laptops without a hardware scanner) */}
      <CameraScanModal
        isOpen={showCameraScan}
        onClose={() => setShowCameraScan(false)}
        onDetected={handleScanSubmit}
      />
      </div>
    </div>
  )
}
