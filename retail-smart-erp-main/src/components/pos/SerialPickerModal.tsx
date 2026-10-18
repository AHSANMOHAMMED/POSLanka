'use client'

import { useState, useEffect } from 'react'
import { X, Hash, Loader2, Check } from 'lucide-react'
import type { Item } from './types'

interface SerialNumber {
  id: string
  serialNumber: string
  warehouseId: string | null
}

interface SerialPickerModalProps {
  isOpen: boolean
  item: Item | null
  warehouseId: string | null
  quantity: number
  onClose: () => void
  onConfirm: (serialIds: string[]) => void
}

export function SerialPickerModal({ isOpen, item, warehouseId, quantity, onClose, onConfirm }: SerialPickerModalProps) {
  const [serials, setSerials] = useState<SerialNumber[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && item) {
      setSelected(new Set())
      setError(null)
      fetchSerials()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id, warehouseId])

  async function fetchSerials() {
    if (!item) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: 'available', all: 'true' })
      if (warehouseId) params.set('warehouseId', warehouseId)
      const res = await fetch(`/api/items/${item.id}/serial-numbers?${params}`)
      if (!res.ok) throw new Error('Failed to load serial numbers')
      const data = await res.json()
      setSerials(Array.isArray(data) ? data : data.data || [])
    } catch {
      setError('Failed to load serial numbers')
      setSerials([])
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !item) return null

  function toggleSerial(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else if (next.size < quantity) {
        next.add(id)
      }
      return next
    })
  }

  function handleConfirm() {
    if (selected.size !== quantity) return
    onConfirm(Array.from(selected))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Hash size={20} className="text-blue-600" />
            <h3 className="font-bold text-lg">Select Serial Numbers</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        {/* Item info */}
        <div className="px-5 pt-4 shrink-0">
          <div className="bg-gray-50 rounded-md p-3">
            <p className="font-semibold text-gray-900">{item.name}</p>
            <p className="text-sm text-gray-500 mt-1">
              Selected {selected.size} of {quantity} required
            </p>
          </div>
        </div>

        {/* Serial list */}
        <div className="px-5 py-3 flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <p className="text-center text-red-500 py-4 text-sm">{error}</p>
          ) : serials.length === 0 ? (
            <p className="text-center text-gray-500 py-4 text-sm">No available serial numbers found</p>
          ) : (
            <div className="space-y-1">
              {serials.map(serial => {
                const isSelected = selected.has(serial.id)
                const isDisabled = !isSelected && selected.size >= quantity
                return (
                  <button
                    key={serial.id}
                    onClick={() => toggleSerial(serial.id)}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-50 border border-blue-300'
                        : isDisabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                    }`}>
                      {isSelected && <Check size={14} className="text-white" />}
                    </div>
                    <span className="font-mono text-sm">{serial.serialNumber}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 pt-2 flex gap-3 shrink-0 border-t">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-md font-medium hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selected.size !== quantity}
            className="flex-1 py-3 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  )
}
