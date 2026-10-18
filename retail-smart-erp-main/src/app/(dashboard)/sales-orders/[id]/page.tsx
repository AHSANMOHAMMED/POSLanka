'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import {
  ChevronDown, ChevronRight, Heart, RotateCw, MoreHorizontal,
  Printer, Trash2, Plus, Warehouse, Calendar,
  User, Package, ChevronUp, X, FileText
} from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { CancellationReasonModal, ItemModal, CreateSalesInvoiceModal, CustomerFormModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date-format'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { LinkField, LinkFieldOption } from '@/components/ui/link-field'
import { formatItemLabel, buildItemSearchOption } from '@/lib/utils/item-display'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { PrintPreview, SalesOrderTemplate } from '@/components/print'
import { DEFAULT_PRINT_SETTINGS } from '@/lib/print/types'

interface OrderItem {
  id: string
  itemId: string | null
  itemName: string
  itemSku: string | null
  itemBarcode: string | null
  itemOemPartNumber: string | null
  itemPluCode: string | null
  quantity: string
  fulfilledQuantity: string
  unitPrice: string
  discount: string
  discountType: string | null
  tax: string
  taxAmount: string
  taxRate: string
  total: string
}

interface LinkedInvoice {
  id: string
  invoiceNo: string
  total: string
  status: string
  createdAt: string
  voidReason: string | null
}

interface SalesOrder {
  id: string
  orderNo: string
  customerId: string | null
  customerName: string | null
  vehicleId: string | null
  vehiclePlate: string | null
  vehicleDescription: string | null
  warehouseId: string
  warehouseName: string | null
  expectedDeliveryDate: string | null
  deliveryAddress: string | null
  subtotal: string
  discountAmount: string
  discountType: string | null
  taxAmount: string
  total: string
  status: 'draft' | 'confirmed' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'
  notes: string | null
  createdBy: string | null
  createdByName: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  items: OrderItem[]
  linkedInvoices: LinkedInvoice[]
}

interface Item {
  id: string
  name: string
  sku: string | null
  barcode?: string | null
  oemPartNumber?: string | null
  pluCode?: string | null
  costPrice: string
  sellingPrice: string
  trackStock?: boolean
  availableStock?: string
}

interface WarehouseData {
  id: string
  name: string
}

interface Customer {
  id: string
  name: string
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
  useSameBillingAddress?: boolean | null
  billingAddressLine1?: string | null
  billingAddressLine2?: string | null
  billingCity?: string | null
  billingState?: string | null
  billingPostalCode?: string | null
  billingCountry?: string | null
}

interface CustomerAddress {
  label: string
  formatted: string
}

interface EditableItem {
  id: string
  itemId: string
  itemName: string
  itemSku: string | null
  itemBarcode: string | null
  itemPartNumber: string | null
  quantity: number
  unitPrice: number
  discount: number
  taxAmount: number
  taxRate: number
  total: number
  isNew?: boolean
}

const statusConfig: Record<string, { label: string; color: string; bgColor: string; dotColor: string }> = {
  draft: { label: 'Draft', color: 'text-red-600', bgColor: 'bg-red-50 border-red-200', dotColor: 'bg-red-500' },
  confirmed: { label: 'Confirmed', color: 'text-blue-600', bgColor: 'bg-blue-50 border-blue-200', dotColor: 'bg-blue-500' },
  partially_fulfilled: { label: 'Partially Fulfilled', color: 'text-orange-600', bgColor: 'bg-orange-50 border-orange-200', dotColor: 'bg-orange-500' },
  fulfilled: { label: 'Fulfilled', color: 'text-green-600', bgColor: 'bg-green-50 border-green-200', dotColor: 'bg-green-500' },
  cancelled: { label: 'Cancelled', color: 'text-gray-600', bgColor: 'bg-gray-100 border-gray-300', dotColor: 'bg-gray-500' },
}

export default function SalesOrderDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const { tenantSlug, businessType, tenantName, currency } = useCompany()
  const isCreateMode = id === 'new'

  const [order, setOrder] = useState<SalesOrder | null>(null)
  const [loading, setLoading] = useState(!isCreateMode)
  const [saving, setSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Data
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([])

  // UI State
  const [liked, setLiked] = useState(false)
  const [showMenuDropdown, setShowMenuDropdown] = useState(false)
  const [showMoreDropdown, setShowMoreDropdown] = useState(false)
  const [showPrintPreview, setShowPrintPreview] = useState(false)

  // Collapsible sections
  const [sectionsOpen, setSectionsOpen] = useState({
    customer: true,
    items: true,
    totals: true,
    invoices: true,
    moreInfo: true,
  })

  // Create mode state
  const [createFormData, setCreateFormData] = useState({
    customerId: '',
    customerName: '',
    warehouseId: '',
    expectedDeliveryDate: '',
    deliveryAddress: '',
    notes: '',
  })

  // Edit mode state
  const [editingItems, setEditingItems] = useState<EditableItem[]>([])
  const [headerForm, setHeaderForm] = useState({
    customerId: '',
    customerName: '',
    warehouseId: '',
    expectedDeliveryDate: '',
    deliveryAddress: '',
    notes: '',
  })

  // Customer addresses for delivery address shortcuts
  const [customerAddresses, setCustomerAddresses] = useState<CustomerAddress[]>([])

  // Track deleted items for activity log change summaries
  const [deletedItemNames, setDeletedItemNames] = useState<string[]>([])

  // Modals
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showConfirmConfirm, setShowConfirmConfirm] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [showCreateInvoiceModal, setShowCreateInvoiceModal] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [pendingCustomerName, setPendingCustomerName] = useState('')
  const [itemInitialName, setItemInitialName] = useState('')
  const [pendingItemRowIndex, setPendingItemRowIndex] = useState<number | null>(null)

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales-orders/${id}`)
      if (res.ok) {
        const data = await res.json()
        setOrder(data)
        setHeaderForm({
          customerId: data.customerId || '',
          customerName: data.customerName || '',
          warehouseId: data.warehouseId || '',
          expectedDeliveryDate: data.expectedDeliveryDate || '',
          deliveryAddress: data.deliveryAddress || '',
          notes: data.notes || '',
        })
        setEditingItems(data.items.map((item: OrderItem) => ({
          id: item.id,
          itemId: item.itemId || '',
          itemName: item.itemName,
          itemSku: item.itemSku,
          itemBarcode: item.itemBarcode || null,
          itemPartNumber: item.itemOemPartNumber || item.itemPluCode || null,
          quantity: parseFloat(item.quantity) || 0,
          unitPrice: parseFloat(item.unitPrice) || 0,
          discount: parseFloat(item.discount) || 0,
          taxAmount: parseFloat(item.taxAmount) || 0,
          taxRate: parseFloat(item.taxRate) || 0,
          total: parseFloat(item.total) || 0,
        })))
        setHasUnsavedChanges(false)
      } else {
        toast.error('Failed to load sales order')
        router.push(tenantSlug ? `/c/${tenantSlug}/sales-orders` : '/sales-orders')
      }
    } catch (error) {
      console.error('Error fetching order:', error)
      toast.error('Failed to load sales order')
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  useEffect(() => {
    async function fetchData() {
      const [warehousesRes, categoriesRes, costCentersRes] = await Promise.all([
        fetch('/api/warehouses?all=true'),
        fetch('/api/categories?all=true'),
        fetch('/api/accounting/cost-centers?all=true'),
      ])
      if (warehousesRes.ok) setWarehouses(await warehousesRes.json())
      if (categoriesRes.ok) setCategories(await categoriesRes.json())
      if (costCentersRes.ok) {
        const data = await costCentersRes.json()
        setCostCenters(Array.isArray(data) ? data.filter((cc: { isGroup: boolean; isActive: boolean }) => !cc.isGroup && cc.isActive) : [])
      }
    }
    fetchData()
  }, [])

  useRealtimeData(fetchOrder, { entityType: 'sales-order', enabled: !isCreateMode })

  // Fetch customer addresses for delivery address shortcuts
  const fetchCustomerAddresses = useCallback(async (custId: string) => {
    if (!custId) {
      setCustomerAddresses([])
      return
    }
    try {
      const res = await fetch(`/api/customers/${custId}`)
      if (!res.ok) return
      const cust: Customer = await res.json()
      const addresses: CustomerAddress[] = []

      // Format primary address
      const primaryParts = [cust.addressLine1, cust.addressLine2, cust.city, cust.state, cust.postalCode, cust.country].filter(Boolean)
      if (primaryParts.length > 0) {
        addresses.push({ label: 'Primary Address', formatted: primaryParts.join(', ') })
      }

      // Format billing address (only if different)
      if (!cust.useSameBillingAddress) {
        const billingParts = [cust.billingAddressLine1, cust.billingAddressLine2, cust.billingCity, cust.billingState, cust.billingPostalCode, cust.billingCountry].filter(Boolean)
        if (billingParts.length > 0) {
          const billingFormatted = billingParts.join(', ')
          // Only show if different from primary
          if (primaryParts.length === 0 || billingFormatted !== primaryParts.join(', ')) {
            addresses.push({ label: 'Billing Address', formatted: billingFormatted })
          }
        }
      }

      setCustomerAddresses(addresses)
    } catch {
      setCustomerAddresses([])
    }
  }, [])

  // Fetch addresses when order loads with a customer
  useEffect(() => {
    const custId = isCreateMode ? createFormData.customerId : headerForm.customerId
    if (custId) fetchCustomerAddresses(custId)
  }, [isCreateMode, createFormData.customerId, headerForm.customerId, fetchCustomerAddresses])

  // Customer search
  const searchCustomers = useCallback(async (searchTerm: string): Promise<LinkFieldOption[]> => {
    const params = new URLSearchParams({ pageSize: '15' })
    if (searchTerm) params.set('search', searchTerm)
    const res = await fetch(`/api/customers?${params}`)
    if (!res.ok) return []
    const result = await res.json()
    const data = Array.isArray(result) ? result : (result.data || [])
    return data.map((c: Customer) => ({ value: c.id, label: c.name }))
  }, [])

  // Item search
  const searchItems = useCallback(async (searchTerm: string): Promise<LinkFieldOption[]> => {
    try {
      const params = new URLSearchParams({ pageSize: '15' })
      if (searchTerm) params.set('search', searchTerm)
      const whId = createFormData.warehouseId || headerForm.warehouseId
      if (whId) params.set('warehouseId', whId)
      const res = await fetch(`/api/items?${params}`)
      if (!res.ok) return []
      const result = await res.json()
      const data: Item[] = Array.isArray(result) ? result : (result.data || [])
      return data.map((item) => buildItemSearchOption(item, businessType, { showStock: true }))
    } catch (err) {
      console.error('searchItems error:', err)
      return []
    }
  }, [businessType, createFormData.warehouseId, headerForm.warehouseId])

  // Create order
  async function handleCreate() {
    if (!createFormData.customerId) {
      toast.error('Please select a customer')
      return
    }
    if (!createFormData.warehouseId) {
      toast.error('Please select a warehouse')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/sales-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: createFormData.customerId || null,
          customerName: createFormData.customerName || null,
          warehouseId: createFormData.warehouseId,
          expectedDeliveryDate: createFormData.expectedDeliveryDate || null,
          deliveryAddress: createFormData.deliveryAddress || null,
          notes: createFormData.notes || null,
          items: [],
        }),
      })

      if (res.ok) {
        const savedOrder = await res.json()
        toast.success(`Sales Order ${savedOrder.orderNo} created`)
        router.replace(tenantSlug ? `/c/${tenantSlug}/sales-orders/${savedOrder.id}` : `/sales-orders/${savedOrder.id}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create sales order')
      }
    } catch (err) {
      console.error('Error creating:', err)
      toast.error('Failed to create sales order')
    } finally {
      setSaving(false)
    }
  }

  // Save changes (items + header fields)
  async function handleSave() {
    if (!order) return
    setSaving(true)

    try {
      // Build item changes summary for activity log
      const itemChanges: string[] = []
      const originalItems = order.items || []
      if (deletedItemNames.length > 0) {
        itemChanges.push(`removed ${deletedItemNames.join(', ')}`)
      }
      const newItems = editingItems.filter(i => i.isNew && i.itemId)
      if (newItems.length > 0) {
        itemChanges.push(`added ${newItems.map(i => i.itemName).join(', ')}`)
      }
      for (const item of editingItems) {
        if (item.isNew) continue
        const orig = originalItems.find(o => o.id === item.id)
        if (orig) {
          const qtyChanged = item.quantity !== (parseFloat(orig.quantity) || 0)
          const priceChanged = item.unitPrice !== (parseFloat(orig.unitPrice) || 0)
          if (qtyChanged || priceChanged) {
            const parts: string[] = []
            if (qtyChanged) parts.push(`qty ${parseFloat(orig.quantity)} → ${item.quantity}`)
            if (priceChanged) parts.push(`price ${parseFloat(orig.unitPrice)} → ${item.unitPrice}`)
            itemChanges.push(`${item.itemName} (${parts.join(', ')})`)
          }
        }
      }
      const changesSummary = itemChanges.length > 0 ? itemChanges.join('; ') : undefined

      const res = await fetch(`/api/sales-orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: headerForm.customerId || null,
          customerName: headerForm.customerName || null,
          warehouseId: headerForm.warehouseId || undefined,
          expectedDeliveryDate: headerForm.expectedDeliveryDate || null,
          deliveryAddress: headerForm.deliveryAddress || null,
          notes: headerForm.notes || null,
          expectedUpdatedAt: order.updatedAt,
          changesSummary,
          items: editingItems.map(item => ({
            id: item.isNew ? undefined : item.id,
            itemId: item.itemId || undefined,
            itemName: item.itemName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxAmount: item.taxAmount,
            taxRate: item.taxRate,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (data.code === 'CONFLICT') {
          toast.error('Modified by another user. Refreshing...')
          fetchOrder()
          return
        }
        toast.error(data.error || 'Failed to save')
        return
      }

      toast.success('Saved')
      setHasUnsavedChanges(false)
      setDeletedItemNames([])
      fetchOrder()
    } catch (error) {
      console.error('Error saving:', error)
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Status change
  async function handleStatusChange(newStatus: string, reason?: string) {
    if (!order) return
    setSaving(true)

    try {
      const res = await fetch(`/api/sales-orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          cancellationReason: reason,
          expectedUpdatedAt: order.updatedAt,
        }),
      })

      if (res.ok) {
        toast.success(newStatus === 'cancelled' ? 'Order cancelled' : 'Status updated')
        fetchOrder()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update status')
      }
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to update')
    } finally {
      setSaving(false)
      setShowCancelModal(false)
    }
  }

  // Create invoice
  async function handleCreateInvoice(data: {
    fulfilledQuantities: Record<string, number>
    notes: string
    costCenterId?: string
  }) {
    if (!order) return
    setSaving(true)

    try {
      const res = await fetch(`/api/sales-orders/${id}/create-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fulfilledQuantities: data.fulfilledQuantities,
          notes: data.notes,
          costCenterId: data.costCenterId || null,
        }),
      })

      if (res.ok) {
        const result = await res.json()
        toast.success(result.message || 'Invoice created')
        setShowCreateInvoiceModal(false)
        fetchOrder()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create invoice')
      }
    } catch (error) {
      console.error('Error creating invoice:', error)
      toast.error('Failed to create invoice')
    } finally {
      setSaving(false)
    }
  }

  // Delete order
  async function handleDelete() {
    if (!order || order.status !== 'draft') return
    if (!confirm('Delete this draft sales order?')) return

    setSaving(true)
    try {
      const res = await fetch(`/api/sales-orders/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Sales order deleted')
        router.push(tenantSlug ? `/c/${tenantSlug}/sales-orders` : '/sales-orders')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete')
      }
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to delete')
    } finally {
      setSaving(false)
    }
  }

  // Item handlers
  function handleAddRow() {
    setEditingItems([...editingItems, {
      id: `new-${Date.now()}`,
      itemId: '',
      itemName: '',
      itemSku: null,
      itemBarcode: null,
      itemPartNumber: null,
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      taxAmount: 0,
      taxRate: 0,
      total: 0,
      isNew: true,
    }])
    setHasUnsavedChanges(true)
  }

  function handleItemChange(index: number, field: string, value: unknown, option?: LinkFieldOption) {
    const newItems = [...editingItems]
    if (field === 'itemId' && option) {
      const sellingPrice = parseFloat(option.data?.sellingPrice as string || '0')
      newItems[index] = {
        ...newItems[index],
        itemId: String(value),
        itemName: option.data?.name as string || option.label,
        itemSku: option.data?.sku as string || option.sublabel || null,
        itemBarcode: option.data?.barcode as string || null,
        itemPartNumber: (option.data?.oemPartNumber || option.data?.sku || option.data?.pluCode) as string || null,
        unitPrice: sellingPrice,
        total: newItems[index].quantity * sellingPrice - newItems[index].discount + newItems[index].taxAmount,
      }
    } else if (field === 'quantity') {
      const qty = parseFloat(String(value)) || 0
      newItems[index] = { ...newItems[index], quantity: qty, total: qty * newItems[index].unitPrice - newItems[index].discount + newItems[index].taxAmount }
    } else if (field === 'unitPrice') {
      const price = parseFloat(String(value)) || 0
      newItems[index] = { ...newItems[index], unitPrice: price, total: newItems[index].quantity * price - newItems[index].discount + newItems[index].taxAmount }
    } else if (field === 'discount') {
      const disc = parseFloat(String(value)) || 0
      newItems[index] = { ...newItems[index], discount: disc, total: newItems[index].quantity * newItems[index].unitPrice - disc + newItems[index].taxAmount }
    }
    setEditingItems(newItems)
    setHasUnsavedChanges(true)
  }

  function handleDeleteRow(index: number) {
    const item = editingItems[index]
    if (item && !item.isNew && item.itemName) {
      setDeletedItemNames(prev => [...prev, item.itemName])
    }
    setEditingItems(editingItems.filter((_, i) => i !== index))
    setHasUnsavedChanges(true)
  }

  function handleItemCreated(item: { id: string; name: string; sku?: string; barcode?: string; oemPartNumber?: string; pluCode?: string; sellingPrice: string }) {
    if (pendingItemRowIndex !== null) {
      const sellingPrice = parseFloat(item.sellingPrice || '0')
      const newItems = [...editingItems]
      newItems[pendingItemRowIndex] = {
        ...newItems[pendingItemRowIndex],
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku || null,
        itemBarcode: item.barcode || null,
        itemPartNumber: item.oemPartNumber || item.pluCode || null,
        unitPrice: sellingPrice,
        total: newItems[pendingItemRowIndex].quantity * sellingPrice,
      }
      setEditingItems(newItems)
      setHasUnsavedChanges(true)
    }
    setShowItemModal(false)
    setPendingItemRowIndex(null)
    toast.success(`Item "${item.name}" created`)
  }

  function toggleSection(section: keyof typeof sectionsOpen) {
    setSectionsOpen({ ...sectionsOpen, [section]: !sectionsOpen[section] })
  }

  // Computed
  const totalQty = editingItems.reduce((sum, item) => sum + item.quantity, 0)
  const totalAmount = editingItems.reduce((sum, item) => sum + item.total, 0)

  if (loading) {
    return <PageLoading text="Loading sales order..." />
  }

  // ==================== CREATE MODE ====================
  if (isCreateMode) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 -m-5">
        {/* Breadcrumb */}
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Link href={tenantSlug ? `/c/${tenantSlug}/dashboard` : '/dashboard'} className="hover:text-blue-600 dark:hover:text-blue-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </Link>
            <ChevronRight size={14} />
            <span className="text-gray-400">Selling</span>
            <ChevronRight size={14} />
            <Link href={tenantSlug ? `/c/${tenantSlug}/sales-orders` : '/sales-orders'} className="hover:text-blue-600 dark:hover:text-blue-400">
              Sales Order
            </Link>
            <ChevronRight size={14} />
            <span className="text-gray-900 dark:text-white font-medium">New</span>
          </div>
        </div>

        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New Sales Order</h1>
        </div>

        {/* Form */}
        <div className="p-6 max-w-4xl">
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
            <div className="px-4 py-3 font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700">
              Customer and Warehouse
            </div>
            <div className="px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Customer <span className="text-red-500">*</span>
                </label>
                <LinkField
                  fetchOptions={searchCustomers}
                  value={createFormData.customerId}
                  onChange={(value, option) => {
                    setCreateFormData({ ...createFormData, customerId: value, customerName: option?.label || '' })
                    fetchCustomerAddresses(value)
                  }}
                  onCreateNew={(name) => { setPendingCustomerName(name); setShowCustomerModal(true) }}
                  placeholder="Select Customer"
                  createLabel="Create new customer"
                  displayValue={createFormData.customerName}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Warehouse <span className="text-red-500">*</span>
                </label>
                <select
                  value={createFormData.warehouseId}
                  onChange={(e) => setCreateFormData({ ...createFormData, warehouseId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                >
                  <option value="">Select Warehouse</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Expected Delivery Date
                </label>
                <input
                  type="date"
                  value={createFormData.expectedDeliveryDate}
                  onChange={(e) => setCreateFormData({ ...createFormData, expectedDeliveryDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Delivery Address
                </label>
                <input
                  type="text"
                  value={createFormData.deliveryAddress}
                  onChange={(e) => setCreateFormData({ ...createFormData, deliveryAddress: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                  placeholder="Delivery address"
                />
                {customerAddresses.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {customerAddresses.map((addr) => (
                      <button
                        key={addr.label}
                        type="button"
                        onClick={() => setCreateFormData({ ...createFormData, deliveryAddress: addr.formatted })}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline"
                      >
                        Use {addr.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
            <Link
              href={tenantSlug ? `/c/${tenantSlug}/sales-orders` : '/sales-orders'}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ==================== VIEW/EDIT MODE ====================
  if (!order) {
    return <div className="text-center py-8 text-gray-500">Sales order not found</div>
  }

  const isDraft = order.status === 'draft'
  const isConfirmed = order.status === 'confirmed'
  const isPartiallyFulfilled = order.status === 'partially_fulfilled'
  const isCancelled = order.status === 'cancelled'
  const isFulfilled = order.status === 'fulfilled'
  const status = statusConfig[order.status] || statusConfig.draft
  const canCreateInvoice = isConfirmed || isPartiallyFulfilled

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 -m-5">
      {/* ===== BREADCRUMB ===== */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link href={tenantSlug ? `/c/${tenantSlug}/dashboard` : '/dashboard'} className="hover:text-blue-600 dark:hover:text-blue-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-400">Selling</span>
          <ChevronRight size={14} />
          <Link href={tenantSlug ? `/c/${tenantSlug}/sales-orders` : '/sales-orders'} className="hover:text-blue-600 dark:hover:text-blue-400">
            Sales Order
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium">{order.orderNo}</span>
        </div>
      </div>

      {/* ===== HEADER ===== */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{order.orderNo}</h1>
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border ${status.bgColor} ${status.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.dotColor}`} />
              {status.label}
            </span>
            {hasUnsavedChanges && (
              <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">Not Saved</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setLiked(!liked)}
              className={`p-2 rounded transition-colors ${liked ? 'text-red-500' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
            </button>

            <div className="relative">
              <button
                onClick={() => setShowMenuDropdown(!showMenuDropdown)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                Menu <ChevronDown size={14} />
              </button>
              {showMenuDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenuDropdown(false)} />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                    <button
                      onClick={() => { setShowMenuDropdown(false); setShowPrintPreview(true) }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <Printer size={14} /> Print
                    </button>
                  </div>
                </>
              )}
            </div>

            <button onClick={() => fetchOrder()} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">
              <RotateCw size={16} />
            </button>

            <div className="relative">
              <button
                onClick={() => setShowMoreDropdown(!showMoreDropdown)}
                className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <MoreHorizontal size={16} />
              </button>
              {showMoreDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMoreDropdown(false)} />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                    {isDraft && (
                      <button
                        onClick={() => { setShowMoreDropdown(false); handleDelete() }}
                        className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 mt-4">
          {isDraft && (
            <>
              {hasUnsavedChanges ? (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              ) : (
                <button
                  onClick={() => setShowConfirmConfirm(true)}
                  disabled={saving || editingItems.length === 0}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm
                </button>
              )}
              <button
                onClick={() => setShowCancelModal(true)}
                disabled={saving}
                className="px-4 py-1.5 border border-red-300 text-red-600 text-sm font-medium rounded hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </>
          )}

          {canCreateInvoice && (
            <>
              <button
                onClick={() => setShowCreateInvoiceModal(true)}
                disabled={saving}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <FileText size={14} />
                Create Invoice
              </button>
              <button
                onClick={() => setShowCancelModal(true)}
                disabled={saving}
                className="px-4 py-1.5 border border-red-300 text-red-600 text-sm font-medium rounded hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                Cancel Order
              </button>
            </>
          )}

          {(isFulfilled || isCancelled) && (
            <span className="text-sm text-gray-500">This order is {order.status.replace('_', ' ')} and read-only.</span>
          )}
        </div>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex gap-6 p-6">
        {/* Left Column - Main Info */}
        <div className="flex-1 space-y-4">
          {/* Customer & Warehouse Section */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('customer')}
              className="w-full px-4 py-3 flex items-center justify-between font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700"
            >
              <span className="flex items-center gap-2"><User size={16} /> Customer & Warehouse</span>
              {sectionsOpen.customer ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {sectionsOpen.customer && (
              <div className="px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                    Customer {isDraft && <span className="text-red-500">*</span>}
                  </label>
                  {isDraft ? (
                    <LinkField
                      fetchOptions={searchCustomers}
                      value={headerForm.customerId}
                      onChange={(value, option) => {
                        setHeaderForm({ ...headerForm, customerId: value, customerName: option?.label || '' })
                        setHasUnsavedChanges(true)
                        fetchCustomerAddresses(value)
                      }}
                      onCreateNew={(name) => { setPendingCustomerName(name); setShowCustomerModal(true) }}
                      placeholder="Select Customer"
                      createLabel="Create new customer"
                      displayValue={headerForm.customerName}
                    />
                  ) : (
                    <div className="px-3 py-2 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 rounded">
                      {order.customerName || 'Walk-in'}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                    Warehouse <span className="text-red-500">*</span>
                  </label>
                  {isDraft ? (
                    <select
                      value={headerForm.warehouseId}
                      onChange={(e) => { setHeaderForm({ ...headerForm, warehouseId: e.target.value }); setHasUnsavedChanges(true) }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                    >
                      <option value="">Select</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  ) : (
                    <div className="px-3 py-2 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 rounded flex items-center gap-2">
                      <Warehouse size={14} className="text-gray-400" />
                      {order.warehouseName}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Expected Delivery</label>
                  {isDraft ? (
                    <input
                      type="date"
                      value={headerForm.expectedDeliveryDate}
                      onChange={(e) => { setHeaderForm({ ...headerForm, expectedDeliveryDate: e.target.value }); setHasUnsavedChanges(true) }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                    />
                  ) : (
                    <div className="px-3 py-2 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 rounded flex items-center gap-2">
                      <Calendar size={14} className="text-gray-400" />
                      {order.expectedDeliveryDate ? formatDate(order.expectedDeliveryDate) : 'Not set'}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Delivery Address</label>
                  {isDraft ? (
                    <>
                      <input
                        type="text"
                        value={headerForm.deliveryAddress}
                        onChange={(e) => { setHeaderForm({ ...headerForm, deliveryAddress: e.target.value }); setHasUnsavedChanges(true) }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                        placeholder="Delivery address"
                      />
                      {customerAddresses.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {customerAddresses.map((addr) => (
                            <button
                              key={addr.label}
                              type="button"
                              onClick={() => {
                                setHeaderForm({ ...headerForm, deliveryAddress: addr.formatted })
                                setHasUnsavedChanges(true)
                              }}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline"
                            >
                              Use {addr.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="px-3 py-2 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 rounded">
                      {order.deliveryAddress || 'Not set'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Items Section */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('items')}
              className="w-full px-4 py-3 flex items-center justify-between font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700"
            >
              <span className="flex items-center gap-2"><Package size={16} /> Items ({editingItems.length})</span>
              {sectionsOpen.items ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {sectionsOpen.items && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-8">#</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Item</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-24">Qty</th>
                      {!isDraft && <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-24">Fulfilled</th>}
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">Rate</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">Amount</th>
                      {isDraft && <th className="w-10"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {editingItems.map((item, index) => (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-2 text-gray-500">{index + 1}</td>
                        <td className="px-4 py-2">
                          {isDraft ? (
                            <LinkField
                              fetchOptions={searchItems}
                              value={item.itemId}
                              onChange={(value, option) => handleItemChange(index, 'itemId', value, option)}
                              onCreateNew={(name) => { setItemInitialName(name); setPendingItemRowIndex(index); setShowItemModal(true) }}
                              placeholder="Search items..."
                              createLabel="Create new item"
                              displayValue={formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemPartNumber }, businessType)}
                            />
                          ) : (
                            <div>
                              <span className="font-medium text-gray-900 dark:text-white">
                                {formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemPartNumber }, businessType)}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isDraft ? (
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                              className="w-20 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                              min="0"
                              step="any"
                            />
                          ) : (
                            <span>{item.quantity}</span>
                          )}
                        </td>
                        {!isDraft && (
                          <td className="px-4 py-2 text-right">
                            <span className={parseFloat(String(order.items[index]?.fulfilledQuantity || '0')) >= item.quantity ? 'text-green-600' : 'text-orange-600'}>
                              {order.items[index]?.fulfilledQuantity || '0'}
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-2 text-right">
                          {isDraft ? (
                            <input
                              type="number"
                              value={item.unitPrice}
                              onChange={(e) => handleItemChange(index, 'unitPrice', e.target.value)}
                              className="w-24 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                              min="0"
                              step="0.01"
                            />
                          ) : (
                            <span>{formatCurrency(item.unitPrice)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          {formatCurrency(item.total)}
                        </td>
                        {isDraft && (
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => handleDeleteRow(index)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {isDraft && (
                  <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
                    <button
                      onClick={handleAddRow}
                      className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700"
                    >
                      <Plus size={14} />
                      Add Row
                    </button>
                  </div>
                )}

                {/* Totals in table */}
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
                  <div className="flex justify-end">
                    <div className="w-64 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Total Qty</span>
                        <span className="font-medium">{totalQty}</span>
                      </div>
                      <div className="flex justify-between text-sm font-semibold text-gray-900 dark:text-white border-t pt-1">
                        <span>Grand Total</span>
                        <span>{formatCurrency(totalAmount)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Linked Invoices Section */}
          {order.linkedInvoices && order.linkedInvoices.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <button
                onClick={() => toggleSection('invoices')}
                className="w-full px-4 py-3 flex items-center justify-between font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700"
              >
                <span className="flex items-center gap-2"><FileText size={16} /> Linked Invoices ({order.linkedInvoices.length})</span>
                {sectionsOpen.invoices ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {sectionsOpen.invoices && (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {order.linkedInvoices.map((invoice) => (
                    <div key={invoice.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <Link
                          href={tenantSlug ? `/c/${tenantSlug}/sales/${invoice.id}` : `/sales/${invoice.id}`}
                          className="flex-1"
                        >
                          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{invoice.invoiceNo}</span>
                          <span className="text-xs text-gray-500 ml-2">{formatDate(invoice.createdAt)}</span>
                        </Link>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            invoice.status === 'completed' ? 'bg-green-100 text-green-700' :
                            invoice.status === 'void' ? 'bg-gray-100 text-gray-600' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>{invoice.status}</span>
                          <span className="text-sm font-medium">{formatCurrency(parseFloat(invoice.total))}</span>
                          {invoice.status === 'pending' && (
                            <Link
                              href={tenantSlug ? `/c/${tenantSlug}/sales/${invoice.id}` : `/sales/${invoice.id}`}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                            >
                              Pay
                            </Link>
                          )}
                        </div>
                      </div>
                      {invoice.status === 'void' && invoice.voidReason && (
                        <p className="text-xs text-gray-500 mt-1">Void reason: {invoice.voidReason}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notes Section */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('moreInfo')}
              className="w-full px-4 py-3 flex items-center justify-between font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700"
            >
              <span>Notes</span>
              {sectionsOpen.moreInfo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {sectionsOpen.moreInfo && (
              <div className="px-4 py-4">
                <textarea
                  value={isDraft ? headerForm.notes : (order.notes || '')}
                  onChange={(e) => { setHeaderForm({ ...headerForm, notes: e.target.value }); setHasUnsavedChanges(true) }}
                  readOnly={!isDraft}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                  rows={3}
                  placeholder="Add notes..."
                />
              </div>
            )}
          </div>

          {/* Cancellation Info */}
          {isCancelled && order.cancellationReason && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-700 px-4 py-3">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">Cancellation Reason</p>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">{order.cancellationReason}</p>
              {order.cancelledAt && <p className="text-xs text-red-500 mt-1">Cancelled on {formatDate(order.cancelledAt)}</p>}
            </div>
          )}
        </div>

        {/* Right Column - Sidebar Info */}
        <div className="w-72 space-y-4 flex-shrink-0">
          {/* Summary Card */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Created by</span>
              <span className="text-gray-900 dark:text-white">{order.createdByName || 'Unknown'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Created on</span>
              <span className="text-gray-900 dark:text-white">{formatDate(order.createdAt)}</span>
            </div>
            {order.confirmedAt && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Confirmed on</span>
                <span className="text-gray-900 dark:text-white">{formatDate(order.confirmedAt)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Warehouse</span>
              <span className="text-gray-900 dark:text-white">{order.warehouseName}</span>
            </div>
            {order.expectedDeliveryDate && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Expected delivery</span>
                <span className="text-gray-900 dark:text-white">{formatDate(order.expectedDeliveryDate)}</span>
              </div>
            )}
            <hr className="border-gray-200 dark:border-gray-700" />
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-gray-900 dark:text-white">Total</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(parseFloat(order.total))}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Comments & Activity */}
      <DocumentCommentsAndActivity
        documentType="sales_order"
        documentId={id}
        entityType="sales-order"
      />

      {/* Modals */}
      <ConfirmModal
        isOpen={showConfirmConfirm}
        onClose={() => setShowConfirmConfirm(false)}
        onConfirm={() => { setShowConfirmConfirm(false); handleStatusChange('confirmed') }}
        title="Confirm Sales Order"
        message={`Are you sure you want to confirm Sales Order ${order.orderNo}? This will approve the order for fulfilment.`}
        confirmText="Confirm"
        variant="info"
        processing={saving}
      />

      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={(reason) => handleStatusChange('cancelled', reason)}
        title="Cancel Sales Order"
        itemName={`Sales Order ${order.orderNo}`}
        processing={saving}
        documentType="sales_order"
      />

      <ItemModal
        isOpen={showItemModal}
        onClose={() => { setShowItemModal(false); setPendingItemRowIndex(null) }}
        onCreated={handleItemCreated}
        initialName={itemInitialName}
        categories={categories}
      />

      <CustomerFormModal
        isOpen={showCustomerModal}
        onClose={() => { setShowCustomerModal(false); setPendingCustomerName('') }}
        onSaved={(customer) => {
          if (isCreateMode) {
            setCreateFormData(prev => ({ ...prev, customerId: customer.id, customerName: customer.name }))
          } else {
            setHeaderForm(prev => ({ ...prev, customerId: customer.id, customerName: customer.name }))
            setHasUnsavedChanges(true)
          }
          fetchCustomerAddresses(customer.id)
          setShowCustomerModal(false)
          setPendingCustomerName('')
        }}
        initialName={pendingCustomerName}
      />

      {showCreateInvoiceModal && order && (
        <CreateSalesInvoiceModal
          isOpen={showCreateInvoiceModal}
          onClose={() => setShowCreateInvoiceModal(false)}
          onConfirm={handleCreateInvoice}
          processing={saving}
          orderNo={order.orderNo}
          items={order.items.map(item => ({
            id: item.id,
            itemName: item.itemName,
            displayName: formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemOemPartNumber, pluCode: item.itemPluCode }, businessType),
            quantity: parseFloat(item.quantity),
            fulfilledQuantity: parseFloat(item.fulfilledQuantity),
          }))}
          costCenters={costCenters}
        />
      )}

      {/* Print Preview */}
      {order && (
        <PrintPreview
          isOpen={showPrintPreview}
          onClose={() => setShowPrintPreview(false)}
          documentType="sales_order"
          title={`Sales Order ${order.orderNo}`}
        >
          <SalesOrderTemplate
            salesOrder={{
              orderNo: order.orderNo,
              status: order.status,
              customerName: order.customerName,
              warehouseName: order.warehouseName,
              deliveryDate: order.expectedDeliveryDate,
              subtotal: order.subtotal,
              taxAmount: order.taxAmount,
              discountAmount: order.discountAmount,
              total: order.total,
              notes: order.notes,
              createdByName: order.createdByName,
              cancellationReason: order.cancellationReason,
              createdAt: order.createdAt,
              items: order.items.map(item => ({
                id: item.id,
                itemId: item.itemId,
                itemName: item.itemName,
                itemSku: item.itemSku,
                quantity: item.quantity,
                fulfilledQuantity: item.fulfilledQuantity,
                unitPrice: item.unitPrice,
                discount: item.discount,
                tax: item.tax,
                total: item.total,
              })),
            }}
            settings={DEFAULT_PRINT_SETTINGS.sales_order}
            businessName={tenantName}
            currencyCode={currency}
          />
        </PrintPreview>
      )}
    </div>
  )
}
