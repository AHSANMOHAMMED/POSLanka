'use client'

import { PrintSettings } from '@/lib/print/types'

interface StockTransferItem {
  id: string
  itemId: string
  quantity: string
  receivedQuantity: string | null
  notes: string | null
  item: {
    name: string
    sku: string | null
    barcode: string | null
  }
}

interface StockTransferData {
  transferNo: string
  status: string
  fromWarehouse: {
    name: string
    code: string | null
    address: string | null
  }
  toWarehouse: {
    name: string
    code: string | null
    address: string | null
  }
  requestedByUser: {
    fullName: string | null
  } | null
  approvedByUser: {
    fullName: string | null
  } | null
  shippedByUser: {
    fullName: string | null
  } | null
  receivedByUser: {
    fullName: string | null
  } | null
  notes: string | null
  cancellationReason: string | null
  createdAt: string
  approvedAt: string | null
  shippedAt: string | null
  receivedAt: string | null
  cancelledAt: string | null
  items: StockTransferItem[]
}

interface StockTransferTemplateProps {
  transfer: StockTransferData
  settings: PrintSettings
  businessName: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
}

export function StockTransferTemplate({
  transfer,
  settings,
  businessName,
  businessAddress,
  businessPhone,
  businessEmail
}: StockTransferTemplateProps) {
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
      pending_approval: 'Pending Approval',
      approved: 'Approved',
      in_transit: 'In Transit',
      completed: 'Completed',
      cancelled: 'Cancelled'
    }
    return labels[status] || status
  }

  const totalItems = transfer.items.reduce((sum, item) => sum + parseFloat(item.quantity), 0)
  const totalReceived = transfer.items.reduce((sum, item) => sum + parseFloat(item.receivedQuantity || '0'), 0)

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
        <h2 className="text-xl font-bold">STOCK TRANSFER</h2>
        <p className="text-lg font-semibold">{transfer.transferNo}</p>
        <div className="flex justify-center gap-4 text-sm mt-2">
          <span className="px-2 py-1 bg-gray-100 rounded">
            Status: {getStatusLabel(transfer.status)}
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div className="grid grid-cols-4 gap-2 mb-4 text-xs">
        <div className={`p-2 rounded ${transfer.createdAt ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border'}`}>
          <p className="font-medium text-gray-600">Created</p>
          <p className="font-semibold">{formatDateTime(transfer.createdAt)}</p>
          {transfer.requestedByUser && <p className="text-gray-500">{transfer.requestedByUser.fullName}</p>}
        </div>
        <div className={`p-2 rounded ${transfer.approvedAt ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border'}`}>
          <p className="font-medium text-gray-600">Approved</p>
          <p className="font-semibold">{formatDateTime(transfer.approvedAt)}</p>
          {transfer.approvedByUser && <p className="text-gray-500">{transfer.approvedByUser.fullName}</p>}
        </div>
        <div className={`p-2 rounded ${transfer.shippedAt ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border'}`}>
          <p className="font-medium text-gray-600">Shipped</p>
          <p className="font-semibold">{formatDateTime(transfer.shippedAt)}</p>
          {transfer.shippedByUser && <p className="text-gray-500">{transfer.shippedByUser.fullName}</p>}
        </div>
        <div className={`p-2 rounded ${transfer.receivedAt ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border'}`}>
          <p className="font-medium text-gray-600">Received</p>
          <p className="font-semibold">{formatDateTime(transfer.receivedAt)}</p>
          {transfer.receivedByUser && <p className="text-gray-500">{transfer.receivedByUser.fullName}</p>}
        </div>
      </div>

      {/* Warehouse Info */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">From Warehouse</h3>
          <p className="font-medium">{transfer.fromWarehouse.name}</p>
          {transfer.fromWarehouse.code && (
            <p className="text-sm text-gray-600">Code: {transfer.fromWarehouse.code}</p>
          )}
          {transfer.fromWarehouse.address && (
            <p className="text-sm text-gray-500">{transfer.fromWarehouse.address}</p>
          )}
        </div>
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">To Warehouse</h3>
          <p className="font-medium">{transfer.toWarehouse.name}</p>
          {transfer.toWarehouse.code && (
            <p className="text-sm text-gray-600">Code: {transfer.toWarehouse.code}</p>
          )}
          {transfer.toWarehouse.address && (
            <p className="text-sm text-gray-500">{transfer.toWarehouse.address}</p>
          )}
        </div>
      </div>

      {/* Transfer Items */}
      {transfer.items.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold text-sm mb-2">Transfer Items</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left py-2 px-2">#</th>
                <th className="text-left py-2 px-2">Item</th>
                <th className="text-left py-2 px-2">SKU</th>
                <th className="text-left py-2 px-2">Barcode</th>
                <th className="text-right py-2 px-2">Requested</th>
                <th className="text-right py-2 px-2">Received</th>
                <th className="text-left py-2 px-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {transfer.items.map((item, index) => {
                const requested = parseFloat(item.quantity)
                const received = parseFloat(item.receivedQuantity || '0')
                const hasDiscrepancy = transfer.status === 'completed' && Math.abs(received - requested) > 0.01

                return (
                  <tr key={item.id} className={`border-b ${hasDiscrepancy ? 'bg-yellow-50' : ''}`}>
                    <td className="py-2 px-2">{index + 1}</td>
                    <td className="py-2 px-2">{item.item.name}</td>
                    <td className="py-2 px-2">{item.item.sku || '-'}</td>
                    <td className="py-2 px-2">{item.item.barcode || '-'}</td>
                    <td className="text-right py-2 px-2">{requested.toLocaleString()}</td>
                    <td className={`text-right py-2 px-2 ${hasDiscrepancy ? 'text-orange-600 font-medium' : ''}`}>
                      {transfer.status === 'completed' ? received.toLocaleString() : '-'}
                    </td>
                    <td className="py-2 px-2 text-gray-500">{item.notes || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={4} className="py-2 px-2 text-right font-medium">Total:</td>
                <td className="text-right py-2 px-2 font-medium">{totalItems.toLocaleString()}</td>
                <td className="text-right py-2 px-2 font-medium">
                  {transfer.status === 'completed' ? totalReceived.toLocaleString() : '-'}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Notes */}
      {transfer.notes && (
        <div className="border rounded p-3 mt-4">
          <h3 className="font-semibold text-sm mb-2">Notes</h3>
          <p className="text-sm whitespace-pre-wrap">{transfer.notes}</p>
        </div>
      )}

      {/* Cancellation Reason */}
      {transfer.status === 'cancelled' && transfer.cancellationReason && (
        <div className="border border-red-200 bg-red-50 rounded p-3 mt-4">
          <h3 className="font-semibold text-sm mb-2 text-red-700">Cancellation Reason</h3>
          <p className="text-sm text-red-600 whitespace-pre-wrap">{transfer.cancellationReason}</p>
        </div>
      )}

      {/* Signature Areas */}
      <div className="grid grid-cols-4 gap-4 mt-8 pt-4">
        <div className="border-t pt-2">
          <p className="text-xs text-gray-600 mb-6">Requested By</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">{transfer.requestedByUser?.fullName || '_______________'}</p>
        </div>
        <div className="border-t pt-2">
          <p className="text-xs text-gray-600 mb-6">Approved By</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">{transfer.approvedByUser?.fullName || '_______________'}</p>
        </div>
        <div className="border-t pt-2">
          <p className="text-xs text-gray-600 mb-6">Shipped By</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">{transfer.shippedByUser?.fullName || '_______________'}</p>
        </div>
        <div className="border-t pt-2">
          <p className="text-xs text-gray-600 mb-6">Received By</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">{transfer.receivedByUser?.fullName || '_______________'}</p>
        </div>
      </div>

      {/* Footer */}
      {settings.showFooter && (
        <div className="text-center mt-8 pt-4 border-t text-sm text-gray-600">
          <p>This is a computer-generated document.</p>
          <p className="text-xs mt-1">Please verify quantities upon receipt and report any discrepancies immediately.</p>
        </div>
      )}
    </div>
  )
}
