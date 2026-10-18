'use client'

import { Search, X, Package, Loader2 } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import type { SaleForReturn } from './types'

interface ReturnLookupModalProps {
  isOpen: boolean
  onClose: () => void
  onLoadSaleForReturn: (sale: SaleForReturn) => void
  onManualReturnMode: () => void
  returnSearchQuery: string
  setReturnSearchQuery: (query: string) => void
  returnSearchResults: SaleForReturn[]
  searchingReturns: boolean
}

export function ReturnLookupModal({
  isOpen,
  onClose,
  onLoadSaleForReturn,
  onManualReturnMode,
  returnSearchQuery,
  setReturnSearchQuery,
  returnSearchResults,
  searchingReturns,
}: ReturnLookupModalProps) {
  const { currency: currencyCode } = useCurrency()
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="px-6 py-5 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Process Return</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-md"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={onManualReturnMode}
              className="p-6 border-2 border-dashed border-gray-300 rounded-2xl hover:border-red-400 hover:bg-red-50 transition-colors text-center"
            >
              <Package size={40} className="mx-auto mb-3 text-gray-400" />
              <div className="font-semibold text-gray-900">Manual Entry</div>
              <div className="text-sm text-gray-500 mt-1">Add return items manually</div>
            </button>
            <div className="p-6 border-2 border-red-200 bg-red-50 rounded-2xl text-center">
              <Search size={40} className="mx-auto mb-3 text-red-500" />
              <div className="font-semibold text-red-700">Lookup Invoice</div>
              <div className="text-sm text-gray-500 mt-1">Search existing invoice</div>
            </div>
          </div>

          <div className="mb-4">
            <FormInput
              type="text"
              placeholder="Search by invoice number or customer..."
              value={returnSearchQuery}
              onChange={(e) => setReturnSearchQuery(e.target.value)}
              leftIcon={<Search size={20} />}
              inputSize="lg"
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {searchingReturns ? (
              <div className="text-center py-8">
                <Loader2 className="animate-spin mx-auto text-red-500" size={32} />
                <p className="text-gray-500 mt-2">Searching...</p>
              </div>
            ) : returnSearchResults.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {returnSearchQuery ? 'No sales found' : 'Enter invoice number to search'}
              </div>
            ) : (
              <div className="space-y-2">
                {returnSearchResults.map((sale) => (
                  <button
                    key={sale.id}
                    onClick={() => onLoadSaleForReturn(sale)}
                    className="w-full p-4 border-2 border-gray-100 rounded-md hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-gray-900">{sale.invoiceNo}</div>
                        <div className="text-sm text-gray-500">
                          {sale.customer?.name || 'Walk-in'} &bull; {new Date(sale.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-lg">{currencyCode} {parseFloat(sale.total).toFixed(2)}</div>
                        <div className="text-xs text-gray-500">{sale.items?.length || 0} items</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
