'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import {
  ChevronDown, ChevronRight, Heart, RotateCw, MoreHorizontal,
  Printer, Trash2, Plus, Building2, Warehouse, Calendar,
  User, Package, ChevronUp, Paperclip, Tag, X,
  CreditCard, CheckCircle, FileIcon
} from 'lucide-react'
import { useRealtimeData, useSmartWarnings } from '@/hooks'
import { CancellationReasonModal, ItemModal, SupplierModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { SmartWarningBanner } from '@/components/ai/SmartWarningBanner'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, formatDateTime } from '@/lib/utils/date-format'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { LinkField, LinkFieldOption } from '@/components/ui/link-field'
import { formatItemLabel, buildItemSearchOption } from '@/lib/utils/item-display'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { PrintPreview, PurchaseInvoiceTemplate } from '@/components/print'
import { DEFAULT_PRINT_SETTINGS } from '@/lib/print/types'

interface PurchaseItem {
  id: string
  itemId: string | null
  itemName: string
  itemSku: string | null
  itemBarcode: string | null
  itemOemPartNumber: string | null
  itemPluCode: string | null
  quantity: string
  unitPrice: string
  tax: string
  total: string
}

interface Payment {
  id: string
  amount: string
  paymentMethod: string
  paymentReference: string | null
  notes: string | null
  paidAt: string
  createdByName: string | null
}

interface Purchase {
  id: string
  purchaseNo: string
  purchaseOrderId: string | null
  purchaseOrderNo: string | null
  supplierId: string
  supplierName: string | null
  warehouseId: string
  warehouseName: string | null
  costCenterId: string | null
  supplierInvoiceNo: string | null
  supplierBillDate: string | null
  paymentTerm: string | null
  subtotal: string
  taxAmount: string
  total: string
  paidAmount: string
  status: 'draft' | 'pending' | 'partial' | 'paid' | 'cancelled'
  notes: string | null
  isReturn: boolean
  createdBy: string | null
  createdByName: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  items: PurchaseItem[]
  payments: Payment[]
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
}

interface Warehouse {
  id: string
  name: string
}

interface CostCenter {
  id: string
  name: string
  isGroup: boolean
  isActive: boolean
}

interface Category {
  id: string
  name: string
}

interface Supplier {
  id: string
  name: string
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
  total: number
  isNew?: boolean
}

const statusConfig: Record<string, { label: string; color: string; bgColor: string; dotColor: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bgColor: 'bg-gray-50 border-gray-300', dotColor: 'bg-gray-400' },
  pending: { label: 'Unpaid', color: 'text-red-600', bgColor: 'bg-red-50 border-red-200', dotColor: 'bg-red-500' },
  partial: { label: 'Partly Paid', color: 'text-orange-600', bgColor: 'bg-orange-50 border-orange-200', dotColor: 'bg-orange-500' },
  paid: { label: 'Paid', color: 'text-green-600', bgColor: 'bg-green-50 border-green-200', dotColor: 'bg-green-500' },
  cancelled: { label: 'Cancelled', color: 'text-gray-600', bgColor: 'bg-gray-100 border-gray-300', dotColor: 'bg-gray-500' },
}

const paymentMethodLabels: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  credit: 'Credit',
  gift_card: 'Gift Card',
}

export default function PurchaseDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const { tenantSlug, businessType, tenantName, currency } = useCompany()
  const isCreateMode = id === 'new'

  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [loading, setLoading] = useState(!isCreateMode)
  const [saving, setSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const purchaseWarnings = useSmartWarnings('purchase')
  const [purchaseWarningBypassed, setPurchaseWarningBypassed] = useState(false)

  // Data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])

  // UI State
  const [liked, setLiked] = useState(false)
  const [showMenuDropdown, setShowMenuDropdown] = useState(false)
  const [showMoreDropdown, setShowMoreDropdown] = useState(false)

  // Collapsible sections
  const [sectionsOpen, setSectionsOpen] = useState({
    supplier: true,
    items: true,
    totals: true,
    payments: true,
    moreInfo: true,
  })

  // Create mode state
  const [createFormData, setCreateFormData] = useState({
    supplierId: '',
    supplierName: '',
    warehouseId: '',
    costCenterId: '',
    supplierInvoiceNo: '',
    supplierBillDate: '',
    paymentTerm: 'cash',
    notes: '',
  })
  const [showCreateSupplierModal, setShowCreateSupplierModal] = useState(false)
  const [pendingSupplierName, setPendingSupplierName] = useState('')

  // Edit mode state
  const [editingItems, setEditingItems] = useState<EditableItem[]>([])
  const [deletedItemNames, setDeletedItemNames] = useState<string[]>([])
  const [headerForm, setHeaderForm] = useState({
    warehouseId: '',
    costCenterId: '',
    supplierInvoiceNo: '',
    supplierBillDate: '',
    notes: '',
  })

  // Modals
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [itemInitialName, setItemInitialName] = useState('')
  const [pendingItemRowIndex, setPendingItemRowIndex] = useState<number | null>(null)

  // Attachments
  const [attachments, setAttachments] = useState<Array<{
    id: string; fileName: string; fileType: string; fileSize: number;
    filePath: string; createdAt: string; uploadedByUser?: { fullName: string } | null
  }>>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

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

  // Tags
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)

  const fetchPurchase = useCallback(async () => {
    try {
      const res = await fetch(`/api/purchases/${id}`)
      if (res.ok) {
        const data = await res.json()
        setPurchase(data)
        setHeaderForm({
          warehouseId: data.warehouseId || '',
          costCenterId: data.costCenterId || '',
          supplierInvoiceNo: data.supplierInvoiceNo || '',
          supplierBillDate: data.supplierBillDate || '',
          notes: data.notes || '',
        })
        setEditingItems(data.items.map((item: PurchaseItem) => ({
          id: item.id,
          itemId: item.itemId || '',
          itemName: item.itemName,
          itemSku: item.itemSku,
          itemBarcode: item.itemBarcode || null,
          itemPartNumber: item.itemOemPartNumber || item.itemPluCode || null,
          quantity: parseFloat(item.quantity) || 0,
          unitPrice: parseFloat(item.unitPrice) || 0,
          total: parseFloat(item.total) || 0,
        })))
        setHasUnsavedChanges(false)
        try { setTags(data.tags ? JSON.parse(data.tags) : []) } catch { setTags([]) }
      } else {
        toast.error('Failed to load purchase invoice')
        router.push(tenantSlug ? `/c/${tenantSlug}/purchases` : '/purchases')
      }
    } catch (error) {
      console.error('Error fetching purchase:', error)
      toast.error('Failed to load purchase invoice')
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
        setCostCenters(Array.isArray(data) ? data.filter((cc: CostCenter) => !cc.isGroup && cc.isActive) : [])
      }
    }
    fetchData()
    if (!isCreateMode) fetchAttachments()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeData(fetchPurchase, { entityType: 'purchase', enabled: !isCreateMode })

  // Supplier search
  const searchSuppliers = useCallback(async (searchTerm: string): Promise<LinkFieldOption[]> => {
    const params = new URLSearchParams({ pageSize: '15' })
    if (searchTerm) params.set('search', searchTerm)
    const res = await fetch(`/api/suppliers?${params}`)
    if (!res.ok) {
      console.error('Failed to fetch suppliers:', res.status)
      return []
    }
    const result = await res.json()
    const data = Array.isArray(result) ? result : (result.data || [])
    return data.map((s: Supplier) => ({ value: s.id, label: s.name }))
  }, [])

  // Item search
  const searchItems = useCallback(async (searchTerm: string): Promise<LinkFieldOption[]> => {
    try {
      const params = new URLSearchParams({ pageSize: '15' })
      if (searchTerm) params.set('search', searchTerm)
      const res = await fetch(`/api/items?${params}`)
      if (!res.ok) {
        const errorText = await res.text()
        console.error('Failed to fetch items:', res.status, errorText)
        return []
      }
      const result = await res.json()
      const data = Array.isArray(result) ? result : (result.data || [])
      return data.map((item: Item) => buildItemSearchOption(item, businessType, { useCostPrice: true }))
    } catch (err) {
      console.error('searchItems error:', err)
      return []
    }
  }, [businessType])

  // Create purchase
  async function handleCreate() {
    if (!createFormData.supplierId) {
      toast.error('Please select a supplier')
      return
    }
    if (!createFormData.warehouseId) {
      toast.error('Please select a warehouse')
      return
    }
    if (costCenters.length > 0 && !createFormData.costCenterId) {
      toast.error('Please select a cost center')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: createFormData.supplierId,
          warehouseId: createFormData.warehouseId,
          costCenterId: createFormData.costCenterId || null,
          supplierInvoiceNo: createFormData.supplierInvoiceNo || null,
          supplierBillDate: createFormData.supplierBillDate || null,
          paymentTerm: createFormData.paymentTerm,
          notes: createFormData.notes || null,
          items: [],
        }),
      })

      if (res.ok) {
        const savedPurchase = await res.json()
        toast.success(`Purchase Invoice ${savedPurchase.purchaseNo} created`)
        router.replace(tenantSlug ? `/c/${tenantSlug}/purchases/${savedPurchase.id}` : `/purchases/${savedPurchase.id}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create purchase invoice')
      }
    } catch (err) {
      console.error('Error creating:', err)
      toast.error('Failed to create purchase invoice')
    } finally {
      setSaving(false)
    }
  }

  // Save changes
  async function handleSave() {
    if (!purchase) return

    if (costCenters.length > 0 && !headerForm.costCenterId) {
      toast.error('Please select a cost center')
      return
    }

    // AI Smart Warnings for purchase items
    if (!purchaseWarningBypassed) {
      const itemsWithData = editingItems.filter(i => i.itemId && i.unitPrice > 0)
      if (itemsWithData.length > 0) {
        const purchaseTotal = editingItems.reduce((sum, i) => sum + i.total, 0)
        const w = await purchaseWarnings.checkWarnings({
          items: itemsWithData.map(i => ({
            itemId: i.itemId,
            itemName: i.itemName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
          total: purchaseTotal,
        })
        if (w.length > 0) return
      }
    }
    setPurchaseWarningBypassed(false)

    setSaving(true)

    try {
      // Build item changes summary
      const itemChanges: string[] = []
      const originalItems = purchase.items || []
      if (deletedItemNames.length > 0) {
        itemChanges.push(`removed ${deletedItemNames.join(', ')}`)
      }
      const newItems = editingItems.filter(i => i.isNew && i.itemId)
      if (newItems.length > 0) {
        itemChanges.push(`added ${newItems.map(i => i.itemName).join(', ')}`)
      }
      for (const item of editingItems) {
        if (item.isNew) continue
        const orig = originalItems.find((o: PurchaseItem) => o.id === item.id)
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

      const headerRes = await fetch(`/api/purchases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: headerForm.warehouseId || undefined,
          costCenterId: headerForm.costCenterId || null,
          supplierInvoiceNo: headerForm.supplierInvoiceNo || null,
          supplierBillDate: headerForm.supplierBillDate || null,
          notes: headerForm.notes || null,
          expectedUpdatedAt: purchase.updatedAt,
          changesSummary,
        }),
      })

      if (!headerRes.ok) {
        const data = await headerRes.json()
        if (data.code === 'CONFLICT') {
          toast.error('Modified by another user. Refreshing...')
          fetchPurchase()
          return
        }
        toast.error(data.error || 'Failed to save')
        return
      }

      let itemError = false
      for (const item of editingItems) {
        if (item.isNew) {
          if (!item.itemId) continue
          const res = await fetch(`/api/purchases/${id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              itemId: item.itemId,
              itemName: item.itemName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              tax: 0,
            }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            toast.error(data.error || 'Failed to save item')
            itemError = true
            break
          }
        } else {
          const res = await fetch(`/api/purchases/${id}/items/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              tax: 0,
            }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            toast.error(data.error || 'Failed to update item')
            itemError = true
            break
          }
        }
      }

      if (!itemError) {
        toast.success('Saved')
      }
      setHasUnsavedChanges(false)
      setDeletedItemNames([])
      fetchPurchase()
    } catch (error) {
      console.error('Error saving:', error)
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Submit purchase (draft → pending)
  async function handleDelete() {
    if (!purchase) return
    setSaving(true)
    try {
      const res = await fetch(`/api/purchases/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Purchase invoice deleted')
        router.push(tenantSlug ? `/c/${tenantSlug}/purchases` : '/purchases')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete')
      }
    } catch {
      toast.error('Failed to delete')
    } finally {
      setSaving(false)
    }
  }

  async function fetchAttachments() {
    try {
      const res = await fetch(`/api/purchases/${id}/attachments`)
      if (res.ok) {
        const data = await res.json()
        setAttachments(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching attachments:', error)
    }
  }

  async function handleAttachmentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const uploadFiles = e.target.files
    if (!uploadFiles?.length) return
    setUploadingAttachment(true)
    try {
      for (const file of Array.from(uploadFiles)) {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`/api/purchases/${id}/attachments`, {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error || `Failed to upload ${file.name}`)
        }
      }
      toast.success('File(s) uploaded')
      await fetchAttachments()
    } catch (error) {
      console.error('Error uploading attachments:', error)
      toast.error('Failed to upload file')
    } finally {
      setUploadingAttachment(false)
      e.target.value = ''
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    try {
      const res = await fetch(`/api/purchases/${id}/attachments?attachmentId=${attachmentId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setAttachments(attachments.filter(a => a.id !== attachmentId))
        toast.success('Attachment deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete attachment')
      }
    } catch (error) {
      console.error('Error deleting attachment:', error)
      toast.error('Failed to delete attachment')
    }
  }

  async function handleSubmit() {
    if (!purchase) return
    if (editingItems.length === 0) {
      toast.error('Please add at least one item before submitting')
      return
    }
    const hasEmptyItems = editingItems.some(item => !item.itemId)
    if (hasEmptyItems) {
      toast.error('Please fill in all item rows before submitting')
      return
    }
    if (costCenters.length > 0 && !headerForm.costCenterId) {
      toast.error('Please select a cost center before submitting')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/purchases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'pending',
          expectedUpdatedAt: purchase.updatedAt,
        }),
      })

      if (res.ok) {
        toast.success('Purchase invoice submitted')
        fetchPurchase()
      } else {
        const data = await res.json()
        if (data.code === 'CONFLICT') {
          toast.error('Modified by another user. Refreshing...')
          fetchPurchase()
          return
        }
        toast.error(data.error || 'Failed to submit')
      }
    } catch (error) {
      console.error('Error submitting:', error)
      toast.error('Failed to submit')
    } finally {
      setSaving(false)
    }
  }

  // Cancel purchase
  async function handleCancel(reason: string) {
    if (!purchase) return
    setSaving(true)

    try {
      const res = await fetch(`/api/purchases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancellationReason: reason,
          expectedUpdatedAt: purchase.updatedAt,
        }),
      })

      if (res.ok) {
        toast.success('Purchase invoice cancelled')
        fetchPurchase()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel')
      }
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to cancel')
    } finally {
      setSaving(false)
      setShowCancelModal(false)
    }
  }

  // Fetch payment entries for this purchase
  const fetchPaymentEntries = useCallback(async () => {
    if (isCreateMode || !id) return
    try {
      const res = await fetch(`/api/purchases/${id}/payments`)
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
    if (!purchase) return ''
    const remaining = parseFloat(purchase.total) - computedTotalPaid
    const params = new URLSearchParams({
      paymentType: 'pay',
      partyType: 'supplier',
      partyId: purchase.supplierId,
      partyName: purchase.supplierName || '',
      referenceType: 'purchase',
      referenceId: purchase.id,
      amount: String(Math.max(0, remaining)),
      returnUrl: `/c/${tenantSlug}/purchases/${purchase.id}`,
    })
    return `/c/${tenantSlug}/accounting/payment-entries/new?${params}`
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
      total: 0,
      isNew: true,
    }])
    setHasUnsavedChanges(true)
  }

  function handleItemChange(index: number, field: string, value: unknown, option?: LinkFieldOption) {
    const newItems = [...editingItems]
    if (field === 'itemId' && option) {
      const globalCostPrice = parseFloat(option.data?.costPrice as string || '0')
      const itemId = String(value)
      newItems[index] = {
        ...newItems[index],
        itemId,
        itemName: option.data?.name as string || option.label,
        itemSku: option.data?.sku as string || option.sublabel || null,
        itemBarcode: option.data?.barcode as string || null,
        itemPartNumber: (option.data?.oemPartNumber || option.data?.sku || option.data?.pluCode) as string || null,
        unitPrice: globalCostPrice,
        total: newItems[index].quantity * globalCostPrice,
      }
      setEditingItems([...newItems])
      setHasUnsavedChanges(true)

      // Fetch supplier-specific cost and update if available
      const supplierId = purchase?.supplierId
      if (supplierId && itemId) {
        fetch(`/api/items/${itemId}/supplier-costs?supplierId=${supplierId}`)
          .then(res => res.ok ? res.json() : null)
          .then(costs => {
            if (costs && costs.length > 0) {
              const supplierCost = parseFloat(costs[0].lastCostPrice)
              if (supplierCost > 0) {
                setEditingItems(prev => {
                  const updated = [...prev]
                  if (updated[index]?.itemId === itemId) {
                    updated[index] = { ...updated[index], unitPrice: supplierCost, total: updated[index].quantity * supplierCost }
                  }
                  return updated
                })
              }
            }
          })
          .catch(() => {})
      }
      return
    } else if (field === 'quantity') {
      const qty = parseFloat(String(value)) || 0
      newItems[index] = { ...newItems[index], quantity: qty, total: qty * newItems[index].unitPrice }
    } else if (field === 'unitPrice') {
      const price = parseFloat(String(value)) || 0
      newItems[index] = { ...newItems[index], unitPrice: price, total: newItems[index].quantity * price }
    }
    setEditingItems(newItems)
    setHasUnsavedChanges(true)
  }

  async function handleDeleteRow(index: number) {
    const item = editingItems[index]
    if (!item.isNew && item.id && !item.id.startsWith('new-')) {
      try {
        const res = await fetch(`/api/purchases/${id}/items/${item.id}`, { method: 'DELETE' })
        if (!res.ok) {
          toast.error('Failed to delete item')
          return
        }
        if (item.itemName) {
          setDeletedItemNames(prev => [...prev, item.itemName])
        }
      } catch (err) {
        console.error('Error deleting:', err)
        toast.error('Failed to delete item')
        return
      }
    }
    setEditingItems(editingItems.filter((_, i) => i !== index))
    setHasUnsavedChanges(true)
  }

  function handleItemCreated(item: { id: string; name: string; sku?: string; barcode?: string; oemPartNumber?: string; pluCode?: string; costPrice?: string; sellingPrice: string }) {
    if (pendingItemRowIndex !== null) {
      const costPrice = parseFloat(item.costPrice || item.sellingPrice || '0')
      const newItems = [...editingItems]
      newItems[pendingItemRowIndex] = {
        ...newItems[pendingItemRowIndex],
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku || null,
        itemBarcode: item.barcode || null,
        itemPartNumber: item.oemPartNumber || item.pluCode || null,
        unitPrice: costPrice,
        total: newItems[pendingItemRowIndex].quantity * costPrice,
      }
      setEditingItems(newItems)
      setHasUnsavedChanges(true)
    }
    setShowItemModal(false)
    setPendingItemRowIndex(null)
    toast.success(`Item "${item.name}" created`)
  }

  function handleSupplierCreated(supplier: Supplier) {
    setCreateFormData({ ...createFormData, supplierId: supplier.id, supplierName: supplier.name })
    setShowCreateSupplierModal(false)
  }

  function toggleSection(section: keyof typeof sectionsOpen) {
    setSectionsOpen({ ...sectionsOpen, [section]: !sectionsOpen[section] })
  }

  function handleAddTag() {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      const updatedTags = [...tags, newTag.trim()]
      setTags(updatedTags)
      setNewTag('')
      setShowTagInput(false)
      fetch(`/api/purchases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: updatedTags }),
      })
    }
  }

  function handleRemoveTag(tag: string) {
    const updatedTags = tags.filter(t => t !== tag)
    setTags(updatedTags)
    fetch(`/api/purchases/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: updatedTags }),
    })
  }

  // Computed
  const totalQty = editingItems.reduce((sum, item) => sum + item.quantity, 0)
  const totalAmount = editingItems.reduce((sum, item) => sum + item.total, 0)

  if (loading) {
    return <PageLoading text="Loading purchase invoice..." />
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
            <span className="text-gray-400">Buying</span>
            <ChevronRight size={14} />
            <Link href={tenantSlug ? `/c/${tenantSlug}/purchases` : '/purchases'} className="hover:text-blue-600 dark:hover:text-blue-400">
              Purchase Invoice
            </Link>
            <ChevronRight size={14} />
            <span className="text-gray-900 dark:text-white font-medium">New</span>
          </div>
        </div>

        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New Purchase Invoice</h1>
        </div>

        {/* Form */}
        <div className="p-6 max-w-4xl">
          {/* Supplier Section */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
            <div className="px-4 py-3 font-medium text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700">
              Supplier and Warehouse
            </div>
            <div className="px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Supplier <span className="text-red-500">*</span>
                </label>
                <LinkField
                  fetchOptions={searchSuppliers}
                  value={createFormData.supplierId}
                  onChange={(value, option) => setCreateFormData({ ...createFormData, supplierId: value, supplierName: option?.label || '' })}
                  onCreateNew={(name) => { setPendingSupplierName(name); setShowCreateSupplierModal(true) }}
                  placeholder="Select Supplier"
                  createLabel="Create new Supplier"
                  displayValue={createFormData.supplierName}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Target Warehouse <span className="text-red-500">*</span>
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
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Supplier Invoice No.
                </label>
                <input
                  type="text"
                  value={createFormData.supplierInvoiceNo}
                  onChange={(e) => setCreateFormData({ ...createFormData, supplierInvoiceNo: e.target.value })}
                  placeholder="Supplier's invoice number"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Bill Date
                </label>
                <input
                  type="date"
                  value={createFormData.supplierBillDate}
                  onChange={(e) => setCreateFormData({ ...createFormData, supplierBillDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                />
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
              href={tenantSlug ? `/c/${tenantSlug}/purchases` : '/purchases'}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </div>

        {/* Modals */}
        <SupplierModal
          isOpen={showCreateSupplierModal}
          onClose={() => setShowCreateSupplierModal(false)}
          onCreated={handleSupplierCreated}
          initialName={pendingSupplierName}
        />
      </div>
    )
  }

  // ==================== VIEW/EDIT MODE ====================
  if (!purchase) {
    return <div className="text-center py-8 text-gray-500">Purchase invoice not found</div>
  }

  const isDraft = purchase.status === 'draft'
  const isPending = purchase.status === 'pending'
  const isPartial = purchase.status === 'partial'
  const isPaid = purchase.status === 'paid'
  const isCancelled = purchase.status === 'cancelled'
  const canEdit = isDraft
  const canSubmit = isDraft && !hasUnsavedChanges && editingItems.length > 0
  const canCancel = (isDraft || isPending || isPartial) && !isCancelled

  // Compute totalPaid from actual payment records (source of truth) instead of
  // trusting denormalized paidAmount, which can drift from double-submits or
  // cancelled payment entries that don't reverse properly.
  const directPaymentsTotal = (purchase.payments || []).reduce(
    (sum, p) => sum + parseFloat(p.amount), 0
  )
  const peAllocatedTotal = paymentEntriesData.reduce(
    (sum, pe) => sum + parseFloat(pe.allocatedAmount), 0
  )
  const jeAllocatedTotal = jeAllocationsData.reduce(
    (sum, je) => sum + parseFloat(je.allocatedAmount), 0
  )
  const computedTotalPaid = Math.round((directPaymentsTotal + peAllocatedTotal + jeAllocatedTotal) * 100) / 100
  const balance = parseFloat(purchase.total) - computedTotalPaid
  const status = statusConfig[purchase.status] || statusConfig.draft

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 -m-5">
      {/* ===== BREADCRUMB ===== */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link href={tenantSlug ? `/c/${tenantSlug}/dashboard` : '/dashboard'} className="hover:text-blue-600 dark:hover:text-blue-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-400">Buying</span>
          <ChevronRight size={14} />
          <Link href={tenantSlug ? `/c/${tenantSlug}/purchases` : '/purchases'} className="hover:text-blue-600 dark:hover:text-blue-400">
            Purchase Invoice
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium">{purchase.purchaseNo}</span>
        </div>
      </div>

      {/* ===== HEADER ===== */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{purchase.purchaseNo}</h1>
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

            <button onClick={() => fetchPurchase()} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">
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
                        onClick={() => { setShowMoreDropdown(false); setShowDeleteConfirm(true) }}
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

        {/* AI Smart Warnings */}
        {(purchaseWarnings.warnings.length > 0 || purchaseWarnings.loading) && (
          <div className="mt-4">
            <SmartWarningBanner
              warnings={purchaseWarnings.warnings}
              loading={purchaseWarnings.loading}
              onProceed={() => {
                setPurchaseWarningBypassed(true)
                purchaseWarnings.clearWarnings()
                handleSave()
              }}
              onCancel={() => purchaseWarnings.clearWarnings()}
              processing={saving}
              proceedText="Save Anyway"
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 mt-4">
          {/* Draft: Save (if unsaved changes) or Submit + Cancel */}
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
                <>
                  <button
                    onClick={() => setShowSubmitConfirm(true)}
                    disabled={saving || !canSubmit}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                  >
                    <CheckCircle size={14} />
                    {saving ? 'Submitting...' : 'Submit'}
                  </button>
                </>
              )}
              {canCancel && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  disabled={saving}
                  className="px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              )}
            </>
          )}

          {/* Pending (submitted): Record Payment + Cancel */}
          {isPending && (
            <>
              <button
                onClick={() => router.push(getPaymentEntryUrl())}
                disabled={saving || balance <= 0}
                className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                <CreditCard size={14} />
                Record Payment
              </button>
              {canCancel && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  disabled={saving}
                  className="px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              )}
            </>
          )}

          {/* Partial: Record Payment + Cancel */}
          {isPartial && (
            <>
              <button
                onClick={() => router.push(getPaymentEntryUrl())}
                disabled={saving || balance <= 0}
                className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                <CreditCard size={14} />
                Record Payment
              </button>
              {canCancel && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  disabled={saving}
                  className="px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              )}
            </>
          )}

          {/* Paid: Print */}
          {isPaid && (
            <button
              onClick={() => setShowPrintPreview(true)}
              className="px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1"
            >
              <Printer size={14} />
              Print
            </button>
          )}

          {/* Cancelled: Amend */}
          {isCancelled && (
            <button className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors">
              Amend
            </button>
          )}
        </div>
      </div>

      {/* ===== CANCELLED BANNER ===== */}
      {isCancelled && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-6 py-3">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <X size={16} />
            <span className="font-medium">This document is cancelled.</span>
            {purchase.cancellationReason && <span>Reason: {purchase.cancellationReason}</span>}
          </div>
        </div>
      )}

      {/* ===== MAIN LAYOUT WITH SIDEBAR ===== */}
      <div className="flex">
        {/* LEFT SIDEBAR */}
        <div className="w-64 flex-shrink-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-4 space-y-6 min-h-[calc(100vh-128px)]">
          {/* Document Info */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Document Info</h3>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">ID</div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{purchase.purchaseNo}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Owner</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                    <User size={12} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-sm text-gray-900 dark:text-white">{purchase.createdByName || 'Unknown'}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Created</div>
                <div className="text-sm text-gray-900 dark:text-white">{formatDate(purchase.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Modified</div>
                <div className="text-sm text-gray-900 dark:text-white">{formatDate(purchase.updatedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Outstanding</div>
                <div className={`text-sm font-bold ${balance > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  {formatCurrency(balance)}
                </div>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300 rounded">
                  {tag}
                  <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
              {showTagInput ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    className="w-20 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Tag..."
                    autoFocus
                  />
                  <button onClick={handleAddTag} className="text-blue-600 hover:text-blue-700">
                    <Plus size={14} />
                  </button>
                  <button onClick={() => { setShowTagInput(false); setNewTag('') }} className="text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowTagInput(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                >
                  <Tag size={12} /> Add Tag
                </button>
              )}
            </div>
          </div>

          {/* Attachments */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Attachments</h3>
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center justify-between text-sm group">
                  <a
                    href={attachment.filePath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline truncate"
                  >
                    <FileIcon size={14} />
                    <span className="truncate">{attachment.fileName}</span>
                  </a>
                  <button
                    onClick={() => handleDeleteAttachment(attachment.id)}
                    className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <label className={`inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded cursor-pointer mt-2 ${uploadingAttachment ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input type="file" multiple className="hidden" onChange={handleAttachmentUpload} disabled={uploadingAttachment} />
              <Paperclip size={12} /> {uploadingAttachment ? 'Uploading...' : 'Attach File'}
            </label>
          </div>

          {/* Linked Documents */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Linked Documents</h3>
            <div className="space-y-2 text-sm">
              {purchase.purchaseOrderId ? (
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Purchase Order</span>
                  <div className="mt-1">
                    <Link
                      href={tenantSlug ? `/c/${tenantSlug}/purchase-orders/${purchase.purchaseOrderId}` : `/purchase-orders/${purchase.purchaseOrderId}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {purchase.purchaseOrderNo}
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Purchase Order</span>
                  <span className="text-gray-400 dark:text-gray-500">None</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-gray-600 dark:text-gray-400">Payments</span>
                <span className="text-gray-900 dark:text-white">{(purchase.payments?.length || 0) + paymentEntriesData.length + jeAllocationsData.length}</span>
              </div>
              {(paymentEntriesData.length > 0 || jeAllocationsData.length > 0) && (
                <div className="mt-2 space-y-1">
                  {paymentEntriesData.map((pe) => (
                    <Link
                      key={pe.id}
                      href={`/c/${tenantSlug}/accounting/payment-entries/${pe.paymentEntryId}`}
                      className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <CreditCard size={12} />
                      {pe.entryNumber}
                    </Link>
                  ))}
                  {jeAllocationsData.map((je) => (
                    <div
                      key={je.id}
                      className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400"
                    >
                      <CreditCard size={12} />
                      {je.entryNumber} (JE)
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 p-6 overflow-auto">
          {/* Supplier & Warehouse */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
            <button
              onClick={() => toggleSection('supplier')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <span className="font-medium text-gray-900 dark:text-white">Supplier and Warehouse</span>
              {sectionsOpen.supplier ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
            </button>
            {sectionsOpen.supplier && (
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Supplier</label>
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded">
                    <Building2 size={14} className="text-gray-400" />
                    <Link href="#" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{purchase.supplierName || 'Not set'}</Link>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Target Warehouse</label>
                  {canEdit ? (
                    <select
                      value={headerForm.warehouseId}
                      onChange={(e) => { setHeaderForm({ ...headerForm, warehouseId: e.target.value }); setHasUnsavedChanges(true) }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="">Select Warehouse</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded">
                      <Warehouse size={14} className="text-gray-400" />
                      <Link href="#" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{purchase.warehouseName || 'Not set'}</Link>
                    </div>
                  )}
                </div>
                {costCenters.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Cost Center {canEdit && <span className="text-red-500">*</span>}</label>
                  {canEdit ? (
                    <select
                      value={headerForm.costCenterId}
                      onChange={(e) => { setHeaderForm({ ...headerForm, costCenterId: e.target.value }); setHasUnsavedChanges(true) }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="">Select Cost Center</option>
                      {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
                    </select>
                  ) : (
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded text-sm">
                      {costCenters.find(cc => cc.id === purchase.costCenterId)?.name || '-'}
                    </div>
                  )}
                </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Supplier Invoice No.</label>
                  {canEdit ? (
                    <input
                      type="text"
                      value={headerForm.supplierInvoiceNo}
                      onChange={(e) => { setHeaderForm({ ...headerForm, supplierInvoiceNo: e.target.value }); setHasUnsavedChanges(true) }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  ) : (
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded text-sm">
                      {purchase.supplierInvoiceNo || '-'}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Bill Date</label>
                  {canEdit ? (
                    <input
                      type="date"
                      value={headerForm.supplierBillDate}
                      onChange={(e) => { setHeaderForm({ ...headerForm, supplierBillDate: e.target.value }); setHasUnsavedChanges(true) }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded">
                      <Calendar size={14} className="text-gray-400" />
                      <span className="text-sm">{purchase.supplierBillDate ? formatDate(purchase.supplierBillDate) : 'Not set'}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
            <button
              onClick={() => toggleSection('items')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <span className="font-medium text-gray-900 dark:text-white">Items</span>
              {sectionsOpen.items ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
            </button>
            {sectionsOpen.items && (
              <div className="border-t border-gray-100 dark:border-gray-700">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-10">No.</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-20">Qty</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-28">Rate</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-28">Amount</th>
                        {canEdit && <th className="px-3 py-2 w-10"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {editingItems.length === 0 ? (
                        <tr>
                          <td colSpan={canEdit ? 6 : 5} className="px-3 py-8 text-center text-gray-500">
                            <Package size={24} className="mx-auto mb-2 text-gray-300" />
                            <p className="text-sm">No items</p>
                          </td>
                        </tr>
                      ) : (
                        editingItems.map((item, index) => (
                          <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-2 text-sm text-gray-500">{index + 1}</td>
                            <td className="px-3 py-2">
                              {canEdit ? (
                                <LinkField
                                  fetchOptions={searchItems}
                                  value={item.itemId}
                                  onChange={(value, option) => handleItemChange(index, 'itemId', value, option)}
                                  onCreateNew={(name) => { setItemInitialName(name); setPendingItemRowIndex(index); setShowItemModal(true) }}
                                  placeholder="Select Item"
                                  createLabel="Create Item"
                                  displayValue={formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemPartNumber }, businessType)}
                                />
                              ) : (
                                <div>
                                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                                    {formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemPartNumber }, businessType)}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {canEdit ? (
                                <input
                                  type="number"
                                  value={item.quantity}
                                  onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                                  className="w-16 px-2 py-1 text-right text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                />
                              ) : (
                                <span className="text-sm">{item.quantity}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {canEdit ? (
                                <input
                                  type="number"
                                  value={item.unitPrice}
                                  onChange={(e) => handleItemChange(index, 'unitPrice', e.target.value)}
                                  className="w-24 px-2 py-1 text-right text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                />
                              ) : (
                                <span className="text-sm">{formatCurrency(item.unitPrice)}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span className="text-sm font-medium">{formatCurrency(item.total)}</span>
                            </td>
                            {canEdit && (
                              <td className="px-3 py-2">
                                <button onClick={() => handleDeleteRow(index)} className="p-1 text-gray-400 hover:text-red-500">
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {canEdit && (
                  <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                    <button onClick={handleAddRow} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
                      <Plus size={14} /> Add Row
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
            <button
              onClick={() => toggleSection('totals')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <span className="font-medium text-gray-900 dark:text-white">Totals</span>
              {sectionsOpen.totals ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
            </button>
            {sectionsOpen.totals && (
              <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                <div className="max-w-xs ml-auto space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Total Quantity</span>
                    <span className="font-medium">{totalQty}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="font-medium">{formatCurrency(totalAmount)}</span>
                  </div>
                  <hr className="border-gray-200 dark:border-gray-700" />
                  <div className="flex justify-between">
                    <span className="font-semibold">Grand Total</span>
                    <span className="font-bold text-lg">{formatCurrency(parseFloat(purchase.total))}</span>
                  </div>
                  <hr className="border-gray-200 dark:border-gray-700" />
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Total Paid</span>
                    <span className="font-medium text-green-600">{formatCurrency(computedTotalPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold">Outstanding</span>
                    <span className={`font-bold text-lg ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(balance)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Payments History */}
          {((purchase.payments && purchase.payments.length > 0) || paymentEntriesData.length > 0 || jeAllocationsData.length > 0) && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
              <button
                onClick={() => toggleSection('payments')}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <span className="font-medium text-gray-900 dark:text-white">Payment History</span>
                {sectionsOpen.payments ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
              </button>
              {sectionsOpen.payments && (
                <div className="border-t border-gray-100 dark:border-gray-700">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {purchase.payments?.map((payment) => (
                          <tr key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-2 text-sm">{formatDateTime(payment.paidAt)}</td>
                            <td className="px-3 py-2 text-sm">{paymentMethodLabels[payment.paymentMethod] || payment.paymentMethod}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">{payment.paymentReference || '-'}</td>
                            <td className="px-3 py-2 text-right text-sm font-medium text-green-600">{formatCurrency(parseFloat(payment.amount))}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">{payment.createdByName || '-'}</td>
                          </tr>
                        ))}
                        {paymentEntriesData.map((pe) => (
                          <tr key={pe.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-2 text-sm">{formatDate(pe.postingDate)}</td>
                            <td className="px-3 py-2 text-sm">
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                                Payment Entry
                              </span>
                            </td>
                            <td className="px-3 py-2 text-sm">
                              <Link
                                href={`/c/${tenantSlug}/accounting/payment-entries/${pe.paymentEntryId}`}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {pe.entryNumber}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-right text-sm font-medium text-green-600">{formatCurrency(parseFloat(pe.allocatedAmount))}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">-</td>
                          </tr>
                        ))}
                        {jeAllocationsData.map((je) => (
                          <tr key={je.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-2 text-sm">{formatDate(je.postingDate)}</td>
                            <td className="px-3 py-2 text-sm">
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                Journal Entry
                              </span>
                            </td>
                            <td className="px-3 py-2 text-sm text-purple-600 dark:text-purple-400">
                              {je.entryNumber}
                            </td>
                            <td className="px-3 py-2 text-right text-sm font-medium text-green-600">{formatCurrency(parseFloat(je.allocatedAmount))}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">-</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* More Information */}
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
            <button
              onClick={() => toggleSection('moreInfo')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <span className="font-medium text-gray-900 dark:text-white">More Information</span>
              {sectionsOpen.moreInfo ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
            </button>
            {sectionsOpen.moreInfo && (
              <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Notes</label>
                  {canEdit ? (
                    <textarea
                      value={headerForm.notes}
                      onChange={(e) => { setHeaderForm({ ...headerForm, notes: e.target.value }); setHasUnsavedChanges(true) }}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none"
                      placeholder="Add notes..."
                    />
                  ) : (
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded min-h-[60px] text-sm">
                      {purchase.notes || 'No notes'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Activity + Comments */}
          <DocumentCommentsAndActivity
            documentType="purchase"
            documentId={id}
            entityType="purchase"
          />
        </div>
      </div>

      {/* Modals */}
      <ConfirmModal
        isOpen={showSubmitConfirm}
        onClose={() => setShowSubmitConfirm(false)}
        onConfirm={() => { setShowSubmitConfirm(false); handleSubmit() }}
        title="Submit Purchase Invoice"
        message={`Are you sure you want to submit Purchase Invoice ${purchase.purchaseNo}? Once submitted, items can no longer be edited.`}
        confirmText="Submit"
        variant="info"
        processing={saving}
      />

      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        title="Cancel Purchase Invoice"
        itemName={`Purchase Invoice ${purchase.purchaseNo}`}
        processing={saving}
        documentType="purchase_invoice"
      />

      <ItemModal
        isOpen={showItemModal}
        onClose={() => { setShowItemModal(false); setPendingItemRowIndex(null) }}
        onCreated={handleItemCreated}
        initialName={itemInitialName}
        categories={categories}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        title="Delete Purchase Invoice"
        message={`Are you sure you want to delete Purchase Invoice ${purchase.purchaseNo}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        processing={saving}
      />

      {/* Print Preview */}
      <PrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        documentType="purchase_invoice"
        title={`Purchase Invoice ${purchase.purchaseNo}`}
      >
        <PurchaseInvoiceTemplate
          purchase={{
            purchaseNo: purchase.purchaseNo,
            purchaseOrderNo: purchase.purchaseOrderNo,
            status: purchase.status,
            supplierName: purchase.supplierName,
            warehouseName: purchase.warehouseName,
            supplierInvoiceNo: purchase.supplierInvoiceNo,
            supplierBillDate: purchase.supplierBillDate,
            paymentTerm: purchase.paymentTerm || 'net_30',
            subtotal: purchase.subtotal,
            taxAmount: purchase.taxAmount,
            total: purchase.total,
            paidAmount: String(computedTotalPaid),
            notes: purchase.notes,
            isReturn: purchase.isReturn,
            createdByName: purchase.createdByName,
            cancellationReason: purchase.cancellationReason,
            createdAt: purchase.createdAt,
            items: purchase.items.map(item => ({
              id: item.id,
              itemId: item.itemId,
              itemName: item.itemName,
              itemSku: item.itemSku,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              tax: item.tax,
              total: item.total,
            })),
            payments: purchase.payments.map(p => ({
              id: p.id,
              amount: p.amount,
              paymentMethod: p.paymentMethod,
              paymentReference: p.paymentReference || null,
              notes: p.notes || null,
              paidAt: p.paidAt,
              createdByName: p.createdByName || null,
            })),
          }}
          settings={DEFAULT_PRINT_SETTINGS.purchase_invoice}
          businessName={tenantName}
          currencyCode={currency}
        />
      </PrintPreview>
    </div>
  )
}
