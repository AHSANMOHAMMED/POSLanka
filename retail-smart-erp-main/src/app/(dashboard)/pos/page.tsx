'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, Plus, Minus, Trash2, CreditCard, Banknote, X, CheckCircle, ShoppingBag, Pause, Play, Clock, Package, RotateCcw, Loader2, Warehouse } from 'lucide-react'
import { CustomerFormModal, VehicleModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Modal } from '@/components/ui/modal'
import { CreatableSelect } from '@/components/ui/creatable-select'
import { FormInput } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useDebouncedValue } from '@/hooks/useDebounce'
import { useSmartWarnings } from '@/hooks/useSmartWarnings'
import { SmartWarningBanner } from '@/components/ai/SmartWarningBanner'
import { useCurrency } from '@/hooks/useCurrency'
import { useUserWarehouse } from '@/components/ui/warehouse-selector'
import { formatItemLabel } from '@/lib/utils/item-display'

interface Item {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  sellingPrice: string
  currentStock: string
  reservedStock: string
  availableStock: string
  trackStock: boolean
  oemPartNumber: string | null
  supplierPartNumber: string | null
  alternatePartNumbers: string[] | null
  categoryId: string | null
}

interface Category {
  id: string
  name: string
}

interface CartItem {
  cartLineId: string  // Unique ID for stable React keys
  itemId: string | null  // null for deleted items in return mode
  name: string
  quantity: number
  unitPrice: number
  total: number
}

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  customerId: string | null
}

interface VehicleMake {
  id: string
  name: string
}

interface HeldSale {
  id: string
  holdNumber: string
  customerId: string | null
  vehicleId: string | null
  warehouseId: string | null
  cartItems: CartItem[]
  subtotal: string
  notes: string | null
  createdAt: string
  customer: Customer | null
  vehicle: Vehicle | null
}

interface SaleForReturn {
  id: string
  invoiceNo: string
  customerId: string | null
  customer: Customer | null
  warehouseId: string | null
  total: string
  createdAt: string
  items: Array<{
    id: string
    itemId: string | null
    itemName: string
    quantity: string
    unitPrice: string
    total: string
  }>
}

// Maximum items to load for POS (prevents performance issues with large inventories)
const POS_ITEMS_LIMIT = 200

export default function POSPage() {
  const { currency: currencyCode } = useCurrency()
  // Warehouse profile for POS
  const {
    warehouse: posWarehouse,
    loading: warehouseLoading,
    needsSetup,
    availableWarehouses,
    selectWarehouse,
  } = useUserWarehouse()
  const [selectingWarehouse, setSelectingWarehouse] = useState(false)

  const [items, setItems] = useState<Item[]>([])
  const [_categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [_selectedCategoryId, _setSelectedCategoryId] = useState<string | null>(null)
  const [hasMoreItems, setHasMoreItems] = useState(false)
  const [searchingItems, setSearchingItems] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'bank_transfer'>('cash')
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'credit'>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [customerCredit, setCustomerCredit] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [lastSale, setLastSale] = useState<{ invoiceNo: string; total: number; isReturn: boolean } | null>(null)

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

  // Return mode confirmation state
  const [returnModeConfirm, setReturnModeConfirm] = useState(false)

  // Issue #11: Return processing confirmation
  const [showReturnConfirmation, setShowReturnConfirmation] = useState(false)

  // Confirm modal states
  const [recallConfirm, setRecallConfirm] = useState<{ open: boolean; heldSale: HeldSale | null }>({ open: false, heldSale: null })
  const [deleteHeldConfirm, setDeleteHeldConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })

  // Customer-vehicle mismatch state
  const [showMismatchDialog, setShowMismatchDialog] = useState(false)
  const [mismatchInfo, setMismatchInfo] = useState<{ vehicleOwnerName: string; vehicleOwnerId: string } | null>(null)
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null)

  // AI Smart Warnings
  const saleWarnings = useSmartWarnings('sale')
  const returnWarnings = useSmartWarnings('return')
  const [warningBypassed, setWarningBypassed] = useState(false)

  // Issue #1: Tenant tax settings
  const [tenantTaxRate, setTenantTaxRate] = useState(0)
  const [tenantTaxInclusive, setTenantTaxInclusive] = useState(false)

  // Warn user if they try to leave with items in cart
  useUnsavedChangesWarning(cart.length > 0, 'You have items in your cart. Are you sure you want to leave?')

  // Debounced return search query
  const debouncedReturnSearchQuery = useDebouncedValue(returnSearchQuery, 300)

  // Debounced search for items (server-side search)
  const debouncedItemSearch = useDebouncedValue(search, 300)

  // Fetch items with optional search filter
  const fetchItems = useCallback(async (searchQuery?: string) => {
    // Don't fetch if warehouse profile not loaded yet
    if (!posWarehouse) return

    try {
      setSearchingItems(true)
      const params = new URLSearchParams()
      params.set('pageSize', String(POS_ITEMS_LIMIT))
      params.set('inStockOnly', 'true')
      params.set('warehouseId', posWarehouse.id)
      if (searchQuery) {
        params.set('search', searchQuery)
      }

      const res = await fetch(`/api/items?${params.toString()}`)
      if (res.ok) {
        const response = await res.json()
        const data = response.data || response
        const pagination = response.pagination

        setItems(data)

        // Check if there are more items available
        if (pagination && pagination.total > POS_ITEMS_LIMIT) {
          setHasMoreItems(true)
        } else {
          setHasMoreItems(false)
        }
      } else {
        toast.error('Failed to load items')
      }
    } catch (error) {
      console.error('Error fetching items:', error)
      toast.error('Failed to load items')
    } finally {
      setSearchingItems(false)
    }
  }, [posWarehouse])

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers?all=true')
      if (res.ok) {
        const data = await res.json()
        setCustomers(Array.isArray(data) ? data : [])
      } else {
        toast.error('Failed to load customers')
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
      toast.error('Failed to load customers')
    }
  }, [])

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicles?all=true')
      if (res.ok) {
        const data = await res.json()
        setVehicles(Array.isArray(data) ? data : [])
      } else {
        toast.error('Failed to load vehicles')
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error)
      toast.error('Failed to load vehicles')
    }
  }, [])

  const fetchMakes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-makes?all=true')
      if (res.ok) {
        const data = await res.json()
        setMakes(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching makes:', error)
    }
  }, [])

  const fetchHeldSales = useCallback(async () => {
    try {
      const res = await fetch('/api/held-sales')
      if (res.ok) {
        const data = await res.json()
        setHeldSales(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching held sales:', error)
    }
  }, [])

  // Fetch categories for filtering
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

  // Issue #1: Fetch tenant tax settings
  const fetchTenantSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant')
      if (res.ok) {
        const data = await res.json()
        setTenantTaxRate(parseFloat(data.taxRate || '0') / 100)
        setTenantTaxInclusive(data.taxInclusive || false)
      }
    } catch (error) {
      console.error('Error fetching tenant settings:', error)
    }
  }, [])

  useEffect(() => {
    // Only fetch when warehouse profile is ready
    if (warehouseLoading || needsSetup) return
    Promise.all([fetchItems(), fetchCategories(), fetchCustomers(), fetchVehicles(), fetchMakes(), fetchHeldSales(), fetchTenantSettings()])
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchCustomers, fetchVehicles, fetchMakes, fetchHeldSales, fetchTenantSettings, warehouseLoading, needsSetup, posWarehouse])

  // Refetch items when search changes (server-side filtering)
  useEffect(() => {
    // Skip if still in initial loading
    if (loading) return
    fetchItems(debouncedItemSearch || undefined)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedItemSearch])

  // Callback for WebSocket updates - refetch with current filters
  const handleItemsUpdate = useCallback(() => {
    fetchItems(debouncedItemSearch || undefined)
  }, [fetchItems, debouncedItemSearch])

  // Real-time updates via WebSocket
  useRealtimeData(handleItemsUpdate, { entityType: ['item', 'warehouse-stock'], refreshOnMount: false })
  useRealtimeData(fetchCustomers, { entityType: 'customer', refreshOnMount: false })
  useRealtimeData(fetchVehicles, { entityType: 'vehicle', refreshOnMount: false })
  useRealtimeData(fetchHeldSales, { entityType: ['held-sale', 'pos-closing'], refreshOnMount: false })

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
          cartItems: cart,
          subtotal,
          warehouseId: posWarehouse?.id,
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
    // If current cart has items, confirm before replacing
    if (cart.length > 0) {
      setRecallConfirm({ open: true, heldSale })
      return
    }
    performRecallHeldSale(heldSale)
  }

  async function performRecallHeldSale(heldSale: HeldSale) {
    // Issue #8: Warn if held sale was from a different warehouse
    if (heldSale.warehouseId && posWarehouse && heldSale.warehouseId !== posWarehouse.id) {
      toast.warning('This held sale was created in a different warehouse. Stock availability may differ.')
    }

    // Validate cart items still exist and have stock
    const validCartItems: CartItem[] = []
    const invalidItems: string[] = []
    const outOfStockItems: string[] = []

    // Issue #19: Use Map for O(1) lookup instead of linear search
    const itemMap = new Map(items.map(i => [i.id, i]))

    for (const cartItem of heldSale.cartItems) {
      if (!cartItem.itemId) {
        invalidItems.push(cartItem.name)
        continue
      }
      const item = itemMap.get(cartItem.itemId)
      if (!item) {
        invalidItems.push(cartItem.name)
      } else {
        const availableStock = parseFloat(item.availableStock)
        if (item.trackStock && availableStock <= 0) {
          outOfStockItems.push(cartItem.name)
        } else {
          // Adjust quantity if stock is less than requested (only for tracked items)
          const adjustedQty = item.trackStock ? Math.min(cartItem.quantity, availableStock) : cartItem.quantity
          validCartItems.push({
            // Generate new cartLineId if not present (for backward compatibility)
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

    // Warn about removed items
    if (invalidItems.length > 0) {
      toast.warning(`Removed items no longer available: ${invalidItems.join(', ')}`)
    }
    if (outOfStockItems.length > 0) {
      toast.warning(`Removed out-of-stock items: ${outOfStockItems.join(', ')}`)
    }

    // If no valid items remain, warn and don't delete the held sale
    if (validCartItems.length === 0) {
      toast.error('No valid items to recall. Held sale preserved.')
      setShowHeldSalesModal(false)
      return
    }

    // Restore cart with validated items
    setCart(validCartItems)

    // Restore customer and vehicle selection (gracefully handle deleted ones)
    if (heldSale.customerId) {
      const cust = customers.find(c => c.id === heldSale.customerId)
      if (cust) {
        setSelectedCustomer(cust)
      } else {
        setSelectedCustomer(null)
        toast.info('Customer no longer exists')
      }
    } else {
      setSelectedCustomer(null)
    }

    if (heldSale.vehicleId) {
      const veh = vehicles.find(v => v.id === heldSale.vehicleId)
      if (veh) {
        setSelectedVehicle(veh)
      } else {
        setSelectedVehicle(null)
        toast.info('Vehicle no longer exists')
      }
    } else {
      setSelectedVehicle(null)
    }

    // Delete the held sale
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

  function addToCart(item: Item) {
    const price = parseFloat(item.sellingPrice)
    const stock = parseFloat(item.availableStock)

    // In return mode, skip stock validation and add with negative quantity
    if (isReturnMode) {
      // In return mode, check if same item already exists (combine if same price)
      const existing = cart.find(c => c.itemId === item.id && c.unitPrice === price)
      if (existing) {
        // Decrease quantity (more negative)
        setCart(cart.map(c =>
          c.cartLineId === existing.cartLineId
            ? { ...c, quantity: c.quantity - 1, total: (c.quantity - 1) * c.unitPrice }
            : c
        ))
      } else {
        // Add new return item with negative quantity
        setCart([...cart, {
          cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          itemId: item.id,
          name: formatItemLabel(item),
          quantity: -1, // Negative for return
          unitPrice: price,
          total: -price, // Negative total
        }])
        toast.success(`${item.name} added for return`)
      }
      return
    }

    // Normal sale mode - validate stock is available (only for items that track stock)
    if (item.trackStock && stock <= 0) {
      toast.error('This item is out of stock')
      return
    }

    // Only combine if itemId AND price match
    // This allows same item with different prices to be separate lines
    const existing = cart.find(c => c.itemId === item.id && c.unitPrice === price)

    // Calculate total quantity of this item in cart
    const totalInCart = cart
      .filter(c => c.itemId === item.id)
      .reduce((sum, c) => sum + c.quantity, 0)

    // Only check stock for items that track stock
    if (item.trackStock) {
      if (totalInCart >= stock) {
        toast.warning('Not enough stock available')
        return
      }
    }

    if (existing) {
      setCart(cart.map(c =>
        c.cartLineId === existing.cartLineId
          ? { ...c, quantity: c.quantity + 1, total: (c.quantity + 1) * c.unitPrice }
          : c
      ))
    } else {
      setCart([...cart, {
        cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        itemId: item.id,
        name: formatItemLabel(item),
        quantity: 1,
        unitPrice: price,
        total: price,
      }])
      toast.success(`${item.name} added to cart`)
    }
  }

  function updateQuantity(cartLineId: string, delta: number) {
    const cartItem = cart.find(c => c.cartLineId === cartLineId)
    if (!cartItem) return

    const item = items.find(i => i.id === cartItem.itemId)
    // For returns, item might not exist in current inventory
    if (!item && !isReturnMode) return

    const newQty = cartItem.quantity + delta

    // In return mode, allow negative quantities but not zero
    if (isReturnMode) {
      if (newQty === 0) {
        // Remove item if quantity becomes zero
        removeFromCart(cartLineId)
        return
      }
      // Allow any non-zero quantity in return mode
    } else {
      // Normal mode: quantity must be positive
      if (newQty <= 0) return
    }

    // Skip stock check for items that don't track stock or in return mode
    if (!isReturnMode && item && item.trackStock) {
      // Calculate total quantity of this item in cart
      const totalInCart = cart
        .filter(c => c.itemId === cartItem.itemId)
        .reduce((sum, c) => sum + c.quantity, 0)
      const availableStock = parseFloat(item.availableStock)

      // Check if new total would exceed stock
      const newTotal = totalInCart + delta
      if (newTotal > availableStock) {
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
    // Price must be strictly positive (greater than zero)
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

  function clearCart() {
    setCart([])
    setSelectedCustomer(null)
    setSelectedVehicle(null)
    // Clear return mode
    setIsReturnMode(false)
    setReturnAgainstSale(null)
  }

  // Search for sales to return (uses debounced query)
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
          setReturnSearchResults(data)
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

  // Load a sale into the cart as a return (all quantities negative)
  function loadSaleForReturn(sale: SaleForReturn) {
    // Clear current cart and enter return mode
    setCart([])
    setIsReturnMode(true)
    setReturnAgainstSale(sale)

    // Set customer from original sale
    if (sale.customer) {
      setSelectedCustomer(sale.customer)
    }

    // Add items with negative quantities for return
    // Filter out items without itemId (deleted items) - they can still be returned by name
    const returnItems: CartItem[] = sale.items.map((item, index) => ({
      cartLineId: `return-${item.id}-${Date.now()}-${index}`,
      itemId: item.itemId || null, // Issue #3: null for deleted items (not empty string)
      name: item.itemName,
      quantity: -Math.abs(parseFloat(item.quantity)), // Negative for return
      unitPrice: parseFloat(item.unitPrice),
      total: -Math.abs(parseFloat(item.total)), // Negative total
    }))

    setCart(returnItems)
    setShowReturnLookupModal(false)
    setReturnSearchQuery('')
    setReturnSearchResults([])
    toast.info(`Loaded invoice ${sale.invoiceNo} for return. Adjust quantities and prices as needed.`)
  }

  // Cancel return mode and go back to normal sale
  function cancelReturnMode() {
    setIsReturnMode(false)
    setReturnAgainstSale(null)
    setCart([])
    setSelectedCustomer(null)
    setSelectedVehicle(null)
  }

  // Set quantity directly (for manual input in return mode)
  function setQuantityDirectly(cartLineId: string, newQty: number) {
    if (newQty === 0) {
      removeFromCart(cartLineId)
      return
    }
    setCart(cart.map(c =>
      c.cartLineId === cartLineId
        ? { ...c, quantity: newQty, total: newQty * c.unitPrice }
        : c
    ))
  }

  const subtotal = cart.reduce((sum, item) => sum + item.total, 0)
  // Issue #1: Calculate tax from tenant settings
  let tax = 0
  if (tenantTaxRate > 0 && !isReturnMode) {
    if (tenantTaxInclusive) {
      tax = subtotal - (subtotal / (1 + tenantTaxRate))
    } else {
      tax = subtotal * tenantTaxRate
    }
    tax = Math.round(tax * 100) / 100
  }
  const total = tenantTaxInclusive ? subtotal : subtotal + tax

  async function openPaymentModal() {
    // Fetch customer credit if customer is selected
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
    setAmountPaid(total.toFixed(2))
    setCreditAmount('')
    setShowPayment(true)
  }

  async function completeSale() {
    if (cart.length === 0) return

    // Prevent double-submission
    if (processing) return

    // For returns, show confirmation first if not already confirmed
    if (isReturnMode && !showReturnConfirmation) {
      setShowReturnConfirmation(true)
      return
    }

    // For returns, handle differently
    if (isReturnMode) {
      setShowReturnConfirmation(false)

      // AI Smart Warnings — check before return submission
      if (!warningBypassed && returnAgainstSale) {
        const w = await returnWarnings.checkWarnings({
          returnItems: cart.map(c => ({
            itemName: c.name,
            quantity: Math.abs(c.quantity),
            unitPrice: c.unitPrice,
          })),
          refundAmount: Math.abs(total),
          originalSaleTotal: parseFloat(returnAgainstSale.total),
          originalSaleDate: returnAgainstSale.createdAt,
          refundMethod,
          existingReturnTotal: 0,
        })
        if (w.length > 0) return // Banner will show in the modal
      }
      setWarningBypassed(false)

      // Returns have negative totals - refund amount is the absolute value
      const refundAmount = Math.abs(total)
      setProcessing(true)

      try {
        const res = await fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: selectedCustomer?.id,
            cartItems: cart, // Items have negative quantities
            paymentMethod: refundMethod, // Use selected refund method
            subtotal,
            discount: 0,
            tax,
            total, // Negative total for return
            amountPaid: 0, // No payment received
            creditAmount: 0,
            addOverpaymentToCredit: refundMethod === 'credit', // Add to credit if credit refund selected
            isReturn: true,
            returnAgainst: returnAgainstSale?.id,
            refundAmount, // Amount to refund
            refundMethod, // 'cash', 'card', or 'credit'
            // Issue #9: Return stock to original sale's warehouse, not current POS warehouse
            warehouseId: returnAgainstSale?.warehouseId || posWarehouse?.id,
          }),
        })

        if (res.ok) {
          const sale = await res.json()
          setLastSale({ invoiceNo: sale.invoiceNo, total: refundAmount, isReturn: true })
          clearCart()
          setShowPayment(false)
          setAmountPaid('')
          setCreditAmount('')
          fetchItems(debouncedItemSearch || undefined) // Refresh stock with current filters
          toast.success(`Return processed. Refund amount: ${currencyCode} ${refundAmount.toFixed(2)}`)
        } else {
          const error = await res.json()
          toast.error(error.error || 'Failed to process return. Please try again.')
        }
      } catch (error) {
        console.error('Error processing return:', error)
        toast.error('Error processing return. Please check your connection.')
      } finally {
        setProcessing(false)
      }
      return
    }

    // Normal sale flow
    // Validate payment amounts - must be non-negative numbers
    const creditVal = parseFloat(creditAmount) || 0
    const amountVal = parseFloat(amountPaid) || 0
    if (creditVal < 0) {
      toast.error('Credit amount cannot be negative')
      return
    }
    if (amountVal < 0) {
      toast.error('Payment amount cannot be negative')
      return
    }
    // Validate credit doesn't exceed available balance
    if (creditVal > customerCredit) {
      toast.error('Credit amount exceeds available balance')
      return
    }
    // Validate credit doesn't exceed total
    if (creditVal > total) {
      toast.error('Credit amount cannot exceed total')
      return
    }

    // AI Smart Warnings — check before sale submission
    if (!warningBypassed) {
      const w = await saleWarnings.checkWarnings({
        items: cart.map(c => ({
          itemId: c.itemId || undefined,
          name: c.name,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          originalPrice: c.itemId ? parseFloat(items.find(i => i.id === c.itemId)?.sellingPrice || '0') : undefined,
        })),
        subtotal,
        discountAmount: 0,
        total,
        customerId: selectedCustomer?.id,
      })
      if (w.length > 0) return // Banner will show in the modal
    }
    setWarningBypassed(false)

    const creditUsed = parseFloat(creditAmount) || 0
    const remainingAfterCredit = Math.max(0, total - creditUsed)
    const cashCardPaid = parseFloat(amountPaid) || 0
    // For card/transfer, cap at remaining amount (no overpayment)
    const effectiveCashCardPaid = paymentMethod === 'cash' ? cashCardPaid : Math.min(cashCardPaid, remainingAfterCredit)

    // Allow partial payments - no minimum required
    setProcessing(true)

    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer?.id,
          vehicleId: selectedVehicle?.id,
          // Denormalized fields for historical accuracy
          customerName: selectedCustomer?.name,
          vehiclePlate: selectedVehicle?.licensePlate,
          vehicleDescription: selectedVehicle ? `${selectedVehicle.year ? `${selectedVehicle.year} ` : ''}${selectedVehicle.make} ${selectedVehicle.model}` : undefined,
          cartItems: cart,
          paymentMethod,
          subtotal,
          discount: 0,
          tax,
          total,
          amountPaid: effectiveCashCardPaid,
          creditAmount: creditUsed,
          addOverpaymentToCredit: false, // POS always returns change
          warehouseId: posWarehouse?.id,
        }),
      })

      if (res.ok) {
        const sale = await res.json()
        setLastSale({ invoiceNo: sale.invoiceNo, total, isReturn: false })
        clearCart()
        setShowPayment(false)
        setAmountPaid('')
        setCreditAmount('')
        fetchItems(debouncedItemSearch || undefined) // Refresh stock with current filters
      } else {
        const error = await res.json()
        toast.error(error.error || 'Failed to complete sale. Please try again.')
      }
    } catch (error) {
      console.error('Error completing sale:', error)
      toast.error('Error completing sale. Please check your connection.')
    } finally {
      setProcessing(false)
    }
  }

  // Filter vehicles by selected customer (show customer's vehicles first, then all others)
  const filteredVehicles = useMemo(() => {
    if (!selectedCustomer?.id) return vehicles

    // Customer's vehicles first, then others
    const customerVehicles = vehicles.filter(v => v.customerId === selectedCustomer.id)
    const otherVehicles = vehicles.filter(v => v.customerId !== selectedCustomer.id)

    return [...customerVehicles, ...otherVehicles]
  }, [vehicles, selectedCustomer?.id])

  // Items are now filtered server-side, but we apply client-side filtering
  // for instant feedback while waiting for the debounced server request
  const filteredItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    return items.filter(item => {
      // Only apply client-side search if it differs from the last server search
      // This provides instant feedback while server catches up
      const matchesSearch = !search ||
        item.name.toLowerCase().includes(searchLower) ||
        item.sku?.toLowerCase().includes(searchLower) ||
        item.barcode?.toLowerCase().includes(searchLower) ||
        item.oemPartNumber?.toLowerCase().includes(searchLower) ||
        item.supplierPartNumber?.toLowerCase().includes(searchLower) ||
        item.alternatePartNumbers?.some(pn => pn.toLowerCase().includes(searchLower))
      return matchesSearch
    })
  }, [items, search])

  // Handle warehouse profile loading/setup
  if (warehouseLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner size="xl" text="Loading POS profile..." />
      </div>
    )
  }

  // Warehouse setup modal
  if (needsSetup) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="bg-white rounded-md shadow-xl w-full max-w-md p-6 m-4">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Warehouse size={32} className="text-blue-600" />
            </div>
            <h2 className="text-xl font-bold">POS Setup Required</h2>
            <p className="text-gray-500 mt-2">
              Select the warehouse you&apos;ll be working from. This determines which inventory you can sell.
            </p>
          </div>

          {availableWarehouses.length === 0 ? (
            <div className="text-center p-4 bg-amber-50 rounded">
              <p className="text-amber-700">
                No warehouses are assigned to your account. Please contact your administrator.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {availableWarehouses.map((wh) => (
                <button
                  key={wh.id}
                  onClick={async () => {
                    setSelectingWarehouse(true)
                    const result = await selectWarehouse(wh.id)
                    if (!result.success) {
                      toast.error(result.error || 'Failed to set warehouse')
                    }
                    setSelectingWarehouse(false)
                  }}
                  disabled={selectingWarehouse}
                  className="w-full p-4 border rounded text-left hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <Warehouse size={20} className="text-gray-400" />
                    <div>
                      <div className="font-medium">{wh.name}</div>
                      <div className="text-sm text-gray-500">{wh.code}</div>
                    </div>
                    {wh.isDefault && (
                      <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        Default
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectingWarehouse && (
            <div className="flex items-center justify-center mt-4 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin mr-2" />
              Setting up...
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner size="xl" text="Loading POS..." />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-88px)] gap-4 -m-5 overflow-hidden">
      {/* Left: Products */}
      <div className="flex-1 flex flex-col p-4 bg-white min-w-0 overflow-x-hidden overflow-y-hidden">
        {/* Warehouse indicator and Search */}
        <div className="flex items-center gap-3 mb-4 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded text-sm">
            <Warehouse size={16} />
            <span className="font-medium">{posWarehouse?.name || 'No Warehouse'}</span>
            {posWarehouse?.code && (
              <span className="text-blue-500">({posWarehouse.code})</span>
            )}
          </div>
          <div className="relative flex-1">
            <FormInput
              type="text"
              placeholder="Search items or scan barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="text-gray-400" size={20} />}
              className="py-3 text-lg"
              autoFocus
            />
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto">
          {searchingItems && (
            <div className="flex items-center justify-center py-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin mr-2" />
              Searching...
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredItems.map(item => (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                className="p-4 border rounded hover:border-blue-500 hover:shadow-md transition-all text-left"
              >
                <div className="font-medium truncate">{item.name}</div>
                <div className="text-sm text-gray-500">{item.sku || '-'}</div>
                <div className="mt-2 flex justify-between items-center">
                  <span className="font-bold text-blue-600">
                    {currencyCode} {parseFloat(item.sellingPrice).toFixed(2)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {item.trackStock ? `Available: ${parseFloat(item.availableStock).toFixed(0)}` : 'In Stock'}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {filteredItems.length === 0 && !searchingItems && (
            <div className="text-center py-10 text-gray-500">
              No items found
            </div>
          )}
          {hasMoreItems && !search && (
            <div className="text-center py-4 text-sm text-gray-500">
              Showing first {POS_ITEMS_LIMIT} items. Use search to find more.
            </div>
          )}
        </div>
      </div>

      {/* Right: Cart */}
      <div className="w-96 flex-shrink-0 flex flex-col bg-gray-50 border-l overflow-hidden">
        <div className={`flex-shrink-0 p-4 border-b ${isReturnMode ? 'bg-red-50' : 'bg-white'}`}>
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">
              {isReturnMode ? (
                <span className="text-red-700">Return Mode</span>
              ) : (
                'Current Sale'
              )}
            </h2>
            {!isReturnMode && (
              <button
                onClick={() => {
                  if (cart.length > 0) {
                    setReturnModeConfirm(true)
                  } else {
                    setShowReturnLookupModal(true)
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                <RotateCcw size={16} />
                Return
              </button>
            )}
            {isReturnMode && (
              <button
                onClick={cancelReturnMode}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                <X size={16} />
                Cancel
              </button>
            )}
          </div>
          {isReturnMode && (
            <div className="mt-2 text-sm text-red-600">
              {returnAgainstSale ? (
                <>Returning against: <span className="font-medium">{returnAgainstSale.invoiceNo}</span></>
              ) : (
                <span className="font-medium">Manual Return - Add items from product list</span>
              )}
            </div>
          )}
          {/* Vehicle selector */}
          <div className="mt-2">
            <CreatableSelect
              options={filteredVehicles.map(v => ({
                value: v.id,
                label: `${v.year ? `${v.year} ` : ''}${v.make} ${v.model}${v.licensePlate ? ` (${v.licensePlate})` : ''}${selectedCustomer?.id && v.customerId !== selectedCustomer.id ? ' (Other Owner)' : ''}`
              }))}
              value={selectedVehicle?.id || ''}
              onChange={(value) => {
                const vehicle = vehicles.find(v => v.id === value)
                if (!vehicle) {
                  setSelectedVehicle(null)
                  return
                }

                // Check for customer-vehicle mismatch
                if (selectedCustomer?.id && vehicle.customerId && vehicle.customerId !== selectedCustomer.id) {
                  // Find vehicle owner name
                  const owner = customers.find(c => c.id === vehicle.customerId)
                  setPendingVehicle(vehicle)
                  setMismatchInfo({
                    vehicleOwnerName: owner?.name || 'another customer',
                    vehicleOwnerId: vehicle.customerId
                  })
                  setShowMismatchDialog(true)
                } else {
                  setSelectedVehicle(vehicle)
                  // Auto-fill customer from vehicle if no customer selected
                  if (vehicle.customerId && !selectedCustomer) {
                    const cust = customers.find(c => c.id === vehicle.customerId)
                    setSelectedCustomer(cust || null)
                  }
                }
              }}
              onCreateNew={() => setShowVehicleModal(true)}
              placeholder="Select Vehicle"
              createLabel="Add vehicle"
            />
          </div>
          {/* Customer selector */}
          <div className="mt-2">
            <CreatableSelect
              options={customers.map(c => ({ value: c.id, label: c.name }))}
              value={selectedCustomer?.id || ''}
              onChange={(value) => {
                const cust = customers.find(c => c.id === value)
                setSelectedCustomer(cust || null)
              }}
              onCreateNew={(name) => {
                setPendingCustomerName(name)
                setShowCustomerModal(true)
              }}
              placeholder="Walk-in Customer"
              createLabel="Add customer"
            />
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              Cart is empty
            </div>
          ) : (
            <div className="space-y-3">
              {/* Cart Items */}
              {cart.map((item) => (
                <div key={item.cartLineId} className={`p-3 rounded border ${
                  isReturnMode ? 'bg-red-50 border-red-200' : 'bg-white'
                }`}>
                  <div className="flex justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      {isReturnMode && (
                        <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                          Return
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removeFromCart(item.cartLineId)}
                      className="text-red-500 hover:bg-red-50 rounded p-1"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.cartLineId, -1)}
                        className="p-1 rounded bg-gray-100 hover:bg-gray-200"
                      >
                        <Minus size={16} />
                      </button>
                      {isReturnMode ? (
                        <FormInput
                          type="number"
                          key={`qty-${item.cartLineId}-${item.quantity}`}
                          defaultValue={item.quantity}
                          onBlur={(e) => {
                            const newQty = parseInt(e.target.value) || 0
                            if (newQty !== item.quantity) {
                              setQuantityDirectly(item.cartLineId, newQty)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                          }}
                          className="w-16 px-1 py-0.5 text-center border rounded font-medium"
                          inputSize="sm"
                        />
                      ) : (
                        <span className="w-8 text-center font-medium">{item.quantity}</span>
                      )}
                      <button
                        onClick={() => updateQuantity(item.cartLineId, 1)}
                        className="p-1 rounded bg-gray-100 hover:bg-gray-200"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <span className={`font-bold ${item.total < 0 ? 'text-red-600' : ''}`}>
                      {item.total.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
                    <span>@</span>
                    <FormInput
                      type="number"
                      step="0.01"
                      min="0.01"
                      key={`price-${item.cartLineId}-${item.unitPrice}`}
                      defaultValue={item.unitPrice}
                      onBlur={(e) => {
                        const newPrice = parseFloat(e.target.value) || 0
                        if (newPrice !== item.unitPrice) {
                          updatePrice(item.cartLineId, newPrice)
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur()
                        }
                      }}
                      className="w-20 px-1 py-0.5 border rounded text-right"
                      inputSize="sm"
                    />
                    <span>each</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Totals & Actions */}
        <div className={`p-4 border-t ${isReturnMode ? 'bg-red-50' : 'bg-white'}`}>
          <div className="space-y-2 mb-4">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className={subtotal < 0 ? 'text-red-600' : ''}>{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold">
              <span>{isReturnMode ? 'Refund Amount' : 'Total'}</span>
              <span className={total < 0 ? 'text-red-600' : ''}>
                {isReturnMode ? Math.abs(total).toFixed(2) : total.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Held Sales Indicator - Hide in return mode */}
          {!isReturnMode && heldSales.length > 0 && (
            <button
              onClick={() => setShowHeldSalesModal(true)}
              className="w-full mb-2 py-2 px-3 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 flex items-center justify-between"
            >
              <div className="flex items-center gap-2 text-amber-700">
                <Clock size={18} />
                <span className="font-medium">{heldSales.length} Held Sale{heldSales.length !== 1 ? 's' : ''}</span>
              </div>
              <Play size={18} className="text-amber-600" />
            </button>
          )}

          <div className={`grid ${isReturnMode ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
            <button
              onClick={clearCart}
              className="py-3 border rounded hover:bg-gray-50 disabled:opacity-50"
              disabled={cart.length === 0}
            >
              {isReturnMode ? 'Cancel' : 'Clear'}
            </button>
            {!isReturnMode && (
              <button
                onClick={holdSale}
                className="py-3 border border-amber-300 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 disabled:opacity-50 flex items-center justify-center gap-1"
                disabled={cart.length === 0 || holdingInProgress}
              >
                <Pause size={18} />
                Hold
              </button>
            )}
            <button
              onClick={openPaymentModal}
              className={`py-3 text-white rounded disabled:opacity-50 ${
                isReturnMode ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
              disabled={cart.length === 0}
            >
              {isReturnMode ? 'Process Return' : 'Pay'}
            </button>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && (() => {
        const creditUsed = parseFloat(creditAmount) || 0
        const remainingAfterCredit = Math.max(0, total - creditUsed)
        // For card/transfer, cap at remaining amount (no overpayment allowed)
        const maxCardAmount = remainingAfterCredit
        const cashCardPaid = parseFloat(amountPaid) || 0
        // For card/transfer, use capped amount
        const effectiveCashCardPaid = paymentMethod === 'cash' ? cashCardPaid : Math.min(cashCardPaid, maxCardAmount)
        const totalPaid = effectiveCashCardPaid + creditUsed
        const change = paymentMethod === 'cash' ? Math.max(0, totalPaid - total) : 0
        const balanceDue = Math.max(0, total - totalPaid)

        return (
          <Modal
            isOpen={true}
            onClose={() => setShowPayment(false)}
            title={isReturnMode ? 'Process Refund' : 'Payment'}
            size="md"
          >
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                {/* Return/Sale Summary */}
                <div className={`rounded p-3 ${isReturnMode ? 'bg-red-50' : 'bg-gray-50'}`}>
                  {selectedCustomer && (
                    <div className="flex justify-between text-sm">
                      <span>Customer:</span>
                      <span className="font-medium">{selectedCustomer.name}</span>
                    </div>
                  )}
                  {isReturnMode && returnAgainstSale && (
                    <div className="flex justify-between text-sm">
                      <span>Original Invoice:</span>
                      <span className="font-medium">{returnAgainstSale.invoiceNo}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span>Items:</span>
                    <span className="font-medium">{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className={`flex justify-between text-lg font-bold mt-2 ${isReturnMode ? 'text-red-700' : ''}`}>
                    <span>{isReturnMode ? 'Refund Amount:' : 'Total:'}</span>
                    <span>{currencyCode} {Math.abs(total).toFixed(2)}</span>
                  </div>
                </div>

                {/* Refund Method Selection (Return Mode Only) */}
                {isReturnMode && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Refund Method</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setRefundMethod('cash')}
                        className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                          refundMethod === 'cash'
                            ? 'border-green-500 bg-green-50 text-green-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Banknote size={24} />
                        <span className="text-sm font-medium">Cash</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRefundMethod('card')}
                        className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                          refundMethod === 'card'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <CreditCard size={24} />
                        <span className="text-sm font-medium">Card</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRefundMethod('credit')}
                        disabled={!selectedCustomer}
                        className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                          refundMethod === 'credit'
                            ? 'border-purple-500 bg-purple-50 text-purple-700'
                            : 'border-gray-200 hover:border-gray-300'
                        } ${!selectedCustomer ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <ShoppingBag size={24} />
                        <span className="text-sm font-medium">Credit</span>
                      </button>
                    </div>
                    {refundMethod === 'credit' && !selectedCustomer && (
                      <p className="text-xs text-amber-600 mt-2">Select a customer to add refund to their credit</p>
                    )}
                    {refundMethod === 'credit' && selectedCustomer && (
                      <p className="text-xs text-green-600 mt-2">Refund will be added to {selectedCustomer.name}&apos;s credit balance</p>
                    )}
                  </div>
                )}

                {/* Customer Credit (if available) - Normal sale mode only */}
                {!isReturnMode && selectedCustomer && customerCredit > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="text-sm font-medium text-green-800">Customer Credit Available</div>
                        <div className="text-lg font-bold text-green-700">{currencyCode} {customerCredit.toFixed(2)}</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const useAmount = Math.min(customerCredit, total)
                            const remaining = total - useAmount
                            setCreditAmount(useAmount.toFixed(2))
                            setAmountPaid(remaining > 0 ? remaining.toFixed(2) : '0')
                          }}
                          className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Use Credit
                        </button>
                        {creditUsed > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCreditAmount('')
                              setAmountPaid(total.toFixed(2))
                            }}
                            className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    {creditUsed > 0 && (
                      <div className="mt-2 pt-2 border-t border-green-200">
                      <label className="block text-sm font-medium text-green-800 mb-1">Credit Amount to Use</label>
                      <FormInput
                        type="number"
                        step="0.01"
                        min="0"
                        max={Math.min(customerCredit, total)}
                        value={creditAmount}
                        onChange={(e) => {
                          // Cap at the lesser of customerCredit and total
                          const maxCredit = Math.min(customerCredit, total)
                          const inputVal = parseFloat(e.target.value) || 0
                          // Prevent negative values
                          const val = Math.max(0, Math.min(inputVal, maxCredit))
                          // Only format on blur, not on every change (prevents cursor jumping)
                          setCreditAmount(val > 0 ? e.target.value : '')
                        }}
                        onBlur={(e) => {
                          // Format to 2 decimal places on blur
                          const val = parseFloat(e.target.value) || 0
                          if (val > 0) {
                            setCreditAmount(val.toFixed(2))
                          }
                        }}
                        className="border border-green-300 focus:ring-2 focus:ring-green-500"
                      />
                      </div>
                    )}
                  </div>
                )}

                {/* Payment Method - Normal sale mode only */}
                {!isReturnMode && (
                <div>
                  <label className="block text-sm font-medium mb-2">Payment Method</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('cash')}
                      className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                        paymentMethod === 'cash'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <Banknote size={24} />
                      <span className="text-sm font-medium">Cash</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMethod('card')
                        // Cap amount to remaining if switching to card
                        if (cashCardPaid > remainingAfterCredit) {
                          setAmountPaid(remainingAfterCredit.toFixed(2))
                        }
                      }}
                      className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                        paymentMethod === 'card'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <CreditCard size={24} />
                      <span className="text-sm font-medium">Card</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMethod('bank_transfer')
                        // Cap amount to remaining if switching to transfer
                        if (cashCardPaid > remainingAfterCredit) {
                          setAmountPaid(remainingAfterCredit.toFixed(2))
                        }
                      }}
                      className={`flex flex-col items-center gap-1 p-3 rounded border-2 transition-colors ${
                        paymentMethod === 'bank_transfer'
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <ShoppingBag size={24} />
                      <span className="text-sm font-medium">Transfer</span>
                    </button>
                  </div>
                </div>
                )}

                {/* Amount Paid - Normal sale mode only */}
                {!isReturnMode && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Card' : 'Transfer'} Amount
                    {paymentMethod !== 'cash' && <span className="text-gray-500 font-normal"> (max: {currencyCode} {remainingAfterCredit.toFixed(2)})</span>}
                  </label>
                  <FormInput
                    type="number"
                    step="0.01"
                    min="0"
                    max={paymentMethod !== 'cash' ? remainingAfterCredit : undefined}
                    value={amountPaid}
                    onChange={(e) => {
                      let val = parseFloat(e.target.value) || 0
                      // Prevent negative values
                      val = Math.max(0, val)
                      // For card/transfer, cap at remaining amount
                      if (paymentMethod !== 'cash' && val > remainingAfterCredit) {
                        val = remainingAfterCredit
                      }
                      setAmountPaid(val > 0 ? val.toString() : '0')
                    }}
                    className="border rounded focus:ring-2 focus:ring-blue-500 text-lg"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setAmountPaid(remainingAfterCredit.toFixed(2))}
                      className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
                    >
                      Exact
                    </button>
                    {paymentMethod === 'cash' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setAmountPaid((Math.ceil(total / 100) * 100).toFixed(2))}
                          className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
                        >
                          Round 100
                        </button>
                        <button
                          type="button"
                          onClick={() => setAmountPaid((Math.ceil(total / 500) * 500).toFixed(2))}
                          className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
                        >
                          Round 500
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setAmountPaid('0')}
                      className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
                    >
                      Zero
                    </button>
                  </div>
                </div>
                )}

                {/* Payment Summary - Normal sale mode only */}
                {!isReturnMode && (
                <div className="bg-gray-50 rounded p-3 space-y-1">
                  <div className="text-sm font-medium text-gray-600 mb-2">Payment Summary</div>
                  {creditUsed > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>Credit Used:</span>
                      <span className="text-green-600">{currencyCode} {creditUsed.toFixed(2)}</span>
                    </div>
                  )}
                  {effectiveCashCardPaid > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>{paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Card' : 'Transfer'}:</span>
                      <span>{currencyCode} {effectiveCashCardPaid.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium border-t pt-1 mt-1">
                    <span>Total Paid:</span>
                    <span>{currencyCode} {totalPaid.toFixed(2)}</span>
                  </div>
                </div>
                )}

                {/* Refund Summary - Return mode only */}
                {isReturnMode && (
                <div className="bg-red-50 rounded p-3 space-y-2">
                  <div className="text-sm font-medium text-red-800 mb-2">Refund Summary</div>
                  <div className="flex justify-between text-sm">
                    <span>Return Items:</span>
                    <span>{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t border-red-200 pt-2 mt-2">
                    <span>Refund Amount:</span>
                    <span className="text-red-600">{currencyCode} {Math.abs(total).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Refund Method:</span>
                    <span className="font-medium">
                      {refundMethod === 'cash' ? 'Cash' : refundMethod === 'card' ? 'Card' : 'Customer Credit'}
                    </span>
                  </div>
                  {refundMethod === 'credit' && selectedCustomer && (
                    <div className="text-xs text-green-700 bg-green-100 rounded p-2 mt-2">
                      Amount will be added to {selectedCustomer.name}&apos;s credit balance
                    </div>
                  )}
                </div>
                )}

                {/* Change (for cash only) - Normal sale mode only */}
                {!isReturnMode && change > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded p-3 text-center">
                    <span className="text-green-800 font-bold text-xl">Change: {currencyCode} {change.toFixed(2)}</span>
                  </div>
                )}

                {/* Balance due warning - Normal sale mode only */}
                {!isReturnMode && balanceDue > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
                    <span className="text-yellow-800">
                      Balance due: <strong>{currencyCode} {balanceDue.toFixed(2)}</strong>
                    </span>
                  </div>
                )}
            </div>

            {/* AI Smart Warnings */}
            {((isReturnMode ? returnWarnings.warnings : saleWarnings.warnings).length > 0 ||
              (isReturnMode ? returnWarnings.loading : saleWarnings.loading)) && (
              <SmartWarningBanner
                warnings={isReturnMode ? returnWarnings.warnings : saleWarnings.warnings}
                loading={isReturnMode ? returnWarnings.loading : saleWarnings.loading}
                onProceed={() => {
                  setWarningBypassed(true)
                  if (isReturnMode) {
                    returnWarnings.clearWarnings()
                  } else {
                    saleWarnings.clearWarnings()
                  }
                  completeSale()
                }}
                onCancel={() => {
                  if (isReturnMode) {
                    returnWarnings.clearWarnings()
                  } else {
                    saleWarnings.clearWarnings()
                  }
                }}
                processing={processing}
              />
            )}

            {(isReturnMode ? returnWarnings.warnings : saleWarnings.warnings).length === 0 && (
            <div className="flex gap-2 pt-4 mt-4 border-t dark:border-gray-700">
              <button
                onClick={() => setShowPayment(false)}
                disabled={processing}
                className="flex-1 px-4 py-2 border dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={completeSale}
                disabled={processing || (isReturnMode && refundMethod === 'credit' && !selectedCustomer)}
                className={`flex-1 px-4 py-3 text-white rounded font-medium disabled:opacity-50 ${
                  isReturnMode
                    ? 'bg-red-600 hover:bg-red-700'
                    : balanceDue > 0
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {processing
                  ? 'Processing...'
                  : isReturnMode
                    ? `Process Refund (${currencyCode} ${Math.abs(total).toFixed(2)})`
                    : balanceDue > 0
                      ? `Complete (Balance: ${currencyCode} ${balanceDue.toFixed(2)})`
                      : 'Complete Sale'}
              </button>
            </div>
            )}
          </Modal>
        )
      })()}

      {/* Success Modal */}
      {lastSale && (
        <Modal
          isOpen={true}
          onClose={() => setLastSale(null)}
          title=""
          size="sm"
        >
          <div className="text-center">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={48} className="text-green-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
              {lastSale.isReturn ? 'Return Processed!' : 'Sale Complete!'}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-1">{lastSale.isReturn ? 'Return Number' : 'Invoice Number'}</p>
            <p className="text-lg font-semibold text-blue-600 mb-4">{lastSale.invoiceNo}</p>
            <div className={`rounded-md p-4 mb-6 ${lastSale.isReturn ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
              <p className="text-sm text-gray-500 dark:text-gray-400">{lastSale.isReturn ? 'Refund Amount' : 'Total Amount'}</p>
              <p className={`text-3xl font-bold ${lastSale.isReturn ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                {currencyCode} {lastSale.total.toFixed(2)}
              </p>
            </div>
            <button
              onClick={() => setLastSale(null)}
              className={`w-full py-4 text-white rounded-md font-semibold transition-colors flex items-center justify-center gap-2 ${
                lastSale.isReturn ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <ShoppingBag size={20} />
              {lastSale.isReturn ? 'Continue' : 'Start New Sale'}
            </button>
          </div>
        </Modal>
      )}

      {/* Held Sales Modal */}
      <Modal
        isOpen={showHeldSalesModal}
        onClose={() => setShowHeldSalesModal(false)}
        title={
          <span className="flex items-center gap-2">
            <Clock size={20} className="text-amber-600" />
            Held Sales
          </span>
        }
        size="lg"
      >
        <div className="max-h-[60vh] overflow-y-auto">
          {heldSales.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No held sales
            </div>
          ) : (
            <div className="space-y-3">
              {heldSales.map(held => (
                <div
                  key={held.id}
                  className="border dark:border-gray-700 rounded p-3 hover:border-amber-300 dark:hover:border-amber-600 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-medium text-amber-700 dark:text-amber-500">{held.holdNumber}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(held.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold dark:text-white">{currencyCode} {parseFloat(held.subtotal).toFixed(2)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {held.cartItems.length} item{held.cartItems.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  {(held.customer || held.vehicle) && (
                    <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                      {held.customer && <span>{held.customer.name}</span>}
                      {held.customer && held.vehicle && <span> • </span>}
                      {held.vehicle && (
                        <span>
                          {held.vehicle.make} {held.vehicle.model}
                          {held.vehicle.licensePlate && ` (${held.vehicle.licensePlate})`}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    {held.cartItems.map((item, idx) => (
                      <span key={idx}>
                        {idx > 0 && ', '}
                        {item.quantity}x {item.name}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => recallHeldSale(held)}
                      className="flex-1 py-2 bg-amber-500 text-white rounded hover:bg-amber-600 flex items-center justify-center gap-1"
                    >
                      <Play size={16} />
                      Recall
                    </button>
                    <button
                      onClick={() => deleteHeldSale(held.id)}
                      className="px-3 py-2 border border-red-200 dark:border-red-800 text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Modals */}
      <CustomerFormModal
        isOpen={showCustomerModal}
        onClose={() => {
          setShowCustomerModal(false)
          setPendingCustomerName('')
        }}
        onSaved={(customer) => {
          setCustomers([...customers, customer])
          setSelectedCustomer(customer)
        }}
        initialName={pendingCustomerName}
      />

      <VehicleModal
        isOpen={showVehicleModal}
        onClose={() => setShowVehicleModal(false)}
        onCreated={(vehicle) => {
          fetchVehicles()
          setSelectedVehicle(vehicle as Vehicle)
          if (vehicle.customerId) {
            const cust = customers.find(c => c.id === vehicle.customerId)
            setSelectedCustomer(cust || null)
          }
        }}
        customers={customers}
        makes={makes}
        onMakesUpdated={fetchMakes}
        onCustomersUpdated={fetchCustomers}
        selectedCustomerId={selectedCustomer?.id}
      />

      {/* Customer-Vehicle Mismatch Dialog */}
      {showMismatchDialog && mismatchInfo && pendingVehicle && (
        <Modal
          isOpen={true}
          onClose={() => {
            setShowMismatchDialog(false)
            setMismatchInfo(null)
            setPendingVehicle(null)
          }}
          title={<span className="text-orange-600">Vehicle Ownership Mismatch</span>}
          size="md"
        >
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            This vehicle belongs to <strong>&quot;{mismatchInfo.vehicleOwnerName}&quot;</strong>, not the selected customer.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Do you want to proceed with the selected customer, or use the vehicle owner as the customer?
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                setSelectedVehicle(pendingVehicle)
                setShowMismatchDialog(false)
                setMismatchInfo(null)
                setPendingVehicle(null)
              }}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
            >
              Keep Selected Customer
            </button>
            <button
              onClick={() => {
                // Use vehicle owner as customer
                const owner = customers.find(c => c.id === mismatchInfo.vehicleOwnerId)
                setSelectedCustomer(owner || null)
                setSelectedVehicle(pendingVehicle)
                setShowMismatchDialog(false)
                setMismatchInfo(null)
                setPendingVehicle(null)
                toast.info('Customer updated to vehicle owner')
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Use Vehicle Owner ({mismatchInfo.vehicleOwnerName})
            </button>
            <button
              onClick={() => {
                setShowMismatchDialog(false)
                setMismatchInfo(null)
                setPendingVehicle(null)
              }}
              className="px-4 py-2 border dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      <ConfirmModal
        isOpen={recallConfirm.open}
        onClose={() => setRecallConfirm({ open: false, heldSale: null })}
        onConfirm={() => {
          if (recallConfirm.heldSale) {
            performRecallHeldSale(recallConfirm.heldSale)
          }
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

      {/* Issue #11: Return processing confirmation */}
      <ConfirmModal
        isOpen={showReturnConfirmation}
        onClose={() => setShowReturnConfirmation(false)}
        onConfirm={() => completeSale()}
        title="Confirm Return"
        message={`Process refund of ${currencyCode} ${Math.abs(total).toFixed(2)} via ${refundMethod === 'cash' ? 'Cash' : refundMethod === 'card' ? 'Card' : 'Customer Credit'}?`}
        confirmText="Process Return"
        variant="warning"
      />

      {/* Return Lookup Modal */}
      <Modal
        isOpen={showReturnLookupModal}
        onClose={() => {
          setShowReturnLookupModal(false)
          setReturnSearchQuery('')
          setReturnSearchResults([])
        }}
        title="Customer Return"
        size="xl"
      >
        {/* Option buttons */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => {
              setShowReturnLookupModal(false)
              setIsReturnMode(true)
              setReturnAgainstSale(null)
              toast.info('Manual return mode. Add items from the product list.')
            }}
            className="p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-center"
          >
            <Package size={32} className="mx-auto mb-2 text-gray-500 dark:text-gray-400" />
            <div className="font-medium dark:text-white">Manual Entry</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Add return items manually</div>
          </button>
          <div className="p-4 border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded text-center">
            <Search size={32} className="mx-auto mb-2 text-red-500" />
            <div className="font-medium text-red-700 dark:text-red-400">Lookup Invoice</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Search existing invoice</div>
          </div>
        </div>

        {/* Invoice search */}
        <div className="relative mb-4">
          <FormInput
            type="text"
            placeholder="Search by invoice number or customer name..."
            value={returnSearchQuery}
            onChange={(e) => setReturnSearchQuery(e.target.value)}
            leftIcon={<Search className="text-gray-400" size={20} />}
            className="py-2 dark:bg-gray-800 dark:text-white"
            autoFocus
          />
        </div>
        <div className="overflow-y-auto max-h-72">
          {searchingReturns ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <LoadingSpinner size="lg" text="Searching..." />
            </div>
          ) : returnSearchResults.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              {returnSearchQuery ? 'No sales found' : 'Enter invoice number or customer name to search'}
            </div>
          ) : (
            <div className="space-y-2">
              {returnSearchResults.map((sale) => (
                <button
                  key={sale.id}
                  onClick={() => loadSaleForReturn(sale)}
                  className="w-full p-3 border dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium dark:text-white">{sale.invoiceNo}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {sale.customer?.name || 'Walk-in'} • {new Date(sale.createdAt).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {sale.items?.length || 0} item{(sale.items?.length || 0) !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold dark:text-white">{currencyCode} {parseFloat(sale.total).toFixed(2)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
