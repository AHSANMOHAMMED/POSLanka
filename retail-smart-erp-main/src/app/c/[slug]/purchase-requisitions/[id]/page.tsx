'use client'

import { useState, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Home, ChevronRight, ArrowLeft, Loader2, Trash2, Send,
  CheckCircle, XCircle, ShoppingCart, Plus, Save
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData, usePermission } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils/date-format'
import { formatCurrency } from '@/lib/utils/currency'
import { CancellationReasonModal } from '@/components/modals'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'
import { formatItemLabel, buildItemSearchOption } from '@/lib/utils/item-display'

interface RequisitionItem {
  id: string
  itemId: string | null
  itemName: string
  itemSku: string | null
  itemBarcode: string | null
  itemOemPartNumber: string | null
  itemPluCode: string | null
  quantity: string
  orderedQuantity: string
  estimatedUnitPrice: string
  estimatedTotal: string
  preferredSupplierId: string | null
  preferredSupplierName: string | null
  warehouseId: string | null
  warehouseName: string | null
  notes: string | null
}

interface RequisitionDetail {
  id: string
  requisitionNo: string
  status: string
  requestedBy: string | null
  requestedByName: string | null
  department: string | null
  costCenterId: string | null
  costCenterName: string | null
  requiredByDate: string | null
  purpose: string | null
  notes: string | null
  estimatedTotal: string
  approvedBy: string | null
  approvedAt: string | null
  approvalNotes: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  items: RequisitionItem[]
}

interface Supplier {
  id: string
  name: string
}

interface Warehouse {
  id: string
  name: string
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-700' },
  pending_approval: { label: 'Pending Approval', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  approved: { label: 'Approved', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  partially_ordered: { label: 'Partially Ordered', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  ordered: { label: 'Ordered', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  rejected: { label: 'Rejected', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700' },
}

export default function PurchaseRequisitionDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id, slug: _slug } = use(params)
  const router = useRouter()
  const { tenantSlug, businessType, currency } = useCompany()
  const canApprove = usePermission('approveRequisitions')
  const canCreate = usePermission('createRequisitions')
  const canManagePurchases = usePermission('managePurchases')

  const [requisition, setRequisition] = useState<RequisitionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  // Inline edit state for header
  const [editPurpose, setEditPurpose] = useState('')
  const [editDepartment, setEditDepartment] = useState('')
  const [editRequiredBy, setEditRequiredBy] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [headerDirty, setHeaderDirty] = useState(false)

  // Add item state
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemQty, setNewItemQty] = useState('1')
  const [newItemPrice, setNewItemPrice] = useState('0')
  const [newItemSupplierId, setNewItemSupplierId] = useState('')
  const [addingItem, setAddingItem] = useState(false)

  // Convert to PO state
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertSupplierId, setConvertSupplierId] = useState('')
  const [convertWarehouseId, setConvertWarehouseId] = useState('')

  // Cancel state
  const [showCancelModal, setShowCancelModal] = useState(false)

  // Reject state
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/purchase-requisitions/${id}`)
      if (!res.ok) throw new Error('Not found')
      const data = await res.json()
      setRequisition(data)
      setEditPurpose(data.purpose || '')
      setEditDepartment(data.department || '')
      setEditRequiredBy(data.requiredByDate || '')
      setEditNotes(data.notes || '')
      setHeaderDirty(false)
    } catch {
      toast.error('Failed to load requisition')
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeData(fetchData, { entityType: 'purchase-requisition' })

  useEffect(() => {
    async function loadDropdowns() {
      const [suppRes, whRes] = await Promise.all([
        fetch('/api/suppliers?all=true'),
        fetch('/api/warehouses?all=true'),
      ])
      if (suppRes.ok) {
        const data = await suppRes.json()
        setSuppliers(Array.isArray(data) ? data : data.data || [])
      }
      if (whRes.ok) {
        const data = await whRes.json()
        setWarehouses(Array.isArray(data) ? data : data.data || [])
      }
    }
    loadDropdowns()
  }, [])

  async function saveHeader() {
    if (!requisition || requisition.status !== 'draft') return
    setProcessing(true)
    try {
      const res = await fetch(`/api/purchase-requisitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: editPurpose || null,
          department: editDepartment || null,
          requiredByDate: editRequiredBy || null,
          notes: editNotes || null,
        }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Saved')
      setHeaderDirty(false)
      fetchData()
    } catch {
      toast.error('Failed to save')
    } finally {
      setProcessing(false)
    }
  }

  async function handleSubmit() {
    setProcessing(true)
    try {
      const res = await fetch(`/api/purchase-requisitions/${id}/submit`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed')
      }
      toast.success('Submitted for approval')
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit')
    } finally {
      setProcessing(false)
    }
  }

  async function handleApprove() {
    setProcessing(true)
    try {
      const res = await fetch(`/api/purchase-requisitions/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Approved')
      fetchData()
    } catch {
      toast.error('Failed to approve')
    } finally {
      setProcessing(false)
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) return
    setProcessing(true)
    try {
      const res = await fetch(`/api/purchase-requisitions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason: rejectReason }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Rejected')
      setShowRejectModal(false)
      setRejectReason('')
      fetchData()
    } catch {
      toast.error('Failed to reject')
    } finally {
      setProcessing(false)
    }
  }

  async function handleCancel(reason: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/purchase-requisitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Cancelled')
      setShowCancelModal(false)
      fetchData()
    } catch {
      toast.error('Failed to cancel')
    } finally {
      setProcessing(false)
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/purchase-requisitions/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Deleted')
      router.push(`/c/${tenantSlug}/purchase-requisitions`)
    } else {
      toast.error('Failed to delete')
    }
  }

  async function handleAddItem() {
    if (!newItemName.trim()) return
    setAddingItem(true)
    try {
      const res = await fetch(`/api/purchase-requisitions/${id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemName: newItemName,
          quantity: parseFloat(newItemQty) || 1,
          estimatedUnitPrice: parseFloat(newItemPrice) || 0,
          preferredSupplierId: newItemSupplierId || undefined,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Item added')
      setNewItemName('')
      setNewItemQty('1')
      setNewItemPrice('0')
      setNewItemSupplierId('')
      setShowAddItem(false)
      fetchData()
    } catch {
      toast.error('Failed to add item')
    } finally {
      setAddingItem(false)
    }
  }

  async function handleConvertToPO() {
    if (!convertSupplierId || !convertWarehouseId) {
      toast.error('Supplier and warehouse are required')
      return
    }
    setProcessing(true)
    try {
      const res = await fetch(`/api/purchase-requisitions/${id}/convert-to-po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: convertSupplierId,
          warehouseId: convertWarehouseId,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed')
      }
      const data = await res.json()
      toast.success(`Purchase Order ${data.orderNo} created`)
      setShowConvertModal(false)
      router.push(`/c/${tenantSlug}/purchase-orders/${data.purchaseOrderId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to convert')
    } finally {
      setProcessing(false)
    }
  }

  async function searchItems(search: string) {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/items?${params}`)
    const result = await res.json()
    const data = result.data || result
    return data.map((item: { id: string; name: string; barcode?: string; sku?: string; oemPartNumber?: string; pluCode?: string; costPrice: string }) =>
      buildItemSearchOption(item, businessType, { useCostPrice: true })
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!requisition) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>Requisition not found</p>
        <Link href={`/c/${tenantSlug}/purchase-requisitions`} className="text-primary hover:underline mt-2 inline-block">
          Back to list
        </Link>
      </div>
    )
  }

  const status = statusConfig[requisition.status] || statusConfig.draft
  const isDraft = requisition.status === 'draft'
  const isPending = requisition.status === 'pending_approval'
  const isApproved = requisition.status === 'approved' || requisition.status === 'partially_ordered'

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/c/${tenantSlug}/purchase-requisitions`} className="hover:text-foreground">Purchase Requisitions</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">{requisition.requisitionNo}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(`/c/${tenantSlug}/purchase-requisitions`)} className="p-2 hover:bg-muted rounded">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{requisition.requisitionNo}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${status.color} ${status.bg}`}>
                {status.label}
              </span>
              {requisition.requestedByName && (
                <span className="text-sm text-muted-foreground">by {requisition.requestedByName}</span>
              )}
              <span className="text-sm text-muted-foreground">{formatDate(requisition.createdAt)}</span>
            </div>
          </div>
        </div>

      </div>

      {/* Rejection info */}
      {requisition.status === 'rejected' && requisition.rejectionReason && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-4">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">Rejected</p>
          <p className="text-sm text-red-700 dark:text-red-300 mt-1">{requisition.rejectionReason}</p>
        </div>
      )}

      {/* Cancellation info */}
      {requisition.status === 'cancelled' && requisition.cancellationReason && (
        <div className="bg-gray-50 dark:bg-gray-800 border rounded p-4">
          <p className="text-sm font-medium text-foreground">Cancelled</p>
          <p className="text-sm text-muted-foreground mt-1">{requisition.cancellationReason}</p>
        </div>
      )}

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card rounded border p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">Details</h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground">Purpose</label>
              {isDraft ? (
                <input
                  value={editPurpose}
                  onChange={e => { setEditPurpose(e.target.value); setHeaderDirty(true) }}
                  placeholder="Purpose of this requisition..."
                  className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground"
                />
              ) : (
                <p className="text-sm text-foreground mt-1">{requisition.purpose || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Department</label>
              {isDraft ? (
                <input
                  value={editDepartment}
                  onChange={e => { setEditDepartment(e.target.value); setHeaderDirty(true) }}
                  placeholder="Department..."
                  className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground"
                />
              ) : (
                <p className="text-sm text-foreground mt-1">{requisition.department || '-'}</p>
              )}
            </div>
          </div>
        </div>
        <div className="bg-card rounded border p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">Timeline</h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground">Required By Date</label>
              {isDraft ? (
                <input
                  type="date"
                  value={editRequiredBy}
                  onChange={e => { setEditRequiredBy(e.target.value); setHeaderDirty(true) }}
                  className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground"
                />
              ) : (
                <p className="text-sm text-foreground mt-1">{requisition.requiredByDate ? formatDate(requisition.requiredByDate) : '-'}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              {isDraft ? (
                <textarea
                  value={editNotes}
                  onChange={e => { setEditNotes(e.target.value); setHeaderDirty(true) }}
                  rows={2}
                  placeholder="Additional notes..."
                  className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground resize-none"
                />
              ) : (
                <p className="text-sm text-foreground mt-1">{requisition.notes || '-'}</p>
              )}
            </div>
            {requisition.costCenterName && (
              <div>
                <label className="text-xs text-muted-foreground">Cost Center</label>
                <p className="text-sm text-foreground mt-1">{requisition.costCenterName}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-card rounded border">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-medium text-foreground">
            Items ({requisition.items.length})
          </h3>
          {isDraft && canCreate && (
            <button
              onClick={() => setShowAddItem(!showAddItem)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> Add Item
            </button>
          )}
        </div>

        {/* Add item form */}
        {showAddItem && (
          <div className="p-4 bg-muted/30 border-b space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Item</label>
                <AsyncCreatableSelect
                  fetchOptions={searchItems}
                  value=""
                  onChange={(value, option) => {
                    if (option) {
                      setNewItemName(option.label)
                      if (option.data?.costPrice) {
                        setNewItemPrice(String(option.data.costPrice))
                      }
                    }
                  }}
                  onCreateNew={(name) => setNewItemName(name)}
                  placeholder="Search items..."
                  createLabel="Use custom name"
                />
                {newItemName && (
                  <p className="text-xs text-muted-foreground mt-1">Selected: {newItemName}</p>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Quantity</label>
                <input
                  type="number"
                  value={newItemQty}
                  onChange={e => setNewItemQty(e.target.value)}
                  min="0.001"
                  step="any"
                  className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Est. Unit Price</label>
                <input
                  type="number"
                  value={newItemPrice}
                  onChange={e => setNewItemPrice(e.target.value)}
                  min="0"
                  step="0.01"
                  className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddItem(false)} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={handleAddItem}
                disabled={!newItemName.trim() || addingItem}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {addingItem && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Add
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-sticky-header">
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Quantity</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ordered</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Unit Price</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Supplier</th>
              </tr>
            </thead>
            <tbody>
              {requisition.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No items added yet
                  </td>
                </tr>
              ) : (
                requisition.items.map(item => (
                  <tr key={item.id} className="border-b">
                    <td className="px-4 py-3 font-medium text-foreground">{formatItemLabel({ name: item.itemName, barcode: item.itemBarcode, sku: item.itemSku, oemPartNumber: item.itemOemPartNumber, pluCode: item.itemPluCode }, businessType)}</td>
                    <td className="px-4 py-3 text-right">{parseFloat(item.quantity)}</td>
                    <td className="px-4 py-3 text-right">
                      {parseFloat(item.orderedQuantity) > 0 ? (
                        <span className={parseFloat(item.orderedQuantity) >= parseFloat(item.quantity) ? 'text-green-600' : 'text-blue-600'}>
                          {parseFloat(item.orderedQuantity)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">{formatCurrency(parseFloat(item.estimatedUnitPrice), currency)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(parseFloat(item.estimatedTotal), currency)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.preferredSupplierName || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
            {requisition.items.length > 0 && (
              <tfoot>
                <tr className="bg-muted/30">
                  <td colSpan={4} className="px-4 py-3 text-right font-medium text-foreground">Estimated Total</td>
                  <td className="px-4 py-3 text-right font-bold text-foreground">{formatCurrency(parseFloat(requisition.estimatedTotal), currency)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Approval info */}
      {requisition.approvedAt && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-4">
          <p className="text-sm font-medium text-green-800 dark:text-green-200">
            Approved on {formatDate(requisition.approvedAt)}
          </p>
          {requisition.approvalNotes && (
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">{requisition.approvalNotes}</p>
          )}
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded border p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-medium text-foreground mb-4">Reject Requisition</h3>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              rows={3}
              className="w-full px-3 py-2 border rounded text-sm bg-background text-foreground resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setShowRejectModal(false); setRejectReason('') }} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || processing}
                className="px-3 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convert to PO Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded border p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-medium text-foreground mb-4">Create Purchase Order</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Supplier *</label>
                <select
                  value={convertSupplierId}
                  onChange={e => setConvertSupplierId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground"
                >
                  <option value="">Select supplier...</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Warehouse *</label>
                <select
                  value={convertWarehouseId}
                  onChange={e => setConvertWarehouseId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground"
                >
                  <option value="">Select warehouse...</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowConvertModal(false)} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={handleConvertToPO}
                disabled={!convertSupplierId || !convertWarehouseId || processing}
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {processing && <Loader2 className="h-4 w-4 animate-spin" />}
                Create PO
              </button>
            </div>
          </div>
        </div>
      )}

      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        if (isDraft && canCreate) {
          a.push({
            key: 'delete',
            label: 'Delete',
            icon: <Trash2 className="h-4 w-4" />,
            variant: 'danger',
            position: 'left',
            onClick: handleDelete,
            confirmation: {
              title: 'Delete Requisition',
              message: `Delete draft requisition ${requisition.requisitionNo}? This cannot be undone.`,
              variant: 'danger',
              confirmText: 'Delete',
            },
          })
          if (headerDirty) {
            a.push({
              key: 'save',
              label: 'Save',
              icon: <Save className="h-4 w-4" />,
              variant: 'outline',
              onClick: saveHeader,
            })
          }
          a.push({
            key: 'submit',
            label: 'Submit',
            icon: <Send className="h-4 w-4" />,
            variant: 'primary',
            onClick: handleSubmit,
            confirmation: {
              title: 'Submit Requisition',
              message: `Submit ${requisition.requisitionNo} for approval?`,
              variant: 'success',
              confirmText: 'Submit',
            },
          })
        }
        if (isPending && canApprove) {
          a.push({
            key: 'reject',
            label: 'Reject',
            icon: <XCircle className="h-4 w-4" />,
            variant: 'danger',
            position: 'left',
            onClick: () => setShowRejectModal(true),
          })
          a.push({
            key: 'approve',
            label: 'Approve',
            icon: <CheckCircle className="h-4 w-4" />,
            variant: 'success',
            onClick: handleApprove,
            confirmation: {
              title: 'Approve Requisition',
              message: `Approve ${requisition.requisitionNo}?`,
              variant: 'success',
              confirmText: 'Approve',
            },
          })
        }
        if (isApproved && canManagePurchases) {
          a.push({
            key: 'convert',
            label: 'Create Purchase Order',
            icon: <ShoppingCart className="h-4 w-4" />,
            variant: 'primary',
            onClick: () => setShowConvertModal(true),
          })
        }
        return a
      })()} />

      {/* Cancellation Modal */}
      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        title="Cancel Requisition"
        itemName={requisition.requisitionNo}
        processing={processing}
      />
    </div>
  )
}
