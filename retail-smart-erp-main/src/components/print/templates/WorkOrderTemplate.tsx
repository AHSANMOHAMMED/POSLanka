'use client'

import { PrintSettings } from '@/lib/print/types'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface WorkOrderService {
  id: string
  description: string | null
  hours: number | null
  rate: string
  amount: string
  status: string
  serviceType?: {
    name: string
  } | null
  technician?: {
    name: string
  } | null
}

interface WorkOrderPart {
  id: string
  quantity: number
  unitPrice: string
  totalPrice: string
  partName: string | null
  item?: {
    name: string
    sku: string | null
  } | null
}

interface WorkOrderData {
  workOrderNo: string
  status: string
  priority: string
  createdAt: string
  scheduledDate: string | null
  completedAt: string | null
  notes: string | null
  internalNotes: string | null
  subtotal: string
  taxAmount: string
  total: string
  customer: {
    name: string
    phone: string | null
    email: string | null
    address: string | null
  } | null
  vehicle: {
    make: string
    model: string
    year: number | null
    plateNumber: string
    color: string | null
    vin: string | null
    currentMileage: number | null
  } | null
  services: WorkOrderService[]
  parts: WorkOrderPart[]
}

interface WorkOrderTemplateProps {
  workOrder: WorkOrderData
  settings: PrintSettings
  businessName: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
  currencyCode?: string
}

export function WorkOrderTemplate({
  workOrder,
  settings,
  businessName,
  businessAddress,
  businessPhone,
  businessEmail,
  currencyCode = 'LKR'
}: WorkOrderTemplateProps) {
  const formatCurrency = (value: string | null) => {
    if (!value) return '-'
    const amount = parseFloat(value)
    return formatCurrencyWithSymbol(amount, currencyCode)
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
      in_progress: 'In Progress',
      waiting_parts: 'Waiting for Parts',
      ready: 'Ready for Pickup',
      completed: 'Completed',
      cancelled: 'Cancelled'
    }
    return labels[status] || status
  }

  const getPriorityLabel = (priority: string) => {
    const labels: Record<string, string> = {
      low: 'Low',
      normal: 'Normal',
      high: 'High',
      urgent: 'Urgent'
    }
    return labels[priority] || priority
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
        <h2 className="text-xl font-bold">WORK ORDER</h2>
        <p className="text-lg font-semibold">{workOrder.workOrderNo}</p>
        <div className="flex justify-center gap-4 text-sm mt-2">
          <span className="px-2 py-1 bg-gray-100 rounded">
            Status: {getStatusLabel(workOrder.status)}
          </span>
          <span className="px-2 py-1 bg-gray-100 rounded">
            Priority: {getPriorityLabel(workOrder.priority)}
          </span>
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-600">Created:</span>{' '}
          <span className="font-medium">{formatDateTime(workOrder.createdAt)}</span>
        </div>
        {workOrder.scheduledDate && (
          <div>
            <span className="text-gray-600">Scheduled:</span>{' '}
            <span className="font-medium">{formatDate(workOrder.scheduledDate)}</span>
          </div>
        )}
        {workOrder.completedAt && (
          <div>
            <span className="text-gray-600">Completed:</span>{' '}
            <span className="font-medium">{formatDateTime(workOrder.completedAt)}</span>
          </div>
        )}
      </div>

      {/* Customer & Vehicle Info */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Customer</h3>
          {workOrder.customer ? (
            <>
              <p className="font-medium">{workOrder.customer.name}</p>
              {workOrder.customer.phone && <p className="text-sm">{workOrder.customer.phone}</p>}
              {workOrder.customer.email && <p className="text-sm">{workOrder.customer.email}</p>}
              {workOrder.customer.address && <p className="text-sm">{workOrder.customer.address}</p>}
            </>
          ) : (
            <p className="text-gray-500 text-sm">No customer assigned</p>
          )}
        </div>
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Vehicle</h3>
          {workOrder.vehicle ? (
            <>
              <p className="font-medium">{workOrder.vehicle.make} {workOrder.vehicle.model}</p>
              <p className="text-sm">Plate: {workOrder.vehicle.plateNumber}</p>
              {workOrder.vehicle.year && <p className="text-sm">Year: {workOrder.vehicle.year}</p>}
              {workOrder.vehicle.color && <p className="text-sm">Color: {workOrder.vehicle.color}</p>}
              {workOrder.vehicle.vin && <p className="text-sm">VIN: {workOrder.vehicle.vin}</p>}
              {workOrder.vehicle.currentMileage && (
                <p className="text-sm">Mileage: {workOrder.vehicle.currentMileage.toLocaleString()} km</p>
              )}
            </>
          ) : (
            <p className="text-gray-500 text-sm">No vehicle assigned</p>
          )}
        </div>
      </div>

      {/* Services */}
      {workOrder.services.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold text-sm mb-2">Services</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left py-2 px-2">Service</th>
                <th className="text-left py-2 px-2">Technician</th>
                <th className="text-right py-2 px-2">Hours</th>
                <th className="text-right py-2 px-2">Rate</th>
                <th className="text-right py-2 px-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {workOrder.services.map((service) => (
                <tr key={service.id} className="border-b">
                  <td className="py-2 px-2">
                    {service.serviceType?.name || service.description || '-'}
                    {service.description && service.serviceType && (
                      <p className="text-xs text-gray-500">{service.description}</p>
                    )}
                  </td>
                  <td className="py-2 px-2">{service.technician?.name || '-'}</td>
                  <td className="text-right py-2 px-2">{service.hours || '-'}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(service.rate)}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(service.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Parts */}
      {workOrder.parts.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold text-sm mb-2">Parts</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left py-2 px-2">Part</th>
                <th className="text-left py-2 px-2">SKU</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Unit Price</th>
                <th className="text-right py-2 px-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {workOrder.parts.map((part) => (
                <tr key={part.id} className="border-b">
                  <td className="py-2 px-2">{part.item?.name || part.partName || '-'}</td>
                  <td className="py-2 px-2">{part.item?.sku || '-'}</td>
                  <td className="text-right py-2 px-2">{part.quantity}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(part.unitPrice)}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(part.totalPrice)}</td>
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
              <span>{formatCurrency(workOrder.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Tax:</span>
              <span>{formatCurrency(workOrder.taxAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg border-t pt-2">
              <span>Total:</span>
              <span>{formatCurrency(workOrder.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {workOrder.notes && (
        <div className="border rounded p-3 mt-4">
          <h3 className="font-semibold text-sm mb-2">Notes</h3>
          <p className="text-sm whitespace-pre-wrap">{workOrder.notes}</p>
        </div>
      )}

      {/* Signature Areas */}
      <div className="grid grid-cols-2 gap-8 mt-8 pt-4">
        <div className="border-t pt-2">
          <p className="text-sm text-gray-600 mb-8">Customer Signature</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">Date: _______________</p>
        </div>
        <div className="border-t pt-2">
          <p className="text-sm text-gray-600 mb-8">Authorized Signature</p>
          <div className="border-b border-gray-400 mb-1"></div>
          <p className="text-xs text-gray-500">Date: _______________</p>
        </div>
      </div>

      {/* Footer */}
      {settings.showFooter && (
        <div className="text-center mt-8 pt-4 border-t text-sm text-gray-600">
          <p>Thank you for your business!</p>
          <p className="text-xs mt-1">All work guaranteed. Payment due upon completion.</p>
        </div>
      )}
    </div>
  )
}
