'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { FileText, AlertCircle } from 'lucide-react'

interface OrderItemForInvoice {
  id: string
  itemName: string
  displayName?: string
  quantity: number
  fulfilledQuantity: number
}

interface CostCenter {
  id: string
  name: string
}

interface CreateSalesInvoiceModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (data: {
    fulfilledQuantities: Record<string, number>
    notes: string
    costCenterId?: string
  }) => void
  processing?: boolean
  orderNo: string
  items: OrderItemForInvoice[]
  costCenters?: CostCenter[]
}

export function CreateSalesInvoiceModal({
  isOpen,
  onClose,
  onConfirm,
  processing = false,
  orderNo,
  items,
  costCenters = [],
}: CreateSalesInvoiceModalProps) {
  const [fulfilledQtys, setFulfilledQtys] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [costCenterId, setCostCenterId] = useState('')

  const requireCostCenter = costCenters.length > 0

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const defaults: Record<string, number> = {}
      items.forEach(item => {
        const remaining = item.quantity - item.fulfilledQuantity
        defaults[item.id] = Math.max(0, remaining)
      })
      queueMicrotask(() => {
        setFulfilledQtys(defaults)
        setNotes('')
        setCostCenterId('')
      })
    }
  }, [isOpen, items])

  function handleQtyChange(itemId: string, value: string) {
    const qty = parseFloat(value) || 0
    setFulfilledQtys(prev => ({ ...prev, [itemId]: qty }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate at least one item has qty > 0
    const hasItems = Object.values(fulfilledQtys).some(q => q > 0)
    if (!hasItems) return

    onConfirm({
      fulfilledQuantities: fulfilledQtys,
      notes,
      costCenterId: costCenterId || undefined,
    })
  }

  const hasValidQtys = Object.values(fulfilledQtys).some(q => q > 0)

  // Check for over-fulfillment
  const hasOverfill = items.some(item => {
    const remaining = item.quantity - item.fulfilledQuantity
    return (fulfilledQtys[item.id] || 0) > remaining
  })

  const canSubmit = hasValidQtys && !hasOverfill && (!requireCostCenter || costCenterId)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Create Sales Invoice - ${orderNo}`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded">
          <FileText className="text-blue-600 shrink-0 mt-0.5" size={24} />
          <div>
            <p className="text-blue-800 font-semibold">Create Sales Invoice</p>
            <p className="text-blue-700 text-sm mt-1">
              Select the quantities to fulfill from this sales order. A new sales invoice will be created.
            </p>
          </div>
        </div>

        {/* Items table */}
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Item</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase w-24">Ordered</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase w-24">Fulfilled</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase w-24">Remaining</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase w-28">Fulfill Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map(item => {
                const remaining = item.quantity - item.fulfilledQuantity
                const currentQty = fulfilledQtys[item.id] || 0
                const isOverfill = currentQty > remaining

                return (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{item.displayName || item.itemName}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{item.quantity}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{item.fulfilledQuantity}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-white">{remaining}</td>
                    <td className="px-4 py-2 text-right">
                      {remaining > 0 ? (
                        <input
                          type="number"
                          value={currentQty}
                          onChange={(e) => handleQtyChange(item.id, e.target.value)}
                          className={`w-24 px-2 py-1 text-right border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${
                            isOverfill ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                          }`}
                          min="0"
                          max={remaining}
                          step="any"
                        />
                      ) : (
                        <span className="text-green-600 text-xs font-medium">Fully fulfilled</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Cost Center */}
        {requireCostCenter && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Cost Center <span className="text-red-500">*</span>
            </label>
            <select
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              required
            >
              <option value="">Select Cost Center</option>
              {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
            </select>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            rows={2}
            placeholder="Optional notes for this invoice..."
          />
        </div>

        {/* Warnings */}
        {hasOverfill && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-red-700">
            <AlertCircle size={18} />
            <span className="text-sm">Fulfill quantity cannot exceed remaining quantity.</span>
          </div>
        )}

        {!hasValidQtys && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-amber-700">
            <AlertCircle size={18} />
            <span className="text-sm">At least one item must have a fulfill quantity greater than 0.</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || processing}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {processing ? (
              'Creating...'
            ) : (
              <>
                <FileText size={16} />
                Create Invoice
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
