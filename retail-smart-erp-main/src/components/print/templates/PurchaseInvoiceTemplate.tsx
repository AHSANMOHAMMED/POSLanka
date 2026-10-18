'use client'

import { PrintSettings } from '@/lib/print/types'

interface PurchaseItem {
  id: string
  itemId: string | null
  itemName: string
  itemSku: string | null
  quantity: string
  unitPrice: string
  tax: string | null
  total: string
}

interface PurchasePayment {
  id: string
  amount: string
  paymentMethod: string
  paymentReference: string | null
  notes: string | null
  paidAt: string
  createdByName: string | null
}

interface PurchaseData {
  purchaseNo: string
  purchaseOrderNo: string | null
  status: string
  supplierName: string | null
  warehouseName: string | null
  supplierInvoiceNo: string | null
  supplierBillDate: string | null
  paymentTerm: string
  subtotal: string
  taxAmount: string
  total: string
  paidAmount: string
  notes: string | null
  isReturn: boolean
  createdByName: string | null
  cancellationReason: string | null
  createdAt: string
  items: PurchaseItem[]
  payments: PurchasePayment[]
}

interface PurchaseInvoiceTemplateProps {
  purchase: PurchaseData
  settings: PrintSettings
  businessName: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
  currencyCode?: string
}

export function PurchaseInvoiceTemplate({
  purchase,
  settings,
  businessName,
  businessAddress,
  businessPhone,
  businessEmail,
  currencyCode
}: PurchaseInvoiceTemplateProps) {
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
      pending: 'Pending',
      partially_paid: 'Partially Paid',
      paid: 'Paid',
      cancelled: 'Cancelled'
    }
    return labels[status] || status
  }

  const getPaymentMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      cash: 'Cash',
      bank_transfer: 'Bank Transfer',
      cheque: 'Cheque',
      credit: 'Credit'
    }
    return labels[method] || method
  }

  const balanceDue = parseFloat(purchase.total) - parseFloat(purchase.paidAmount)

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
        <h2 className="text-xl font-bold">
          {purchase.isReturn ? 'PURCHASE RETURN' : 'PURCHASE INVOICE'}
        </h2>
        <p className="text-lg font-semibold">{purchase.purchaseNo}</p>
        <div className="flex justify-center gap-4 text-sm mt-2">
          <span className="px-2 py-1 bg-gray-100 rounded">
            Status: {getStatusLabel(purchase.status)}
          </span>
          {purchase.purchaseOrderNo && (
            <span className="px-2 py-1 bg-blue-100 rounded">
              PO: {purchase.purchaseOrderNo}
            </span>
          )}
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-600">Created:</span>{' '}
          <span className="font-medium">{formatDateTime(purchase.createdAt)}</span>
        </div>
        {purchase.supplierBillDate && (
          <div>
            <span className="text-gray-600">Supplier Bill Date:</span>{' '}
            <span className="font-medium">{formatDate(purchase.supplierBillDate)}</span>
          </div>
        )}
        {purchase.supplierInvoiceNo && (
          <div>
            <span className="text-gray-600">Supplier Invoice #:</span>{' '}
            <span className="font-medium">{purchase.supplierInvoiceNo}</span>
          </div>
        )}
      </div>

      {/* Supplier & Warehouse Info */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Supplier</h3>
          {purchase.supplierName ? (
            <>
              <p className="font-medium">{purchase.supplierName}</p>
              <p className="text-sm text-gray-600">Payment Term: {purchase.paymentTerm}</p>
            </>
          ) : (
            <p className="text-gray-500 text-sm">No supplier assigned</p>
          )}
        </div>
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Received At</h3>
          {purchase.warehouseName ? (
            <p className="font-medium">{purchase.warehouseName}</p>
          ) : (
            <p className="text-gray-500 text-sm">No warehouse assigned</p>
          )}
        </div>
      </div>

      {/* Purchase Items */}
      {purchase.items.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold text-sm mb-2">Items</h3>
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
              {purchase.items.map((item, index) => (
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
              <span>{formatCurrency(purchase.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Tax:</span>
              <span>{formatCurrency(purchase.taxAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg border-t pt-2">
              <span>Total:</span>
              <span>{formatCurrency(purchase.total)}</span>
            </div>
            <div className="flex justify-between text-sm mt-2 text-green-600">
              <span>Paid:</span>
              <span>{formatCurrency(purchase.paidAmount)}</span>
            </div>
            {balanceDue > 0 && (
              <div className="flex justify-between text-sm font-medium text-red-600">
                <span>Balance Due:</span>
                <span>{formatCurrency(balanceDue.toString())}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment History */}
      {purchase.payments.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold text-sm mb-2">Payment History</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left py-2 px-2">Date</th>
                <th className="text-left py-2 px-2">Method</th>
                <th className="text-left py-2 px-2">Reference</th>
                <th className="text-right py-2 px-2">Amount</th>
                <th className="text-left py-2 px-2">Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {purchase.payments.map((payment) => (
                <tr key={payment.id} className="border-b">
                  <td className="py-2 px-2">{formatDateTime(payment.paidAt)}</td>
                  <td className="py-2 px-2">{getPaymentMethodLabel(payment.paymentMethod)}</td>
                  <td className="py-2 px-2">{payment.paymentReference || '-'}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(payment.amount)}</td>
                  <td className="py-2 px-2">{payment.createdByName || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      {purchase.notes && (
        <div className="border rounded p-3 mt-4">
          <h3 className="font-semibold text-sm mb-2">Notes</h3>
          <p className="text-sm whitespace-pre-wrap">{purchase.notes}</p>
        </div>
      )}

      {/* Cancellation Reason */}
      {purchase.status === 'cancelled' && purchase.cancellationReason && (
        <div className="border border-red-200 bg-red-50 rounded p-3 mt-4">
          <h3 className="font-semibold text-sm mb-2 text-red-700">Cancellation Reason</h3>
          <p className="text-sm text-red-600 whitespace-pre-wrap">{purchase.cancellationReason}</p>
        </div>
      )}

      {/* Signature Areas */}
      <div className="grid grid-cols-2 gap-8 mt-8 pt-4">
        <div className="border-t pt-2">
          <p className="text-sm text-gray-600 mb-8">Received By</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">{purchase.createdByName || 'N/A'}</p>
        </div>
        <div className="border-t pt-2">
          <p className="text-sm text-gray-600 mb-8">Verified By</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">Date: _______________</p>
        </div>
      </div>

      {/* Footer */}
      {settings.showFooter && (
        <div className="text-center mt-8 pt-4 border-t text-sm text-gray-600">
          <p>This is a computer-generated document.</p>
          <p className="text-xs mt-1">For any discrepancies, please contact accounts department.</p>
        </div>
      )}
    </div>
  )
}
