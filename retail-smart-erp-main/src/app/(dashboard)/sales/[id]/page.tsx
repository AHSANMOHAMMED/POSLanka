'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import {
  ChevronRight, Plus, Package, X, Ban,
  ChevronDown, ChevronUp, CreditCard, RotateCcw, ExternalLink, Info
} from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { CancellationReasonModal, ItemModal, CustomerFormModal } from '@/components/modals'
import { ConfirmDialog } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date-format'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatItemLabel, buildItemSearchOption, type SearchableItem } from '@/lib/utils/item-display'
import { LinkField, LinkFieldOption } from '@/components/ui/link-field'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'

const paymentMethodLabels: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer', credit: 'Credit', gift_card: 'Gift Card',
}

interface SaleItemData {
  id: string
  itemId: string | null
  itemName: string
  quantity: string
  unitPrice: string
  discount: string
  taxAmount: string
  taxRate: string
  total: string
  item?: { name: string; sku?: string; barcode?: string; oemPartNumber?: string; pluCode?: string } | null
}

interface PaymentData {
  id: string
  amount: string
  method: string
  reference: string | null
  receivedBy: string | null
  createdAt: string
  voidedAt?: string | null
}

interface SaleData {
  id: string
  invoiceNo: string
  salesOrderId: string | null
  customerId: string | null
  customerName: string | null
  warehouseId: string
  costCenterId: string | null
  subtotal: string
  discountAmount: string
  taxAmount: string
  total: string
  paidAmount: string
  paymentMethod: string
  status: string
  notes: string | null
  voidReason: string | null
  voidedAt: string | null
  isReturn: boolean
  createdAt: string
  updatedAt: string
  customer: { id: string; name: string; balance?: string } | null
  user: { fullName: string } | null
  items: SaleItemData[]
  payments: PaymentData[]
}

interface RefundData {
  id: string
  saleId: string
  originalSaleId: string | null
  amount: string
  method: string
  reason: string | null
  createdAt: string
  saleInvoiceNo: string | null
  originalSaleInvoiceNo: string | null
  processedByName: string | null
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

interface WarehouseData {
  id: string
  name: string
}

const statusConfig: Record<string, { label: string; color: string; bgColor: string; dotColor: string }> = {
  pending: { label: 'Pending', color: 'text-orange-600', bgColor: 'bg-orange-50 border-orange-200', dotColor: 'bg-orange-500' },
  partial: { label: 'Partial', color: 'text-yellow-600', bgColor: 'bg-yellow-50 border-yellow-200', dotColor: 'bg-yellow-500' },
  completed: { label: 'Paid', color: 'text-green-600', bgColor: 'bg-green-50 border-green-200', dotColor: 'bg-green-500' },
  void: { label: 'Void', color: 'text-gray-600', bgColor: 'bg-gray-100 border-gray-300', dotColor: 'bg-gray-500' },
}

export default function SalesInvoiceDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const { tenantSlug, businessType } = useCompany()
  const isCreateMode = id === 'new'

  const [sale, setSale] = useState<SaleData | null>(null)
  const [loading, setLoading] = useState(!isCreateMode)
  const [saving, setSaving] = useState(false)

  // Data
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([])

  // Create mode state
  const [createFormData, setCreateFormData] = useState({
    customerId: '',
    customerName: '',
    warehouseId: '',
    costCenterId: '',
    notes: '',
  })
  const [editingItems, setEditingItems] = useState<EditableItem[]>([])

  // Modals
  const [showVoidModal, setShowVoidModal] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [showCreateConfirm, setShowCreateConfirm] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [pendingCustomerName, setPendingCustomerName] = useState('')
  const [itemInitialName, setItemInitialName] = useState('')
  const [pendingItemRowIndex, setPendingItemRowIndex] = useState<number | null>(null)

  // Payment entries from accounting module
  const [paymentEntriesData, setPaymentEntriesData] = useState<{
    id: string
    paymentEntryId: string
    entryNumber: string
    postingDate: string
    allocatedAmount: string
    status: string
  }[]>([])
  // Journal entry allocations from payment reconciliation
  const [jeAllocationsData, setJeAllocationsData] = useState<{
    id: string
    sourceJeItemId: string
    entryNumber: string
    postingDate: string
    allocatedAmount: string
  }[]>([])
  const [processing, setProcessing] = useState(false)

  // Linked SO info
  const [linkedOrderNo, setLinkedOrderNo] = useState<string | null>(null)

  // Refunds state
  const [refundsData, setRefundsData] = useState<RefundData[]>([])

  // Collapsible sections
  const [sectionsOpen, setSectionsOpen] = useState({
    items: true,
    payments: true,
    refunds: true,
  })

  const fetchSale = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales/${id}`)
      if (res.ok) {
        const data = await res.json()
        setSale(data)
        // Fetch linked SO number if applicable
        if (data.salesOrderId) {
          const soRes = await fetch(`/api/sales-orders/${data.salesOrderId}`)
          if (soRes.ok) {
            const soData = await soRes.json()
            setLinkedOrderNo(soData.orderNo)
          }
        }
      } else {
        toast.error('Failed to load sales invoice')
        router.push(tenantSlug ? `/c/${tenantSlug}/sales` : '/sales')
      }
    } catch (error) {
      console.error('Error fetching sale:', error)
      toast.error('Failed to load sales invoice')
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  // Fetch refunds for this sale
  const fetchRefunds = useCallback(async () => {
    if (isCreateMode) return
    try {
      const res = await fetch(`/api/refunds?saleId=${id}`)
      if (res.ok) {
        const result = await res.json()
        setRefundsData(result.data || [])
      }
    } catch (error) {
      console.error('Error fetching refunds:', error)
    }
  }, [id, isCreateMode])

  useEffect(() => {
    if (!isCreateMode) {
      fetchRefunds()
    }
  }, [fetchRefunds, isCreateMode])

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
        const ccData = await costCentersRes.json()
        setCostCenters(Array.isArray(ccData) ? ccData : (ccData.data || []))
      }
    }
    fetchData()
  }, [])

  useRealtimeData(fetchSale, { entityType: 'sale', enabled: !isCreateMode })

  // Subscribe to sale changes for refunds refresh
  useRealtimeData(fetchRefunds, { entityType: 'sale', enabled: !isCreateMode, refreshOnMount: false })

  // Customer search
  const searchCustomers = useCallback(async (searchTerm: string): Promise<LinkFieldOption[]> => {
    const params = new URLSearchParams({ pageSize: '15' })
    if (searchTerm) params.set('search', searchTerm)
    const res = await fetch(`/api/customers?${params}`)
    if (!res.ok) return []
    const result = await res.json()
    const data = Array.isArray(result) ? result : (result.data || [])
    return data.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name }))
  }, [])

  // Item search
  const searchItems = useCallback(async (searchTerm: string): Promise<LinkFieldOption[]> => {
    try {
      const params = new URLSearchParams({ pageSize: '15' })
      if (searchTerm) params.set('search', searchTerm)
      const whId = createFormData.warehouseId || sale?.warehouseId
      if (whId) params.set('warehouseId', whId)
      const res = await fetch(`/api/items?${params}`)
      if (!res.ok) return []
      const result = await res.json()
      const data: SearchableItem[] = Array.isArray(result) ? result : (result.data || [])
      return data.map((item) => buildItemSearchOption(item, businessType, { showStock: true }))
    } catch {
      return []
    }
  }, [businessType, createFormData.warehouseId, sale?.warehouseId])

  // Create invoice
  async function handleCreate() {
    if (saving) return
    if (!createFormData.customerId) {
      toast.error('Please select a customer')
      return
    }
    if (!createFormData.warehouseId) {
      toast.error('Please select a warehouse')
      return
    }
    if (editingItems.length === 0) {
      toast.error('Please add at least one item')
      return
    }
    if (costCenters.length > 0 && !createFormData.costCenterId) {
      toast.error('Please select a cost center')
      return
    }

    const subtotal = editingItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const totalDiscount = editingItems.reduce((sum, item) => sum + item.discount, 0)
    const totalTax = editingItems.reduce((sum, item) => sum + item.taxAmount, 0)
    const total = subtotal - totalDiscount + totalTax

    setSaving(true)
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: createFormData.customerId || null,
          customerName: createFormData.customerName || null,
          warehouseId: createFormData.warehouseId,
          costCenterId: createFormData.costCenterId || null,
          cartItems: editingItems.map(item => ({
            itemId: item.itemId,
            name: item.itemName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
          })),
          subtotal: subtotal.toFixed(2),
          discount: totalDiscount.toFixed(2),
          tax: totalTax.toFixed(2),
          total: total.toFixed(2),
          amountPaid: 0,
          paymentMethod: 'cash',
          notes: createFormData.notes || null,
        }),
      })

      if (res.ok) {
        const savedSale = await res.json()
        toast.success(`Invoice ${savedSale.invoiceNo} created`)
        router.replace(tenantSlug ? `/c/${tenantSlug}/sales/${savedSale.id}` : `/sales/${savedSale.id}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create invoice')
      }
    } catch (err) {
      console.error('Error creating invoice:', err)
      toast.error('Failed to create invoice')
    } finally {
      setSaving(false)
    }
  }

  // Void sale
  async function handleVoid(reason: string) {
    if (!sale) return
    setProcessing(true)
    try {
      const res = await fetch(`/api/sales/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voidReason: reason }),
      })
      if (res.ok) {
        toast.success('Invoice voided')
        setShowVoidModal(false)
        fetchSale()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to void invoice')
      }
    } catch {
      toast.error('Failed to void invoice')
    } finally {
      setProcessing(false)
    }
  }

  // Fetch payment entries for this sale
  const fetchPaymentEntries = useCallback(async () => {
    if (isCreateMode || !id) return
    try {
      const res = await fetch(`/api/sales/${id}/payments`)
      if (res.ok) {
        const data = await res.json()
        setPaymentEntriesData(data.paymentEntries || [])
        setJeAllocationsData(data.journalEntryAllocations || [])
      }
    } catch {
      // ignore
    }
  }, [id, isCreateMode])

  useEffect(() => {
    if (!isCreateMode) fetchPaymentEntries()
  }, [fetchPaymentEntries, isCreateMode])

  // Build payment entry URL for navigation
  function getPaymentEntryUrl() {
    if (!sale) return ''
    const params = new URLSearchParams({
      paymentType: 'receive',
      partyType: 'customer',
      partyId: sale.customer?.id || sale.customerId || '',
      partyName: sale.customerName || sale.customer?.name || '',
      referenceType: 'sale',
      referenceId: sale.id,
      amount: String(Math.max(0, parseFloat(sale.total) - computedTotalPaid)),
      returnUrl: `/c/${tenantSlug}/sales/${sale.id}`,
    })
    return `/c/${tenantSlug}/accounting/payment-entries/new?${params}`
  }

  // Item handlers for create mode
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
  }

  function handleItemChange(index: number, field: string, value: unknown, option?: LinkFieldOption) {
    const newItems = [...editingItems]
    if (field === 'itemId' && option) {
      const sellingPrice = parseFloat(option.data?.sellingPrice as string || '0')
      // Same item different price pattern
      const existingIdx = newItems.findIndex((i, idx) =>
        idx !== index && i.itemId === String(value) && i.unitPrice === sellingPrice
      )
      if (existingIdx >= 0) {
        newItems[existingIdx] = {
          ...newItems[existingIdx],
          quantity: newItems[existingIdx].quantity + newItems[index].quantity,
          total: (newItems[existingIdx].quantity + newItems[index].quantity) * newItems[existingIdx].unitPrice - newItems[existingIdx].discount + newItems[existingIdx].taxAmount,
        }
        newItems.splice(index, 1)
      } else {
        newItems[index] = {
          ...newItems[index],
          itemId: String(value),
          itemName: option.data?.name as string || option.label,
          itemSku: option.data?.sku as string || null,
          itemBarcode: option.data?.barcode as string || null,
          itemPartNumber: option.data?.oemPartNumber as string || option.data?.sku as string || null,
          unitPrice: sellingPrice,
          total: newItems[index].quantity * sellingPrice - newItems[index].discount + newItems[index].taxAmount,
        }
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
  }

  function handleDeleteRow(index: number) {
    setEditingItems(editingItems.filter((_, i) => i !== index))
  }

  function handleItemCreated(item: { id: string; name: string; sku?: string; barcode?: string; oemPartNumber?: string; sellingPrice: string }) {
    if (pendingItemRowIndex !== null) {
      const sellingPrice = parseFloat(item.sellingPrice || '0')
      const newItems = [...editingItems]
      newItems[pendingItemRowIndex] = {
        ...newItems[pendingItemRowIndex],
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku || null,
        itemBarcode: item.barcode || null,
        itemPartNumber: item.oemPartNumber || item.sku || null,
        unitPrice: sellingPrice,
        total: newItems[pendingItemRowIndex].quantity * sellingPrice,
      }
      setEditingItems(newItems)
    }
    setShowItemModal(false)
    setPendingItemRowIndex(null)
    toast.success(`Item "${item.name}" created`)
  }

  function toggleSection(section: keyof typeof sectionsOpen) {
    setSectionsOpen({ ...sectionsOpen, [section]: !sectionsOpen[section] })
  }

  // Computed totals for create mode
  const totalQty = editingItems.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = editingItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const totalDiscount = editingItems.reduce((sum, item) => sum + item.discount, 0)
  const totalTax = editingItems.reduce((sum, item) => sum + item.taxAmount, 0)
  const grandTotal = subtotal - totalDiscount + totalTax

  if (loading) {
    return <PageLoading text="Loading sales invoice..." />
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
            <Link href={tenantSlug ? `/c/${tenantSlug}/sales` : '/sales'} className="hover:text-blue-600 dark:hover:text-blue-400">
              Sales Invoice
            </Link>
            <ChevronRight size={14} />
            <span className="text-gray-900 dark:text-white font-medium">New</span>
          </div>
        </div>

        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New Sales Invoice</h1>
        </div>

        {/* Form */}
        <div className="p-6 max-w-4xl">
          {/* Customer & Warehouse */}
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
                  onChange={(value, option) => setCreateFormData({ ...createFormData, customerId: value, customerName: option?.label || '' })}
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
              {costCenters.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                    Cost Center <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={createFormData.costCenterId}
                    onChange={(e) => setCreateFormData({ ...createFormData, costCenterId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                  >
                    <option value="">Select Cost Center</option>
                    {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
                  </select>
                </div>
              )}
              <div className={costCenters.length > 0 ? '' : 'md:col-span-2'}>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Notes
                </label>
                <textarea
                  value={createFormData.notes}
                  onChange={(e) => setCreateFormData({ ...createFormData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                  rows={2}
                  placeholder="Add notes..."
                />
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
            <div className="px-4 py-3 font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <Package size={16} /> Items ({editingItems.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-8">#</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Item</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-24">Qty</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">Rate</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-24">Disc</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">Amount</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {editingItems.map((item, index) => (
                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 text-gray-500">{index + 1}</td>
                      <td className="px-4 py-2">
                        <LinkField
                          fetchOptions={searchItems}
                          value={item.itemId}
                          onChange={(value, option) => handleItemChange(index, 'itemId', value, option)}
                          onCreateNew={(name) => { setItemInitialName(name); setPendingItemRowIndex(index); setShowItemModal(true) }}
                          placeholder="Search items..."
                          createLabel="Create new item"
                          displayValue={formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemPartNumber }, businessType)}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                          className="w-20 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                          min="0"
                          step="any"
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => handleItemChange(index, 'unitPrice', e.target.value)}
                          className="w-24 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                          min="0"
                          step="0.01"
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          value={item.discount}
                          onChange={(e) => handleItemChange(index, 'discount', e.target.value)}
                          className="w-20 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                          min="0"
                          step="0.01"
                        />
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        {formatCurrency(item.quantity * item.unitPrice - item.discount + item.taxAmount)}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => handleDeleteRow(index)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
                <button
                  onClick={handleAddRow}
                  className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700"
                >
                  <Plus size={14} />
                  Add Row
                </button>
              </div>

              {/* Totals */}
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
                <div className="flex justify-end">
                  <div className="w-64 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Total Qty</span>
                      <span className="font-medium">{totalQty}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Subtotal</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    {totalDiscount > 0 && (
                      <div className="flex justify-between text-sm text-red-600">
                        <span>Discount</span>
                        <span>-{formatCurrency(totalDiscount)}</span>
                      </div>
                    )}
                    {totalTax > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Tax</span>
                        <span>{formatCurrency(totalTax)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold text-gray-900 dark:text-white border-t pt-1">
                      <span>Grand Total</span>
                      <span>{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (!createFormData.customerId) {
                  toast.error('Please select a customer')
                  return
                }
                if (!createFormData.warehouseId) {
                  toast.error('Please select a warehouse')
                  return
                }
                if (editingItems.length === 0) {
                  toast.error('Please add at least one item')
                  return
                }
                setShowCreateConfirm(true)
              }}
              disabled={saving || editingItems.length === 0}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Creating...' : 'Create Invoice'}
            </button>
            <Link
              href={tenantSlug ? `/c/${tenantSlug}/sales` : '/sales'}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </div>

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
            setCreateFormData(prev => ({ ...prev, customerId: customer.id, customerName: customer.name }))
            setShowCustomerModal(false)
            setPendingCustomerName('')
          }}
          initialName={pendingCustomerName}
        />

        <ConfirmDialog
          isOpen={showCreateConfirm}
          onClose={() => setShowCreateConfirm(false)}
          onConfirm={() => { setShowCreateConfirm(false); handleCreate() }}
          title="Create Sales Invoice"
          message={`This will create an invoice for ${formatCurrency(grandTotal)} and deduct stock from the selected warehouse. Continue?`}
          confirmText="Create Invoice"
          variant="warning"
          processing={saving}
        />
      </div>
    )
  }

  // ==================== VIEW MODE ====================
  if (!sale) {
    return <div className="text-center py-8 text-gray-500">Sales invoice not found</div>
  }

  const status = statusConfig[sale.status] || statusConfig.pending

  // Compute totalPaid from actual payment records (source of truth) instead of
  // trusting denormalized paidAmount, which can drift.
  const directPaymentsTotal = (sale.payments || [])
    .filter(p => !p.voidedAt)
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)
  const peAllocatedTotal = paymentEntriesData.reduce(
    (sum, pe) => sum + parseFloat(pe.allocatedAmount), 0
  )
  const jeAllocatedTotal = jeAllocationsData.reduce(
    (sum, je) => sum + parseFloat(je.allocatedAmount), 0
  )
  const computedTotalPaid = Math.round((directPaymentsTotal + peAllocatedTotal + jeAllocatedTotal) * 100) / 100
  const balanceDue = parseFloat(sale.total) - computedTotalPaid
  const isVoid = sale.status === 'void'
  const canPay = !isVoid && !sale.isReturn && (sale.status === 'pending' || sale.status === 'partial')
  const canVoid = !isVoid && !sale.isReturn

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
          <Link href={tenantSlug ? `/c/${tenantSlug}/sales` : '/sales'} className="hover:text-blue-600 dark:hover:text-blue-400">
            Sales Invoice
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium">{sale.invoiceNo}</span>
        </div>
      </div>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{sale.invoiceNo}</h1>
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border ${status.bgColor} ${status.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.dotColor}`} />
              {status.label}
            </span>
            {sale.isReturn && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Return</span>
            )}
            {sale.salesOrderId && linkedOrderNo && (
              <Link
                href={tenantSlug ? `/c/${tenantSlug}/sales-orders/${sale.salesOrderId}` : `/sales-orders/${sale.salesOrderId}`}
                className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100"
              >
                {linkedOrderNo}
              </Link>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-4">
          {canPay && sale.customerId && (
            <button
              onClick={() => router.push(getPaymentEntryUrl())}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add Payment
            </button>
          )}
          {canPay && !sale.customerId && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm rounded cursor-not-allowed" title="Assign a customer to record payment">
              <Info size={14} />
              Assign customer to add payment
            </div>
          )}
          {canVoid && (
            <button
              onClick={() => setShowVoidModal(true)}
              className="px-4 py-1.5 border border-red-300 text-red-600 text-sm font-medium rounded hover:bg-red-50 transition-colors flex items-center gap-1.5"
            >
              <Ban size={14} />
              Void
            </button>
          )}
          {isVoid && (
            <span className="text-sm text-gray-500">This invoice is voided and read-only.</span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex gap-6 p-6">
        {/* Left Column */}
        <div className="flex-1 space-y-4">
          {/* Items Section */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('items')}
              className="w-full px-4 py-3 flex items-center justify-between font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700"
            >
              <span className="flex items-center gap-2"><Package size={16} /> Items ({sale.items.length})</span>
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
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">Rate</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {sale.items.map((item, index) => (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-2 text-gray-500">{index + 1}</td>
                        <td className="px-4 py-2">
                          <span className="font-medium text-gray-900 dark:text-white">
                            {item.item ? formatItemLabel(item.item, businessType) : item.itemName}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">{parseFloat(item.quantity)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(parseFloat(item.unitPrice))}</td>
                        <td className="px-4 py-2 text-right font-medium">{formatCurrency(parseFloat(item.total))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
                  <div className="flex justify-end">
                    <div className="w-64 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Subtotal</span>
                        <span>{formatCurrency(parseFloat(sale.subtotal))}</span>
                      </div>
                      {parseFloat(sale.discountAmount) > 0 && (
                        <div className="flex justify-between text-sm text-red-600">
                          <span>Discount</span>
                          <span>-{formatCurrency(parseFloat(sale.discountAmount))}</span>
                        </div>
                      )}
                      {parseFloat(sale.taxAmount) > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Tax</span>
                          <span>{formatCurrency(parseFloat(sale.taxAmount))}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-semibold text-gray-900 dark:text-white border-t pt-1">
                        <span>Total</span>
                        <span>{formatCurrency(parseFloat(sale.total))}</span>
                      </div>
                      <div className="flex justify-between text-sm text-green-600">
                        <span>Paid</span>
                        <span>{formatCurrency(computedTotalPaid)}</span>
                      </div>
                      {balanceDue > 0.01 && (
                        <div className="flex justify-between text-sm font-medium text-orange-600">
                          <span>Balance Due</span>
                          <span>{formatCurrency(balanceDue)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Payments Section */}
          {(sale.payments.length > 0 || paymentEntriesData.length > 0 || jeAllocationsData.length > 0) && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <button
                onClick={() => toggleSection('payments')}
                className="w-full px-4 py-3 flex items-center justify-between font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700"
              >
                <span className="flex items-center gap-2"><CreditCard size={16} /> Payments ({sale.payments.filter(p => !p.voidedAt).length + paymentEntriesData.length + jeAllocationsData.length})</span>
                {sectionsOpen.payments ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {sectionsOpen.payments && (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {/* Legacy inline payments */}
                  {sale.payments.map((payment) => (
                    <div key={payment.id} className={`px-4 py-3 flex justify-between items-center ${payment.voidedAt ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          payment.method === 'cash' ? 'bg-green-100 text-green-700' :
                          payment.method === 'credit' ? 'bg-purple-100 text-purple-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {paymentMethodLabels[payment.method] || payment.method}
                        </span>
                        <span className="text-xs text-gray-500">{formatDate(payment.createdAt)}</span>
                        {payment.voidedAt && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">Voided</span>
                        )}
                      </div>
                      <span className="font-medium">{formatCurrency(parseFloat(payment.amount))}</span>
                    </div>
                  ))}
                  {/* Payment entries from accounting module */}
                  {paymentEntriesData.map((pe) => (
                    <div key={pe.id} className="px-4 py-3 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                          Payment Entry
                        </span>
                        <Link
                          href={`/c/${tenantSlug}/accounting/payment-entries/${pe.paymentEntryId}`}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                          {pe.entryNumber} <ExternalLink size={10} />
                        </Link>
                        <span className="text-xs text-gray-500">{formatDate(pe.postingDate)}</span>
                      </div>
                      <span className="font-medium">{formatCurrency(parseFloat(pe.allocatedAmount))}</span>
                    </div>
                  ))}
                  {/* Journal entry allocations from payment reconciliation */}
                  {jeAllocationsData.map((je) => (
                    <div key={je.id} className="px-4 py-3 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                          Journal Entry
                        </span>
                        <span className="text-xs text-purple-600 dark:text-purple-400">{je.entryNumber}</span>
                        <span className="text-xs text-gray-500">{formatDate(je.postingDate)}</span>
                      </div>
                      <span className="font-medium">{formatCurrency(parseFloat(je.allocatedAmount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Refunds Section */}
          {refundsData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <button
                onClick={() => toggleSection('refunds')}
                className="w-full px-4 py-3 flex items-center justify-between font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700"
              >
                <span className="flex items-center gap-2"><RotateCcw size={16} /> Refunds ({refundsData.length})</span>
                {sectionsOpen.refunds ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {sectionsOpen.refunds && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                          <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                          <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Method</th>
                          <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Reason</th>
                          <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Processed By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {refundsData.map((refund) => (
                          <tr key={refund.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                              {formatDate(refund.createdAt)}
                            </td>
                            <td className="px-4 py-2 text-right font-medium text-red-600 dark:text-red-400">
                              -{formatCurrency(parseFloat(refund.amount))}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                refund.method === 'cash' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                refund.method === 'credit' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                                'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              }`}>
                                {refund.method}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs max-w-[200px] truncate">
                              {refund.reason || '-'}
                            </td>
                            <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs">
                              {refund.processedByName || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Total Refunded */}
                  <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 bg-red-50 dark:bg-red-900/10">
                    <div className="flex justify-end">
                      <div className="flex justify-between w-64 text-sm font-semibold">
                        <span className="text-red-700 dark:text-red-400">Total Refunded</span>
                        <span className="text-red-700 dark:text-red-400">
                          -{formatCurrency(refundsData.reduce((sum, r) => sum + parseFloat(r.amount), 0))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Void Info */}
          {isVoid && sale.voidReason && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-700 px-4 py-3">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">Void Reason</p>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">{sale.voidReason}</p>
              {sale.voidedAt && <p className="text-xs text-red-500 mt-1">Voided on {formatDate(sale.voidedAt)}</p>}
            </div>
          )}

          {/* Notes */}
          {sale.notes && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 px-4 py-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Notes</p>
              <p className="text-sm text-gray-900 dark:text-white">{sale.notes}</p>
            </div>
          )}
        </div>

        {/* Right Column - Summary */}
        <div className="w-72 space-y-4 flex-shrink-0">
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Customer</span>
              <span className="text-gray-900 dark:text-white">{sale.customerName || sale.customer?.name || 'Walk-in'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Created by</span>
              <span className="text-gray-900 dark:text-white">{sale.user?.fullName || 'Unknown'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Created on</span>
              <span className="text-gray-900 dark:text-white">{formatDate(sale.createdAt)}</span>
            </div>
            {sale.costCenterId && costCenters.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Cost Center</span>
                <span className="text-gray-900 dark:text-white">
                  {costCenters.find(cc => cc.id === sale.costCenterId)?.name || '-'}
                </span>
              </div>
            )}
            {sale.salesOrderId && linkedOrderNo && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Sales Order</span>
                <Link
                  href={tenantSlug ? `/c/${tenantSlug}/sales-orders/${sale.salesOrderId}` : `/sales-orders/${sale.salesOrderId}`}
                  className="text-blue-600 hover:underline"
                >
                  {linkedOrderNo}
                </Link>
              </div>
            )}
            <hr className="border-gray-200 dark:border-gray-700" />
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-gray-900 dark:text-white">Total</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(parseFloat(sale.total))}</span>
            </div>
            {balanceDue > 0.01 && (
              <div className="flex justify-between text-sm font-semibold text-orange-600">
                <span>Balance Due</span>
                <span>{formatCurrency(balanceDue)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Comments & Activity */}
      <DocumentCommentsAndActivity
        documentType="sales_invoice"
        documentId={id}
        entityType="sale"
      />

      {/* Void Modal */}
      <CancellationReasonModal
        isOpen={showVoidModal}
        onClose={() => setShowVoidModal(false)}
        onConfirm={handleVoid}
        title="Void Invoice"
        itemName={`Invoice ${sale.invoiceNo}`}
        processing={processing}
        documentType="sales_invoice"
      />

    </div>
  )
}
