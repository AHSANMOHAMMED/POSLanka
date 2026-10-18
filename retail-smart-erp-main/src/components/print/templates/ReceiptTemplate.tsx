'use client'

import { PrintSettings } from '@/lib/print/types'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface SaleItem {
  id: string
  quantity: number
  unitPrice: string
  totalPrice: string
  discount: string
  item: {
    name: string
    sku: string | null
  }
}

interface Payment {
  id: string
  method: string
  amount: string
  reference: string | null
}

interface SaleData {
  saleNo: string
  status: string
  createdAt: string
  subtotal: string
  taxAmount: string
  discountAmount: string
  total: string
  paidAmount: string
  changeAmount: string
  notes: string | null
  customer: {
    name: string
    phone: string | null
    email: string | null
  } | null
  items: SaleItem[]
  payments: Payment[]
  cashier: {
    name: string
  } | null
}

interface ReceiptTemplateProps {
  sale: SaleData
  settings: PrintSettings
  businessName: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
  taxId?: string
  currencyCode?: string
  receiptHeader?: string
  receiptFooter?: string
}

export function ReceiptTemplate({
  sale,
  settings,
  businessName,
  businessAddress,
  businessPhone,
  businessEmail,
  taxId,
  currencyCode,
  receiptHeader,
  receiptFooter,
}: ReceiptTemplateProps) {
  const currency = currencyCode || 'LKR'
  const isThermal = settings.paperSize.startsWith('thermal')

  const formatCurrency = (value: string | null) => {
    if (!value) return '-'
    const amount = parseFloat(value)
    return formatCurrencyWithSymbol(amount, currency)
  }

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getPaymentMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      cash: 'Cash',
      card: 'Card',
      bank_transfer: 'Bank Transfer',
      mobile_payment: 'Mobile Payment',
      gift_card: 'Gift Card',
      layaway: 'Layaway',
      credit: 'Credit'
    }
    return labels[method] || method
  }

  // Thermal receipt layout (narrow)
  if (isThermal) {
    return (
      <div className="print-content" style={{ fontSize: '11px' }}>
        {/* Header */}
        {settings.showHeader && (
          <div className="text-center mb-2">
            <p className="font-bold text-sm">{businessName}</p>
            {businessAddress && <p className="text-xs">{businessAddress}</p>}
            {businessPhone && <p className="text-xs">{businessPhone}</p>}
            {taxId && <p className="text-xs">Tax ID: {taxId}</p>}
          </div>
        )}

        <div className="border-t border-dashed border-gray-400 my-2"></div>

        {/* Receipt Info */}
        <div className="text-xs mb-2">
          <div className="flex justify-between">
            <span>Receipt:</span>
            <span className="font-medium">{sale.saleNo}</span>
          </div>
          <div className="flex justify-between">
            <span>Date:</span>
            <span>{formatDateTime(sale.createdAt)}</span>
          </div>
          {sale.cashier && (
            <div className="flex justify-between">
              <span>Cashier:</span>
              <span>{sale.cashier.name}</span>
            </div>
          )}
          {sale.customer && (
            <div className="flex justify-between">
              <span>Customer:</span>
              <span>{sale.customer.name}</span>
            </div>
          )}
        </div>

        <div className="border-t border-dashed border-gray-400 my-2"></div>

        {/* Items */}
        <div className="mb-2">
          {sale.items.map((item) => (
            <div key={item.id} className="mb-1">
              <div className="font-medium truncate">{item.item.name}</div>
              <div className="flex justify-between text-xs">
                <span>{item.quantity} x {formatCurrency(item.unitPrice)}</span>
                <span>{formatCurrency(item.totalPrice)}</span>
              </div>
              {parseFloat(item.discount) > 0 && (
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Discount</span>
                  <span>-{formatCurrency(item.discount)}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-gray-400 my-2"></div>

        {/* Totals */}
        <div className="text-xs">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span>{formatCurrency(sale.subtotal)}</span>
          </div>
          {parseFloat(sale.discountAmount) > 0 && (
            <div className="flex justify-between">
              <span>Discount:</span>
              <span>-{formatCurrency(sale.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Tax:</span>
            <span>{formatCurrency(sale.taxAmount)}</span>
          </div>
          <div className="flex justify-between font-bold text-sm mt-1 pt-1 border-t">
            <span>TOTAL:</span>
            <span>{formatCurrency(sale.total)}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-gray-400 my-2"></div>

        {/* Payments */}
        <div className="text-xs mb-2">
          <p className="font-medium mb-1">Payment:</p>
          {sale.payments.map((payment) => (
            <div key={payment.id} className="flex justify-between">
              <span>{getPaymentMethodLabel(payment.method)}</span>
              <span>{formatCurrency(payment.amount)}</span>
            </div>
          ))}
          {parseFloat(sale.changeAmount) > 0 && (
            <div className="flex justify-between font-medium mt-1">
              <span>Change:</span>
              <span>{formatCurrency(sale.changeAmount)}</span>
            </div>
          )}
        </div>

        {/* Custom Header Message */}
        {receiptHeader && (
          <div className="text-center text-xs mt-2 mb-1">{receiptHeader}</div>
        )}

        {/* Footer */}
        {settings.showFooter && (
          <div className="text-center mt-4 pt-2 border-t border-dashed border-gray-400">
            <p className="text-xs">{receiptFooter || 'Thank you for your purchase!'}</p>
            {!receiptFooter && <p className="text-xs mt-1">Please keep this receipt for your records.</p>}
          </div>
        )}
      </div>
    )
  }

  // Standard paper layout (A4, Letter, etc.)
  return (
    <div className="print-content">
      {/* Header */}
      {settings.showHeader && (
        <div className="text-center mb-6 border-b pb-4">
          <h1 className="text-2xl font-bold">{businessName}</h1>
          {businessAddress && <p className="text-sm text-gray-600">{businessAddress}</p>}
          <div className="text-sm text-gray-600">
            {businessPhone && <span>{businessPhone}</span>}
            {businessPhone && businessEmail && <span> | </span>}
            {businessEmail && <span>{businessEmail}</span>}
          </div>
          {taxId && <p className="text-sm text-gray-600">Tax ID: {taxId}</p>}
        </div>
      )}

      {/* Document Title */}
      <div className="text-center mb-4">
        <h2 className="text-xl font-bold">SALES RECEIPT</h2>
        <p className="text-lg font-semibold">{sale.saleNo}</p>
        <p className="text-sm text-gray-600">{formatDateTime(sale.createdAt)}</p>
      </div>

      {/* Customer & Transaction Info */}
      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          {sale.customer && (
            <>
              <p className="text-gray-600">Customer:</p>
              <p className="font-medium">{sale.customer.name}</p>
              {sale.customer.phone && <p>{sale.customer.phone}</p>}
            </>
          )}
        </div>
        <div className="text-right">
          {sale.cashier && (
            <>
              <p className="text-gray-600">Served by:</p>
              <p className="font-medium">{sale.cashier.name}</p>
            </>
          )}
        </div>
      </div>

      {/* Items */}
      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="bg-gray-100">
            <th className="text-left py-2 px-3">Item</th>
            <th className="text-left py-2 px-3">SKU</th>
            <th className="text-right py-2 px-3">Qty</th>
            <th className="text-right py-2 px-3">Price</th>
            <th className="text-right py-2 px-3">Discount</th>
            <th className="text-right py-2 px-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="py-2 px-3">{item.item.name}</td>
              <td className="py-2 px-3">{item.item.sku || '-'}</td>
              <td className="text-right py-2 px-3">{item.quantity}</td>
              <td className="text-right py-2 px-3">{formatCurrency(item.unitPrice)}</td>
              <td className="text-right py-2 px-3">
                {parseFloat(item.discount) > 0 ? `-${formatCurrency(item.discount)}` : '-'}
              </td>
              <td className="text-right py-2 px-3">{formatCurrency(item.totalPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mb-4">
        <div className="w-64">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Subtotal:</span>
            <span>{formatCurrency(sale.subtotal)}</span>
          </div>
          {parseFloat(sale.discountAmount) > 0 && (
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Discount:</span>
              <span>-{formatCurrency(sale.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Tax:</span>
            <span>{formatCurrency(sale.taxAmount)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg border-t pt-2">
            <span>Total:</span>
            <span>{formatCurrency(sale.total)}</span>
          </div>
        </div>
      </div>

      {/* Payments */}
      <div className="border rounded p-3 mb-4">
        <h3 className="font-semibold text-sm mb-2">Payment Details</h3>
        <div className="space-y-1 text-sm">
          {sale.payments.map((payment) => (
            <div key={payment.id} className="flex justify-between">
              <span>{getPaymentMethodLabel(payment.method)}</span>
              <span>{formatCurrency(payment.amount)}</span>
            </div>
          ))}
          {parseFloat(sale.changeAmount) > 0 && (
            <div className="flex justify-between font-medium pt-2 border-t mt-2">
              <span>Change Given:</span>
              <span>{formatCurrency(sale.changeAmount)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      {sale.notes && (
        <div className="border rounded p-3 mb-4">
          <h3 className="font-semibold text-sm mb-1">Notes</h3>
          <p className="text-sm">{sale.notes}</p>
        </div>
      )}

      {/* Footer */}
      {settings.showFooter && (
        <div className="text-center mt-8 pt-4 border-t text-sm text-gray-600">
          <p>{receiptFooter || 'Thank you for your purchase!'}</p>
          {!receiptFooter && (
            <>
              <p className="text-xs mt-1">Please keep this receipt for your records.</p>
              <p className="text-xs">Returns accepted within 7 days with receipt.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
