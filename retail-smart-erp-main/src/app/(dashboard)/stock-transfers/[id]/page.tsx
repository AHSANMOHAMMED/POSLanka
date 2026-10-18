'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { ArrowRightLeft, ChevronLeft, Warehouse, ArrowRight, Loader2, Check, X, Truck, Package } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Modal } from '@/components/ui/modal'
import { CancellationReasonModal } from '@/components/modals'
import { useRealtimeDocument } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatItemLabel } from '@/lib/utils/item-display'

interface TransferItem {
  id: string
  itemId: string
  quantity: string
  receivedQuantity: string | null
  notes: string | null
  item: {
    id: string
    name: string
    sku: string | null
    barcode?: string | null
    oemPartNumber?: string | null
    pluCode?: string | null
  }
}

interface StockTransfer {
  id: string
  transferNo: string
  status: 'draft' | 'pending_approval' | 'approved' | 'in_transit' | 'completed' | 'cancelled'
  notes: string | null
  cancellationReason: string | null
  fromWarehouse: { id: string; name: string; code: string }
  toWarehouse: { id: string; name: string; code: string }
  requestedBy: { id: string; fullName: string } | null
  approvedBy: { id: string; fullName: string } | null
  receivedBy: { id: string; fullName: string } | null
  createdAt: string
  approvedAt: string | null
  shippedAt: string | null
  receivedAt: string | null
  cancelledAt: string | null
  updatedAt: string
  items: TransferItem[]
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  in_transit: 'In Transit',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export default function StockTransferDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const tenantSlug = session?.user?.tenantSlug || ''
  const id = params.id as string

  const [transfer, setTransfer] = useState<StockTransfer | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [actionType, setActionType] = useState<string | null>(null)

  // Modal states
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ action: string; title: string; message: string } | null>(null)
  const [showCancelModal, setShowCancelModal] = useState(false)

  // Receiving state
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, string>>({})

  const fetchTransfer = useCallback(async () => {
    try {
      const res = await fetch(`/api/stock-transfers/${id}`)
      if (res.ok) {
        const data = await res.json()
        setTransfer(data)
        // Initialize received quantities
        const quantities: Record<string, string> = {}
        data.items?.forEach((item: TransferItem) => {
          quantities[item.id] = item.receivedQuantity || item.quantity
        })
        setReceivedQuantities(quantities)
      } else if (res.status === 404) {
        toast.error('Transfer not found')
        router.push(`/c/${tenantSlug}/stock-transfers`)
      }
    } catch (error) {
      console.error('Error fetching transfer:', error)
      toast.error('Failed to load transfer')
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  useRealtimeDocument('stock-transfer', id, fetchTransfer)

  useEffect(() => {
    fetchTransfer()
  }, [fetchTransfer])

  async function performAction(action: string, data?: Record<string, unknown>) {
    setProcessing(true)
    setActionType(action)

    try {
      const res = await fetch(`/api/stock-transfers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
      })

      if (res.ok) {
        const actionMessages: Record<string, string> = {
          submit_for_approval: 'Submitted for approval',
          approve: 'Transfer approved',
          reject: 'Transfer rejected',
          ship: 'Transfer shipped',
          receive: 'Transfer received',
          cancel: 'Transfer cancelled',
        }
        toast.success(actionMessages[action] || 'Action completed')
        fetchTransfer()
      } else {
        const error = await res.json()
        toast.error(error.error || 'Action failed')
      }
    } catch (error) {
      console.error('Error performing action:', error)
      toast.error('Failed to perform action')
    } finally {
      setProcessing(false)
      setActionType(null)
      setShowConfirm(false)
      setConfirmAction(null)
    }
  }

  function openConfirmModal(action: string, title: string, message: string) {
    setConfirmAction({ action, title, message })
    setShowConfirm(true)
  }

  async function handleReceive() {
    const items = Object.entries(receivedQuantities).map(([itemId, qty]) => ({
      itemId,
      receivedQuantity: parseFloat(qty),
    }))

    await performAction('receive', { items })
    setShowReceiveModal(false)
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return <PageLoading text="Loading transfer..." />
  }

  if (!transfer) {
    return null
  }

  const canSubmitForApproval = transfer.status === 'draft'
  const canApprove = transfer.status === 'pending_approval'
  const canShip = transfer.status === 'approved'
  const canReceive = transfer.status === 'in_transit'
  const canCancel = ['draft', 'pending_approval', 'approved'].includes(transfer.status)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/c/${tenantSlug}/stock-transfers`} className="p-2 hover:bg-gray-100 rounded">
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowRightLeft size={24} />
            {transfer.transferNo}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[transfer.status]}`}>
              {statusLabels[transfer.status]}
            </span>
            <span className="text-sm text-gray-500">
              Created {formatDate(transfer.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Transfer Info */}
      <div className="bg-white rounded-md border p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Warehouses */}
          <div className="flex items-center gap-4 p-4 bg-gray-50 rounded">
            <div className="flex-1">
              <div className="text-xs text-gray-500 mb-1">From</div>
              <div className="flex items-center gap-2">
                <Warehouse size={18} className="text-gray-400" />
                <div>
                  <div className="font-medium">{transfer.fromWarehouse?.name}</div>
                  <div className="text-sm text-gray-500">{transfer.fromWarehouse?.code}</div>
                </div>
              </div>
            </div>
            <ArrowRight size={24} className="text-gray-400" />
            <div className="flex-1">
              <div className="text-xs text-gray-500 mb-1">To</div>
              <div className="flex items-center gap-2">
                <Warehouse size={18} className="text-gray-400" />
                <div>
                  <div className="font-medium">{transfer.toWarehouse?.name}</div>
                  <div className="text-sm text-gray-500">{transfer.toWarehouse?.code}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-2 text-sm">
            {transfer.requestedBy && (
              <div className="flex justify-between">
                <span className="text-gray-500">Requested by:</span>
                <span>{transfer.requestedBy.fullName}</span>
              </div>
            )}
            {transfer.approvedBy && (
              <div className="flex justify-between">
                <span className="text-gray-500">Approved by:</span>
                <span>{transfer.approvedBy.fullName} ({formatDate(transfer.approvedAt)})</span>
              </div>
            )}
            {transfer.shippedAt && (
              <div className="flex justify-between">
                <span className="text-gray-500">Shipped:</span>
                <span>{formatDate(transfer.shippedAt)}</span>
              </div>
            )}
            {transfer.receivedBy && (
              <div className="flex justify-between">
                <span className="text-gray-500">Received by:</span>
                <span>{transfer.receivedBy.fullName} ({formatDate(transfer.receivedAt)})</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {transfer.notes && (
          <div className="mt-4 p-3 bg-gray-50 rounded">
            <div className="text-xs text-gray-500 mb-1">Notes</div>
            <div className="text-sm">{transfer.notes}</div>
          </div>
        )}

        {/* Cancellation Reason */}
        {transfer.cancellationReason && (
          <div className="mt-4 p-3 bg-red-50 rounded border border-red-200">
            <div className="text-xs text-red-500 mb-1">Cancellation Reason</div>
            <div className="text-sm text-red-700">{transfer.cancellationReason}</div>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="bg-white rounded-md border overflow-hidden mb-6">
        <div className="px-4 py-3 bg-gray-50 border-b font-medium flex items-center gap-2">
          <Package size={18} />
          Transfer Items ({transfer.items?.length || 0})
        </div>
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Quantity</th>
              {transfer.status === 'completed' && (
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Received</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {transfer.items?.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{item.item ? formatItemLabel(item.item, session?.user?.businessType) : 'Unknown Item'}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {parseFloat(item.quantity).toFixed(0)}
                </td>
                {transfer.status === 'completed' && (
                  <td className="px-4 py-3 text-right">
                    <span className={parseFloat(item.receivedQuantity || '0') < parseFloat(item.quantity) ? 'text-amber-600' : 'text-green-600'}>
                      {parseFloat(item.receivedQuantity || '0').toFixed(0)}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      {(canSubmitForApproval || canApprove || canShip || canReceive || canCancel) && (
        <div className="bg-white rounded-md border p-4 flex flex-wrap gap-3 justify-end">
          {canCancel && (
            <button
              onClick={() => setShowCancelModal(true)}
              disabled={processing}
              className="px-4 py-2 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
            >
              Cancel Transfer
            </button>
          )}

          {canSubmitForApproval && (
            <button
              onClick={() => openConfirmModal('submit_for_approval', 'Submit for Approval', 'This will submit the transfer for manager/owner approval.')}
              disabled={processing}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {processing && actionType === 'submit_for_approval' && <Loader2 size={16} className="animate-spin" />}
              Submit for Approval
            </button>
          )}

          {canApprove && (
            <>
              <button
                onClick={() => openConfirmModal('reject', 'Reject Transfer', 'Are you sure you want to reject this transfer request?')}
                disabled={processing}
                className="px-4 py-2 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50 flex items-center gap-2"
              >
                {processing && actionType === 'reject' && <Loader2 size={16} className="animate-spin" />}
                <X size={16} />
                Reject
              </button>
              <button
                onClick={() => openConfirmModal('approve', 'Approve Transfer', 'Approve this transfer request? It can then be shipped.')}
                disabled={processing}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {processing && actionType === 'approve' && <Loader2 size={16} className="animate-spin" />}
                <Check size={16} />
                Approve
              </button>
            </>
          )}

          {canShip && (
            <button
              onClick={() => openConfirmModal('ship', 'Ship Transfer', 'Mark this transfer as shipped? Stock will be deducted from the source warehouse.')}
              disabled={processing}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              {processing && actionType === 'ship' && <Loader2 size={16} className="animate-spin" />}
              <Truck size={16} />
              Ship
            </button>
          )}

          {canReceive && (
            <button
              onClick={() => setShowReceiveModal(true)}
              disabled={processing}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {processing && actionType === 'receive' && <Loader2 size={16} className="animate-spin" />}
              <Package size={16} />
              Receive
            </button>
          )}
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => {
          setShowConfirm(false)
          setConfirmAction(null)
        }}
        onConfirm={() => confirmAction && performAction(confirmAction.action)}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        confirmText="Confirm"
        processing={processing}
      />

      {/* Cancel Modal */}
      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={(reason) => {
          performAction('cancel', { cancellationReason: reason })
          setShowCancelModal(false)
        }}
        title="Cancel Transfer"
        itemName={`Transfer ${transfer.transferNo}`}
        processing={processing}
        documentType="purchase_order"
      />

      {/* Receive Modal */}
      <Modal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        title="Receive Transfer"
        size="lg"
      >
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Confirm the quantities received</p>
        <div className="overflow-y-auto max-h-[50vh]">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Item</th>
                <th className="px-3 py-2 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Expected</th>
                <th className="px-3 py-2 text-center text-sm font-medium text-gray-600 dark:text-gray-300 w-32">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {transfer.items?.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium dark:text-white">{item.item ? formatItemLabel(item.item, session?.user?.businessType) : 'Unknown Item'}</div>
                  </td>
                  <td className="px-3 py-2 text-right dark:text-gray-300">
                    {parseFloat(item.quantity).toFixed(0)}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={receivedQuantities[item.id] || ''}
                      onChange={(e) => setReceivedQuantities({
                        ...receivedQuantities,
                        [item.id]: e.target.value,
                      })}
                      min={0}
                      max={parseFloat(item.quantity)}
                      className="w-full px-2 py-1 text-center border dark:border-gray-700 rounded dark:bg-gray-800 dark:text-white"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pt-4 mt-4 border-t dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={() => setShowReceiveModal(false)}
            className="px-4 py-2 border dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleReceive}
            disabled={processing}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            {processing && <Loader2 size={16} className="animate-spin" />}
            Confirm Receipt
          </button>
        </div>
      </Modal>
    </div>
  )
}
