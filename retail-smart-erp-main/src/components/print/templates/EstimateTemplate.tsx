'use client'

import { PrintSettings } from '@/lib/print/types'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface EstimateItem {
  id: string
  itemType: 'service' | 'part'
  description: string | null
  hours: number | null
  rate: string | null
  partName: string | null
  quantity: number | null
  unitPrice: string | null
  originalAmount: string
  approvedAmount: string | null
  status: string
}

interface EstimateData {
  estimateNo: string
  estimateType: 'insurance' | 'direct'
  status: string
  createdAt: string
  incidentDate: string | null
  incidentDescription: string | null
  policyNumber: string | null
  claimNumber: string | null
  assessorName: string | null
  insuranceRemarks: string | null
  originalSubtotal: string
  originalTaxAmount: string
  originalTotal: string
  approvedSubtotal: string | null
  approvedTaxAmount: string | null
  approvedTotal: string | null
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
  } | null
  insuranceCompany: {
    name: string
    shortName: string | null
  } | null
  items: EstimateItem[]
}

interface EstimateTemplateProps {
  estimate: EstimateData
  settings: PrintSettings
  businessName: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
  currencyCode?: string
}

export function EstimateTemplate({
  estimate,
  settings,
  businessName,
  businessAddress,
  businessPhone,
  businessEmail,
  currencyCode = 'LKR'
}: EstimateTemplateProps) {
  const isInsurance = estimate.estimateType === 'insurance'
  const showApproved = ['approved', 'partially_approved', 'work_order_created'].includes(estimate.status)
  const services = estimate.items.filter(i => i.itemType === 'service')
  const parts = estimate.items.filter(i => i.itemType === 'part')

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

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'Pending',
      approved: 'Approved',
      price_adjusted: 'Price Adjusted',
      rejected: 'Rejected',
      requires_reinspection: 'Requires Re-inspection'
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
        <h2 className="text-xl font-bold">
          {isInsurance ? 'INSURANCE ESTIMATE' : 'ESTIMATE'}
        </h2>
        <p className="text-lg font-semibold">{estimate.estimateNo}</p>
        <p className="text-sm text-gray-600">Date: {formatDate(estimate.createdAt)}</p>
      </div>

      {/* Customer & Vehicle Info */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Customer</h3>
          {estimate.customer ? (
            <>
              <p className="font-medium">{estimate.customer.name}</p>
              {estimate.customer.phone && <p className="text-sm">{estimate.customer.phone}</p>}
              {estimate.customer.email && <p className="text-sm">{estimate.customer.email}</p>}
              {estimate.customer.address && <p className="text-sm">{estimate.customer.address}</p>}
            </>
          ) : (
            <p className="text-gray-500 text-sm">No customer assigned</p>
          )}
        </div>
        <div className="border rounded p-3">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Vehicle</h3>
          {estimate.vehicle ? (
            <>
              <p className="font-medium">{estimate.vehicle.make} {estimate.vehicle.model}</p>
              <p className="text-sm">Plate: {estimate.vehicle.plateNumber}</p>
              {estimate.vehicle.year && <p className="text-sm">Year: {estimate.vehicle.year}</p>}
              {estimate.vehicle.color && <p className="text-sm">Color: {estimate.vehicle.color}</p>}
              {estimate.vehicle.vin && <p className="text-sm">VIN: {estimate.vehicle.vin}</p>}
            </>
          ) : (
            <p className="text-gray-500 text-sm">No vehicle assigned</p>
          )}
        </div>
      </div>

      {/* Insurance Info (only for insurance estimates) */}
      {isInsurance && estimate.insuranceCompany && (
        <div className="border rounded p-3 mb-4">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Insurance Details</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-gray-600">Company:</span>{' '}
              <span className="font-medium">{estimate.insuranceCompany.name}</span>
            </div>
            {estimate.policyNumber && (
              <div>
                <span className="text-gray-600">Policy No:</span>{' '}
                <span className="font-medium">{estimate.policyNumber}</span>
              </div>
            )}
            {estimate.claimNumber && (
              <div>
                <span className="text-gray-600">Claim No:</span>{' '}
                <span className="font-medium">{estimate.claimNumber}</span>
              </div>
            )}
            {estimate.assessorName && (
              <div>
                <span className="text-gray-600">Assessor:</span>{' '}
                <span className="font-medium">{estimate.assessorName}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Incident Info */}
      {(estimate.incidentDate || estimate.incidentDescription) && (
        <div className="border rounded p-3 mb-4">
          <h3 className="font-semibold text-sm mb-2 border-b pb-1">Incident Details</h3>
          {estimate.incidentDate && (
            <p className="text-sm">
              <span className="text-gray-600">Date:</span> {formatDate(estimate.incidentDate)}
            </p>
          )}
          {estimate.incidentDescription && (
            <p className="text-sm mt-1">{estimate.incidentDescription}</p>
          )}
        </div>
      )}

      {/* Services */}
      {services.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold text-sm mb-2">Services</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left py-2 px-2">Description</th>
                <th className="text-right py-2 px-2">Hours</th>
                <th className="text-right py-2 px-2">Rate</th>
                <th className="text-right py-2 px-2">Amount</th>
                {showApproved && (
                  <>
                    <th className="text-center py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Approved</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {services.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="py-2 px-2">{item.description || '-'}</td>
                  <td className="text-right py-2 px-2">{item.hours || '-'}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(item.rate)}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(item.originalAmount)}</td>
                  {showApproved && (
                    <>
                      <td className="text-center py-2 px-2">{getStatusLabel(item.status)}</td>
                      <td className="text-right py-2 px-2">
                        {item.status === 'rejected' ? '-' : formatCurrency(item.approvedAmount)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Parts */}
      {parts.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold text-sm mb-2">Parts</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left py-2 px-2">Part Name</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Unit Price</th>
                <th className="text-right py-2 px-2">Amount</th>
                {showApproved && (
                  <>
                    <th className="text-center py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Approved</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {parts.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="py-2 px-2">{item.partName || '-'}</td>
                  <td className="text-right py-2 px-2">{item.quantity || '-'}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(item.unitPrice)}</td>
                  <td className="text-right py-2 px-2">{formatCurrency(item.originalAmount)}</td>
                  {showApproved && (
                    <>
                      <td className="text-center py-2 px-2">{getStatusLabel(item.status)}</td>
                      <td className="text-right py-2 px-2">
                        {item.status === 'rejected' ? '-' : formatCurrency(item.approvedAmount)}
                      </td>
                    </>
                  )}
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
            {showApproved ? (
              <>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Original Subtotal:</span>
                  <span>{formatCurrency(estimate.originalSubtotal)}</span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Original Tax:</span>
                  <span>{formatCurrency(estimate.originalTaxAmount)}</span>
                </div>
                <div className="flex justify-between text-sm mb-2 pb-2 border-b">
                  <span className="text-gray-600">Original Total:</span>
                  <span>{formatCurrency(estimate.originalTotal)}</span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Approved Subtotal:</span>
                  <span className="font-medium">{formatCurrency(estimate.approvedSubtotal)}</span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Approved Tax:</span>
                  <span className="font-medium">{formatCurrency(estimate.approvedTaxAmount)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>Approved Total:</span>
                  <span>{formatCurrency(estimate.approvedTotal)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Subtotal:</span>
                  <span>{formatCurrency(estimate.originalSubtotal)}</span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Tax:</span>
                  <span>{formatCurrency(estimate.originalTaxAmount)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>Total:</span>
                  <span>{formatCurrency(estimate.originalTotal)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Insurance Remarks */}
      {isInsurance && estimate.insuranceRemarks && (
        <div className="border rounded p-3 mt-4">
          <h3 className="font-semibold text-sm mb-2">Insurance Remarks</h3>
          <p className="text-sm">{estimate.insuranceRemarks}</p>
        </div>
      )}

      {/* Footer */}
      {settings.showFooter && (
        <div className="text-center mt-8 pt-4 border-t text-sm text-gray-600">
          <p>Thank you for your business!</p>
          <p className="text-xs mt-1">This estimate is valid for 30 days from the date of issue.</p>
        </div>
      )}
    </div>
  )
}
