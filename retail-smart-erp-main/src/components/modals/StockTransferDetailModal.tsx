'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowRightLeft, Warehouse, ArrowRight, Loader2, Check, X, Truck, Package, FileText, ClipboardList, History } from 'lucide-react'
import { Timeline, TimelineItemData } from '@/components/ui/timeline'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { CancellationReasonModal } from './CancellationReasonModal'
import { useRealtimeDocument } from '@/hooks'

type TabType = 'details' | 'items' | 'timeline'

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
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  in_transit: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  in_transit: 'In Transit',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

interface StockTransferDetailModalProps {
  isOpen: boolean
  onClose: () => void
  transferId: string | null
  onUpdated?: () => void
}

export function StockTransferDetailModal({
  isOpen,
  onClose,
  transferId,
  onUpdated,
}: StockTransferDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('details')
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

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'details', label: 'Details', icon: <FileText size={16} /> },
    { key: 'items', label: 'Items', icon: <ClipboardList size={16} /> },
    { key: 'timeline', label: 'Activity', icon: <History size={16} /> },
  ]

  // Generate timeline items
  const timelineItems: TimelineItemData[] = transfer ? (() => {
    const items: TimelineItemData[] = []

    // Created event
    items.push({
      id: 'created',
      type: 'created',
      title: 'Transfer Request Created',
      description: `Transfer ${transfer.transferNo} from ${transfer.fromWarehouse?.name} to ${transfer.toWarehouse?.name}`,
      timestamp: transfer.createdAt,
      user: transfer.requestedBy?.fullName ? { name: transfer.requestedBy.fullName } : undefined,
    })

    // Items added
    if (transfer.items?.length > 0) {
      items.push({
        id: 'items-added',
        type: 'document',
        title: `${transfer.items.length} Item(s) Added`,
        description: transfer.items.slice(0, 3).map(i => `${i.item?.name} (${parseFloat(i.quantity)})`).join(', ') + (transfer.items.length > 3 ? '...' : ''),
        timestamp: transfer.createdAt,
      })
    }

    // Submitted for approval
    if (['pending_approval', 'approved', 'in_transit', 'completed'].includes(transfer.status)) {
      items.push({
        id: 'submitted',
        type: 'status_change',
        title: 'Submitted for Approval',
        description: 'Transfer submitted for manager review',
        timestamp: transfer.updatedAt,
        metadata: { fromStatus: 'Draft', toStatus: 'Pending Approval' },
      })
    }

    // Approved
    if (transfer.approvedAt) {
      items.push({
        id: 'approved',
        type: 'status_change',
        title: 'Transfer Approved',
        description: 'Transfer approved by manager',
        timestamp: transfer.approvedAt,
        user: transfer.approvedBy?.fullName ? { name: transfer.approvedBy.fullName } : undefined,
        metadata: { fromStatus: 'Pending Approval', toStatus: 'Approved' },
      })
    }

    // Shipped
    if (transfer.shippedAt) {
      items.push({
        id: 'shipped',
        type: 'status_change',
        title: 'Transfer Shipped',
        description: `Stock deducted from ${transfer.fromWarehouse?.name}`,
        timestamp: transfer.shippedAt,
        metadata: { fromStatus: 'Approved', toStatus: 'In Transit' },
      })
    }

    // Received
    if (transfer.receivedAt) {
      items.push({
        id: 'received',
        type: 'status_change',
        title: 'Transfer Received',
        description: `Stock added to ${transfer.toWarehouse?.name}`,
        timestamp: transfer.receivedAt,
        user: transfer.receivedBy?.fullName ? { name: transfer.receivedBy.fullName } : undefined,
        metadata: { fromStatus: 'In Transit', toStatus: 'Completed' },
      })
    }

    // Cancelled
    if (transfer.status === 'cancelled' && transfer.cancelledAt) {
      items.push({
        id: 'cancelled',
        type: 'deleted',
        title: 'Transfer Cancelled',
        description: transfer.cancellationReason || 'Transfer was cancelled',
        timestamp: transfer.cancelledAt,
      })
    }

    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  })() : []

  const fetchTransfer = useCallback(async () => {
    if (!transferId) return

    try {
      const res = await fetch(`/api/stock-transfers/${transferId}`)
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
        onClose()
      }
    } catch (error) {
      console.error('Error fetching transfer:', error)
      toast.error('Failed to load transfer')
    } finally {
      setLoading(false)
    }
  }, [transferId, onClose])

  useRealtimeDocument('stock-transfer', transferId || '', fetchTransfer)

  useEffect(() => {
    if (isOpen && transferId) {
      setLoading(true)
      setActiveTab('details')
      fetchTransfer()
    }
  }, [isOpen, transferId, fetchTransfer])

  async function performAction(action: string, data?: Record<string, unknown>) {
    if (!transferId) return

    setProcessing(true)
    setActionType(action)

    try {
      const res = await fetch(`/api/stock-transfers/${transferId}`, {
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
        onUpdated?.()
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

  function handleClose() {
    setTransfer(null)
    setActiveTab('details')
    onClose()
  }

  if (!transferId) return null

  const canSubmitForApproval = transfer?.status === 'draft'
  const canApprove = transfer?.status === 'pending_approval'
  const canShip = transfer?.status === 'approved'
  const canReceive = transfer?.status === 'in_transit'
  const canCancel = transfer && ['draft', 'pending_approval', 'approved'].includes(transfer.status)

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={20} />
            <span>{transfer?.transferNo || 'Loading...'}</span>
            {transfer && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[transfer.status]}`}>
                {statusLabels[transfer.status]}
              </span>
            )}
          </div>
        }
        size="5xl"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={32} className="animate-spin text-blue-600" />
          </div>
        ) : transfer ? (
          <div className="flex flex-col h-full">
            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b dark:border-gray-700">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition ${
                    activeTab === tab.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.key === 'items' && transfer.items && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 rounded">
                      {transfer.items.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto min-h-[400px] max-h-[60vh]">
              {/* Details Tab */}
              {activeTab === 'details' && (
                <div className="space-y-4">
                  {/* Warehouses */}
                  <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded">
                    <div className="flex-1">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">From</div>
                      <div className="flex items-center gap-2">
                        <Warehouse size={18} className="text-gray-400" />
                        <div>
                          <div className="font-medium dark:text-white">{transfer.fromWarehouse?.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{transfer.fromWarehouse?.code}</div>
                        </div>
                      </div>
                    </div>
                    <ArrowRight size={24} className="text-gray-400" />
                    <div className="flex-1">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">To</div>
                      <div className="flex items-center gap-2">
                        <Warehouse size={18} className="text-gray-400" />
                        <div>
                          <div className="font-medium dark:text-white">{transfer.toWarehouse?.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{transfer.toWarehouse?.code}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded space-y-2 text-sm">
                    <div className="font-medium dark:text-white mb-2">Timeline</div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Created:</span>
                      <span className="dark:text-gray-300">{formatDate(transfer.createdAt)}</span>
                    </div>
                    {transfer.requestedBy && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Requested by:</span>
                        <span className="dark:text-gray-300">{transfer.requestedBy.fullName}</span>
                      </div>
                    )}
                    {transfer.approvedBy && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Approved by:</span>
                        <span className="dark:text-gray-300">{transfer.approvedBy.fullName} ({formatDate(transfer.approvedAt)})</span>
                      </div>
                    )}
                    {transfer.shippedAt && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Shipped:</span>
                        <span className="dark:text-gray-300">{formatDate(transfer.shippedAt)}</span>
                      </div>
                    )}
                    {transfer.receivedBy && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Received by:</span>
                        <span className="dark:text-gray-300">{transfer.receivedBy.fullName} ({formatDate(transfer.receivedAt)})</span>
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  {transfer.notes && (
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</div>
                      <div className="text-sm dark:text-gray-300">{transfer.notes}</div>
                    </div>
                  )}

                  {/* Cancellation Reason */}
                  {transfer.cancellationReason && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                      <div className="text-xs text-red-500 dark:text-red-400 mb-1">Cancellation Reason</div>
                      <div className="text-sm text-red-700 dark:text-red-300">{transfer.cancellationReason}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Items Tab */}
              {activeTab === 'items' && (
                <div className="border dark:border-gray-700 rounded overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Item</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Quantity</th>
                        {transfer.status === 'completed' && (
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Received</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700">
                      {transfer.items?.length === 0 ? (
                        <tr>
                          <td colSpan={transfer.status === 'completed' ? 3 : 2} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                            No items in this transfer
                          </td>
                        </tr>
                      ) : (
                        transfer.items?.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-3">
                              <div className="font-medium dark:text-white">{item.item?.name}</div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">{item.item?.sku || 'No SKU'}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-medium dark:text-white">
                              {parseFloat(item.quantity).toFixed(0)}
                            </td>
                            {transfer.status === 'completed' && (
                              <td className="px-4 py-3 text-right">
                                <span className={parseFloat(item.receivedQuantity || '0') < parseFloat(item.quantity) ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>
                                  {parseFloat(item.receivedQuantity || '0').toFixed(0)}
                                </span>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Timeline Tab */}
              {activeTab === 'timeline' && (
                <div className="space-y-4">
                  {timelineItems.length > 0 ? (
                    <Timeline items={timelineItems} />
                  ) : (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      No activity recorded yet.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions Footer */}
            {(canSubmitForApproval || canApprove || canShip || canReceive || canCancel) && (
              <div className="flex flex-wrap gap-3 justify-end pt-4 mt-4 border-t dark:border-gray-700">
                {canCancel && (
                  <button
                    onClick={() => setShowCancelModal(true)}
                    disabled={processing}
                    className="px-4 py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
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
                      className="px-4 py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 flex items-center gap-2"
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
          </div>
        ) : null}
      </Modal>

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
        itemName={`Transfer ${transfer?.transferNo}`}
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
              {transfer?.items?.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium dark:text-white">{item.item?.name}</div>
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
    </>
  )
}
