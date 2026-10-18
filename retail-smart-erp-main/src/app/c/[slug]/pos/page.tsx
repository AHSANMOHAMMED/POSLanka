'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
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
} from '@/components/pos'
import { WeightInputModal } from '@/components/pos/WeightInputModal'
import { OfflineStatusBanner } from '@/components/pos/OfflineStatusBanner'
import { SerialPickerModal } from '@/components/pos/SerialPickerModal'
import { ModifierPickerModal } from '@/components/pos/ModifierPickerModal'
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
import type { PaperSize } from '@/lib/print/types'
import { useCurrency } from '@/hooks/useCurrency'
import { roundCurrency } from '@/lib/utils/currency'
import { calculateItemTax, aggregateTaxBreakdown, type ResolvedTaxTemplate, type TaxBreakdownItem } from '@/lib/utils/tax-template'
import { POS_ITEMS_LIMIT } from '@/components/pos/types'
import { usePOSBusinessConfig } from '@/hooks/usePOSBusinessConfig'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatItemLabel } from '@/lib/utils/item-display'

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
  const taxInclusive = tenantInfo?.taxInclusive || false
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

      const res = await fetch(`/api/items?${params.toString()}`)
      if (res.ok) {
        const response = await res.json()
        const data = response.data || response
        const pagination = response.pagination
        setItems(data)
        setHasMoreItems(pagination && pagination.total > POS_ITEMS_LIMIT)
      } else {
        toast.error('Failed to load items')
      }
    } catch (error) {
      console.error('Error fetching items:', error)
      toast.error('Failed to load items')
    } finally {
      setSearchingItems(false)
    }
  }, [])

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
    if (!config.enableBarcodeAutoAdd || !debouncedItemSearch || !posWarehouse || isReturnMode) return
    const barcode = debouncedItemSearch.trim()
    if (!barcode || barcode.length < 3) return

    async function tryBarcodeAutoAdd() {
      try {
        const res = await fetch(`/api/items/barcode-lookup?barcode=${encodeURIComponent(barcode)}&warehouseId=${posWarehouse!.id}`)
        if (res.ok) {
          const item: Item = await res.json()
          addToCart(item)
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

  function updatePrice(cartLineId: string, newPrice: number) {
    if (isNaN(newPrice) || newPrice <= 0) {
      toast.error('Price must be greater than zero')
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
    setCart([])
    setSelectedCustomer(null)
    setSelectedVehicle(null)
    setIsReturnMode(false)
    setReturnAgainstSale(null)
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

  function loadSaleForReturn(sale: SaleForReturn) {
    setCart([])
    setIsReturnMode(true)
    setReturnAgainstSale(sale)
    if (sale.customer) setSelectedCustomer(sale.customer)

    // Filter out gift card items — they are non-returnable
    const returnableItems = sale.items.filter(item => !item.item?.isGiftCard)
    const skippedCount = sale.items.length - returnableItems.length

    if (returnableItems.length === 0) {
      toast.error('This sale contains only gift card items which cannot be returned')
      setIsReturnMode(false)
      setReturnAgainstSale(null)
      return
    }

    if (skippedCount > 0) {
      toast.warning(`${skippedCount} gift card item(s) excluded from return — gift cards are non-returnable`)
    }

    const returnItems: CartItem[] = []
    for (const item of returnableItems) {
      const serialIds = item.serialNumberIds as string[] | undefined
      if (serialIds?.length) {
        // Serial-tracked: create one cart line per serial for individual removal
        const unitPrice = parseFloat(item.unitPrice)
        for (let i = 0; i < serialIds.length; i++) {
          returnItems.push({
            cartLineId: `return-${item.id}-${Date.now()}-${i}`,
            itemId: item.itemId ?? '',
            name: item.itemName,
            quantity: -1,
            unitPrice,
            total: -unitPrice,
            serialNumberIds: [serialIds[i]],
          })
        }
      } else {
        // Non-serial: keep existing behavior
        returnItems.push({
          cartLineId: `return-${item.id}-${Date.now()}-0`,
          itemId: item.itemId ?? '',
          name: item.itemName,
          quantity: -Math.abs(parseFloat(item.quantity)),
          unitPrice: parseFloat(item.unitPrice),
          total: -Math.abs(parseFloat(item.total)),
        })
      }
    }

    setCart(returnItems)
    setShowReturnLookupModal(false)
    setReturnSearchQuery('')
    setReturnSearchResults([])
    toast.info(`Loaded invoice ${sale.invoiceNo} for return`)
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
    const payableTotal = Math.max(0, total - loyaltyRedeemValue + tip)
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

    if (isReturnMode) {
      const refundAmount = Math.abs(total)
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
            isReturn: true,
            returnAgainst: returnAgainstSale?.id,
            refundAmount,
            refundMethod,
          }),
        })

        if (res.ok) {
          const sale = await res.json()
          clearCart()
          setShowPayment(false)
          setAmountPaid('')
          setCreditAmount('')
          fetchItems(debouncedItemSearch || undefined, posWarehouse?.id, selectedCategory)
          setLastSale({ invoiceNo: sale.invoiceNo, total: refundAmount, isReturn: true })
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

    setProcessing(true)
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer?.id,
          vehicleId: selectedVehicle?.id,
          warehouseId: posWarehouse?.id,
          costCenterId: posProfile?.costCenterId || null,
          posOpeningEntryId: activeShift?.id,
          customerName: selectedCustomer?.name,
          vehiclePlate: selectedVehicle?.licensePlate,
          vehicleDescription: selectedVehicle ? `${selectedVehicle.year ? `${selectedVehicle.year} ` : ''}${selectedVehicle.make} ${selectedVehicle.model}` : undefined,
          cartItems: cartWithTax,
          paymentMethod,
          subtotal,
          discount: discountAmount,
          discountType: saleDiscount.value > 0 ? saleDiscount.type : undefined,
          discountReason: saleDiscount.value > 0 ? saleDiscount.reason : undefined,
          tax,
          taxBreakdown: saleTaxBreakdown.length > 0 ? saleTaxBreakdown : undefined,
          total: Math.max(0, total - loyaltyRedeemValue + tip),
          amountPaid: effectiveCashCardPaid,
          creditAmount: creditUsed,
          addOverpaymentToCredit: false,
          loyaltyPointsRedeemed: loyaltyRedeemPoints > 0 ? loyaltyRedeemPoints : undefined,
          loyaltyRedeemValue: loyaltyRedeemValue > 0 ? loyaltyRedeemValue : undefined,
          restaurantOrderId: restaurantOrderId || undefined,
          tipAmount: tip > 0 ? tip : undefined,
          giftCardId: paymentMethod === 'gift_card' && giftCardInfo ? giftCardInfo.id : undefined,
        }),
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

        const saleTotal = Math.max(0, total - loyaltyRedeemValue + tip)
        clearCart()
        setShowPayment(false)
        setAmountPaid('')
        setCreditAmount('')
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
      toast.error('Error completing sale')
    } finally {
      setProcessing(false)
    }
  }

  // ─── Receipt Printing ─────────────────────────────────────────

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  async function printReceiptForSale(saleId: string) {
    try {
      const res = await fetch(`/api/sales/${saleId}`)
      if (!res.ok) {
        toast.error('Failed to load sale for printing')
        return
      }
      const saleData = await res.json()

      const businessName = escapeHtml(tenantInfo?.name || 'Business')
      const headerLines = [
        `<p class="font-bold text-sm">${businessName}</p>`,
        tenantInfo?.address ? `<p class="text-xs">${escapeHtml(tenantInfo.address)}</p>` : '',
        tenantInfo?.phone ? `<p class="text-xs">${escapeHtml(tenantInfo.phone)}</p>` : '',
      ].filter(Boolean).join('\n')

      const customFooter = escapeHtml(posProfile?.receiptFooter || 'Thank you for your purchase!')

      // Resolve serial numbers for receipt display
      const allSerialIds: string[] = []
      for (const item of (saleData.items || [])) {
        if (item.serialNumberIds?.length) {
          allSerialIds.push(...item.serialNumberIds)
        }
      }
      const serialMap = new Map<string, string>()
      if (allSerialIds.length > 0) {
        try {
          const snRes = await fetch(`/api/serial-numbers/by-ids?ids=${allSerialIds.join(',')}`)
          if (snRes.ok) {
            const snData: { id: string; serialNumber: string }[] = await snRes.json()
            for (const sn of snData) serialMap.set(sn.id, sn.serialNumber)
          }
        } catch { /* non-critical */ }
      }

      const receiptItems = (saleData.items || []).map((item: { id: string; itemName: string; quantity: string; unitPrice: string; discount: string; total: string; serialNumberIds?: string[] }) => {
        const serialNumbers = (item.serialNumberIds || []).map(id => serialMap.get(id)).filter(Boolean)
        const serialLine = serialNumbers.length > 0
          ? `<div style="font-size:9px;color:#666;margin-top:1px">S/N: ${serialNumbers.map(s => escapeHtml(s!)).join(', ')}</div>`
          : ''
        return `
        <div style="margin-bottom:4px">
          <div style="font-weight:500">${escapeHtml(item.itemName)}</div>
          <div style="display:flex;justify-content:space-between;font-size:10px">
            <span>${parseFloat(item.quantity)} x ${parseFloat(item.unitPrice).toFixed(2)}</span>
            <span>${parseFloat(item.total).toFixed(2)}</span>
          </div>
          ${parseFloat(item.discount) > 0 ? `<div style="display:flex;justify-content:space-between;font-size:10px;color:#666"><span>Discount</span><span>-${parseFloat(item.discount).toFixed(2)}</span></div>` : ''}
          ${serialLine}
        </div>
      `
      }).join('')

      const payments = (saleData.payments || []).map((p: { id: string; method: string; amount: string }) => `
        <div style="display:flex;justify-content:space-between;font-size:10px">
          <span>${p.method === 'cash' ? 'Cash' : p.method === 'card' ? 'Card' : p.method === 'credit' ? 'Credit' : p.method}</span>
          <span>${parseFloat(p.amount).toFixed(2)}</span>
        </div>
      `).join('')

      const html = `
        <div style="text-align:center;margin-bottom:8px">${headerLines}</div>
        ${posProfile?.receiptHeader ? `<div style="text-align:center;font-size:10px;margin-bottom:8px">${escapeHtml(posProfile.receiptHeader)}</div>` : ''}
        <div style="border-top:1px dashed #999;margin:8px 0"></div>
        <div style="font-size:10px">
          <div style="display:flex;justify-content:space-between"><span>Receipt:</span><span style="font-weight:500">${saleData.invoiceNo}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Date:</span><span>${new Date(saleData.createdAt).toLocaleString()}</span></div>
          ${saleData.customerName ? `<div style="display:flex;justify-content:space-between"><span>Customer:</span><span>${escapeHtml(saleData.customerName)}</span></div>` : ''}
        </div>
        <div style="border-top:1px dashed #999;margin:8px 0"></div>
        <div style="font-size:11px">${receiptItems}</div>
        <div style="border-top:1px dashed #999;margin:8px 0"></div>
        <div style="font-size:10px">
          <div style="display:flex;justify-content:space-between"><span>Subtotal:</span><span>${parseFloat(saleData.subtotal).toFixed(2)}</span></div>
          ${parseFloat(saleData.discountAmount) > 0 ? `<div style="display:flex;justify-content:space-between"><span>Discount:</span><span>-${parseFloat(saleData.discountAmount).toFixed(2)}</span></div>` : ''}
          ${parseFloat(saleData.taxAmount) > 0 ? `<div style="display:flex;justify-content:space-between"><span>Tax${taxInclusive ? ' (incl.)' : ''}:</span><span>${parseFloat(saleData.taxAmount).toFixed(2)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:12px;margin-top:4px;padding-top:4px;border-top:1px solid #ccc"><span>TOTAL:</span><span>${currencyCode} ${parseFloat(saleData.total).toFixed(2)}</span></div>
        </div>
        <div style="border-top:1px dashed #999;margin:8px 0"></div>
        <div style="font-size:10px">${payments}</div>
        <div style="text-align:center;margin-top:16px;padding-top:8px;border-top:1px dashed #999;font-size:10px">
          <p>${customFooter}</p>
        </div>
      `

      // Map POS profile receiptPrintFormat to PaperSize key
      const formatMap: Record<string, PaperSize> = {
        '58mm': 'thermal_58mm',
        '80mm': 'thermal_80mm',
        'A4': 'a4',
      }
      const paperSize = posProfile?.receiptPrintFormat
        ? formatMap[posProfile.receiptPrintFormat]
        : undefined

      await quickPrint('receipt', `Receipt-${saleData.invoiceNo}`, html, { paperSize })

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
    <div className="flex flex-col h-[calc(100vh-48px)] bg-gray-100 -m-5 overflow-hidden">
      <OfflineStatusBanner />
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
        total={total}
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
      </div>
    </div>
  )
}
