'use client'

import { PrintSettings } from '@/lib/print/types'

interface PurchaseOrderItem {
  id: string
  itemId: string | null
  itemName: string
  itemSku: string | null
  quantity: string
  receivedQuantity: string | null
  unitPrice: string
  tax: string | null
  total: string
}

interface PurchaseOrderData {
  orderNo: string
  status: string
  supplierName: string | null
  warehouseName: string | null
  expectedDeliveryDate: string | null
  subtotal: string
  taxAmount: string
  total: string
  notes: string | null
  createdByName: string | null
  approvedAt: string | null
  cancellationReason: string | null
  createdAt: string
  items: PurchaseOrderItem[]
}

interface PurchaseOrderTemplateProps {
  purchaseOrder: PurchaseOrderData
  settings: PrintSettings
  businessName: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
  currencyCode?: string
}

export function PurchaseOrderTemplate({
  purchaseOrder,
  settings,
  businessName,
  businessAddress,
  businessPhone,
  businessEmail,
  currencyCode
}: PurchaseOrderTemplateProps) {
  const currency = currencyCode || 'LKR'
  const formatCurrency = (value: string | null) => {
    if (!value) return '-'
    return `${currency} ${parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  }

  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const formatDateTime = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: 'Draft',
      submitted: 'Submitted',
      confirmed: 'Confirmed',
      invoice_created: 'Invoice Created',
      cancelled: 'Cancelled'
    }
    return labels[status] || status
  }

  return (
    <div className="print-content">
      {/* Header */}
      {settings.showHeader && (
        <div className="text-center mb-4 border-b pb-4">
          <h1 className="text-2xl font-bold">{businessName}</h1>
          {businessAddress && <p className="text-sm text-gray-600">{businessAddress}</p>}
          <div className="text-sm text-gray-600">
            {businessPhone && <span>{businessPhone}</span>}
            {businessPhone && businessEmail && <span> | </span>}
            {businessEmail && <span>{businessEmail}</span>}
          </div>
        </div>
      )}

      {/* Document Title */}
      <div className="text-center mb-4">
        <h2 className="text-xl font-bold">PURCHASE ORDER</h2>
        <p className="text-lg font-semibold">{purchaseOrder.orderNo}</p>
        <div className="flex justify-center gap-4 text-sm mt-2">
          <span className="px-2 py-1 bg-gray-100 rounded">
            Status: {getStatusLabel(purchaseOrder.status)}
          </span>
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-600">Created:</span>{' '}
          <span className="font-medium">{formatDateTime(purchaseOrder.createdAt)}</span>
        </div>
        {purchaseOrder.expectedDeliveryDate && (
          <div>
            <span className="text-gray-600">Expected Delivery:</span>{' '}
            <span className="font-medium">{formatDate(purchaseOrder.expectedDeliveryDate)}</span>
          </div>
        )}
        {purchaseOrder.approvedAt && (
          <div>
            <span className="text-gray-600">Approved:</span>{' '}
            <span className="font-medium">{formatDateTime(purchaseOrder.approvedAt)}</span>
          </div>
        )}
      </div>

      {/* Supplier & Warehouse Info */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Supplier</h3>
          {purchaseOrder.supplierName ? (
            <p className="font-medium">{purchaseOrder.supplierName}</p>
          ) : (
            <p className="text-gray-500 text-sm">No supplier assigned</p>
          )}
        </div>
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Deliver To</h3>
          {purchaseOrder.warehouseName ? (
            <p className="font-medium">{purchaseOrder.warehouseName}</p>
          ) : (
            <p className="text-gray-500 text-sm">No warehouse assigned</p>
          )}
        </div>
      </div>

      {/* Order Items */}
      {purchaseOrder.items.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold text-sm mb-2">Order Items</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left py-2 px-2">#</th>
                <th className="text-left py-2 px-2">Item</th>
                <th className="text-left py-2 px-2">SKU</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Unit Price</th>
                <th className="text-right py-2 px-2">Tax</th>
                <th className="text-right py-2 px-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrder.items.map((item, index) => (
                <tr key={item.id} className="border-b">
                  <td className="py-2 px-2">{index + 1}</td>
                  <td className="py-2 px-2">{item.itemName}</td>
                  <td className="py-2 px-2">{item.itemSku || '-'}</td>
                  <td className="text-right py-2 px-2">{parseFloat(item.quantity).toLocaleString()}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(item.unitPrice)}</td>
                  <td className="text-right py-2 px-2">{item.tax ? formatCurrency(item.tax) : '-'}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      <div className="border-t pt-4 mt-4">
        <div className="flex justify-end">
          <div className="w-64">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Subtotal:</span>
              <span>{formatCurrency(purchaseOrder.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Tax:</span>
              <span>{formatCurrency(purchaseOrder.taxAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg border-t pt-2">
              <span>Total:</span>
              <span>{formatCurrency(purchaseOrder.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {purchaseOrder.notes && (
        <div className="border rounded p-3 mt-4">
          <h3 className="font-semibold text-sm mb-2">Notes</h3>
          <p className="text-sm whitespace-pre-wrap">{purchaseOrder.notes}</p>
        </div>
      )}

      {/* Cancellation Reason */}
      {purchaseOrder.status === 'cancelled' && purchaseOrder.cancellationReason && (
        <div className="border border-red-200 bg-red-50 rounded p-3 mt-4">
          <h3 className="font-semibold text-sm mb-2 text-red-700">Cancellation Reason</h3>
          <p className="text-sm text-red-600 whitespace-pre-wrap">{purchaseOrder.cancellationReason}</p>
        </div>
      )}

      {/* Signature Areas */}
      <div className="grid grid-cols-3 gap-8 mt-8 pt-4">
        <div className="border-t pt-2">
          <p className="text-sm text-gray-600 mb-8">Created By</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">{purchaseOrder.createdByName || 'N/A'}</p>
        </div>
        <div className="border-t pt-2">
          <p className="text-sm text-gray-600 mb-8">Approved By</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">Date: _______________</p>
        </div>
        <div className="border-t pt-2">
          <p className="text-sm text-gray-600 mb-8">Supplier Acknowledgment</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">Date: _______________</p>
        </div>
      </div>

      {/* Footer */}
      {settings.showFooter && (
        <div className="text-center mt-8 pt-4 border-t text-sm text-gray-600">
          <p>This is a computer-generated document.</p>
          <p className="text-xs mt-1">Please deliver items as per specifications above.</p>
        </div>
      )}
    </div>
  )
}
