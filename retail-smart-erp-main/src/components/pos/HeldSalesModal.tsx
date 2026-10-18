'use client'

import { Clock, X, Play, Trash2 } from 'lucide-react'
import { useCurrency } from '@/hooks/useCurrency'
import type { HeldSale } from './types'

interface HeldSalesModalProps {
  isOpen: boolean
  onClose: () => void
  heldSales: HeldSale[]
  onRecall: (heldSale: HeldSale) => void
  onDelete: (id: string) => void
}

export function HeldSalesModal({ isOpen, onClose, heldSales, onRecall, onDelete }: HeldSalesModalProps) {
  const { currency: currencyCode } = useCurrency()
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-5 border-b bg-amber-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-md flex items-center justify-center">
              <Clock className="text-amber-600" size={20} />
            </div>
            <h2 className="text-lg font-bold text-gray-900">Held Sales</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-amber-100 rounded-md">
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {heldSales.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No held sales</div>
          ) : (
            <div className="space-y-3">
              {heldSales.map(held => (
                <div key={held.id} className="border-2 border-gray-100 rounded-2xl p-4 hover:border-amber-300 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-bold text-amber-700">{held.holdNumber}</div>
                      <div className="text-sm text-gray-500">{new Date(held.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">{currencyCode} {parseFloat(held.subtotal).toFixed(2)}</div>
                      <div className="text-xs text-gray-500">{held.cartItems.length} items</div>
                    </div>
                  </div>
                  {(held.customer || held.vehicle) && (
                    <div className="text-sm text-gray-600 mb-3">
                      {held.customer && <span>{held.customer.name}</span>}
                      {held.customer && held.vehicle && <span> &bull; </span>}
                      {held.vehicle && <span>{held.vehicle.make} {held.vehicle.model}</span>}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => onRecall(held)}
                      className="flex-1 py-2.5 bg-amber-500 text-white rounded-md font-medium hover:bg-amber-600 flex items-center justify-center gap-2"
                    >
                      <Play size={16} />
                      Recall
                    </button>
                    <button
                      onClick={() => onDelete(held.id)}
                      className="px-4 py-2.5 border-2 border-red-200 text-red-600 rounded-md hover:bg-red-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
