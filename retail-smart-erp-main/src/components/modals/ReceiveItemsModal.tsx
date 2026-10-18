'use client'

import { useState, useEffect, useMemo } from 'react'
import { Modal } from '@/components/ui/modal'
import { Package, CheckCircle, AlertCircle, FileText } from 'lucide-react'

export interface ReceiveItemData {
  id: string          // purchaseOrderItem.id
  itemId: string | null
  itemName: string
  itemSku: string | null
  displayName?: string
  orderedQty: number
  receivedQty: number  // Already received (cumulative)
}

interface ReceivingItem {
  itemId: string      // purchaseOrderItem.id
  receivingNow: number
  notes: string
}

interface ReceiveItemsModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (data: {
    items: { itemId: string; receivedQuantity: number; notes?: string }[]
    updateStock: boolean
    notes: string
    supplierInvoiceNo: string
    supplierBillDate: string
  }) => void
  items: ReceiveItemData[]
  processing?: boolean
  orderNo: string
}

export function ReceiveItemsModal({
  isOpen,
  onClose,
  onConfirm,
  items,
  processing = false,
  orderNo,
}: ReceiveItemsModalProps) {
  const [receivingItems, setReceivingItems] = useState<ReceivingItem[]>([])
  const [updateStock, setUpdateStock] = useState(true)
  const [overallNotes, setOverallNotes] = useState('')
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [supplierBillDate, setSupplierBillDate] = useState('')

  // Initialize receiving items when modal opens - intentional prop->state sync for modal pattern
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen && items.length > 0) {
      const initial: ReceivingItem[] = items.map(item => ({
        itemId: item.id,
        receivingNow: 0,
        notes: '',
      }))
      setReceivingItems(initial)
      setUpdateStock(true)
      setOverallNotes('')
      setSupplierInvoiceNo('')
      setSupplierBillDate(new Date().toISOString().split('T')[0]) // Default to today
    }
  }, [isOpen, items])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Calculate totals and summary
  const summary = useMemo(() => {
    let totalOrdered = 0
    let totalPreviouslyReceived = 0
    let totalReceivingNow = 0

    items.forEach((item, index) => {
      totalOrdered += item.orderedQty
      totalPreviouslyReceived += item.receivedQty
      totalReceivingNow += receivingItems[index]?.receivingNow || 0
    })

    const totalAfterReceive = totalPreviouslyReceived + totalReceivingNow
    const percentComplete = totalOrdered > 0 ? Math.round((totalAfterReceive / totalOrdered) * 100) : 0
    const itemsWithQuantity = receivingItems.filter(r => r.receivingNow > 0).length

    return {
      totalOrdered,
      totalPreviouslyReceived,
      totalReceivingNow,
      totalAfterReceive,
      percentComplete,
      itemsWithQuantity,
    }
  }, [items, receivingItems])

  function handleQuantityChange(index: number, value: number) {
    const item = items[index]
    const maxReceivable = item.orderedQty - item.receivedQty
    const validValue = Math.min(Math.max(0, value), maxReceivable)

    setReceivingItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], receivingNow: validValue }
      return updated
    })
  }

  function handleNotesChange(index: number, value: string) {
    setReceivingItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], notes: value }
      return updated
    })
  }

  function handleReceiveAll() {
    setReceivingItems(prev => {
      return prev.map((ri, index) => {
        const item = items[index]
        const maxReceivable = item.orderedQty - item.receivedQty
        return { ...ri, receivingNow: maxReceivable }
      })
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Filter items with quantity > 0
    const itemsToReceive = receivingItems
      .filter(ri => ri.receivingNow > 0)
      .map(ri => ({
        itemId: ri.itemId,
        receivedQuantity: ri.receivingNow,
        notes: ri.notes || undefined,
      }))

    if (itemsToReceive.length === 0) {
      return // No items to receive
    }

    if (!supplierInvoiceNo.trim()) {
      return // Supplier invoice no is required
    }

    if (!supplierBillDate) {
      return // Bill date is required
    }

    onConfirm({
      items: itemsToReceive,
      updateStock,
      notes: overallNotes,
      supplierInvoiceNo: supplierInvoiceNo.trim(),
      supplierBillDate,
    })
  }

  const canSubmit = summary.itemsWithQuantity > 0 && supplierInvoiceNo.trim() && supplierBillDate

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Receive Items - ${orderNo}`} size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded">
          <Package className="text-blue-600 shrink-0 mt-0.5" size={24} />
          <div>
            <p className="text-blue-800 font-semibold">Receive Items into Inventory</p>
            <p className="text-blue-700 text-sm mt-1">
              Enter the quantity being received for each item. You can do partial receives over multiple deliveries.
            </p>
          </div>
        </div>

        {/* Items table */}
        <div className="border rounded overflow-hidden">
          <div className="max-h-[350px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Item</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300 w-20">Ordered</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300 w-24">Received</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-300 w-28">Receiving</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300 w-24">Remaining</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300 w-32">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((item, index) => {
                  const receivingNow = receivingItems[index]?.receivingNow || 0
                  const remaining = item.orderedQty - item.receivedQty - receivingNow
                  const maxReceivable = item.orderedQty - item.receivedQty
                  const isFullyReceived = maxReceivable <= 0

                  return (
                    <tr key={item.id} className={isFullyReceived ? 'bg-green-50 dark:bg-green-900/20' : ''}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 dark:text-white">{item.displayName || item.itemName}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                        {item.orderedQty}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={item.receivedQty > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
                          {item.receivedQty}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isFullyReceived ? (
                          <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                            <CheckCircle size={14} />
                            Complete
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={maxReceivable}
                            value={receivingNow || ''}
                            onChange={(e) => handleQuantityChange(index, parseFloat(e.target.value) || 0)}
                            className="w-20 px-2 py-1 text-center text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            placeholder="0"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isFullyReceived ? (
                          <span className="text-green-600">0</span>
                        ) : (
                          <span className={remaining === 0 && receivingNow > 0 ? 'text-green-600 font-medium' : 'text-gray-700 dark:text-gray-300'}>
                            {remaining}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {!isFullyReceived && (
                          <input
                            type="text"
                            value={receivingItems[index]?.notes || ''}
                            onChange={(e) => handleNotesChange(index, e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            placeholder="Optional"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleReceiveAll}
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            Receive all remaining quantities
          </button>
        </div>

        {/* Summary */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Receiving Summary</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Total Ordered</span>
              <p className="font-semibold text-gray-900 dark:text-white">{summary.totalOrdered}</p>
            </div>
            <div>
              <span className="text-gray-500">Already Received</span>
              <p className="font-semibold text-green-600">{summary.totalPreviouslyReceived}</p>
            </div>
            <div>
              <span className="text-gray-500">Receiving Now</span>
              <p className="font-semibold text-blue-600">{summary.totalReceivingNow}</p>
            </div>
            <div>
              <span className="text-gray-500">Completion</span>
              <p className="font-semibold text-gray-900 dark:text-white">{summary.percentComplete}%</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
              <div
                className="bg-green-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(summary.percentComplete, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Supplier Invoice Details */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="text-blue-600 dark:text-blue-400" size={18} />
            <h4 className="text-sm font-medium text-blue-800 dark:text-blue-300">Supplier Invoice Details</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Supplier Invoice No. <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={supplierInvoiceNo}
                onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="Enter supplier's invoice number"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Bill Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={supplierBillDate}
                onChange={(e) => setSupplierBillDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                required
              />
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={updateStock}
              onChange={(e) => setUpdateStock(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Update warehouse stock (add received quantities to inventory)
            </span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Overall Notes (optional)
            </label>
            <textarea
              value={overallNotes}
              onChange={(e) => setOverallNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              rows={2}
              placeholder="Add notes about this delivery..."
            />
          </div>
        </div>

        {/* Warning if validation fails */}
        {!canSubmit && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-amber-700">
            <AlertCircle size={18} />
            <span className="text-sm">
              {summary.itemsWithQuantity === 0
                ? 'Enter quantities for at least one item to receive.'
                : !supplierInvoiceNo.trim()
                ? 'Supplier Invoice No. is required.'
                : 'Bill Date is required.'
              }
            </span>
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
              'Processing...'
            ) : (
              <>
                <CheckCircle size={16} />
                Receive {summary.itemsWithQuantity} Item{summary.itemsWithQuantity !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
