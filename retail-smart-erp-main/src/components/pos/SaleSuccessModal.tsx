'use client'

import { CheckCircle, Printer, Truck } from 'lucide-react'
import { useTerminology } from '@/hooks/useTerminology'
import { useCurrency } from '@/hooks/useCurrency'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { SendReceiptButtons, useMessagingAvailability } from './SendReceiptButtons'
import { BillShareButtons } from './BillShareButtons'
import { Kbd } from './Kbd'

interface SaleSuccessModalProps {
  lastSale: {
    invoiceNo: string
    total: number
    isReturn: boolean
    customerName?: string | null
    customerPhone?: string | null
  } | null
  lastSaleId: string | null
  onDismiss: () => void
  onPrintReceipt: (saleId: string) => void
  printingReceipt?: boolean
  shopName?: string
  /** Deliveries module: open the delivery scheduler for this invoice (key D; the page handles the key) */
  onScheduleDelivery?: () => void
}

export function SaleSuccessModal({
  lastSale,
  lastSaleId,
  onDismiss,
  onPrintReceipt,
  printingReceipt,
  shopName = 'skyERPOS',
  onScheduleDelivery,
}: SaleSuccessModalProps) {
  const terms = useTerminology()
  const { currency: currencyCode } = useCurrency()
  const whatsappOn = useFeatureFlag('whatsapp')
  const messaging = useMessagingAvailability()

  useEscapeKey(!!lastSale, onDismiss, onDismiss)

  if (!lastSale) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-sm p-7 text-center shadow-2xl border border-gray-100 dark:border-gray-700 animate-in fade-in zoom-in-95 duration-150">
        <div
          className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${
            lastSale.isReturn ? 'bg-red-100 dark:bg-red-950/40' : 'bg-emerald-100 dark:bg-emerald-950/40'
          }`}
        >
          <CheckCircle
            size={48}
            className={lastSale.isReturn ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
          />
        </div>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
          {lastSale.isReturn ? 'Return Complete!' : `${terms.saleCompleted}!`}
        </h2>

        <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">Invoice No</p>
        <p className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 mb-3">{lastSale.invoiceNo}</p>

        {lastSale.customerName && (
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-3 font-medium bg-gray-50 dark:bg-gray-700/50 py-1 px-2.5 rounded-lg inline-block">
            Customer: <span className="font-bold">{lastSale.customerName}</span>
          </p>
        )}

        <div className={`rounded-2xl p-4 mb-4 ${lastSale.isReturn ? 'bg-red-50 dark:bg-red-950/30' : 'bg-gray-50 dark:bg-gray-700/40'}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{lastSale.isReturn ? 'Refund Amount' : 'Total'}</p>
          <p className={`text-3xl font-bold font-mono ${lastSale.isReturn ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
            {currencyCode} {lastSale.total.toFixed(2)}
          </p>
        </div>

        <div className="space-y-2.5">
          {lastSaleId && (
            <button
              onClick={() => onPrintReceipt(lastSaleId)}
              disabled={printingReceipt}
              className="w-full py-3 border-2 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <Printer size={18} className="text-gray-600 dark:text-gray-300" />
              {printingReceipt ? 'Printing...' : 'Print Bill Receipt'}
            </button>
          )}

          {onScheduleDelivery && !lastSale.isReturn && (
            <button
              type="button"
              onClick={onScheduleDelivery}
              title="Schedule delivery / installation (opens in a new tab)"
              className="w-full py-3 border-2 border-teal-200 dark:border-teal-900 text-teal-800 dark:text-teal-300 bg-teal-50/60 dark:bg-teal-950/30 rounded-xl font-semibold hover:bg-teal-50 dark:hover:bg-teal-950/50 transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <Truck size={18} />
              Schedule delivery
              <Kbd>D</Kbd>
            </button>
          )}

          {/* SMS / WhatsApp sent by the server (messaging plan) */}
          {lastSaleId && (messaging.sms || messaging.whatsapp) && (
            <SendReceiptButtons saleId={lastSaleId} defaultPhone={lastSale.customerPhone} availability={messaging} />
          )}
          {/* WhatsApp chat of the customer with the bill PDF link, and the PDF itself */}
          {lastSaleId && (
            <BillShareButtons saleId={lastSaleId} shopName={shopName} phone={lastSale.customerPhone} showWhatsApp={whatsappOn} />
          )}

          <button
            onClick={onDismiss}
            className={`w-full py-3.5 text-white rounded-xl font-bold text-base shadow-md transition-all active:scale-[0.98] ${
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
