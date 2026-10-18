'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { AlertTriangle, Package } from 'lucide-react'

export interface StockIssueItem {
  itemId: string // estimate item id
  partName: string
  inventoryItemId: string
  requiredQty: number
  availableStock: number
}

export interface ItemAdjustment {
  itemId: string
  action: 'convert' | 'skip' | 'partial'
  quantity?: number
}

interface StockAdjustmentModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (adjustments: ItemAdjustment[]) => void
  items: StockIssueItem[]
  processing?: boolean
}

type AdjustmentState = {
  [itemId: string]: {
    action: 'partial' | 'skip'
    quantity: number
  }
}

export function StockAdjustmentModal({
  isOpen,
  onClose,
  onConfirm,
  items,
  processing = false,
}: StockAdjustmentModalProps) {
  const [adjustments, setAdjustments] = useState<AdjustmentState>({})

  // Initialize adjustments when modal opens
  useEffect(() => {
    if (isOpen && items.length > 0) {
      const initial: AdjustmentState = {}
      for (const item of items) {
        // Default to partial with available stock
        initial[item.itemId] = {
          action: item.availableStock > 0 ? 'partial' : 'skip',
          quantity: item.availableStock > 0 ? item.availableStock : 0,
        }
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdjustments(initial)
    }
  }, [isOpen, items])

  function handleActionChange(itemId: string, action: 'partial' | 'skip', availableStock: number) {
    setAdjustments(prev => ({
      ...prev,
      [itemId]: {
        action,
        quantity: action === 'partial' ? availableStock : 0,
      },
    }))
  }

  function handleQuantityChange(itemId: string, quantity: number, availableStock: number) {
    const validQty = Math.min(Math.max(0, quantity), availableStock)
    setAdjustments(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        quantity: validQty,
        action: validQty > 0 ? 'partial' : 'skip',
      },
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const result: ItemAdjustment[] = items.map(item => {
      const adj = adjustments[item.itemId]
      if (!adj || adj.action === 'skip' || adj.quantity === 0) {
        return { itemId: item.itemId, action: 'skip' as const }
      }
      return {
        itemId: item.itemId,
        action: 'partial' as const,
        quantity: adj.quantity,
      }
    })

    onConfirm(result)
  }

  // Count how many items will be converted (partial with qty > 0)
  const itemsToConvert = items.filter(item => {
    const adj = adjustments[item.itemId]
    return adj && adj.action === 'partial' && adj.quantity > 0
  }).length

  const itemsToSkip = items.length - itemsToConvert

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Stock Availability Issue" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={24} />
          <div>
            <p className="text-amber-800 font-semibold">Some items have insufficient stock</p>
            <p className="text-amber-700 text-sm mt-1">
              Choose how to handle each item below. You can take the available quantity or skip items entirely.
            </p>
          </div>
        </div>

        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {items.map(item => {
            const adj = adjustments[item.itemId] || { action: 'skip', quantity: 0 }
            const hasStock = item.availableStock > 0

            return (
              <div key={item.itemId} className="p-4 border rounded bg-gray-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Package className="text-gray-400 mt-1" size={20} />
                    <div>
                      <p className="font-medium">{item.partName}</p>
                      <p className="text-sm text-gray-600">
                        Required: <span className="font-medium text-red-600">{item.requiredQty}</span>
                        {' | '}
                        Available: <span className={`font-medium ${hasStock ? 'text-green-600' : 'text-red-600'}`}>
                          {item.availableStock}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {hasStock ? (
                      <>
                        <select
                          value={adj.action}
                          onChange={(e) => handleActionChange(item.itemId, e.target.value as 'partial' | 'skip', item.availableStock)}
                          className="px-3 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="partial">Take partial</option>
                          <option value="skip">Skip item</option>
                        </select>

                        {adj.action === 'partial' && (
                          <input
                            type="number"
                            min={1}
                            max={item.availableStock}
                            value={adj.quantity}
                            onChange={(e) => handleQuantityChange(item.itemId, parseInt(e.target.value) || 0, item.availableStock)}
                            className="w-20 px-2 py-1.5 border rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        )}
                      </>
                    ) : (
                      <span className="px-3 py-1.5 bg-red-100 text-red-700 text-sm rounded">
                        No stock - will skip
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="p-3 bg-gray-100 rounded">
          <div className="flex justify-between text-sm">
            <span>Items to convert (partial):</span>
            <span className="font-medium text-green-600">{itemsToConvert}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span>Items to skip:</span>
            <span className="font-medium text-orange-600">{itemsToSkip}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={processing}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {processing ? 'Converting...' : 'Continue with Conversion'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
