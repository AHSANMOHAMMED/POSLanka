'use client'

import { useState, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Home, ChevronRight, ArrowLeft, Loader2, Trash2, Send,
  ShoppingCart, Plus, Award
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData, usePermission } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils/date-format'
import { formatCurrency } from '@/lib/utils/currency'
import { CancellationReasonModal } from '@/components/modals'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'
import { buildItemSearchOption } from '@/lib/utils/item-display'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'

interface QuotationItem {
  id: string
  itemId: string | null
  itemName: string
  quantity: string
  unitPrice: string
  tax: string
  total: string
  deliveryDays: number | null
  notes: string | null
}

interface QuotationDetail {
  id: string
  quotationNo: string
  supplierId: string
  supplierName: string | null
  requisitionId: string | null
  requisitionNo: string | null
  status: string
  validUntil: string | null
  deliveryDays: number | null
  paymentTerms: string | null
  subtotal: string
  taxAmount: string
  total: string
  supplierReference: string | null
  notes: string | null
  convertedToPOId: string | null
  cancellationReason: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  items: QuotationItem[]
}

interface Warehouse {
  id: string
  name: string
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-700' },
  submitted: { label: 'Submitted', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  received: { label: 'Received', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  awarded: { label: 'Awarded', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  rejected: { label: 'Rejected', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
  expired: { label: 'Expired', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700' },
}

export default function SupplierQuotationDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenantSlug, businessType, currency } = useCompany()
  const canManage = usePermission('managePurchases')

  const [quotation, setQuotation] = useState<QuotationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  // Add item state
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemQty, setNewItemQty] = useState('1')
  const [newItemPrice, setNewItemPrice] = useState('0')
  const [newItemTax, setNewItemTax] = useState('0')
  const [addingItem, setAddingItem] = useState(false)

  // Convert to PO
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertWarehouseId, setConvertWarehouseId] = useState('')

  // Cancel
  const [showCancelModal, setShowCancelModal] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/supplier-quotations/${id}`)
      if (!res.ok) throw new Error('Not found')
      const data = await res.json()
      setQuotation(data)
    } catch {
      toast.error('Failed to load quotation')
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeData(fetchData, { entityType: 'supplier-quotation' })

  useEffect(() => {
    fetch('/api/warehouses?all=true').then(r => r.json()).then(data => {
      setWarehouses(Array.isArray(data) ? data : data.data || [])
    }).catch(() => {})
  }, [])

  async function updateStatus(newStatus: string, extra?: Record<string, string>) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/supplier-quotations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...extra }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed')
      }
      toast.success(`Status updated to ${newStatus}`)
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setProcessing(false)
    }
  }

  async function handleAddItem() {
    if (!newItemName.trim()) return
    setAddingItem(true)
    try {
      const res = await fetch(`/api/supplier-quotations/${id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemName: newItemName,
          quantity: parseFloat(newItemQty) || 1,
          unitPrice: parseFloat(newItemPrice) || 0,
          tax: parseFloat(newItemTax) || 0,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Item added')
      setNewItemName('')
      setNewItemQty('1')
      setNewItemPrice('0')
      setNewItemTax('0')
      setShowAddItem(false)
      fetchData()
    } catch {
      toast.error('Failed to add item')
    } finally {
      setAddingItem(false)
    }
  }

  async function handleConvertToPO() {
    if (!convertWarehouseId) return
    setProcessing(true)
    try {
      const res = await fetch(`/api/supplier-quotations/${id}/convert-to-po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId: convertWarehouseId }),
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
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setProcessing(false)
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/supplier-quotations/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Deleted')
      router.push(`/c/${tenantSlug}/supplier-quotations`)
    } else {
      toast.error('Failed to delete')
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

  if (!quotation) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>Quotation not found</p>
        <Link href={`/c/${tenantSlug}/supplier-quotations`} className="text-primary hover:underline mt-2 inline-block">
          Back to list
        </Link>
      </div>
    )
  }

  const status = statusConfig[quotation.status] || statusConfig.draft
  const isDraft = quotation.status === 'draft'
  const isSubmitted = quotation.status === 'submitted'
  const isReceived = quotation.status === 'received'
  const canAddItems = isDraft || isReceived

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/c/${tenantSlug}/supplier-quotations`} className="hover:text-foreground">Supplier Quotations</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">{quotation.quotationNo}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(`/c/${tenantSlug}/supplier-quotations`)} className="p-2 hover:bg-muted rounded">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{quotation.quotationNo}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${status.color} ${status.bg}`}>
                {status.label}
              </span>
              <span className="text-sm text-muted-foreground">{quotation.supplierName}</span>
              <span className="text-sm text-muted-foreground">{formatDate(quotation.createdAt)}</span>
            </div>
          </div>
        </div>

      </div>

      {/* Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded border p-4">
          <h3 className="text-xs text-muted-foreground mb-1">Supplier</h3>
          <p className="text-sm font-medium text-foreground">{quotation.supplierName}</p>
          {quotation.supplierReference && (
            <p className="text-xs text-muted-foreground mt-1">Ref: {quotation.supplierReference}</p>
          )}
        </div>
        <div className="bg-card rounded border p-4">
          <h3 className="text-xs text-muted-foreground mb-1">Valid Until</h3>
          <p className="text-sm font-medium text-foreground">{quotation.validUntil ? formatDate(quotation.validUntil) : '-'}</p>
          {quotation.deliveryDays && (
            <p className="text-xs text-muted-foreground mt-1">Delivery: {quotation.deliveryDays} days</p>
          )}
        </div>
        <div className="bg-card rounded border p-4">
          <h3 className="text-xs text-muted-foreground mb-1">Total</h3>
          <p className="text-lg font-bold text-foreground">{formatCurrency(parseFloat(quotation.total), currency)}</p>
          {quotation.paymentTerms && (
            <p className="text-xs text-muted-foreground mt-1">{quotation.paymentTerms}</p>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="bg-card rounded border">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-medium text-foreground">Items ({quotation.items.length})</h3>
          {canAddItems && canManage && (
            <button
              onClick={() => setShowAddItem(!showAddItem)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> Add Item
            </button>
          )}
        </div>

        {showAddItem && (
          <div className="p-4 bg-muted/30 border-b space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Item</label>
                <AsyncCreatableSelect
                  fetchOptions={searchItems}
                  value=""
                  onChange={(value, option) => {
                    if (option) {
                      setNewItemName(option.label)
                      if (option.data?.costPrice) setNewItemPrice(String(option.data.costPrice))
                    }
                  }}
                  onCreateNew={(name) => setNewItemName(name)}
                  placeholder="Search items..."
                  createLabel="Use custom name"
                />
                {newItemName && <p className="text-xs text-muted-foreground mt-1">Selected: {newItemName}</p>}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Quantity</label>
                <input type="number" value={newItemQty} onChange={e => setNewItemQty(e.target.value)} min="0.001" step="any" className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit Price</label>
                <input type="number" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} min="0" step="0.01" className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Tax</label>
                <input type="number" value={newItemTax} onChange={e => setNewItemTax(e.target.value)} min="0" step="0.01" className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddItem(false)} className="px-3 py-1.5 text-sm text-muted-foreground">Cancel</button>
              <button onClick={handleAddItem} disabled={!newItemName.trim() || addingItem} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50">
                {addingItem && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-sticky-header">
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qty</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Unit Price</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Tax</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No items</td></tr>
              ) : (
                quotation.items.map(item => (
                  <tr key={item.id} className="border-b">
                    <td className="px-4 py-3 font-medium text-foreground">{item.itemName}</td>
                    <td className="px-4 py-3 text-right">{parseFloat(item.quantity)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(parseFloat(item.unitPrice), currency)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(parseFloat(item.tax), currency)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(parseFloat(item.total), currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {quotation.items.length > 0 && (
              <tfoot>
                <tr className="bg-muted/30">
                  <td colSpan={3}></td>
                  <td className="px-4 py-2 text-right text-sm text-muted-foreground">Subtotal</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(parseFloat(quotation.subtotal), currency)}</td>
                </tr>
                <tr className="bg-muted/30">
                  <td colSpan={3}></td>
                  <td className="px-4 py-2 text-right text-sm text-muted-foreground">Tax</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(parseFloat(quotation.taxAmount), currency)}</td>
                </tr>
                <tr className="bg-muted/30">
                  <td colSpan={3}></td>
                  <td className="px-4 py-2 text-right text-sm font-medium text-foreground">Total</td>
                  <td className="px-4 py-2 text-right font-bold text-foreground">{formatCurrency(parseFloat(quotation.total), currency)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {quotation.notes && (
        <div className="bg-card rounded border p-4">
          <h3 className="text-xs text-muted-foreground mb-1">Notes</h3>
          <p className="text-sm text-foreground">{quotation.notes}</p>
        </div>
      )}

      {/* Convert to PO Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded border p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-medium text-foreground mb-4">Award & Create Purchase Order</h3>
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
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowConvertModal(false)} className="px-3 py-2 text-sm text-muted-foreground">Cancel</button>
              <button
                onClick={handleConvertToPO}
                disabled={!convertWarehouseId || processing}
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
              >
                {processing && <Loader2 className="h-4 w-4 animate-spin" />} Create PO
              </button>
            </div>
          </div>
        </div>
      )}

      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        const canCancel = (isDraft || isSubmitted || isReceived) && canManage
        if (canCancel) {
          a.push({
            key: 'cancel',
            label: 'Cancel',
            variant: 'danger',
            position: 'left',
            onClick: () => setShowCancelModal(true),
          })
        }
        if (isDraft && canManage) {
          a.push({
            key: 'delete',
            label: 'Delete',
            icon: <Trash2 className="h-4 w-4" />,
            variant: 'danger',
            position: 'left',
            onClick: handleDelete,
            confirmation: {
              title: 'Delete Quotation',
              message: `Delete draft quotation ${quotation.quotationNo}? This cannot be undone.`,
              variant: 'danger',
              confirmText: 'Delete',
            },
          })
          a.push({
            key: 'submit',
            label: 'Submit to Supplier',
            icon: <Send className="h-4 w-4" />,
            variant: 'primary',
            onClick: () => updateStatus('submitted'),
            confirmation: {
              title: 'Submit Quotation',
              message: `Submit ${quotation.quotationNo} to supplier?`,
              variant: 'default',
              confirmText: 'Submit',
            },
          })
        }
        if (isSubmitted && canManage) {
          a.push({
            key: 'received',
            label: 'Mark Received',
            icon: <Award className="h-4 w-4" />,
            variant: 'success',
            onClick: () => updateStatus('received'),
            confirmation: {
              title: 'Mark as Received',
              message: `Mark ${quotation.quotationNo} as received from supplier?`,
              variant: 'success',
              confirmText: 'Mark Received',
            },
          })
        }
        if (isReceived && canManage) {
          a.push({
            key: 'reject',
            label: 'Reject',
            variant: 'outline',
            position: 'left',
            onClick: () => updateStatus('rejected'),
            confirmation: {
              title: 'Reject Quotation',
              message: `Reject ${quotation.quotationNo}?`,
              variant: 'danger',
              confirmText: 'Reject',
            },
          })
          a.push({
            key: 'award',
            label: 'Award & Create PO',
            icon: <ShoppingCart className="h-4 w-4" />,
            variant: 'primary',
            onClick: () => setShowConvertModal(true),
          })
        }
        return a
      })()} />

      <DocumentCommentsAndActivity
        documentType="supplier_quotation"
        documentId={id}
        entityType="supplier-quotation"
      />

      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={(reason) => {
          updateStatus('cancelled', { cancellationReason: reason })
          setShowCancelModal(false)
        }}
        title="Cancel Quotation"
        itemName={quotation.quotationNo}
        processing={processing}
      />
    </div>
  )
}
