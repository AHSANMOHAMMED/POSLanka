'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { FileText, AlertCircle } from 'lucide-react'

interface CostCenter {
  id: string
  name: string
}

interface CreatePurchaseInvoiceModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (data: {
    supplierInvoiceNo: string
    supplierBillDate: string
    costCenterId?: string
  }) => void
  processing?: boolean
  orderNo: string
  costCenters?: CostCenter[]
}

export function CreatePurchaseInvoiceModal({
  isOpen,
  onClose,
  onConfirm,
  processing = false,
  orderNo,
  costCenters = [],
}: CreatePurchaseInvoiceModalProps) {
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [supplierBillDate, setSupplierBillDate] = useState('')
  const [costCenterId, setCostCenterId] = useState('')

  const requireCostCenter = costCenters.length > 0

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      queueMicrotask(() => {
        setSupplierInvoiceNo('')
        setSupplierBillDate(new Date().toISOString().split('T')[0]) // Default to today
        setCostCenterId('')
      })
    }
  }, [isOpen])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!supplierInvoiceNo.trim()) {
      return
    }

    if (!supplierBillDate) {
      return
    }

    onConfirm({
      supplierInvoiceNo: supplierInvoiceNo.trim(),
      supplierBillDate,
      costCenterId: costCenterId || undefined,
    })
  }

  const canSubmit = supplierInvoiceNo.trim() && supplierBillDate && (!requireCostCenter || costCenterId)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Create Purchase Invoice - ${orderNo}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded">
          <FileText className="text-blue-600 shrink-0 mt-0.5" size={24} />
          <div>
            <p className="text-blue-800 font-semibold">Create Purchase Invoice</p>
            <p className="text-blue-700 text-sm mt-1">
              Enter the supplier&apos;s invoice details to create a purchase invoice linked to this order.
            </p>
          </div>
        </div>

        {/* Supplier Invoice Details */}
        <div className="space-y-4">
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
              autoFocus
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
        </div>

        {/* Warning if validation fails */}
        {!canSubmit && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-amber-700">
            <AlertCircle size={18} />
            <span className="text-sm">
              {!supplierInvoiceNo.trim()
                ? 'Supplier Invoice No. is required.'
                : !supplierBillDate
                ? 'Bill Date is required.'
                : 'Cost Center is required.'
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
