'use client'

import { useState, useEffect } from 'react'
import { X, Search, Printer, MessageCircle, RotateCcw, Clock, ArrowRight, Loader2 } from 'lucide-react'
import { useCurrency } from '@/hooks/useCurrency'
import { buildWhatsAppShareUrl } from '@/lib/whatsapp'
import { useEscapeKey } from '@/hooks/useEscapeKey'

export interface PastSale {
  id: string
  invoiceNo: string
  total: number
  paymentMethod: string
  createdAt: string
  customerName?: string | null
  customerPhone?: string | null
  itemsCount?: number
  isReturn?: boolean
}

interface RecentSalesModalProps {
  isOpen: boolean
  onClose: () => void
  onPrintReceipt: (saleId: string) => void
  onReturnSale?: (saleId: string) => void
  shopName?: string
}

export function RecentSalesModal({
  isOpen,
  onClose,
  onPrintReceipt,
  onReturnSale,
  shopName = 'POSLanka',
}: RecentSalesModalProps) {
  const { currency: currencyCode } = useCurrency()
  const [sales, setSales] = useState<PastSale[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sharingSaleId, setSharingSaleId] = useState<string | null>(null)
  const [manualPhone, setManualPhone] = useState('')

  useEscapeKey(isOpen, onClose)

  useEffect(() => {
    if (!isOpen) return

    let isMounted = true

    const url = search.trim()
      ? `/api/sales?search=${encodeURIComponent(search.trim())}&pageSize=20`
      : '/api/sales?pageSize=20'

    fetch(url)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((data) => {
        if (!isMounted) return
        const list = Array.isArray(data) ? data : data.data || []
        const mapped: PastSale[] = list.map((s: Record<string, unknown>) => ({
          id: String(s.id),
          invoiceNo: String(s.invoiceNo || 'INV-UNKNOWN'),
          total: Number(s.total || 0),
          paymentMethod: String(s.paymentMethod || 'cash'),
          createdAt: String(s.createdAt || new Date().toISOString()),
          customerName: s.customerName ? String(s.customerName) : null,
          customerPhone: s.customerPhone ? String(s.customerPhone) : null,
          isReturn: Boolean(s.isReturn),
        }))
        setSales(mapped)
      })
      .catch(() => {
        if (isMounted) setSales([])
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, search])

  if (!isOpen) return null

  const handleShareWhatsApp = (sale: PastSale, customPhoneInput?: string) => {
    const phone = (customPhoneInput || sale.customerPhone || '').trim()
    const textLines = [
      `🧾 *${shopName}*`,
      `${sale.isReturn ? 'Return' : 'Sale'} Receipt: *${sale.invoiceNo}*`,
      sale.customerName ? `Customer: ${sale.customerName}` : null,
      `Total: *${currencyCode} ${sale.total.toFixed(2)}*`,
      `Payment: ${sale.paymentMethod.toUpperCase()}`,
      `Date: ${new Date(sale.createdAt).toLocaleString()}`,
      `Thank you for shopping with us!`,
    ].filter(Boolean).join('\n')

    const url = buildWhatsAppShareUrl({
      phone: phone || undefined,
      text: textLines,
    })
    window.open(url, '_blank', 'noopener,noreferrer')
    setSharingSaleId(null)
    setManualPhone('')
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] border border-gray-100 dark:border-gray-700 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/80">
          <div className="flex items-center gap-2.5">
            <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Recent Sales & Bill History</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-white rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by invoice number (e.g. INV-1001) or customer name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 p-2">
          {loading ? (
            <div className="py-16 text-center text-gray-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <p className="text-sm">Loading recent bills...</p>
            </div>
          ) : sales.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <p className="text-sm">No sales matching your query found.</p>
            </div>
          ) : (
            sales.map((sale) => (
              <div
                key={sale.id}
                className="p-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-2xl transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-bold text-sm text-gray-900 dark:text-white">
                      {sale.invoiceNo}
                    </span>
                    <span
                      className={`text-[11px] uppercase font-bold px-1.5 py-0.5 rounded ${
                        sale.isReturn
                          ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                          : 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {sale.isReturn ? 'Return' : sale.paymentMethod}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 truncate">
                    <span>{new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>•</span>
                    <span className="truncate">{sale.customerName ? `Customer: ${sale.customerName}` : 'Walk-in Customer'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0">
                  <span className="font-mono font-bold text-base text-gray-900 dark:text-white sm:text-right min-w-[90px]">
                    {currencyCode} {sale.total.toFixed(2)}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {/* Print bill */}
                    <button
                      type="button"
                      onClick={() => onPrintReceipt(sale.id)}
                      className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      title="Reprint Bill Receipt"
                    >
                      <Printer size={14} />
                      <span>Print</span>
                    </button>

                    {/* WhatsApp */}
                    <button
                      type="button"
                      onClick={() => {
                        if (!sale.customerPhone) {
                          setSharingSaleId(sale.id)
                        } else {
                          handleShareWhatsApp(sale)
                        }
                      }}
                      className="px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      title="Share bill via WhatsApp"
                    >
                      <MessageCircle size={14} />
                      <span>WhatsApp</span>
                    </button>

                    {/* Return */}
                    {onReturnSale && !sale.isReturn && (
                      <button
                        type="button"
                        onClick={() => onReturnSale(sale.id)}
                        className="px-2 py-1.5 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 text-red-600 dark:text-red-400 rounded-lg text-xs font-semibold transition-colors"
                        title="Process return against this bill"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline WhatsApp phone prompter if needed */}
                {sharingSaleId === sale.id && (
                  <div className="w-full sm:col-span-2 pt-2 flex items-center gap-2 border-t border-gray-100 dark:border-gray-700">
                    <input
                      type="tel"
                      placeholder="WhatsApp phone number (e.g. 0771234567)..."
                      value={manualPhone}
                      onChange={(e) => setManualPhone(e.target.value)}
                      className="flex-1 text-xs px-3 py-1.5 border border-emerald-300 dark:border-emerald-700 rounded-lg dark:bg-gray-700 dark:text-white font-mono"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleShareWhatsApp(sale, manualPhone)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                    >
                      Send <ArrowRight size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSharingSaleId(null); setManualPhone('') }}
                      className="px-2 py-1.5 text-gray-400 hover:text-gray-600 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
