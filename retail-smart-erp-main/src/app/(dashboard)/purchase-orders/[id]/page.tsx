'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import {
  ChevronDown, ChevronRight, Heart, RotateCw, MoreHorizontal,
  Printer, Trash2, Plus, Building2, Warehouse, Calendar,
  User, Package, ChevronUp, Paperclip, Tag, X,
  PackageCheck, TruckIcon, FileIcon
} from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { CancellationReasonModal, ItemModal, SupplierModal, ReceiveItemsModal, ReceiveItemData, CreatePurchaseInvoiceModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date-format'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { LinkField, LinkFieldOption } from '@/components/ui/link-field'
import { formatItemLabel, buildItemSearchOption } from '@/lib/utils/item-display'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { PrintPreview, PurchaseOrderTemplate } from '@/components/print'
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
  receivedQuantity: string
  unitPrice: string
  tax: string
  total: string
}

interface PurchaseOrder {
  id: string
  orderNo: string
  supplierId: string
  supplierName: string | null
  warehouseId: string
  warehouseName: string | null
  expectedDeliveryDate: string | null
  subtotal: string
  taxAmount: string
  total: string
  status: 'draft' | 'submitted' | 'confirmed' | 'partially_received' | 'fully_received' | 'invoice_created' | 'cancelled'
  notes: string | null
  createdBy: string | null
  createdByName: string | null
  approvedBy: string | null
  approvedAt: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  items: OrderItem[]
  linkedInvoices: LinkedInvoice[]
}

interface LinkedInvoice {
  id: string
  purchaseNo: string
  status: string
  total: string
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

interface ReceiptRecord {
  id: string
  receiptNo: string
  receiptDate: string
  status: 'draft' | 'completed' | 'cancelled'
  supplierInvoiceNo: string | null
  receivedByName: string | null
  notes: string | null
  cancellationReason: string | null
  createdAt: string
  totalItems: number
  totalQtyReceived: number
  items: {
    id: string
    itemName: string
    itemSku: string | null
    itemBarcode: string | null
    itemOemPartNumber: string | null
    itemPluCode: string | null
    quantityReceived: string
    quantityAccepted: string
    quantityRejected: string
  }[]
}

const statusConfig: Record<string, { label: string; color: string; bgColor: string; dotColor: string }> = {
  draft: { label: 'Draft', color: 'text-red-600', bgColor: 'bg-red-50 border-red-200', dotColor: 'bg-red-500' },
  submitted: { label: 'Submitted', color: 'text-blue-600', bgColor: 'bg-blue-50 border-blue-200', dotColor: 'bg-blue-500' },
  confirmed: { label: 'To Receive', color: 'text-orange-600', bgColor: 'bg-orange-50 border-orange-200', dotColor: 'bg-orange-500' },
  partially_received: { label: 'Partially Received', color: 'text-amber-600', bgColor: 'bg-amber-50 border-amber-200', dotColor: 'bg-amber-500' },
  fully_received: { label: 'Fully Received', color: 'text-teal-600', bgColor: 'bg-teal-50 border-teal-200', dotColor: 'bg-teal-500' },
  invoice_created: { label: 'Completed', color: 'text-green-600', bgColor: 'bg-green-50 border-green-200', dotColor: 'bg-green-500' },
  cancelled: { label: 'Cancelled', color: 'text-gray-600', bgColor: 'bg-gray-100 border-gray-300', dotColor: 'bg-gray-500' },
}

export default function PurchaseOrderDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const { tenantSlug, businessType, tenantName, currency } = useCompany()
  const isCreateMode = id === 'new'

  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [loading, setLoading] = useState(!isCreateMode)
  const [saving, setSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([])

  // UI State
  const [liked, setLiked] = useState(false)
  const [showMenuDropdown, setShowMenuDropdown] = useState(false)
  const [showMoreDropdown, setShowMoreDropdown] = useState(false)

  // Receiving history
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([])
  const [receiptsLoading, setReceiptsLoading] = useState(false)

  // Collapsible sections
  const [sectionsOpen, setSectionsOpen] = useState({
    supplier: true,
    items: true,
    totals: true,
    receivingHistory: false,
    moreInfo: true,
  })

  // Create mode state
  const [createFormData, setCreateFormData] = useState({
    supplierId: '',
    supplierName: '',
    warehouseId: '',
    expectedDeliveryDate: '',
    notes: '',
  })
  const [showCreateSupplierModal, setShowCreateSupplierModal] = useState(false)
  const [pendingSupplierName, setPendingSupplierName] = useState('')

  // Edit mode state
  const [editingItems, setEditingItems] = useState<EditableItem[]>([])
  const [deletedItemNames, setDeletedItemNames] = useState<string[]>([])
  const [headerForm, setHeaderForm] = useState({
    warehouseId: '',
    expectedDeliveryDate: '',
    notes: '',
  })

  // Modals
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showConfirmConfirm, setShowConfirmConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [showCreateInvoiceModal, setShowCreateInvoiceModal] = useState(false)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [itemInitialName, setItemInitialName] = useState('')
  const [pendingItemRowIndex, setPendingItemRowIndex] = useState<number | null>(null)

  // Attachments
  const [attachments, setAttachments] = useState<Array<{
    id: string; fileName: string; fileType: string; fileSize: number;
    filePath: string; createdAt: string; uploadedByUser?: { fullName: string } | null
  }>>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

  // Tags
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/purchase-orders/${id}`)
      if (res.ok) {
        const data = await res.json()
        setOrder(data)
        setHeaderForm({
          warehouseId: data.warehouseId || '',
          expectedDeliveryDate: data.expectedDeliveryDate || '',
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
          total: parseFloat(item.total) || 0,
        })))
        setHasUnsavedChanges(false)
        try { setTags(data.tags ? JSON.parse(data.tags) : []) } catch { setTags([]) }
      } else {
        toast.error('Failed to load purchase order')
        router.push(tenantSlug ? `/c/${tenantSlug}/purchase-orders` : '/purchase-orders')
      }
    } catch (error) {
      console.error('Error fetching order:', error)
      toast.error('Failed to load purchase order')
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
    if (!isCreateMode) fetchAttachments()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeData(fetchOrder, { entityType: ['purchase-order', 'purchase-receipt'], enabled: !isCreateMode })

  // Fetch receipts when receiving history section opens
  const fetchReceipts = useCallback(async () => {
    if (isCreateMode) return
    setReceiptsLoading(true)
    try {
      const res = await fetch(`/api/purchase-orders/${id}/receipts`)
      if (res.ok) {
        const data = await res.json()
        setReceipts(data)
      }
    } catch {
      // silent
    } finally {
      setReceiptsLoading(false)
    }
  }, [id, isCreateMode])

  useEffect(() => {
    if (sectionsOpen.receivingHistory && receipts.length === 0 && !receiptsLoading) {
      fetchReceipts()
    }
  }, [sectionsOpen.receivingHistory, receipts.length, receiptsLoading, fetchReceipts])

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

  // Create order
  async function handleCreate() {
    if (!createFormData.supplierId) {
      toast.error('Please select a supplier')
      return
    }
    if (!createFormData.warehouseId) {
      toast.error('Please select a warehouse')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: createFormData.supplierId,
          warehouseId: createFormData.warehouseId,
          expectedDeliveryDate: createFormData.expectedDeliveryDate || null,
          notes: createFormData.notes || null,
          items: [],
        }),
      })

      if (res.ok) {
        const savedOrder = await res.json()
        toast.success(`Purchase Order ${savedOrder.orderNo} created`)
        router.replace(tenantSlug ? `/c/${tenantSlug}/purchase-orders/${savedOrder.id}` : `/purchase-orders/${savedOrder.id}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create purchase order')
      }
    } catch (err) {
      console.error('Error creating:', err)
      toast.error('Failed to create purchase order')
    } finally {
      setSaving(false)
    }
  }

  // Save changes
  async function handleSave() {
    if (!order) return
    setSaving(true)

    try {
      // Build item changes summary
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
        const orig = originalItems.find((o: OrderItem) => o.id === item.id)
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

      const headerRes = await fetch(`/api/purchase-orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: headerForm.warehouseId || undefined,
          expectedDeliveryDate: headerForm.expectedDeliveryDate || null,
          notes: headerForm.notes || null,
          expectedUpdatedAt: order.updatedAt,
          changesSummary,
        }),
      })

      if (!headerRes.ok) {
        const data = await headerRes.json()
        if (data.code === 'CONFLICT') {
          toast.error('Modified by another user. Refreshing...')
          fetchOrder()
          return
        }
        toast.error(data.error || 'Failed to save')
        return
      }

      let itemError = false
      for (const item of editingItems) {
        if (item.isNew) {
          if (!item.itemId) continue
          const res = await fetch(`/api/purchase-orders/${id}/items`, {
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
          const res = await fetch(`/api/purchase-orders/${id}/items/${item.id}`, {
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
      fetchOrder()
    } catch (error) {
      console.error('Error saving:', error)
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Status change
  async function handleDelete() {
    if (!order) return
    setSaving(true)
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Purchase order deleted')
        router.push(tenantSlug ? `/c/${tenantSlug}/purchase-orders` : '/purchase-orders')
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
      const res = await fetch(`/api/purchase-orders/${id}/attachments`)
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
        const res = await fetch(`/api/purchase-orders/${id}/attachments`, {
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
      const res = await fetch(`/api/purchase-orders/${id}/attachments?attachmentId=${attachmentId}`, {
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

  async function handleStatusChange(newStatus: string, reason?: string) {
    if (!order) return
    setSaving(true)

    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
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

  // Receive items and create invoice
  async function handleReceiveItems(data: {
    items: { itemId: string; receivedQuantity: number; notes?: string }[]
    updateStock: boolean
    notes: string
    supplierInvoiceNo: string
    supplierBillDate: string
  }) {
    if (!order) return
    setSaving(true)

    try {
      // Step 1: Receive items (creates GRN record)
      const receiveRes = await fetch(`/api/purchase-orders/${id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: data.items,
          updateStock: data.updateStock,
          notes: data.notes,
          supplierInvoiceNo: data.supplierInvoiceNo,
          supplierBillDate: data.supplierBillDate,
        }),
      })

      if (!receiveRes.ok) {
        const err = await receiveRes.json()
        toast.error(err.error || 'Failed to receive items')
        return
      }

      toast.success('Items received successfully')
      fetchReceipts() // Refresh receiving history

      // Step 2: Create purchase invoice using received quantities (not full ordered qty)
      // Build a map of received quantities from the receive modal
      const receivedMap = new Map(data.items.map(ri => [ri.itemId, ri.receivedQuantity]))

      const invoiceItems = order.items
        .map(item => {
          const receivedQty = receivedMap.get(item.id) || 0
          if (receivedQty <= 0) return null
          const orderedQty = parseFloat(item.quantity)
          const itemTax = orderedQty > 0 ? parseFloat(item.tax || '0') * (receivedQty / orderedQty) : 0
          return {
            itemId: item.itemId,
            itemName: item.itemName,
            quantity: receivedQty,
            unitPrice: parseFloat(item.unitPrice),
            tax: Math.round(itemTax * 100) / 100,
          }
        })
        .filter(Boolean)

      const invoiceRes = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: order.supplierId,
          warehouseId: order.warehouseId,
          purchaseOrderId: order.id,
          supplierInvoiceNo: data.supplierInvoiceNo,
          supplierBillDate: data.supplierBillDate,
          notes: data.notes || `Created from PO ${order.orderNo}`,
          items: invoiceItems,
        }),
      })

      if (invoiceRes.ok) {
        const invoice = await invoiceRes.json()
        toast.success('Purchase invoice created')
        setShowReceiveModal(false)
        // Navigate to the created invoice
        router.push(tenantSlug ? `/c/${tenantSlug}/purchases/${invoice.id}` : `/purchases/${invoice.id}`)
      } else {
        const err = await invoiceRes.json()
        toast.error(err.error || 'Failed to create purchase invoice')
        setShowReceiveModal(false)
        fetchOrder()
      }
    } catch (error) {
      console.error('Error receiving items:', error)
      toast.error('Failed to receive items')
    } finally {
      setSaving(false)
    }
  }

  // Create invoice from PO (without receiving first — marks all items as received)
  async function handleCreateInvoice(data: {
    supplierInvoiceNo: string
    supplierBillDate: string
    costCenterId?: string
  }) {
    if (!order) return
    setSaving(true)

    try {
      // Build receivedQuantities: full remaining qty for each item
      const receivedQuantities: Record<string, string> = {}
      for (const item of order.items) {
        const ordered = parseFloat(item.quantity)
        const alreadyReceived = parseFloat(item.receivedQuantity || '0')
        const remaining = ordered - alreadyReceived
        if (remaining > 0) {
          receivedQuantities[item.id] = remaining.toString()
        }
      }

      // Use the dedicated create-invoice endpoint which handles:
      // - Creating the invoice
      // - Updating PO item receivedQuantity
      // - Updating PO status to invoice_created
      // - Updating supplier balance
      const invoiceRes = await fetch(`/api/purchase-orders/${id}/create-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierInvoiceNo: data.supplierInvoiceNo,
          supplierBillDate: data.supplierBillDate,
          costCenterId: data.costCenterId || null,
          notes: `Created from PO ${order.orderNo}`,
          receivedQuantities,
        }),
      })

      if (invoiceRes.ok) {
        const result = await invoiceRes.json()
        toast.success('Purchase invoice created')
        setShowCreateInvoiceModal(false)
        router.push(tenantSlug ? `/c/${tenantSlug}/purchases/${result.purchase.id}` : `/purchases/${result.purchase.id}`)
      } else {
        const err = await invoiceRes.json()
        toast.error(err.error || 'Failed to create purchase invoice')
      }
    } catch (error) {
      console.error('Error creating invoice:', error)
      toast.error('Failed to create purchase invoice')
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
      total: 0,
      isNew: true,
    }])
    setHasUnsavedChanges(true)
  }

  function handleItemChange(index: number, field: string, value: unknown, option?: LinkFieldOption) {
    const newItems = [...editingItems]
    if (field === 'itemId' && option) {
      const costPrice = parseFloat(option.data?.costPrice as string || '0')
      newItems[index] = {
        ...newItems[index],
        itemId: String(value),
        itemName: option.data?.name as string || option.label,
        itemSku: option.data?.sku as string || option.sublabel || null,
        itemBarcode: option.data?.barcode as string || null,
        itemPartNumber: (option.data?.oemPartNumber || option.data?.sku || option.data?.pluCode) as string || null,
        unitPrice: costPrice,
        total: newItems[index].quantity * costPrice,
      }
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
        const res = await fetch(`/api/purchase-orders/${id}/items/${item.id}`, { method: 'DELETE' })
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
      fetch(`/api/purchase-orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: updatedTags }),
      })
    }
  }

  function handleRemoveTag(tag: string) {
    const updatedTags = tags.filter(t => t !== tag)
    setTags(updatedTags)
    fetch(`/api/purchase-orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: updatedTags }),
    })
  }

  // Computed
  const totalQty = editingItems.reduce((sum, item) => sum + item.quantity, 0)
  const totalAmount = editingItems.reduce((sum, item) => sum + item.total, 0)

  if (loading) {
    return <PageLoading text="Loading purchase order..." />
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
            <Link href={tenantSlug ? `/c/${tenantSlug}/purchase-orders` : '/purchase-orders'} className="hover:text-blue-600 dark:hover:text-blue-400">
              Purchase Order
            </Link>
            <ChevronRight size={14} />
            <span className="text-gray-900 dark:text-white font-medium">New</span>
          </div>
        </div>

        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New Purchase Order</h1>
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
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Required By Date
                </label>
                <input
                  type="date"
                  value={createFormData.expectedDeliveryDate}
                  onChange={(e) => setCreateFormData({ ...createFormData, expectedDeliveryDate: e.target.value })}
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
              href={tenantSlug ? `/c/${tenantSlug}/purchase-orders` : '/purchase-orders'}
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
  if (!order) {
    return <div className="text-center py-8 text-gray-500">Purchase order not found</div>
  }

  const isDraft = order.status === 'draft'
  const isSubmitted = order.status === 'submitted'
  const isConfirmed = order.status === 'confirmed'
  const isCancelled = order.status === 'cancelled'
  const status = statusConfig[order.status] || statusConfig.draft

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
          <Link href={tenantSlug ? `/c/${tenantSlug}/purchase-orders` : '/purchase-orders'} className="hover:text-blue-600 dark:hover:text-blue-400">
            Purchase Order
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
                <>
                  <button
                    onClick={() => setShowSubmitConfirm(true)}
                    disabled={saving || editingItems.length === 0}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Submit
                  </button>
                  <button
                    onClick={() => setShowCancelModal(true)}
                    disabled={saving}
                    className="px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}
            </>
          )}

          {isSubmitted && (
            <>
              <button
                onClick={() => setShowConfirmConfirm(true)}
                disabled={saving}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowCancelModal(true)}
                disabled={saving}
                className="px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </>
          )}

          {(isConfirmed || order?.status === 'partially_received') && (
            <>
              <button
                onClick={() => setShowReceiveModal(true)}
                disabled={saving}
                className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                <TruckIcon size={14} />
                Receive Items
              </button>
              {isConfirmed && (
                <button
                  onClick={() => setShowCreateInvoiceModal(true)}
                  disabled={saving}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Create Purchase Invoice
                </button>
              )}
              <button
                onClick={() => setShowCancelModal(true)}
                disabled={saving}
                className="px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </>
          )}

          {order?.status === 'fully_received' && (
            <>
              <button
                onClick={() => setShowCreateInvoiceModal(true)}
                disabled={saving}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                <PackageCheck size={14} />
                Create Purchase Invoice
              </button>
            </>
          )}

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
            {order.cancellationReason && <span>Reason: {order.cancellationReason}</span>}
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
                <div className="text-sm font-medium text-gray-900 dark:text-white">{order.orderNo}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Owner</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                    <User size={12} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-sm text-gray-900 dark:text-white">{order.createdByName || 'Unknown'}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Created</div>
                <div className="text-sm text-gray-900 dark:text-white">{formatDate(order.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Modified</div>
                <div className="text-sm text-gray-900 dark:text-white">{formatDate(order.updatedAt)}</div>
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
              {order.linkedInvoices && order.linkedInvoices.length > 0 ? (
                order.linkedInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between">
                    <Link
                      href={tenantSlug ? `/c/${tenantSlug}/purchases/${inv.id}` : `/purchases/${inv.id}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {inv.purchaseNo}
                    </Link>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      inv.status === 'cancelled' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' :
                      inv.status === 'paid' ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400' :
                      inv.status === 'draft' ? 'bg-gray-50 text-gray-500 dark:bg-gray-700 dark:text-gray-400' :
                      'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400'
                    }`}>
                      {inv.status}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Purchase Invoice</span>
                  <span className="text-gray-900 dark:text-white">0</span>
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
                    <Link href="#" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{order.supplierName || 'Not set'}</Link>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Target Warehouse</label>
                  {isDraft ? (
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
                      <Link href="#" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{order.warehouseName || 'Not set'}</Link>
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
                {/* Receiving Progress Indicator */}
                {(order.status === 'confirmed' || order.status === 'partially_received' || order.status === 'fully_received') && order.items.length > 0 && (
                  <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700">
                    {(() => {
                      const totalOrdered = order.items.reduce((sum, item) => sum + parseFloat(item.quantity), 0)
                      const totalReceived = order.items.reduce((sum, item) => sum + parseFloat(item.receivedQuantity || '0'), 0)
                      const percentComplete = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0

                      return (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Receiving Progress</span>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {totalReceived} / {totalOrdered} items ({percentComplete}%)
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                            <div
                              className={`h-2 rounded-full transition-all duration-300 ${
                                percentComplete === 100 ? 'bg-green-600' : percentComplete > 0 ? 'bg-amber-500' : 'bg-gray-300'
                              }`}
                              style={{ width: `${Math.min(percentComplete, 100)}%` }}
                            />
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-10">No.</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-20">Ordered</th>
                        {!isDraft && (
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-20">Received</th>
                        )}
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-28">Rate</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-28">Amount</th>
                        {isDraft && <th className="px-3 py-2 w-10"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {editingItems.length === 0 ? (
                        <tr>
                          <td colSpan={isDraft ? 6 : 6} className="px-3 py-8 text-center text-gray-500">
                            <Package size={24} className="mx-auto mb-2 text-gray-300" />
                            <p className="text-sm">No items</p>
                          </td>
                        </tr>
                      ) : (
                        editingItems.map((item, index) => {
                          const orderItem = order.items[index]
                          const receivedQty = parseFloat(orderItem?.receivedQuantity || '0')
                          const orderedQty = parseFloat(orderItem?.quantity || String(item.quantity))
                          const isFullyReceived = receivedQty >= orderedQty && orderedQty > 0

                          return (
                            <tr key={item.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${isFullyReceived ? 'bg-green-50/50 dark:bg-green-900/10' : ''}`}>
                              <td className="px-3 py-2 text-sm text-gray-500">{index + 1}</td>
                              <td className="px-3 py-2">
                                {isDraft ? (
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
                                  <div className="flex items-center gap-2">
                                    <div>
                                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                                        {formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemPartNumber }, businessType)}
                                      </div>
                                    </div>
                                    {isFullyReceived && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                                        <PackageCheck size={12} className="mr-0.5" />
                                        Received
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {isDraft ? (
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
                              {!isDraft && (
                                <td className="px-3 py-2 text-right">
                                  <span className={`text-sm font-medium ${
                                    isFullyReceived ? 'text-green-600' : receivedQty > 0 ? 'text-amber-600' : 'text-gray-400'
                                  }`}>
                                    {receivedQty}
                                  </span>
                                </td>
                              )}
                              <td className="px-3 py-2 text-right">
                                {isDraft ? (
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
                              {isDraft && (
                                <td className="px-3 py-2">
                                  <button onClick={() => handleDeleteRow(index)} className="p-1 text-gray-400 hover:text-red-500">
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {isDraft && (
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
                    <span className="text-gray-500">Total Amount</span>
                    <span className="font-medium">{formatCurrency(totalAmount)}</span>
                  </div>
                  <hr className="border-gray-200 dark:border-gray-700" />
                  <div className="flex justify-between">
                    <span className="font-semibold">Grand Total</span>
                    <span className="font-bold text-lg">{formatCurrency(totalAmount)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Receiving History */}
          {!isCreateMode && order && order.status !== 'draft' && (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4">
              <button
                onClick={() => {
                  toggleSection('receivingHistory')
                  if (!sectionsOpen.receivingHistory) fetchReceipts()
                }}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <PackageCheck size={16} className="text-teal-600" />
                  <span className="font-medium text-gray-900 dark:text-white">Receiving History</span>
                  {receipts.length > 0 && (
                    <span className="text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded-full">
                      {receipts.filter(r => r.status === 'completed').length} receipt{receipts.filter(r => r.status === 'completed').length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {sectionsOpen.receivingHistory ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
              </button>
              {sectionsOpen.receivingHistory && (
                <div className="border-t border-gray-100 dark:border-gray-700">
                  {receiptsLoading ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-500">Loading receipts...</div>
                  ) : receipts.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      No items received yet
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {receipts.map((receipt) => (
                        <div key={receipt.id} className="px-4 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{receipt.receiptNo}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                receipt.status === 'completed'
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                  : receipt.status === 'cancelled'
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 line-through'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                              }`}>
                                {receipt.status === 'completed' ? 'Completed' : receipt.status === 'cancelled' ? 'Cancelled' : 'Draft'}
                              </span>
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(receipt.receiptDate)}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                            <span>{receipt.totalItems} item{receipt.totalItems !== 1 ? 's' : ''}</span>
                            <span>Qty: {receipt.totalQtyReceived}</span>
                            {receipt.receivedByName && <span>By: {receipt.receivedByName}</span>}
                            {receipt.supplierInvoiceNo && <span>Invoice: {receipt.supplierInvoiceNo}</span>}
                          </div>
                          {receipt.status === 'cancelled' && receipt.cancellationReason && (
                            <div className="mt-1 text-xs text-red-500">Reason: {receipt.cancellationReason}</div>
                          )}
                          {receipt.items.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {receipt.items.map((item) => (
                                <div key={item.id} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 pl-2 border-l-2 border-gray-200 dark:border-gray-600">
                                  <span>{formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemOemPartNumber, pluCode: item.itemPluCode }, businessType)}</span>
                                  <span className="font-medium">
                                    {parseFloat(item.quantityReceived).toFixed(0)} received
                                    {parseFloat(item.quantityRejected) > 0 && (
                                      <span className="text-red-500 ml-1">({parseFloat(item.quantityRejected).toFixed(0)} rejected)</span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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
              <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Required By Date</label>
                  {isDraft ? (
                    <input
                      type="date"
                      value={headerForm.expectedDeliveryDate}
                      onChange={(e) => { setHeaderForm({ ...headerForm, expectedDeliveryDate: e.target.value }); setHasUnsavedChanges(true) }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded">
                      <Calendar size={14} className="text-gray-400" />
                      <span className="text-sm">{order.expectedDeliveryDate ? formatDate(order.expectedDeliveryDate) : 'Not set'}</span>
                    </div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Terms & Conditions</label>
                  {isDraft ? (
                    <textarea
                      value={headerForm.notes}
                      onChange={(e) => { setHeaderForm({ ...headerForm, notes: e.target.value }); setHasUnsavedChanges(true) }}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none"
                      placeholder="Add terms or notes..."
                    />
                  ) : (
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded min-h-[60px] text-sm">
                      {order.notes || 'No notes'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Activity + Comments */}
          <DocumentCommentsAndActivity
            documentType="purchase_order"
            documentId={id}
            entityType="purchase-order"
          />
        </div>
      </div>

      {/* Modals */}
      <ConfirmModal
        isOpen={showSubmitConfirm}
        onClose={() => setShowSubmitConfirm(false)}
        onConfirm={() => { setShowSubmitConfirm(false); handleStatusChange('submitted') }}
        title="Submit Purchase Order"
        message={`Are you sure you want to submit Purchase Order ${order.orderNo}? Once submitted, items can no longer be edited.`}
        confirmText="Submit"
        variant="info"
        processing={saving}
      />

      <ConfirmModal
        isOpen={showConfirmConfirm}
        onClose={() => setShowConfirmConfirm(false)}
        onConfirm={() => { setShowConfirmConfirm(false); handleStatusChange('confirmed') }}
        title="Confirm Purchase Order"
        message={`Are you sure you want to confirm Purchase Order ${order.orderNo}? This will approve the order for processing.`}
        confirmText="Confirm"
        variant="info"
        processing={saving}
      />

      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={(reason) => handleStatusChange('cancelled', reason)}
        title="Cancel Purchase Order"
        itemName={`Purchase Order ${order.orderNo}`}
        processing={saving}
        documentType="purchase_order"
      />

      <ItemModal
        isOpen={showItemModal}
        onClose={() => { setShowItemModal(false); setPendingItemRowIndex(null) }}
        onCreated={handleItemCreated}
        initialName={itemInitialName}
        categories={categories}
      />

      <ReceiveItemsModal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        onConfirm={handleReceiveItems}
        items={order.items.map((item): ReceiveItemData => ({
          id: item.id,
          itemId: item.itemId,
          itemName: item.itemName,
          itemSku: item.itemSku,
          displayName: formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemOemPartNumber, pluCode: item.itemPluCode }, businessType),
          orderedQty: parseFloat(item.quantity),
          receivedQty: parseFloat(item.receivedQuantity || '0'),
        }))}
        processing={saving}
        orderNo={order.orderNo}
      />

      <CreatePurchaseInvoiceModal
        isOpen={showCreateInvoiceModal}
        onClose={() => setShowCreateInvoiceModal(false)}
        onConfirm={handleCreateInvoice}
        processing={saving}
        orderNo={order.orderNo}
        costCenters={costCenters}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        title="Delete Purchase Order"
        message={`Are you sure you want to delete Purchase Order ${order.orderNo}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        processing={saving}
      />

      {/* Print Preview */}
      <PrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        documentType="purchase_order"
        title={`Purchase Order ${order.orderNo}`}
      >
        <PurchaseOrderTemplate
          purchaseOrder={{
            orderNo: order.orderNo,
            status: order.status,
            supplierName: order.supplierName,
            warehouseName: order.warehouseName,
            expectedDeliveryDate: order.expectedDeliveryDate,
            subtotal: order.subtotal,
            taxAmount: order.taxAmount,
            total: order.total,
            notes: order.notes,
            createdByName: order.createdByName,
            approvedAt: order.approvedAt,
            cancellationReason: order.cancellationReason,
            createdAt: order.createdAt,
            items: order.items.map(item => ({
              id: item.id,
              itemId: item.itemId,
              itemName: item.itemName,
              itemSku: item.itemSku,
              quantity: item.quantity,
              receivedQuantity: item.receivedQuantity,
              unitPrice: item.unitPrice,
              tax: item.tax,
              total: item.total,
            })),
          }}
          settings={DEFAULT_PRINT_SETTINGS.purchase_order}
          businessName={tenantName}
          currencyCode={currency}
        />
      </PrintPreview>
    </div>
  )
}
