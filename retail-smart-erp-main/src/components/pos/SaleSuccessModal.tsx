'use client'

import { CheckCircle, Printer } from 'lucide-react'
import { useTerminology } from '@/hooks/useTerminology'
import { useCurrency } from '@/hooks/useCurrency'

interface SaleSuccessModalProps {
  lastSale: { invoiceNo: string; total: number; isReturn: boolean } | null
  lastSaleId: string | null
  onDismiss: () => void
  onPrintReceipt: (saleId: string) => void
  printingReceipt?: boolean
}

export function SaleSuccessModal({ lastSale, lastSaleId, onDismiss, onPrintReceipt }: SaleSuccessModalProps) {
  const terms = useTerminology()
  const { currency: currencyCode } = useCurrency()
  if (!lastSale) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-8 text-center shadow-2xl">
        <div className={`w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center ${
          lastSale.isReturn ? 'bg-red-100' : 'bg-green-100'
        }`}>
          <CheckCircle size={56} className={lastSale.isReturn ? 'text-red-600' : 'text-green-600'} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {lastSale.isReturn ? 'Return Complete!' : `${terms.saleCompleted}!`}
        </h2>
        <p className="text-gray-500 mb-1">Invoice Number</p>
        <p className="text-xl font-bold text-blue-600 mb-6">{lastSale.invoiceNo}</p>
        <div className={`rounded-2xl p-5 mb-6 ${lastSale.isReturn ? 'bg-red-50' : 'bg-gray-50'}`}>
          <p className="text-sm text-gray-500 mb-1">{lastSale.isReturn ? 'Refund Amount' : 'Total'}</p>
          <p className={`text-4xl font-bold ${lastSale.isReturn ? 'text-red-600' : 'text-gray-900'}`}>
            {currencyCode} {lastSale.total.toFixed(2)}
          </p>
        </div>
        <div className="space-y-3">
          {lastSaleId && (
            <button
              onClick={() => onPrintReceipt(lastSaleId)}
              className="w-full py-3.5 border-2 border-gray-200 text-gray-700 rounded-2xl font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              <Printer size={18} />
              Print Receipt
            </button>
          )}
          <button
            onClick={onDismiss}
            className={`w-full py-4 text-white rounded-2xl font-bold text-lg shadow-lg transition-all ${
              lastSale.isReturn
                ? 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600'
                : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600'
            }`}
          >
            {lastSale.isReturn ? 'Continue' : terms.newSale}
          </button>
        </div>
      </div>
    </div>
  )
}
